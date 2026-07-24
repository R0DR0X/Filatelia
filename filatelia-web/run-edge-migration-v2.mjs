/**
 * Run edge functions migration - proper version
 * Handles PL/pgSQL functions correctly
 */
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🚀 Running edge functions migration (v2)...\n')

const sqlFile = path.join(process.cwd(), '..', 'migrate-edge-functions.sql')
const sql = fs.readFileSync(sqlFile, 'utf8')

// Better SQL splitting that respects $$ delimiters
function splitSQL(sql) {
  const statements = []
  let current = ''
  let inDollarQuote = false
  let dollarTag = ''

  for (let i = 0; i < sql.length; i++) {
    // Check for dollar-quote start
    if (!inDollarQuote && sql[i] === '$' && sql[i+1] === '$') {
      let end = sql.indexOf('$', i + 2)
      if (end !== -1) {
        dollarTag = sql.slice(i, end + 1)
        inDollarQuote = true
        current += dollarTag
        i = end
        continue
      }
    }

    // Check for dollar-quote end
    if (inDollarQuote && sql.slice(i, i + dollarTag.length) === dollarTag) {
      current += dollarTag
      inDollarQuote = false
      i += dollarTag.length - 1
      continue
    }

    // Check for semicolon outside dollar quotes
    if (!inDollarQuote && sql[i] === ';') {
      const trimmed = current.trim()
      if (trimmed.length > 0) {
        statements.push(trimmed)
      }
      current = ''
      continue
    }

    current += sql[i]
  }

  // Don't forget the last statement
  const trimmed = current.trim()
  if (trimmed.length > 0) {
    statements.push(trimmed)
  }

  return statements
}

const statements = splitSQL(sql)
console.log(`Found ${statements.length} statements to execute\n`)

let completed = 0
let errors = 0

for (const stmt of statements) {
  if (stmt.length < 5 || stmt.startsWith('--')) continue

  try {
    await client.query(stmt)
    completed++
    process.stdout.write(`\r  ✓ Completed ${completed}/${statements.length}...`)
  } catch (e) {
    const msg = e.message.toLowerCase()
    if (!msg.includes('already exists') && !msg.includes('does not exist')) {
      console.error(`\n  ✗ Error: ${e.message.slice(0, 120)}`)
      errors++
    } else {
      completed++ // Count as completed since it's not a real error
    }
  }
}

console.log(`\n\n✅ Migration completed!`)
console.log(`   Statements processed: ${completed}`)
console.log(`   Errors: ${errors}`)

// Verify
try {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM "Stamp") as total_stamps,
      (SELECT COUNT(*) FROM pg_proc WHERE proname = 'match_stamps_by_embedding') as has_match_func,
      (SELECT COUNT(*) FROM pg_proc WHERE proname = 'stamp_search_vector_trigger') as has_trigger_func,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'PriceAlert') as has_price_alert
  `)
  console.log('\n📊 Verification:')
  console.log(`   Total stamps: ${result.rows[0].total_stamps}`)
  console.log(`   match_stamps_by_embedding exists: ${result.rows[0].has_match_func}`)
  console.log(`   stamp_search_vector_trigger exists: ${result.rows[0].has_trigger_func}`)
  console.log(`   PriceAlert table exists: ${result.rows[0].has_price_alert}`)
} catch (e) {
  console.error('Verification error:', e.message)
}

client.release()
await pool.end()
