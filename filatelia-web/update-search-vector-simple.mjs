/**
 * Update searchVector for all existing stamps - simple version
 */
import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🔧 Updating searchVector for all stamps...\n')

try {
  const result = await client.query(`
    UPDATE "Stamp"
    SET "searchVector" =
      setweight(to_tsvector('spanish', COALESCE("nameEs", '')), 'A') ||
      setweight(to_tsvector('english', COALESCE("nameEn", '')), 'A') ||
      setweight(to_tsvector('spanish', COALESCE("theme", '')), 'C')
  `)

  console.log(`✅ Updated ${result.rowCount} stamps`)

  // Verify
  const verify = await client.query(`
    SELECT COUNT(*) as total,
           COUNT("searchVector") as with_vector
    FROM "Stamp"
  `)

  console.log(`\n📊 Verification:`)
  console.log(`   Total stamps: ${verify.rows[0].total}`)
  console.log(`   With searchVector: ${verify.rows[0].with_vector}`)

} catch (e) {
  console.error('Error:', e.message)
  console.error(e.stack)
} finally {
  client.release()
  await pool.end()
}
