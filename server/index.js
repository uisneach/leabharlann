require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const neo4j = require('neo4j-driver');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// --- Neo4j Driver ---
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

// --- JWT Secret ---
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// --- Define Middleware ---
const app = express();
app.set('trust proxy', 1); // Allow for one reverse proxy in the network path (i.e. Render's)
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '50kb' })); // Limit payload size to 50kb

// --- Rate Limiting ---
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute per IP
});
app.use(limiter);

// --- Swagger Documentation ---
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Leabharlann Ghealach API',
      version: '1.0.0',
      description: 'API for managing nodes and relationships in Neo4j'
    },
    servers: [{ url: 'http://localhost:3000', description: 'Development server' }]
  },
  apis: ['./index.js']
};
const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// --- Helper to Validate Identifiers ---
function validIdentifier(str) {
  return typeof str === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(str);
}

// --- Auth Middleware ---
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } });
  }
  const token = auth.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!['user', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid user role' } });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}

// --- Admin-Only Middleware ---
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  next();
}

// --- Custom String Sanitization Middleware ---
const SANITIZATION_REGEX = /[^\p{L}\p{N}\p{P}\p{Z}\s]/gu; // Allow Unicode letters (e.g., Gaelic á), numbers, punctuation, spaces; block others
const CYPHER_KEYWORDS = ['MATCH', 'DELETE', 'MERGE', 'SET', 'REMOVE', 'RETURN', 'UNWIND', 'CALL', '--', '/*']; // Potential injection indicators

function sanitizeString(value) {
  if (typeof value === 'string') {
    value = value.trim(); // Trim whitespace
    // Check for Cypher injection markers
    for (const keyword of CYPHER_KEYWORDS) {
      if (value.toUpperCase().includes(keyword)) {
        throw new Error(`Potential injection detected in input: ${keyword}`);
      }
    }
    // Restrict to standard characters
    value = value.replace(SANITIZATION_REGEX, ''); // Remove disallowed chars
    return value;
  }
  return value; // Non-strings pass through
}

function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeString(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  const sanitized = {};
  for (const key in obj) {
    sanitized[key] = sanitizeObject(obj[key]);
  }
  return sanitized;
}

app.use((req, res, next) => {
  try {
    if (req.body) req.body = sanitizeObject(req.body);
    if (req.query) req.query = sanitizeObject(req.query);
    if (req.params) req.params = sanitizeObject(req.params);
    next();
  } catch (err) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: err.message } });
  }
});

// --- User Registration ---
/**
 * @openapi
 * /register:
 *   post:
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Username already exists
 */
app.post('/register', async (req, res, next) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required' } });
  }
  const session = driver.session();
  try {
    const existing = await session.run(
      'MATCH (u:User {username: $username}) RETURN u',
      { username }
    );
    if (existing.records.length > 0) {
      return res.status(409).json({ error: { code: 'USER_EXISTS', message: 'Username already exists' } });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    await session.run(
      'CREATE (u:User:Entity {username: $username, passwordHash: $passwordHash, role: $role})',
      { username, passwordHash, role: 'user' }
    );
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Set User Role (Admin Only) ---
/**
 * @openapi
 * /users/{username}/role:
 *   put:
 *     summary: Set user role (admin only)
 *     parameters:
 *       - name: username
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [user, admin]
 *     responses:
 *       200:
 *         description: User role updated successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
app.put('/users/:username/role', requireAuth, requireAdmin, async (req, res, next) => {
  const { username } = req.params;
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid role' } });
  }
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (u:User {username: $username}) SET u.role = $role RETURN u',
      { username, role }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    res.json({ message: 'User role updated successfully' });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- User Login ---
/**
 * @openapi
 * /login:
 *   post:
 *     summary: Log in a user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Invalid credentials
 */
app.post('/login', async (req, res, next) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Username and password are required' } });
  }
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (u:User {username: $username}) RETURN u',
      { username }
    );
    if (result.records.length === 0) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    }
    const user = result.records[0].get('u').properties;
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    }
    const token = jwt.sign({ username, role: user.role }, JWT_SECRET, { expiresIn: '90m' });
    const refreshToken = crypto.randomUUID();
    await session.run(
      'MATCH (u:User {username: $username}) SET u.refreshToken = $refreshToken',
      { username, refreshToken }
    );
    res.json({ token, refreshToken });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Token Refresh ---
