require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const neo4j = require('neo4j-driver');
const cors = require('cors');


const app  = express();
app.use(express.json());
app.use(cors());

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

// --- Public: List up to 10 nodes + relationships ---
app.get('/', async (req, res, next) => {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a)-[r]->(b)
      RETURN
        id(r)      AS relId,
        type(r)    AS relType,

        // Source node summary
        id(a)               AS srcId,
        labels(a)[0]        AS srcLabel,
        a.name      AS srcName,
        a.title     AS srcTitle,

        // Target node summary
        id(b)               AS tgtId,
        labels(b)[0]        AS tgtLabel,
        b.name      AS tgtName,
        b.title     AS tgtTitle

      LIMIT 25
    `);

    // Map relationships with embedded node info
    const relationships = result.records.map(rec => ({
      id:    rec.get('relId')?.toString(),
      type:  rec.get('relType'),
      source: {
        id:    rec.get('srcId')?.toString(),
        label: rec.get('srcLabel'),
        // pick whichever property exists
        name:  rec.get('srcName')  || rec.get('srcTitle')
      },
      target: {
        id:    rec.get('tgtId')?.toString(),
        label: rec.get('tgtLabel'),
        name:  rec.get('tgtName')  || rec.get('tgtTitle')
      }
    }));

    // Build a unique nodes list from those relationships
    const nodeMap = {};
    relationships.forEach(r => {
      nodeMap[r.source.id] = {
        id:    r.source.id,
        labels:[r.source.label],
        ...(r.source.name ? { name: r.source.name } : {})
      };
      nodeMap[r.target.id] = {
        id:    r.target.id,
        labels:[r.target.label],
        ...(r.target.name ? { name: r.target.name } : {})
      };
    });

    res.json({
      nodes: Object.values(nodeMap),
      relationships
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// index.js (add below your other routes)

app.get('/node/:id', async (req, res, next) => {
  const nodeId = parseInt(req.params.id, 10);
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (n)
      WHERE id(n) = $nodeId
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN
        id(n)            AS id,
        labels(n)        AS labels,
        properties(n)    AS props,
        collect({
          id:     id(r),
          type:   type(r),
          target: {
            id:    id(m),
            label: labels(m)[0],
            name:  coalesce(m.name, m.title)
          }
        })               AS relations
      `,
      { nodeId }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const record = result.records[0];
    res.json({
      id:        record.get('id')?.toString(),
      labels:    record.get('labels'),
      properties: record.get('props'),
      relations: record.get('relations').map(r => ({
        id:     r.id?.toString(),
        type:   r.type,
        target: {
          id:    r.target.id?.toString(),
          label: r.target.label,
          name:  r.target.name
        }
      }))
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// ----- GET /authors/:name -----
app.get('/authors/:name', async (req, res, next) => {
  const authorName = req.params.name;
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (a:Author {name: $val})
      OPTIONAL MATCH (a)-[r]->(m)
      RETURN
        id(a)         AS id,
        labels(a)     AS labels,
        properties(a) AS props,
        collect({
          id:     id(r),
          type:   type(r),
          target: {
            id:    id(m),
            label: labels(m)[0],
            name:  coalesce(m.name, m.title)
          }
        })            AS relations
      `,
      { val: authorName }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: `Author "${authorName}" not found` });
    }
    const rec = result.records[0];
    res.json({
      id:         rec.get('id')?.toString(),
      labels:     rec.get('labels'),
      properties: rec.get('props'),
      relations:  rec.get('relations').map(r => ({
        id:     r.id?.toString(),
        type:   r.type,
        target: {
          id:    r.target.id?.toString(),
          label: r.target.label,
          name:  r.target.name
        }
      }))
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// ----- GET /texts/:title -----
app.get('/texts/:title', async (req, res, next) => {
  const textTitle = req.params.title;
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (t:Text {title: $val})
      OPTIONAL MATCH (t)-[r]->(m)
      RETURN
        id(t)         AS id,
        labels(t)     AS labels,
        properties(t) AS props,
        collect({
          id:     id(r),
          type:   type(r),
          target: {
            id:    id(m),
            label: labels(m)[0],
            name:  coalesce(m.name, m.title)
          }
        })            AS relations
      `,
      { val: textTitle }
    );
    if (result.records.length === 0) {
      return res.status(404).json({ error: `Text "${textTitle}" not found` });
    }
    const rec = result.records[0];
    res.json({
      id:         rec.get('id')?.toString(),
      labels:     rec.get('labels'),
      properties: rec.get('props'),
      relations:  rec.get('relations').map(r => ({
        id:     r.id?.toString(),
        type:   r.type,
        target: {
          id:    r.target.id?.toString(),
          label: r.target.label,
          name:  r.target.name
        }
      }))
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// POST /cypher
app.post('/cypher', requireAuth, async (req, res, next) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "query" in request body' });
  }
  console.log("Attempting to run the following query: " + query);

  const session = driver.session();
  try {
    const result = await session.run(query);
    // Convert each record into a plain object
    const data = result.records.map(record => {
      const obj = {};
      record.keys.forEach((key, idx) => {
        const value = record.get(key);
        // If it's a Node or Relationship, pull out .properties
        if (value && typeof value === 'object' && value.properties) {
          obj[key] = value.properties;
        } else {
          obj[key] = value;
        }
      });
      return obj;
    });
    res.json({
      columns: result.records[0]?.keys || [],
      data
    });
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
