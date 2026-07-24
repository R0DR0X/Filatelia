/**
 * Run edge functions migration via pg Pool
 */
import 'dotenv/config'
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🚀 Running edge functions migration...\n')

const sqlFile = path.join(process.cwd(), 'migrate-edge-functions.sql')
const sql = fs.readFileSync(sqlFile, 'utf8')

// Split by semicolon and run each statement
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('$$'))

let completed = 0
let errors = 0

for (const stmt of statements) {
  if (stmt.length < 10) continue // Skip short/empty statements

  try {
    await client.query(stmt + ';')
    completed++
    process.stdout.write(`\r  ✓ Completed ${completed} statements...`)
  } catch (e) {
    // Log but continue
    if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
      console.error(`\n  ✗ Error: ${e.message.slice(0, 100)}`)
      errors++
    }
  }
}

console.log(`\n\n✅ Migration completed!`)
console.log(`   Statements run: ${completed}`)
console.log(`   Errors (non-fatal): ${errors}`)

// Verify
try {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM "Stamp" WHERE embedding IS NOT NULL) as with_embedding,
      (SELECT COUNT(*) FROM "PriceAlert") as price_alerts,
      (SELECT COUNT(*) FROM pg_proc WHERE proname = 'match_stamps_by_embedding') as has_match_func
  `)
  console.log('\n📊 Verification:')
  console.log(`   Stamps with embedding: ${result.rows[0].with_embedding}`)
  console.log(`   PriceAlert records: ${result.rows[0].price_alerts}`)
  console.log(`   match_stamps_by_embedding exists: ${result.rows[0].has_match_func}`)
} catch (e) {
  console.error('Verification error:', e.message)
}

client.release()
await pool.end()