/**
 * @openapi
 * /refresh:
 *   post:
 *     summary: Refresh access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Invalid refresh token
 */
app.post('/refresh', async (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Refresh token is required' } });
  }
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (u:User {refreshToken: $refreshToken}) RETURN u',
      { refreshToken }
    );
    if (result.records.length === 0) {
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' } });
    }
    const user = result.records[0].get('u').properties;
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ token });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Create Node ---
/**
 * @openapi
 * /nodes:
 *   post:
 *     summary: Create a new node
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               labels:
 *                 type: array
 *                 items:
 *                   type: string
 *               properties:
 *                 type: object
 *     responses:
 *       201:
 *         description: Node created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
app.post('/nodes', requireAuth, async (req, res, next) => {
  const { labels = [], properties = {} } = req.body;

  // Validate input
  if (!labels.length) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'At least one label is required' } });
  }
  if (labels.some(label => !validIdentifier(label))) {
    return res.status(400).json({ error: { code: 'INVALID_LABEL', message: 'Invalid label format' } });
  }
  for (const prop in properties) {
    if (!validIdentifier(prop)) {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: `Invalid property: ${prop}` } });
    }
    if (prop === 'nodeId' || prop === 'createdBy') {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: 'Cannot set nodeId or createdBy.' } });
    }
  }

  const session = driver.session();
  try {
    const nodeId = uuidv4(); // Generate custom UUID for nodeId
    const allLabels = ['Entity', ...labels]; // Always include Entity label
    const result = await session.run(
      `CREATE (n${allLabels.map(label => `:${label}`).join('')})
       SET n += $properties
       SET n.nodeId = $nodeId
       SET n.createdBy = $username
       RETURN n, id(n) AS internalId`,
      { properties: properties, nodeId, username: req.user.username }
    );
    const node = result.records[0].get('n');
    res.status(201).json({
      id: node.properties.nodeId,
      labels: node.labels,
      properties: node.properties
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Delete Node ---
/**
 * @openapi
 * /nodes/{id}:
 *   delete:
 *     summary: Delete a node by nodeId
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Custom nodeId of the node
 *     responses:
 *       204:
 *         description: Node deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Node not found
 */
