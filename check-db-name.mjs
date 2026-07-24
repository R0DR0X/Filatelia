import { Pool } from 'pg';

const pool = new Pool({
  host: 'aws-1-us-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.tshatwvvkworsogjfjyj',
  password: '1vrpu4XvDBvhcUON',
  ssl: { rejectUnauthorized: false }
});

try {
  const res = await pool.query(`
    SELECT
      current_database() AS db_name,
      (SELECT datname FROM pg_database WHERE datname ILIKE '%filatelia%') AS filatelia_db,
      (SELECT count(*) FROM "Stamp") AS stamp_count
  `);
  console.log('✅ Conexión exitosa a Supabase:');
  console.log(res.rows[0]);
} catch (err) {
  console.error('❌ Error de conexión:', err.message);
} finally {
  await pool.end();
}
