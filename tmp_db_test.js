const { Pool } = require('pg');
require('dotenv').config();
console.log('DATABASE_URL=', process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.connect((err) => {
  console.log('connect callback');
  if (err) {
    console.error('err message:', err.message);
    console.error('err code:', err.code);
    console.error('err stack:', err.stack);
  } else {
    console.log('connected');
    pool.end();
  }
});
