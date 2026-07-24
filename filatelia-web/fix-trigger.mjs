/**
 * Fix the stamp_search_vector_trigger to handle column types properly
 */
import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🔧 Fixing stamp_search_vector_trigger...\n')

try {
  // First, check the actual column types for tags and color
  const colInfo = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'Stamp'
      AND column_name IN ('tags', 'color', 'nameEs', 'nameEn', 'theme', 'descriptionEs', 'descriptionEn')
    ORDER BY column_name
  `)

  console.log('Column types:')
  colInfo.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} (${r.udt_name})`))

  // Build the trigger function based on actual types
  let funcBody = `
  BEGIN
    NEW."searchVector" :=
      setweight(to_tsvector('spanish', COALESCE(NEW."nameEs", '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(NEW."nameEn", '')), 'A') ||
      setweight(to_tsvector('spanish', COALESCE(NEW."descriptionEs", '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW."descriptionEn", '')), 'B')
  `

  const tagsRow = colInfo.rows.find(r => r.column_name === 'tags')
  if (tagsRow && tagsRow.data_type.includes('ARRAY')) {
    funcBody += ` || setweight(to_tsvector('spanish', COALESCE(array_to_string(NEW."tags", ' '), '')), 'C')`
    console.log('  → Adding tags to trigger (array type)')
  } else if (tagsRow) {
    funcBody += ` || setweight(to_tsvector('spanish', COALESCE(NEW."tags", '')), 'C')`
    console.log('  → Adding tags to trigger (text type)')
  }

  const colorRow = colInfo.rows.find(r => r.column_name === 'color')
  if (colorRow && colorRow.data_type.includes('ARRAY')) {
    funcBody += ` || setweight(to_tsvector('spanish', COALESCE(array_to_string(NEW."color", ' '), '')), 'D')`
    console.log('  → Adding color to trigger (array type)')
  } else if (colorRow) {
    funcBody += ` || setweight(to_tsvector('spanish', COALESCE(NEW."color", '')), 'D')`
    console.log('  → Adding color to trigger (text type)')
  }

  // Add theme
  funcBody += ` || setweight(to_tsvector('spanish', COALESCE(NEW."theme", '')), 'C')`
  funcBody += `;
    RETURN NEW;
  END;`

  console.log('\nCreating trigger function...')

  await client.query(`
    CREATE OR REPLACE FUNCTION stamp_search_vector_trigger()
    RETURNS trigger AS $$
    ${funcBody}
    $$ LANGUAGE plpgsql
  `)

  console.log('✅ Trigger function updated')

  // Test the trigger with a dummy update
  console.log('\nTesting trigger...')
  const testResult = await client.query(`
    UPDATE "Stamp"
    SET "updatedAt" = NOW()
    WHERE id = (SELECT id FROM "Stamp" LIMIT 1)
    RETURNING "searchVector"
  `)

  if (testResult.rows[0]?.searchVector) {
    console.log('✅ Trigger works! Sample searchVector:', testResult.rows[0].searchVector.slice(0, 100))
  }

  // Now update all stamps
  console.log('\nUpdating all stamps searchVector...')
  const updateResult = await client.query(`
    UPDATE "Stamp"
    SET "nameEs" = "nameEs"  -- This triggers the update
  `)

  console.log(`✅ Updated ${updateResult.rowCount} stamps`)

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
