require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const neo4j = require('neo4j-driver');
const cors = require('cors');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(cors());

// --- Neo4j Driver ---
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

// --- JWT Secret ---
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

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
  if (label && !validIdentifier(label)) {
    return res.status(400).json({ error: { code: 'INVALID_LABEL', message: 'Invalid label format' } });
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
    if (prop === 'nodeId' || prop === 'createdBy' || prop === 'display_name') {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: 'Cannot set nodeId, createdBy, or display_name' } });
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

// --- Update Node ---
/**
 * @openapi
 * /nodes/{id}:
 *   put:
 *     summary: Update a node's properties
 *     parameters:
 *       - in: path
 *         name: id
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
 *               properties:
 *                 type: object
 *     responses:
 *       200:
 *         description: Node updated successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Node not found
 */
app.put('/nodes/:id', requireAuth, async (req, res, next) => {
  const { id: nodeId } = req.params;
  const { properties } = req.body;
  if (!properties || typeof properties !== 'object') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Properties must be an object' } });
  }
  for (const prop in properties) {
    if (!validIdentifier(prop)) {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: `Invalid property: ${prop}` } });
    }
    if (prop === 'nodeId' || prop === 'createdBy') {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: 'Cannot modify nodeId or createdBy' } });
    }
  }
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
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only update nodes you created' } });
    }
    const result = await session.run(
      'MATCH (n:Entity {nodeId: $nodeId}) SET n += $properties RETURN n',
      { nodeId, properties }
    );
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

// --- Delete Property of Node ---
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
  if (key === 'nodeId' || key === 'createdBy') {
    return res.status(400).json({ error: { code: 'PROTECTED_PROPERTY', message: 'Cannot delete nodeId or createdBy' } });
  }
  const session = driver.session();
  try {
    const checkResult = await session.run(
      'MATCH (n:Entity {nodeId: $nodeId}) RETURN n.createdBy AS createdBy, EXISTS(n.`${key}`) AS hasProperty',
      { nodeId }
    );
    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const record = checkResult.records[0];
    const createdBy = record.get('createdBy');
    const hasProperty = record.get('hasProperty');
    if (!hasProperty) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Property ${key} not found on node` } });
    }
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete properties from nodes you created' } });
    }
    const result = await session.run(
      `MATCH (n:Entity {nodeId: $nodeId}) REMOVE n.\`${key}\` RETURN n`,
      { nodeId }
    );
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
 *               fromLabel:
 *                 type: string
 *               fromId:
 *                 type: string
 *               toLabel:
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
  const { fromLabel, fromId, toLabel, toId, relType, relProps = {} } = req.body;
  if (!fromLabel || !toLabel || !relType || !fromId || !toId) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'All fields are required' } });
  }
  if (!validIdentifier(fromLabel) || !validIdentifier(toLabel) || !validIdentifier(relType)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid label or relationship type format' } });
  }
  for (const prop in relProps) {
    if (!validIdentifier(prop)) {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: `Invalid relationship property: ${prop}` } });
    }
  }
  const session = driver.session();
  try {
    const checkResult = await session.run(
      `MATCH (a:Entity:${fromLabel} { nodeId: $fromId }) RETURN a.createdBy AS createdBy`,
      { fromId }
    );
    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source node not found' } });
    }
    const createdBy = checkResult.records[0].get('createdBy');
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only create relationships from nodes you created' } });
    }
    const result = await session.run(
      `
      MATCH (a:Entity:\`${fromLabel}\` {nodeId: $fromId})
      MATCH (b:Entity:\`${toLabel}\` {nodeId: $toId})
      CREATE (a)-[r:\`${relType}\`]->(b)
      SET r += $relProps
      SET r.createdBy = $username
      RETURN id(r) AS relId, type(r) AS type, properties(r) AS props
      `,
      { fromId, toId, relProps: { ...relProps, createdBy: req.user.username }, username: req.user.username }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Target node not found' } });
    }
    const record = result.records[0];
    res.status(201).json({
      id: record.get('relId').toString(),
      type: record.get('type'),
      properties: record.get('props')
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

// --- Delete Property of Relationship ---
/**
 * @openapi
 * /relation/{id}/property/{key}:
 *   delete:
 *     summary: Delete a property from a relationship
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Internal Neo4j ID of the relationship
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
 *         description: Relationship or property not found
 */
app.delete('/relation/:id/property/:key', requireAuth, async (req, res, next) => {
    const { id: relIdParam, key } = req.params;
    if (!validIdentifier(key)) {
      return res.status(400).json({
          error: {
            code: 'INVALID_PROPERTY',
            message: 'Invalid property key format'
          }
        });
    }
    if (key === 'createdBy') {
      return res.status(400).json({
          error: {
            code: 'PROTECTED_PROPERTY',
            message: 'Cannot delete createdBy'
          }
        });
    }
    const session = driver.session();
    try {
      const checkCypher = `MATCH ()-[r]->() WHERE id(r) = $relId RETURN r.createdBy AS createdBy, (r.\`${key}\` IS NOT NULL) AS hasProperty`;
      const checkResult = await session.run(checkCypher, {
        relId: neo4j.int(relIdParam)
      });

      if (checkResult.records.length === 0) {
        return res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Relationship not found'
            }
          });
      }

      const checkRecord = checkResult.records[0];
      const createdBy   = checkRecord.get('createdBy');
      const hasProperty = checkRecord.get('hasProperty');

      if (!hasProperty) {
        return res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: `Property "${key}" not found on relationship`
            }
          });
      }

      if (req.user.role !== 'admin' && createdBy !== req.user.username) {
        return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'You can only delete properties from relationships you created'
            }
          });
      }

      const deleteCypher = `MATCH ()-[r]->() WHERE id(r) = $relId REMOVE r.\`${key}\` RETURN id(r) AS relId, type(r) AS type, properties(r) AS props`;
      const deleteResult = await session.run(deleteCypher, {
        relId: neo4j.int(relIdParam)
      });

      const deleteRecord = deleteResult.records[0];
      res.json({
        id:         deleteRecord.get('relId').toString(),
        type:       deleteRecord.get('type'),
        properties: deleteRecord.get('props')
      });
    } catch (err) {
      next(err);
    } finally {
      await session.close();
    }
  }
);

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
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔗 API running on port ${PORT}`);
});