/**
 * Fix PriceAlert table - use correct column types
 */
import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🔧 Fixing PriceAlert table...\n')

try {
  // Check User table id type
  const userCol = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'id'
  `)
  console.log('User.id type:', userCol.rows[0]?.data_type)

  // Check Stamp table id type
  const stampCol = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'Stamp' AND column_name = 'id'
  `)
  console.log('Stamp.id type:', stampCol.rows[0]?.data_type)

  // Drop PriceAlert if exists and recreate with TEXT columns
  await client.query(`DROP TABLE IF EXISTS "PriceAlert" CASCADE`)

  await client.query(`
    CREATE TABLE "PriceAlert" (
      id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
      "userId" TEXT NOT NULL,
      "stampId" TEXT NOT NULL,
      "targetPrice" NUMERIC(10,2) NOT NULL,
      "currentPrice" NUMERIC(10,2),
      condition TEXT,
      "alertType" TEXT NOT NULL DEFAULT 'below',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "isNotified" BOOLEAN NOT NULL DEFAULT false,
      "triggeredAt" TIMESTAMP,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  console.log('✓ PriceAlert table created with TEXT columns')

  // Create indexes
  await client.query(`CREATE INDEX IF NOT EXISTS idx_price_alert_user ON "PriceAlert"("userId")`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_price_alert_stamp ON "PriceAlert"("stampId")`)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_price_alert_active ON "PriceAlert"("isActive", "isNotified")`)
  console.log('✓ Indexes created')

  // Enable RLS
  await client.query(`ALTER TABLE "PriceAlert" ENABLE ROW LEVEL SECURITY`)
  console.log('✓ RLS enabled')

  // Create policy
  await client.query(`DROP POLICY IF EXISTS "users_own_alerts" ON "PriceAlert"`)
  await client.query(`
    CREATE POLICY "users_own_alerts" ON "PriceAlert"
    FOR ALL
    USING (auth.uid()::text = "userId")
    WITH CHECK (auth.uid()::text = "userId")
  `)
  console.log('✓ RLS policy created')

  // Verify
  const result = await client.query(`
    SELECT COUNT(*) as count FROM information_schema.tables
    WHERE table_name = 'PriceAlert'
  `)
  console.log(`\n✅ PriceAlert table verified: ${result.rows[0].count > 0 ? 'EXISTS' : 'NOT FOUND'}`)

} catch (e) {
  console.error('Error:', e.message)
  console.error(e.stack)
} finally {
  client.release()
  await pool.end()
}