app.delete('/nodes/:id', requireAuth, async (req, res, next) => {
  const { id: nodeId } = req.params;
  const session = driver.session();
  try {
    const checkResult = await session.run(
      'MATCH (n:Entity {nodeId: $nodeId}) RETURN n.createdBy AS createdBy',
      { nodeId }
    );
    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const createdBy = checkResult.records[0].get('createdBy');
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete nodes you created' } });
    }
    await session.run(
      'MATCH (n:Entity {nodeId: $nodeId}) DETACH DELETE n',
      { nodeId }
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Get Node by ID ---
/**
 * @openapi
 * /nodes/{id}:
 *   get:
 *     summary: Get a node by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Node found
 *       404:
 *         description: Node not found
 */
app.get('/nodes/:id', async (req, res, next) => {
  const { id } = req.params;
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (n:Entity {nodeId: $nodeId}) RETURN n',
      { nodeId: id }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const node = result.records[0].get('n');
    res.json({
      id: node.properties.nodeId,
      labels: node.labels,
      properties: node.properties
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Get Nodes ---
/**
 * @openapi
 * /nodes:
 *   get:
 *     summary: Get nodes with optional label filter
 *     parameters:
 *       - name: label
 *         in: query
 *         description: Label to filter nodes
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         description: Number of nodes to return
 *         schema:
 *           type: integer
 *           default: 10
 *       - name: offset
 *         in: query
 *         description: Number of nodes to skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of nodes
 *       400:
 *         description: Invalid input
 */
app.get('/nodes', async (req, res, next) => {
  const { label, limit = 10, offset = 0 } = req.query;

  // Validate and parse limit/offset: must be non-negative integers, limit capped at 100
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    return res.status(400).json({ error: { code: 'INVALID_LIMIT', message: 'Limit must be an integer between 1 and 100' } });
  }
  if (isNaN(parsedOffset) || parsedOffset < 0) {
    return res.status(400).json({ error: { code: 'INVALID_OFFSET', message: 'Offset must be a non-negative integer' } });
  }

  const session = driver.session();
  try {
    const cypher = label
      ? `MATCH (n:Entity:\`${label}\`) RETURN n SKIP $offset LIMIT $limit`
      : `MATCH (n:Entity) RETURN n SKIP $offset LIMIT $limit`;
    const result = await session.run(cypher, { offset: neo4j.int(offset), limit: neo4j.int(limit) });
    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `No nodes found${label ? ` with label ${label}` : ''}` } });
    }
    const nodes = result.records.map(record => {
      const node = record.get('n');
      return {
        id: node.properties.nodeId,
        labels: node.labels,
        properties: node.properties
      };
    });
    res.json(nodes);
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Add Label to Node ---
/**
 * @openapi
 * /nodes/{id}/labels/{label}:
 *   put:
 *     summary: Add a single label to the node.
 *     description: Validates the provided label and adds it to the node's labels. Does not modify other labels. The reserved label "Entity" cannot be added.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Node identifier (nodeId property)
 *         schema:
 *           type: string
 *       - name: label
 *         in: path
 *         required: true
 *         description: Label to add. Must match Cypher identifier rules.
 *         schema:
 *           type: string
 *           pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$'
 *     responses:
 *       200:
 *         description: Label added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 labels:
 *                   type: array
 *                   items:
 *                     type: string
 *                 properties:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Invalid input (bad label or reserved label)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Node not found
 */
app.put('/nodes/:id/labels', requireAuth, async (req, res, next) => {
    const { id } = req.params;
    const { label } = req.body;

    // Protect reserved label
    if (label === 'Entity') {
      return res.status(400).json({
        error: { code: 'RESERVED_LABEL', message: 'Cannot add reserved label "Entity"' }
      });
    }

    const session = driver.session();
    try {
      const cypher = `
        MATCH (n:Entity {nodeId: $nodeId})
        CALL apoc.create.addLabels(n, [$label]) YIELD node
        RETURN node
      `;
      const result = await session.run(cypher, { nodeId: id, label });

      if (result.records.length === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
      }

      const node = result.records[0].get('node');
      res.json({
        id: node.properties.nodeId,
        labels: node.labels,
        properties: node.properties
      });
    } catch (err) {
      next(err);
    } finally {
      await session.close();
    }
  }
);

// --- Remove Label from Node ---
/**
 * @openapi
 * /nodes/{id}/labels/{label}:
 *   delete:
 *     summary: Remove a single label from the node.
 *     description: Validates the provided label and removes it from the node's labels if present. No-op if the node doesn't have the label. The reserved label "Entity" cannot be removed.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Node identifier (nodeId property)
 *         schema:
 *           type: string
 *       - name: label
 *         in: path
 *         required: true
 *         description: Label to remove. Must match Cypher identifier rules.
 *         schema:
 *           type: string
 *           pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$'
 *     responses:
 *       200:
 *         description: Label removed (or no-op if label wasn't present)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 labels:
 *                   type: array
 *                   items:
 *                     type: string
 *                 properties:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Invalid input (bad label or reserved label)
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Node not found
 */
app.delete('/nodes/:id/labels/:label', requireAuth, async (req, res, next) => {
    const { id, label } = req.params;

    // Protect reserved label
    if (label === 'Entity') {
      return res.status(400).json({
        error: { code: 'RESERVED_LABEL', message: 'Cannot remove reserved label "Entity"' }
      });
    }

    const session = driver.session();
    try {
      const cypher = `
        MATCH (n:Entity {nodeId: $nodeId})
        CALL apoc.create.removeLabels(n, [$label]) YIELD node
        RETURN node
      `;
      const result = await session.run(cypher, { nodeId: id, label });

      if (result.records.length === 0) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
      }

      const node = result.records[0].get('node');
      res.json({
        id: node.properties.nodeId,
        labels: node.labels,
        properties: node.properties
      });
    } catch (err) {
      next(err);
    } finally {
      await session.close();
    }
  }
);

// --- Add New Property to Node ---
/**
 * @openapi
 * /nodes/{id}/properties:
 *   post:
 *     summary: Create a new property on a node.
 *     description: Creates a new property (key/value) on the specified node. Fails with 409 if the property already exists. The reserved property "nodeId" cannot be created or modified.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Node identifier (nodeId property)
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       description: Object with `key` (property name) and `value` (primitive or array of primitives)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - value
 *             properties:
 *               key:
 *                 type: string
 *                 description: Property name (must match Cypher identifier rules)
 *                 pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$'
 *               value:
 *                 description: Property value (string, number, boolean, null, or array of those)
 *     responses:
 *       201:
 *         description: Property created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 labels:
 *                   type: array
 *                   items:
 *                     type: string
 *                 properties:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Invalid key or value, or attempt to modify reserved property
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Node not found
 *       409:
 *         description: Property already exists
 */
app.post('/nodes/:id/properties', requireAuth, async (req, res, next) => {
  const { id } = req.params;
  const { key, value } = req.body;

  // Protect reserved properties
  if (key === 'nodeId' || key === 'createdBy') {
    return res.status(400).json({ error: { code: 'PROTECTED_PROPERTY', message: 'Cannot delete nodeId or createdBy' } });
  }

  const session = driver.session();
  try {
    // Check node exists and whether property already exists
    const checkQ = `
      MATCH (n:Entity {nodeId: $nodeId})
      RETURN n, exists(n[$key]) AS hasProp
    `;
    const checkRes = await session.run(checkQ, { nodeId: id, key });

    if (checkRes.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }

    const hasProp = checkRes.records[0].get('hasProp');
    if (hasProp) {
      return res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: `Property "${key}" already exists on this node` } });
    }

    // Create the property
    const createQ = `
      MATCH (n:Entity {nodeId: $nodeId})
      SET n[$key] = $value
      RETURN n
    `;
    const createRes = await session.run(createQ, { nodeId: id, key, value });

    const node = createRes.records[0].get('n');
    res.status(201).json({
      id: node.properties.nodeId,
      labels: node.labels,
      properties: node.properties
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Edit Property on a Node
app.put('/nodes/:id/properties', requireAuth, requireAdmin, async (req, res, next) => {
  const { id } = req.params;
  const { key, value } = req.body;

  // Protect reserved properties
  if (key === 'nodeId' || key === 'createdBy') {
    return res.status(400).json({ error: { code: 'PROTECTED_PROPERTY', message: 'Cannot delete nodeId or createdBy' } });
  }

  const session = driver.session();
  try {
    // Check node exists and property exists
    const checkQ = `
      MATCH (n:Entity {nodeId: $nodeId})
      RETURN n, exists(n[$key]) AS hasProp
    `;
    const checkRes = await session.run(checkQ, { nodeId: id, key });

    if (checkRes.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }

    const hasProp = checkRes.records[0].get('hasProp');
    if (!hasProp) {
      return res.status(404).json({ error: { code: 'NOT_FOUND_PROPERTY', message: `Property "${key}" does not exist on this node` } });
    }

    // Update the property
    const updateQ = `
      MATCH (n:Entity {nodeId: $nodeId})
      SET n[$key] = $value
      RETURN n
    `;
    const updateRes = await session.run(updateQ, { nodeId: id, key, value });

    const node = updateRes.records[0].get('n');
    res.json({ id: node.properties.nodeId, labels: node.labels, properties: node.properties });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Delete a Property from a Node ---
/**
 * @openapi
 * /nodes/{id}/property/{key}:
 *   delete:
 *     summary: Delete a property from a node
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Custom nodeId of the node
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Property key to delete
 *     responses:
 *       200:
 *         description: Property deleted successfully
 *       400:
 *         description: Invalid input or protected property
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Node or property not found
 */
app.delete('/nodes/:id/property/:key', requireAuth, async (req, res, next) => {
  const { id: nodeId, key } = req.params;

  if (!validIdentifier(key)) {
    return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: 'Invalid property key format' } });
  }

  // Protect reserved properties
  if (key === 'nodeId' || key === 'createdBy') {
    return res.status(400).json({ error: { code: 'PROTECTED_PROPERTY', message: 'Cannot delete nodeId or createdBy' } });
  }

  const session = driver.session();
  try {
    // NOTE: use parameterized key access (exists(n[$key])) — DO NOT attempt to interpolate the key into the query string.
    const checkResult = await session.run(
      `
      MATCH (n:Entity {nodeId: $nodeId})
      RETURN n.createdBy AS createdBy, exists(n[$key]) AS hasProperty
      `,
      { nodeId, key }
    );

    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }

    const record = checkResult.records[0];
    const hasProperty = record.get('hasProperty');

    if (!hasProperty) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Property ${key} not found on node` } });
    }

    // Safely remove the property by setting it to null (Neo4j removes null properties).
    const deleteResult = await session.run(
      `
      MATCH (n:Entity {nodeId: $nodeId})
      SET n[$key] = null
      RETURN n
      `,
      { nodeId, key }
    );

    const node = deleteResult.records[0].get('n');
    res.json({
      id: node.properties.nodeId,
      labels: node.labels,
      properties: node.properties
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Get Node Relationships ---
/**
 * @openapi
 * /nodes/{id}/relations:
 *   get:
 *     summary: Get incoming and outgoing relationships for a node
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Relationships found
 *       404:
 *         description: Node not found
 */
app.get('/nodes/:id/relations', async (req, res, next) => {
  const { id: nodeId } = req.params;
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n:Entity {nodeId: $nodeId})
      OPTIONAL MATCH (n)-[outRel]->(outNode:Entity)
      OPTIONAL MATCH (inNode:Entity)-[inRel]->(n)
      RETURN
        COLLECT(DISTINCT {
          relId: id(outRel),
          type:  type(outRel),
          node: {
            id:         outNode.nodeId,
            labels:     labels(outNode),
            properties: properties(outNode)
          }
        }) AS outgoing,
        COLLECT(DISTINCT {
          relId: id(inRel),
          type:  type(inRel),
          node: {
            id:         inNode.nodeId,
            labels:     labels(inNode),
            properties: properties(inNode)
          }
        }) AS incoming`,
      { nodeId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }

    const record = result.records[0];
    // Filter out any entries where relId is null (i.e. the optional match had no real rel)
    const outgoing = record.get('outgoing').filter(r => r.relId !== null);
    const incoming = record.get('incoming').filter(r => r.relId !== null);
    res.json({ outgoing, incoming });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Create Relationship ---
/**
 * @openapi
 * /relation:
 *   post:
 *     summary: Create a relationship between two nodes
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromId:
 *                 type: string
 *               toId:
 *                 type: string
 *               relType:
 *                 type: string
 *               relProps:
 *                 type: object
 *     responses:
 *       201:
 *         description: Relationship created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Source or target node not found
 */
app.post('/relation', requireAuth, async (req, res, next) => {
  const { sourceNodeId, targetNodeId, relType: rawRelType, relProps = {} } = req.body;

  // Basic presence check
  if (!rawRelType || !sourceNodeId || !targetNodeId) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'All fields are required.' } });
  }

  // Normalize + sanitize relationship type: uppercase, trimmed
  const relType = String(rawRelType).trim().toUpperCase();

  // Strict token validation for the relationship type.
  // Only allow A-Z, 0-9 and underscore, must start with a letter or underscore, max length 64.
  const RELTYPE_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
  if (!RELTYPE_RE.test(relType)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid relationship type format. Allowed: A-Z, 0-9, underscore; must start with letter/underscore; max 64 chars.' } });
  }

  // Validate property keys
  for (const prop in relProps) {
    if (!validIdentifier(prop)) {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: `Invalid relationship property name: ${prop}` } });
    }
  }

  // Sanitize values: allow primitives (string, number, boolean, null) and arrays of primitives only.
  // Truncate long strings; reject nested objects.
  function sanitizeRelProps(input) {
    const out = {};
    const MAX_STRING = 2000;      // limit single-string length
    const MAX_ARRAY_LEN = 200;    // max items in an array
    const MAX_PROP_COUNT = 50;    // limit number of properties

    const keys = Object.keys(input || {});
    if (keys.length > MAX_PROP_COUNT) {
      return { error: `Too many relationship properties (max ${MAX_PROP_COUNT})` };
    }

    for (const key of keys) {
      let val = input[key];

      // explicit server-side protection: never allow client to set createdBy
      if (key === 'createdBy' || key === 'created_by') {
        // skip it; server will set createdBy
        continue;
      }

      if (val === null) {
        out[key] = null;
        continue;
      }

      const t = typeof val;
      if (t === 'string') {
        // trim and truncate
        const s = val.trim();
        out[key] = s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s;
      } else if (t === 'number' || t === 'boolean') {
        out[key] = val;
      } else if (Array.isArray(val)) {
        if (val.length > MAX_ARRAY_LEN) {
          return { error: `Array too long for property ${key} (max ${MAX_ARRAY_LEN})` };
        }
        const sanitizedArray = [];
        for (const item of val) {
          if (item === null) { sanitizedArray.push(null); continue; }
          const it = typeof item;
          if (it === 'string') {
            const s = item.trim();
            sanitizedArray.push(s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s);
          } else if (it === 'number' || it === 'boolean') {
            sanitizedArray.push(item);
          } else {
            return { error: `Invalid array element type for property ${key}` };
          }
        }
        out[key] = sanitizedArray;
      } else {
        // nested objects / maps are not allowed as property values
        return { error: `Invalid property value for ${key}. Only primitives or arrays of primitives allowed.` };
      }
    }
    return { props: out };
  }

  const sanitized = sanitizeRelProps(relProps);
  if (sanitized && sanitized.error) {
    return res.status(400).json({ error: { code: 'INVALID_PROPERTY_VALUE', message: sanitized.error } });
  }

  // Merge sanitized props and enforce server-side createdBy
  const finalRelProps = { ...(sanitized.props || {}), createdBy: req.user.username };

  const session = driver.session();
  try {
    // Confirm source node exists and check permission
    const checkResult = await session.run(
      `MATCH (a:Entity { nodeId: $sourceNodeId }) RETURN a.createdBy AS createdBy`,
      { sourceNodeId }
    );
    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source node not found' } });
    }
    const createdBy = checkResult.records[0].get('createdBy');

    // Only allow non-admin users to create relationships from nodes they created
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only create relationships from nodes you created' } });
    }

    // Create relationship inside a write transaction.
    // NOTE: relType is injected directly into the Cypher text as a token, but it's been sanitized.
    // All user data (node ids and rel properties) are passed as parameters to avoid injection.
    const createCypher = `
      MATCH (a:Entity { nodeId: $sourceNodeId })
      MATCH (b:Entity { nodeId: $targetNodeId })
      CREATE (a)-[r:${relType}]->(b)
      SET r += $relProps
      SET r.createdBy = $username
      RETURN id(r) AS relId, type(r) AS type, properties(r) AS props
    `;

    const txResult = await session.writeTransaction(tx =>
      tx.run(createCypher, {
        sourceNodeId,
        targetNodeId,
        relProps: finalRelProps,
        username: req.user.username
      })
    );

    if (!txResult || txResult.records.length === 0) {
      // If no records returned, assume target node not found or the create didn't happen.
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Target node not found or relationship not created.' } });
    }

    const record = txResult.records[0];
    res.status(201).json({
      id: record.get('relId').toString(),
      type: record.get('type'),
      properties: record.get('props')
    });
  } catch (err) {
    // Log the error server-side for diagnostics but avoid leaking details to clients.
    console.error('Error creating relation:', err);
    next(err);
  } finally {
    await session.close();
  }
});

