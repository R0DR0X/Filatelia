import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  // Check tables
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)
  console.log('Tables in database:')
  tables.rows.forEach(r => console.log(`  - ${r.table_name}`))

  // Check Stamp table schema
  console.log('\nStamp table columns:')
  const columns = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'Stamp'
    ORDER BY ordinal_position
  `)
  columns.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (${r.udt_name})`))

  // Check if Stamp.id is UUID
  const pk = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'Stamp' AND column_name = 'id'
  `)
  console.log('\nStamp.id type:', pk.rows)

} catch (e) {
  console.error('Error:', e.message)
} finally {
  client.release()
  await pool.end()
}
