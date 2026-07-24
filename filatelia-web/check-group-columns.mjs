import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

try {
  const result = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'StampGroup'
    ORDER BY ordinal_position
  `)

  console.log('StampGroup columns:')
  result.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`))

} catch (e) {
  console.error('Error:', e.message)
} finally {
  client.release()
  await pool.end()
}