// --- Delete Relationship ---
/**
 * @openapi
 * /relation:
 *   delete:
 *     summary: Delete a relationship by specifying source node, target node, and relationship type
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sourceNodeId
 *               - targetNodeId
 *               - relType
 *             properties:
 *               sourceNodeId:
 *                 type: string
 *                 description: Unique identifier of the source node
 *               targetNodeId:
 *                 type: string
 *                 description: Unique identifier of the target node
 *               relType:
 *                 type: string
 *                 description: Type/label of the relationship
 *     responses:
 *       204:
 *         description: Relationship deleted successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Relationship or nodes not found
 */
app.delete('/relation', requireAuth, async (req, res, next) => {
  const { sourceNodeId, targetNodeId, relType } = req.body;

  // Validate input
  if (!sourceNodeId || !targetNodeId || !relType) {
    return res.status(400).json({ 
      error: { 
        code: 'INVALID_INPUT', 
        message: 'sourceNodeId, targetNodeId, and relType are required' 
      }
    });
  }

  const session = driver.session();
  try {
    const checkResult = await session.run(
      `MATCH (a)-[r:${relType}]->(b)
       WHERE a.nodeId = $sourceNodeId AND b.nodeId = $targetNodeId
       RETURN r.createdBy AS createdBy, r`,
      { sourceNodeId, targetNodeId }
    );

    if (checkResult.records.length === 0) {
      return res.status(404).json({ 
        error: { code: 'NOT_FOUND', message: 'Relationship or nodes not found' } 
      });
    }

    const createdBy = checkResult.records[0].get('createdBy');
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ 
        error: { code: 'FORBIDDEN', message: 'You can only delete relationships you created' } 
      });
    }

    await session.run(
      `MATCH (a)-[r:${relType}]->(b)
       WHERE a.nodeId = $sourceNodeId AND b.nodeId = $targetNodeId
       DELETE r`,
      { sourceNodeId, targetNodeId }
    );

    res.status(204).send();
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});


