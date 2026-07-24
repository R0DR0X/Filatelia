
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Add comments for documentation
COMMENT ON EXTENSION "uuid-ossp" IS 'Generate universally unique identifiers (UUIDs)';
COMMENT ON EXTENSION "pg_trgm" IS 'Text similarity measurement and indexing';
COMMENT ON EXTENSION "unaccent" IS 'Remove accents for text search';
COMMENT ON EXTENSION "vector" IS 'Vector similarity search for embeddings';

-- Create function to update search vector (for full-text search)
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

-- Note: The search_vector column and trigger will be added after Prisma push
-- because Prisma doesn't support tsvector directly

-- Create indexes for performance (will be created after columns exist)
-- These are commented out because the columns need to exist first
-- CREATE INDEX IF NOT EXISTS idx_stamps_country ON "Stamp"("countryCode");
-- CREATE INDEX IF NOT EXISTS idx_stamps_year ON "Stamp"(year);
-- CREATE INDEX IF NOT EXISTS idx_stamps_theme ON "Stamp"("theme");
-- CREATE INDEX IF NOT EXISTS idx_stamps_rarity ON "Stamp"("rarityScore" DESC);
-- CREATE INDEX IF NOT EXISTS idx_stamps_price ON "Stamp"("marketPriceUsd");
-- CREATE INDEX IF NOT EXISTS idx_stamps_wns ON "Stamp"("wnsNumber");

-- Grant permissions (adjust as needed)
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;
