import 'dotenv/config'
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

const connectionString = process.env.DATABASE_URL
console.log('Running migration v3...')

const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  const sqlPath = path.join(process.cwd(), '..', 'migrate-schema-v3.sql')
  console.log('Reading SQL from:', sqlPath)
  const sql = fs.readFileSync(sqlPath, 'utf-8')

  console.log('Executing migration SQL...')
  await client.query(sql)
  console.log('✅ Migration completed successfully!')

} catch (e) {
  console.error('Error during migration:', e.message)
  console.error('Stack:', e.stack)
} finally {
  client.release()
  await pool.end()
}