// --- Get List of Labels ---
/**
 * @openapi
 * /labels:
 *   get:
 *     summary: Retrieve all unique labels in the database
 *     responses:
 *       200:
 *         description: List of all unique node labels
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 labels:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Array of unique node labels
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/labels', async (req, res, next) => {
  const session = driver.session();
  try {
    const result = await session.run('CALL db.labels()');
    const labels = result.records
      .map(record => record.get('label'))
      .filter(label => label !== 'User');
    res.status(200).json({ labels });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Search Nodes ---
/**
 * @openapi
 * /search:
 *   get:
 *     summary: Search nodes by partial matches on labels, property names, or property values
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: >
 *           The search term to match against node labels, property names,
 *           or property values (e.g. "Auth" for Author, "na" for name).
 *     responses:
 *       '200':
 *         description: A list of matching nodes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: The unique application‐defined nodeId
 *                   labels:
 *                     type: array
 *                     items: { type: string }
 *                   properties:
 *                     type: object
 *       '400': …
 *       '500': …
 */
app.get('/search', async (req, res) => {
  const { query, label } = req.query;
  if (!query || typeof query !== 'string' || query.length < 2) {
    return res.status(400).json({
      error: { code: 'INVALID_QUERY',
               message: 'Query must be a string with at least 2 characters' }
    });
  }
  if (label !== undefined && typeof label !== 'string') {
    return res.status(400).json({
      error: { code: 'INVALID_LABEL',
               message: 'Label, if provided, must be a string' }
    });
  }

  const session = driver.session();
  try {
    // Always run the full deep search
    const cypher = `
      CALL {
        CALL db.labels() YIELD label AS lbl
        WHERE toLower(lbl) CONTAINS toLower($query) AND lbl <> 'User'
        MATCH (n) WHERE lbl IN labels(n)
        RETURN n, labels(n) AS labels

        UNION

        MATCH (n:Entity)
        WHERE ANY(key IN keys(n) WHERE toLower(key) CONTAINS toLower($query))
        RETURN n, labels(n) AS labels

        UNION

        CALL db.index.fulltext.queryNodes('nodeProperties', $query + '*')
        YIELD node AS n
        WHERE 'Entity' IN labels(n)
        RETURN n, labels(n) AS labels
      }
      RETURN DISTINCT
        n.nodeId      AS id,
        properties(n) AS properties,
        labels
      ORDER BY id
      LIMIT 50
    `;

    const result = await session.run(cypher, { query });
    let nodes = result.records.map(record => ({
      id:         record.get('id'),
      labels:     record.get('labels'),
      properties: record.get('properties')
    }));

    // If a label was specified, filter results by label
    if (label) {
      nodes = nodes.filter(node => node.labels.includes(label));
    }

    res.json(nodes);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  } finally {
    await session.close();
  }
});

