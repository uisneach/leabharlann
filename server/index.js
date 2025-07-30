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

// Helper to validate Neo4j identifiers (labels & rel types)
function validIdentifier(str) {
  return typeof str === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(str);
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

// --- Shared helper to fetch all nodes by label ---
async function fetchAllByLabel(label) {
  // Basic safety: ensure label is a valid Neo4j identifier
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
    throw new Error(`Invalid label "${label}"`);
  }

  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (n:${label})
      RETURN
        id(n)         AS id,
        labels(n)     AS labels,
        properties(n) AS properties
      `
    );
    // Map to simple JS objects
    return result.records.map(rec => ({
      id:         rec.get('id').toString(),
      labels:     rec.get('labels'),
      properties: rec.get('properties')
    }));
  } finally {
    await session.close();
  }
}

// --- Public: List up to 10 nodes + relationships ---
app.get('/graph', async (req, res, next) => {
  const session = driver.session();
  try {
    // Fetch all nodes
    const nodesResult = await session.run(
      `MATCH (n)
       RETURN
         id(n)          AS id,
         labels(n)      AS labels,
         properties(n)  AS properties`
    );

    // Fetch all relationships
    const relsResult = await session.run(
      `MATCH (a)-[r]->(b)
       RETURN
         id(r)            AS id,
         type(r)          AS type,
         id(a)            AS source,
         id(b)            AS target,
         properties(r)    AS properties`
    );

    // Map nodes to an object
    const nodes = nodesResult.records.map(rec => ({
      id:          rec.get('id')?.toString(),
      labels:      rec.get('labels'),
      properties:  rec.get('properties')
    }));

    // Map relationships
    const relationships = relsResult.records.map(rec => ({
      id:         rec.get('id')?.toString(),
      type:       rec.get('type'),
      source:     rec.get('source')?.toString(),
      target:     rec.get('target')?.toString(),
      properties: rec.get('properties')
    }));

    // Return the combined graph
    res.json({ nodes, relationships });

  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});


app.get('/node/:id', async (req, res, next) => {
  const nodeId = parseInt(req.params.id, 10);
  const withRels = req.query.relations === 'true';
  const session = driver.session();

  try {
    const result = await session.run(
      `
      MATCH (n)
      WHERE id(n) = $nodeId
      ${withRels ? `
      OPTIONAL MATCH (n)-[r]->(m)
      OPTIONAL MATCH (p)-[r2]->(n)
      RETURN
        id(n) AS id,
        labels(n) AS labels,
        properties(n) AS props,
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
          node: { id: id(n), labels: labels(p), properties: properties(p) }
        }) AS incoming
      ` : `
      RETURN
        id(n) AS id,
        labels(n) AS labels,
        properties(n) AS props;
      `}
      `,
      { nodeId }
    );

    if (!result.records.length) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const record = result.records[0];
    const response = {
      id: record.get('id').toString(),
      labels: record.get('labels'),
      properties: record.get('props')
    };

    if (withRels) {
      const makeRel = r => ({
        id: r.relId?.toString(),
        type: r.type,
        direction: r.direction,
        node: {
          id: r.node.id?.toString(),
          labels: r.node.labels,
          properties: r.node.properties
        }
      });
      response.outgoingRels = record.get('outgoing').map(makeRel);
      response.incomingRels = record.get('incoming').map(makeRel);
    }

    res.json(response);
  } catch (err) {
    console.error('GET Node Error:', err);
    next(err);
  } finally {
    await session.close();
  }
});

// Update node properties
app.patch('/node/:id', requireAuth, async (req, res, next) => {
  const nodeId = parseInt(req.params.id, 10);
  const properties = req.body;
  const session = driver.session();

  try {
    // Validate properties
    if (!properties || Object.keys(properties).length === 0) {
      return res.status(400).json({ error: 'At least one property is required' });
    }
    for (const key of Object.keys(properties)) {
      if (/[^a-zA-Z0-9_]/.test(key)) {
        return res.status(400).json({ error: 'Property names can only contain letters, numbers, or underscores' });
      }
    }

    // Update node in Neo4j
    const result = await session.run(
      `
      MATCH (n)
      WHERE id(n) = $nodeId
      SET n += $properties
      RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props
      `,
      { nodeId, properties }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const record = result.records[0];
    res.json({
      id: record.get('id').toString(),
      labels: record.get('labels'),
      properties: record.get('props')
    });
  } catch (err) {
    console.error('Update Node Error:', err);
    next(err);
  } finally {
    await session.close();
  }
});

// --- CREATE Author ---
// POST /authors  
// Body: { name: string, <any other initial properties> }
app.post('/authors', requireAuth, async (req, res, next) => {
  const { name, ...otherProps } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '`name` is required' });
  }

  // In it Neo4j driver
  const session = driver.session();

  // Send POST message to database
  try {
    // First, check for duplicate node
    const dup = await session.run(
      `MATCH (a:Author {name:$name}) RETURN a LIMIT 1`,
      { name }
    );
    // If the node already exists, return 409 CONFLICT
    if (dup.records.length) {
      return res.status(409).json({ error: `Author "${name}" already exists` });
    }

    // Create with generated UUID for id, and check that the ID doesn't already exist in the DB
    let id, timeout = 100;
    while (timeout > 0) {
      id = crypto.randomUUID();
      const idCheck = await session.run(
        `MATCH (a:Author {id:$id}) RETURN a LIMIT 1`,
        { id }
      );
      if (idCheck.records.length === 0) break;  // We found an unused id
      console.warn(`UUID collision on ${id}, regenerating…`);
      timeout--;
    }

    // Create properties
    const props = { id, name, ...otherProps };

    // Send request to database to create node
    const rec = await session.run(
      `CREATE (a:Author $props) RETURN a`,
      { props }
    );

    console.log("CREATE Author Success");

    // Return new author node to client.
    const node = rec.records[0].get('a').properties;
    res.status(201).json({ id: node.id, labels: ['Author'], properties: node });
  } catch (err) {
    console.log("CREATE Author Error");
    next(err);
  } finally {
    await session.close();
  }
});

// --- READ Author + Relations ---
// GET /authors/:name  
app.get('/authors/:name', async (req, res, next) => {
  const name = req.params.name;

  // Init Neo4j driver
  const session = driver.session();

  // Send request to database
  try {
    const result = await session.run(
      `
      MATCH (a:Author {name: $val})
      OPTIONAL MATCH (a)-[r]->(m)
      OPTIONAL MATCH (n)-[r2]->(a)
      RETURN
        id(a)            AS id,
        labels(a)        AS labels,
        properties(a)    AS props,

        collect(DISTINCT {
          relId:    id(r),
          type:     type(r),
          direction:"outgoing",
          node: {
            id:    id(m),
            labels: labels(m),
            properties:  properties(m)
          }
        })               AS outgoing,

        collect(DISTINCT {
          relId:    id(r2),
          type:     type(r2),
          direction:"incoming",
          node: {
            id:    id(n),
            labels: labels(n),
            properties:  properties(n)
          }
        })               AS incoming
      `,
      { val: name }
    );

    // If no content inside the result, then there is no such author
    if (!result.records.length) {
      return res.status(404).json({ error: `Author "${name}" not found` });
    }

    // Get first author
    const rec = result.records[0];

    // Create template for JSON data structure, to be filled later
    const makeRel = r => ({
      id:        r.relId?.toString(),
      type:      r.type,
      direction: r.direction,
      node: {
        id:    r.node.id?.toString(),
        labels: r.node.labels,
        properties:  r.node.properties
      }
    });

    console.log("GET Author Success");

    // Create JSON from template using the first author data, and return to client.
    res.json({
      id:             rec.get('id')?.toString(),
      labels:         rec.get('labels'),
      properties:     rec.get('props'),
      outgoingRels:   rec.get('outgoing').map(makeRel),
      incomingRels:   rec.get('incoming').map(makeRel)
    });
  } catch (err) {
    console.log("GET Author Error");
    next(err);
  } finally {
    await session.close();
  }
});

// --- 3) UPDATE Author Properties ---
// PUT /authors/:name  
// Body: { properties: { key1: val1, key2: val2, … } }
app.put('/authors/:name', requireAuth, async (req, res, next) => {
  const name = req.params.name;
  const { properties } = req.body;

  // If 'properties' is wrong type, throw error.
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    return res.status(400).json({ error: '`properties` must be an object' });
  }

  // Init Neo4j driver
  const session = driver.session();

  // Send SET command to database
  try {
    // Build SET clauses dynamically while guarding keys
    const safeKeys = Object.keys(properties).filter(validIdentifier);
    if (!safeKeys.length) {
      return res.status(400).json({ error: 'No valid properties to set' });
    }
    const assignments = safeKeys.map(k => `a.${k} = $props.${k}`).join(', ');
    const result = await session.run(
      `
      MATCH (a:Author {name:$name})
      SET ${assignments}
      RETURN properties(a) AS props
      `,
      { name, props: properties }
    );
    if (!result.records.length) {
      return res.status(404).json({ error: `Author "${name}" not found` });
    }

    console.log("EDIT Author Success");

    // Return the current list of properties returned from databse.
    res.json({ properties: result.records[0].get('props') });
  } catch (err) {
    console.log("EDIT Author Error");
    next(err);
  } finally {
    await session.close();
  }
});

// --- 4) DELETE Author ---
// DELETE /authors/:name
app.delete('/authors/:name', requireAuth, async (req, res, next) => {
  const name = req.params.name;

  // Init Neo4j driver
  const session = driver.session();

  // Send DELETE command to database
  try {
    const result = await session.run(
      `
      MATCH (a:Author {name:$name})
      WITH a, count(a) AS cnt
      DETACH DELETE a
      RETURN cnt
      `,
      { name }
    );

    const deleted = result.records[0].get('cnt').toNumber();
    if (!deleted) {
      return res.status(404).json({ error: `Author "${name}" not found` });
    }

    console.log("DELETE Author Success");

    // Return true if one or more nodes were deleted
    res.json({ deleted: true });
  } catch (err) {
    console.log("DELETE Author Error");
    next(err);
  } finally {
    await session.close();
  }
});

// This endpoint will allow the user to search for a text by its title.
// RETURNS: Info about the text, and all relationships connected to that text.
app.get('/texts/:title', async (req, res, next) => {
  const textTitle = req.params.title;
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (t:Text {title: $val})
      OPTIONAL MATCH (t)-[r]->(m)
      OPTIONAL MATCH (n)-[r2]->(t)
      RETURN
        id(t)            AS id,
        labels(t)        AS labels,
        properties(t)    AS props,

        collect(DISTINCT {
          relId:     id(r),
          type:      type(r),
          direction: "outgoing",
          node: {
            id:    id(m),
            labels: labels(m),
            properties:  properties(m)
          }
        })                AS outgoing,

        collect(DISTINCT {
          relId:     id(r2),
          type:      type(r2),
          direction: "incoming",
          node: {
            id:    id(n),
            labels: labels(n),
            properties:  properties(n)
          }
        })                AS incoming
      `,
      { val: textTitle }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: `Text "${textTitle}" not found` });
    }

    const rec = result.records[0];
    const makeRel = r => ({
      id:        r.relId?.toString(),
      type:      r.type,
      direction: r.direction,
      node: {
        id:    r.node.id?.toString(),
        labels: r.node.labels,
        properties:  r.node.properties
      }
    });

    res.json({
      id:             rec.get('id')?.toString(),
      labels:         rec.get('labels'),
      properties:     rec.get('props'),
      outgoingRels:   rec.get('outgoing').map(makeRel),
      incomingRels:   rec.get('incoming').map(makeRel)
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- GET all authors ---
app.get('/authors', async (req, res, next) => {
  try {
    const authors = await fetchAllByLabel('Author');
    res.json(authors);
  } catch (err) {
    next(err);
  }
});

// GET /editions/:title
app.get('/editions/:title', async (req, res, next) => {
  const editionTitle = req.params.title;
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (e:Edition {title: $val})
      OPTIONAL MATCH (e)-[r]->(m)
      OPTIONAL MATCH (n)-[r2]->(e)
      RETURN
        id(e)            AS id,
        labels(e)        AS labels,
        properties(e)    AS props,

        collect(DISTINCT {
          relId:     id(r),
          type:      type(r),
          direction: "outgoing",
          node: {
            id:    id(m),
            labels: labels(m),
            properties:  properties(m)
          }
        })               AS outgoing,

        collect(DISTINCT {
          relId:     id(r2),
          type:      type(r2),
          direction: "incoming",
          node: {
            id:    id(n),
            labels: labels(n),
            properties:  properties(n)
          }
        })               AS incoming
      `,
      { val: editionTitle }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: `Edition "${editionTitle}" not found` });
    }

    const rec = result.records[0];
    const makeRel = r => ({
      id:        r.relId?.toString(),
      type:      r.type,
      direction: r.direction,
      node: {
        id:    r.node.id?.toString(),
        labels: r.node.labels,
        properties:  r.node.properties
      }
    });

    res.json({
      id:             rec.get('id')?.toString(),
      labels:         rec.get('labels'),
      properties:     rec.get('props'),
      outgoingRels:   rec.get('outgoing').map(makeRel),
      incomingRels:   rec.get('incoming').map(makeRel)
    });
  } catch (err) {
    next(err);
  } finally {
    await session.close();
  }
});

// --- GET all texts ---
app.get('/texts', async (req, res, next) => {
  try {
    const texts = await fetchAllByLabel('Text');
    res.json(texts);
  } catch (err) {
    next(err);
  }
});

// --- GET all editions ---
app.get('/editions', async (req, res, next) => {
  try {
    const editions = await fetchAllByLabel('Edition');
    res.json(editions);
  } catch (err) {
    next(err);
  }
});

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
    console.log("Result: " + result);
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
// Body: {
//   fromLabel,        // e.g. "Author"
//   fromId,           // the node.id property to match
//   toLabel,          // e.g. "Text"
//   toId,             // the node.id property to match
//   relType,          // e.g. "WROTE"
//   relProps?         // optional map of relationship properties
// }
app.post('/relation', requireAuth, async (req, res, next) => {
  let { fromLabel, fromId, toLabel, toId, relType, relProps = {} } = req.body;

  // Basic validation
  if (![fromLabel, toLabel, relType].every(validIdentifier)) {
    return res.status(400).json({ error: 'Invalid label or relationship type' });
  }
  if (![fromId, toId].every(v => typeof v === 'string' && v.length > 0)) {
    return res.status(400).json({ error: 'fromId and toId must be non-empty strings' });
  }
  if (typeof relProps !== 'object') {
    return res.status(400).json({ error: '`relProps` must be an object if provided' });
  }

  const session = driver.session();
  try {
    // Create / merge the relationship
    const result = await session.run(
      `
      MATCH (a:${fromLabel} {id:$fromId})
      MATCH (b:${toLabel}   {id:$toId})
      MERGE (a)-[r:${relType}]->(b)
      SET r += $relProps
      RETURN 
        id(r)              AS relInternalId,
        type(r)            AS relType,
        properties(r)      AS relProps,

        id(a)              AS srcId,
        labels(a)          AS srcLabels,
        properties(a)      AS srcProps,

        id(b)              AS tgtId,
        labels(b)          AS tgtLabels,
        properties(b)      AS tgtProps
      `,
      { fromId, toId, relProps }
    );

    if (result.records.length === 0) {
      return res.status(404).json({ error: 'Source or target node not found' });
    }

    const rec = result.records[0];
    // Build a structured response
    const response = {
      relationship: {
        id:         rec.get('relInternalId').toString(),
        type:       rec.get('relType'),
        properties: rec.get('relProps')
      },
      source: {
        id:         rec.get('srcId').toString(),
        labels:     rec.get('srcLabels'),
        properties: rec.get('srcProps')
      },
      target: {
        id:         rec.get('tgtId').toString(),
        labels:     rec.get('tgtLabels'),
        properties: rec.get('tgtProps')
      }
    };

    res.status(201).json(response);
  } catch (err) {
    next(err);
  } finally {
    await session.close();
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
