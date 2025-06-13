// index.js
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const neo4j = require('neo4j-driver');

const app = express();
app.use(express.json());

// --- Neo4j Driver ---
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

// --- Simple In-Memory User (for demo) ---
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// --- Auth Middleware ---
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// --- Login Route ---
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USER && password === AUTH_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// --- Public: List up to 10 nodes ---
app.get('/', async (req, res, next) => {
  const session = driver.session();
  try {
    const result = await session.run('MATCH (n) RETURN n LIMIT 10');
    const nodes = result.records.map(r => r.get('n').properties);
    res.json(nodes);
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- Helper to CREATE a node with label and props ---
async function createNode(label, props) {
  const session = driver.session();
  const keys = Object.keys(props);
  const params = keys.map(k => `$${k}`).join(', ');
  const assignments = keys.map(k => `n.${k} = $${k}`).join(', ');
  const cypher = `
    CREATE (n:${label})
    SET ${assignments}
    RETURN n
  `;
  const result = await session.run(cypher, props);
  await session.close();
  return result.records[0].get('n').properties;
}

// --- Protected: Create endpoints for each label ---
// JSON body should include all desired properties (including `id`)
const NODES = ['Text','Author','Edition','Publisher','Series','Journal','Translator'];
NODES.forEach(label => {
  app.post(`/${label.toLowerCase()}s`, requireAuth, async (req, res, next) => {
    try {
      const node = await createNode(label, req.body);
      res.status(201).json(node);
    } catch (err) {
      next(err);
    }
  });
});

// --- Protected: Generic relationship creator ---
// Body: { fromLabel, fromId, toLabel, toId, relType, relProps? }
app.post('/relation', requireAuth, async (req, res, next) => {
  const { fromLabel, fromId, toLabel, toId, relType, relProps = {} } = req.body;
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (a:${fromLabel} {id:$fromId})
      MATCH (b:${toLabel}   {id:$toId})
      MERGE (a)-[r:${relType}]->(b)
      SET r += $relProps
      RETURN r
      `,
      { fromId, toId, relProps }
    );
    await session.close();
    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Nodes not found or relation failed' });
    }
    res.status(201).json(result.records[0].get('r').properties);
  } catch (err) {
    next(err);
  }
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔗 API running on port ${PORT}`);
});
