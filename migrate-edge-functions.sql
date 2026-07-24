-- Migration: Edge Functions support (identify-stamp, search-semantic, price-alert)
-- Run with: psql or via Supabase SQL editor

-- ============================================
-- 1. Ensure embedding column exists on Stamp table
-- ============================================

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

-- Create ivfflat index for vector similarity search (if not exists)
CREATE INDEX IF NOT EXISTS idx_stamps_embedding
  ON "Stamp"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Create GIN index for full-text search (if not exists)
CREATE INDEX IF NOT EXISTS idx_stamps_searchvector
  ON "Stamp"
  USING GIN ("searchVector");

-- ============================================
-- 2. Update searchVector with trigger
-- ============================================

-- Function to update searchVector
CREATE OR REPLACE FUNCTION stamp_search_vector_trigger()
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
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then recreate
DROP TRIGGER IF EXISTS tsvectorupdate ON "Stamp";

CREATE TRIGGER tsvectorupdate
  BEFORE INSERT OR UPDATE ON "Stamp"
  FOR EACH ROW
  EXECUTE FUNCTION stamp_search_vector_trigger();

-- ============================================
-- 3. Function: match_stamps_by_embedding
-- ============================================

CREATE OR REPLACE FUNCTION match_stamps_by_embedding(
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
$$;

-- ============================================
-- 4. Ensure PriceAlert table exists
-- ============================================

CREATE TABLE IF NOT EXISTS "PriceAlert" (
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
);

CREATE INDEX IF NOT EXISTS idx_price_alert_user ON "PriceAlert"("userId");
CREATE INDEX IF NOT EXISTS idx_price_alert_stamp ON "PriceAlert"("stampId");
CREATE INDEX IF NOT EXISTS idx_price_alert_active ON "PriceAlert"("isActive", "isNotified");

-- Enable RLS on PriceAlert
ALTER TABLE "PriceAlert" ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "users_own_alerts" ON "PriceAlert";

-- Policy: users can only access their own alerts
CREATE POLICY "users_own_alerts" ON "PriceAlert"
  FOR ALL
  USING (auth.uid()::text = "userId"::text)
  WITH CHECK (auth.uid()::text = "userId"::text);

-- ============================================
-- 5. Update existing stamps' searchVector
-- ============================================

UPDATE "Stamp"
SET "searchVector" =
  setweight(to_tsvector('spanish', COALESCE("nameEs", '')), 'A') ||
  setweight(to_tsvector('english', COALESCE("nameEn", '')), 'A') ||
  setweight(to_tsvector('spanish', COALESCE("descriptionEs", '')), 'B') ||
  setweight(to_tsvector('english', COALESCE("descriptionEn", '')), 'B') ||
  setweight(to_tsvector('spanish', COALESCE("theme", '')), 'C') ||
  setweight(to_tsvector('spanish', COALESCE(array_to_string("tags", ' '), '')), 'C') ||
  setweight(to_tsvector('spanish', COALESCE(array_to_string("color", ' '), '')), 'D')
WHERE "searchVector" IS NULL;

-- ============================================
-- Done!
-- ============================================
-- Verify:
-- SELECT COUNT(*) FROM "Stamp" WHERE embedding IS NOT NULL;
-- SELECT COUNT(*) FROM "PriceAlert";
-- SELECT * FROM match_stamps_by_embedding(ARRAY_FILL(0, ARRAY[1536])::vector, 5);
