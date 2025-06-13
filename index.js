require('dotenv').config();
const express = require('express');
const neo4j = require('neo4j-driver');

const app = express();
app.use(express.json());

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);
const session = driver.session();

app.get('/', async (req, res) => {
  const result = await session.run('MATCH (n) RETURN n LIMIT 10');
  const nodes = result.records.map(r => r.get('n').properties);
  res.json(nodes);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
