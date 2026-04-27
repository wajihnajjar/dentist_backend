const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DATABASE_URL in environment configuration');
  process.exit(1);
}

const pool = new Pool({ connectionString });

(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('Database connected');
  } catch (err) {
    console.error('Database connection error:', err.message);
  }
})();

module.exports = pool;