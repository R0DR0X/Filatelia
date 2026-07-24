import 'dotenv/config'
import { Pool } from 'pg'

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
console.log('Using connection string for setup...')

const pool = new Pool({ connectionString })

async function main() {
  const client = await pool.connect()

  try {
    console.log('Enabling extensions...')

    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    console.log('✓ uuid-ossp enabled')

    await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"')
    console.log('✓ pg_trgm enabled')

    await client.query('CREATE EXTENSION IF NOT EXISTS "unaccent"')
    console.log('✓ unaccent enabled')

    await client.query('CREATE EXTENSION IF NOT EXISTS "vector"')
    console.log('✓ vector enabled')

    // Check if search_vector column exists in Stamp table
    const checkColumn = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Stamp' AND column_name = 'search_vector'
    `)

    if (checkColumn.rows.length === 0) {
      console.log('Adding search_vector column to Stamp table...')
      await client.query(`ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS search_vector tsvector`)
      console.log('✓ search_vector column added')
    } else {
      console.log('search_vector column already exists')
    }

    // Check if embedding column exists
    const checkEmbedding = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Stamp' AND column_name = 'embedding'
    `)

    if (checkEmbedding.rows.length === 0) {
      console.log('Adding embedding column to Stamp table...')
      await client.query(`ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS embedding vector(1536)`)
      console.log('✓ embedding column added')
    } else {
      console.log('embedding column already exists')
    }

    // Create the search vector update function
    console.log('Creating/updating search vector function...')
    await client.query(`
      CREATE OR REPLACE FUNCTION update_stamp_search_vector()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('spanish', COALESCE(NEW."nameEs", '')), 'A') ||
          setweight(to_tsvector('spanish', COALESCE(NEW."descriptionEs", '')), 'B') ||
          setweight(to_tsvector('simple', COALESCE(NEW."countryCode", '')), 'C') ||
          setweight(to_tsvector('simple', COALESCE(NEW."theme", '')), 'C') ||
          setweight(to_tsvector('simple', array_to_string(COALESCE(NEW.tags, '{}'), ' ')), 'D');
        NEW."updatedAt" := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)
    console.log('✓ search vector function created')

    // Create trigger
    console.log('Creating trigger...')
    await client.query(`
      DROP TRIGGER IF EXISTS stamps_search_vector_update ON "Stamp";
      CREATE TRIGGER stamps_search_vector_update
        BEFORE INSERT OR UPDATE ON "Stamp"
        FOR EACH ROW EXECUTE FUNCTION update_stamp_search_vector();
    `)
    console.log('✓ trigger created')

    // Create indexes
    console.log('Creating indexes...')
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_country ON "Stamp"("countryCode")`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_year ON "Stamp"(year)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_theme ON "Stamp"("theme")`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_rarity ON "Stamp"("rarityScore" DESC)`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_price ON "Stamp"("marketPriceUsd")`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_wns ON "Stamp"("wnsNumber")`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stamps_search ON "Stamp" USING GIN(search_vector)`)
    console.log('✓ indexes created')

    // Enable RLS on collections
    console.log('Enabling RLS on collections...')
    await client.query(`ALTER TABLE "Collection" ENABLE ROW LEVEL SECURITY`)

    // Create RLS policy (drop first if exists)
    await client.query(`DROP POLICY IF EXISTS "users_own_collections" ON "Collection"`)
    await client.query(`
      CREATE POLICY "users_own_collections" ON "Collection"
        FOR ALL USING (auth.uid() = "userId");
    `)
    console.log('✓ RLS enabled on collections')

    console.log('\n✅ Database setup completed successfully!')

  } catch (e) {
    console.error('Error:', e.message)
    console.error('Stack:', e.stack)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