// --- Get List of Nodes by Label ---
/**
 * @openapi
 * /nodes/{label}:
 *   get:
 *     summary: Retrieve all nodes in the database with the provided label
 *     parameters:
 *       - name: label
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The label of the nodes to retrieve
 *     responses:
 *       200:
 *         description: List of all nodes that have the provided label
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: The unique ID of the node
 *                   labels:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: The labels of the node
 *                   properties:
 *                     type: object
 *                     description: The properties of the node
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
app.get('/search/:label', async (req, res, next) => {
  const { label } = req.params;
  if (!label) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Label is required' } });
  }
  if (!validIdentifier(label)) {
    return res.status(400).json({ error: { code: 'INVALID_LABEL', message: 'Invalid label format' } });
  }
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n:Entity:${label}) RETURN n`,
    );
    const nodes = result.records.map(record => {
      const node = record.get('n');
      return {
        id: node.properties.nodeId,
        labels: node.labels,
        properties: node.properties
      };
    });
    res.json(nodes);
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// Ping endpoint for debugging or waking up the server.
app.get('/ping', (req, res) => {
  res.status(200).send('Ping Successful. Server is awake.');
});

// Create full‐text index to help search property values (run once at startup)
async function createFullTextIndex() {
  const session = driver.session();
  try {
    await session.run(`
      CREATE FULLTEXT INDEX nodeProperties IF NOT EXISTS
      FOR (n:Entity)
      ON EACH [n.name, n.title, n.description]
    `);
    console.log('Full‐text index "nodeProperties" ensured');
  } catch (error) {
    console.error('Error creating full‐text index:', error);
  } finally {
    await session.close();
  }
}
// Index once when app starts
createFullTextIndex();


// --- Error Handler ---
app.use((err, req, res, next) => {
  console.error(err);
  const statusCode = err.status || 500;
  const errorDetails = {
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An internal error occurred'
  };
  // Include stack trace only in development mode
  if (process.env.NODE_ENV === 'development') {
    errorDetails.stack = err.stack;
  }
  // If it's a Neo4j error, include Neo4j-specific details
  if (err.name === 'Neo4jError') {
    errorDetails.neo4jCode = err.code;
    errorDetails.neo4jMessage = err.message;
  }
  res.status(statusCode).json({ error: errorDetails });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔗 API running on port ${PORT}`);
});
