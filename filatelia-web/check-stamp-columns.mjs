import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  const columns = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'Stamp'
    ORDER BY ordinal_position
  `)

  console.log('Current Stamp table columns:')
  columns.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`))

} catch (e) {
  console.error('Error:', e.message)
} finally {
  client.release()
  await pool.end()
}
