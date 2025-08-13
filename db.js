const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to set your PostgreSQL connection string?",
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Simple query helper
async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

module.exports = { pool, query };