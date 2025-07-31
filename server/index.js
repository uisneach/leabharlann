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
      'CREATE (u:User {username: $username, passwordHash: $passwordHash, role: $role})',
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
    const token = jwt.sign({ username, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
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
    const cypher = label ?
      `MATCH (n:\`${label}\`) RETURN n SKIP $offset LIMIT $limit` :
      `MATCH (n) RETURN n SKIP $offset LIMIT $limit`;
    const result = await session.run(cypher, { offset: neo4j.int(offset), limit: neo4j.int(limit) });
    const nodes = result.records.map(record => {
      const node = record.get('n');
      return {
        id: node.identity.toString(),
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
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Node details
 *       404:
 *         description: Node not found
 */
app.get('/nodes/:id', async (req, res, next) => {
  const id = req.params.id;
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (n) WHERE id(n) = $id RETURN n',
      { id: neo4j.int(id) }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const node = result.records[0].get('n');
    res.json({
      id: node.identity.toString(),
      labels: node.labels,
      properties: node.properties
    });
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
  const { labels, properties } = req.body;
  if (!labels || !Array.isArray(labels) || labels.length === 0) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'At least one label is required' } });
  }
  if (!properties || typeof properties !== 'object') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Properties must be an object' } });
  }
  for (const label of labels) {
    if (!validIdentifier(label)) {
      return res.status(400).json({ error: { code: 'INVALID_LABEL', message: `Invalid label: ${label}` } });
    }
  }
  for (const prop in properties) {
    if (!validIdentifier(prop)) {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: `Invalid property: ${prop}` } });
    }
  }
  const session = driver.session();
  try {
    const cypherLabels = labels.map(label => `\`${label}\``).join(':');
    const result = await session.run(
      `CREATE (n:${cypherLabels} $properties) SET n.createdBy = $username RETURN n`,
      { properties: { ...properties, createdBy: req.user.username }, username: req.user.username }
    );
    const node = result.records[0].get('n');
    res.status(201).json({
      id: node.identity.toString(),
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
 *     summary: Update node properties
 *     parameters:
 *       - name: id
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
  const id = req.params.id;
  const { properties } = req.body;
  if (!properties || typeof properties !== 'object') {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Properties must be an object' } });
  }
  for (const prop in properties) {
    if (!validIdentifier(prop)) {
      return res.status(400).json({ error: { code: 'INVALID_PROPERTY', message: `Invalid property: ${prop}` } });
    }
  }
  const session = driver.session();
  try {
    const checkResult = await session.run(
      'MATCH (n) WHERE id(n) = $id RETURN n.createdBy AS createdBy',
      { id: neo4j.int(id) }
    );
    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const createdBy = checkResult.records[0].get('createdBy');
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only update nodes you created' } });
    }
    const result = await session.run(
      'MATCH (n) WHERE id(n) = $id SET n += $properties RETURN n',
      { id: neo4j.int(id), properties }
    );
    const node = result.records[0].get('n');
    res.json({
      id: node.identity.toString(),
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
 *     summary: Delete a node
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Node deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Node not found
 */
app.delete('/nodes/:id', requireAuth, async (req, res, next) => {
  const id = req.params.id;
  const session = driver.session();
  try {
    const checkResult = await session.run(
      'MATCH (n) WHERE id(n) = $id RETURN n.createdBy AS createdBy',
      { id: neo4j.int(id) }
    );
    if (checkResult.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const createdBy = checkResult.records[0].get('createdBy');
    if (req.user.role !== 'admin' && createdBy !== req.user.username) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete nodes you created' } });
    }
    const result = await session.run(
      'MATCH (n) WHERE id(n) = $id DETACH DELETE n',
      { id: neo4j.int(id) }
    );
    if (result.summary.counters.updates().nodesDeleted === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    res.json({ message: 'Node deleted successfully' });
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
      'MATCH (a:\`${fromLabel}\`) WHERE id(a) = $fromId RETURN a.createdBy AS createdBy',
      { fromId: neo4j.int(fromId) }
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
      MATCH (a:\`${fromLabel}\`) WHERE id(a) = $fromId
      MATCH (b:\`${toLabel}\`) WHERE id(b) = $toId
      CREATE (a)-[r:\`${relType}\`]->(b)
      SET r += $relProps
      SET r.createdBy = $username
      RETURN id(r) AS relId, type(r) AS type, properties(r) AS props
      `,
      { fromId: neo4j.int(fromId), toId: neo4j.int(toId), relProps: { ...relProps, createdBy: req.user.username }, username: req.user.username }
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
 *     summary: Get all relationships for a node
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of relationships
 *       404:
 *         description: Node not found
 */
app.get('/nodes/:id/relations', async (req, res, next) => {
  const id = req.params.id;
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (n) WHERE id(n) = $id
      OPTIONAL MATCH (n)-[r]->(m)
      OPTIONAL MATCH (p)-[r2]->(n)
      RETURN
        collect(DISTINCT {
          relId: id(r),
          type: type(r),
          direction: "outgoing",
          node: { id: id(m), labels: labels(m), properties: properties(m) }
        }) AS outgoing,
        collect(DISTINCT {
          relId: id(r2),
          type: type(r2),
          direction: "incoming",
          node: { id: id(p), labels: labels(p), properties: properties(p) }
        }) AS incoming
      `,
      { id: neo4j.int(id) }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Node not found' } });
    }
    const record = result.records[0];
    const response = {
      outgoing: record.get('outgoing').filter(r => r.node && r.node.id).map(r => ({
        id: r.relId.toString(),
        type: r.type,
        direction: r.direction,
        node: {
          id: r.node.id.toString(),
          labels: r.node.labels,
          properties: r.node.properties
        }
      })),
      incoming: record.get('incoming').filter(r => r.node && r.node.id).map(r => ({
        id: r.relId.toString(),
        type: r.type,
        direction: r.direction,
        node: {
          id: r.node.id.toString(),
          labels: r.node.labels,
          properties: r.node.properties
        }
      }))
    };
    res.json(response);
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
 *     summary: Search for nodes by label, property, and value
 *     parameters:
 *       - name: label
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: property
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: value
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         description: Number of results to return
 *         schema:
 *           type: integer
 *           default: 10
 *       - name: offset
 *         in: query
 *         description: Number of results to skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of matching nodes
 *       400:
 *         description: Invalid input
 */
app.get('/search', async (req, res, next) => {
  const { label, property, value, limit = 10, offset = 0 } = req.query;
  if (!label || !property || !value) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Label, property, and value are required' } });
  }
  if (!validIdentifier(label) || !validIdentifier(property)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid label or property format' } });
  }
  const session = driver.session();
  try {
    const cypher = `
      MATCH (n:\`${label}\`)
      WHERE toLower(n.\`${property}\`) CONTAINS toLower($value)
      RETURN n
      SKIP $offset
      LIMIT $limit
    `;
    const result = await session.run(cypher, { value, offset: neo4j.int(offset), limit: neo4j.int(limit) });
    const nodes = result.records.map(record => {
      const node = record.get('n');
      return {
        id: node.identity.toString(),
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