/**
 * Run edge functions migration - manual statements
 */
import { Pool } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

console.log('🚀 Running edge functions migration (v3)...\n')

const statements = [
  // 1. Add embedding column
  `ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS embedding vector(1536)`,

  // 2. Add searchVector column
  `ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "searchVector" tsvector`,

  // 3. Create ivfflat index for vector search
  `CREATE INDEX IF NOT EXISTS idx_stamps_embedding ON "Stamp" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,

  // 4. Create GIN index for full-text search
  `CREATE INDEX IF NOT EXISTS idx_stamps_searchvector ON "Stamp" USING GIN ("searchVector")`,

  // 5. Create the search vector update function
  `CREATE OR REPLACE FUNCTION stamp_search_vector_trigger()
  RETURNS trigger AS $$
  BEGIN
    NEW."searchVector" :=
      setweight(to_tsvector('spanish', COALESCE(NEW."nameEs", '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(NEW."nameEn", '')), 'A') ||
      setweight(to_tsvector('spanish', COALESCE(NEW."descriptionEs", '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW."descriptionEn", '')), 'B') ||
      setweight(to_tsvector('spanish', COALESCE(NEW."theme", '')), 'C') ||
      setweight(to_tsvector('spanish', COALESCE(array_to_string(NEW."tags", ' '), '')), 'C') ||
      setweight(to_tsvector('spanish', COALESCE(array_to_string(NEW."color", ' '), '')), 'D');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`,

  // 6. Drop and recreate trigger
  `DROP TRIGGER IF EXISTS tsvectorupdate ON "Stamp"`,

  `CREATE TRIGGER tsvectorupdate
    BEFORE INSERT OR UPDATE ON "Stamp"
    FOR EACH ROW
    EXECUTE FUNCTION stamp_search_vector_trigger()`,

  // 7. Create match_stamps_by_embedding function
  `CREATE OR REPLACE FUNCTION match_stamps_by_embedding(
    query_embedding vector(1536),
    match_count int DEFAULT 10,
    filter_country text DEFAULT NULL
  )
  RETURNS TABLE (
    id text,
    name_es text,
    name_en text,
    scott_number text,
    year int,
    country_code char(2),
    image_url text,
    market_price_usd numeric,
    similarity float
  )
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RETURN QUERY
    SELECT
      s.id,
      s."nameEs"::text as name_es,
      s."nameEn"::text as name_en,
      s."scottNumber"::text as scott_number,
      s.year,
      s."countryCode"::char(2) as country_code,
      s."imageUrl"::text as image_url,
      s."marketPriceUsd"::numeric as market_price_usd,
      1 - (s.embedding <=> query_embedding)::float as similarity
    FROM "Stamp" s
    WHERE s.embedding IS NOT NULL
      AND (filter_country IS NULL OR s."countryCode" = filter_country)
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count;
  END;
  $$`,

  // 8. Create PriceAlert table
  `CREATE TABLE IF NOT EXISTS "PriceAlert" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "stampId" UUID NOT NULL REFERENCES "Stamp"(id) ON DELETE CASCADE,
    "targetPrice" NUMERIC(10,2) NOT NULL,
    "currentPrice" NUMERIC(10,2),
    condition TEXT,
    "alertType" TEXT NOT NULL DEFAULT 'below',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isNotified" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  // 9. Create indexes for PriceAlert
  `CREATE INDEX IF NOT EXISTS idx_price_alert_user ON "PriceAlert"("userId")`,
  `CREATE INDEX IF NOT EXISTS idx_price_alert_stamp ON "PriceAlert"("stampId")`,
  `CREATE INDEX IF NOT EXISTS idx_price_alert_active ON "PriceAlert"("isActive", "isNotified")`,

  // 10. Enable RLS on PriceAlert
  `ALTER TABLE "PriceAlert" ENABLE ROW LEVEL SECURITY`,

  // 11. Create RLS policy (drop first if exists)
  `DROP POLICY IF EXISTS "users_own_alerts" ON "PriceAlert"`,
  `CREATE POLICY "users_own_alerts" ON "PriceAlert"
    FOR ALL
    USING (auth.uid()::text = "userId"::text)
    WITH CHECK (auth.uid()::text = "userId"::text)`,

  // 12. Update existing stamps' searchVector
  `UPDATE "Stamp"
  SET "searchVector" =
    setweight(to_tsvector('spanish', COALESCE("nameEs", '')), 'A') ||
    setweight(to_tsvector('english', COALESCE("nameEn", '')), 'A') ||
    setweight(to_tsvector('spanish', COALESCE("descriptionEs", '')), 'B') ||
    setweight(to_tsvector('english', COALESCE("descriptionEn", '')), 'B') ||
    setweight(to_tsvector('spanish', COALESCE("theme", '')), 'C') ||
    setweight(to_tsvector('spanish', COALESCE(array_to_string("tags", ' '), '')), 'C') ||
    setweight(to_tsvector('spanish', COALESCE(array_to_string("color", ' '), '')), 'D')
  WHERE "searchVector" IS NULL`
]

let completed = 0
let errors = 0

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i].trim()
  if (stmt.length < 5) continue

  try {
    await client.query(stmt)
    completed++
    process.stdout.write(`\r  ✓ [${completed}/${statements.length}] ${stmt.slice(0, 50)}...`)
  } catch (e) {
    const msg = e.message.toLowerCase()
    if (!msg.includes('already exists') && !msg.includes('does not exist')) {
      console.error(`\n  ✗ Error in statement ${i+1}: ${e.message.slice(0, 150)}`)
      errors++
    } else {
      completed++ // Still count as completed
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
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'PriceAlert') as has_price_alert,
      (SELECT COUNT(*) FROM "Stamp" WHERE "searchVector" IS NOT NULL) as with_search_vector
  `)
  console.log('\n📊 Verification:')
  console.log(`   Total stamps: ${result.rows[0].total_stamps}`)
  console.log(`   match_stamps_by_embedding exists: ${result.rows[0].has_match_func}`)
  console.log(`   stamp_search_vector_trigger exists: ${result.rows[0].has_trigger_func}`)
  console.log(`   PriceAlert table exists: ${result.rows[0].has_price_alert}`)
  console.log(`   Stamps with searchVector: ${result.rows[0].with_search_vector}`)
} catch (e) {
  console.error('Verification error:', e.message)
}

client.release()
await pool.end()
