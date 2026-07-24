/**
 * Update searchVector for all existing stamps - v3
 */
import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🔧 Updating searchVector for all stamps...\n')

try {
  // Check if tags/color are arrays
  const colInfo = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'Stamp'
      AND column_name IN ('tags', 'color')
  `)

  console.log('Array columns:')
  colInfo.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`))

  // Build dynamic update based on column types
  let updateQuery = `
    UPDATE "Stamp"
    SET "searchVector" =
      setweight(to_tsvector('spanish', COALESCE("nameEs", '')), 'A') ||
      setweight(to_tsvector('english', COALESCE("nameEn", '')), 'A') ||
      setweight(to_tsvector('spanish', COALESCE("theme", '')), 'C')
  `

  // Add tags if column exists and is array
  const tagsCol = colInfo.rows.find(r => r.column_name === 'tags')
  if (tagsCol && tagsCol.data_type.includes('ARRAY')) {
    updateQuery += ` || setweight(to_tsvector('spanish', COALESCE(array_to_string("tags", ' '), '')), 'C')`
  }

  // Add color if column exists and is array
  const colorCol = colInfo.rows.find(r => r.column_name === 'color')
  if (colorCol && colorCol.data_type.includes('ARRAY')) {
    updateQuery += ` || setweight(to_tsvector('spanish', COALESCE(array_to_string("color", ' '), '')), 'D')`
  }

  console.log('\nExecuting update...')
  const result = await client.query(updateQuery)

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
