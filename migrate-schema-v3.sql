-- Migration: Sync schema with user requirements
-- Generated: 2026-05-03

-- ============================================
-- 1. RENAME EXISTING COLUMNS to match new schema
-- ============================================

-- Rename titleEs -> nameEs, titleEn -> nameEn
ALTER TABLE "Stamp" RENAME COLUMN "titleEs" TO "nameEs";
ALTER TABLE "Stamp" RENAME COLUMN "titleEn" TO "nameEn";

-- Rename description -> descriptionEs
ALTER TABLE "Stamp" RENAME COLUMN "description" TO "descriptionEs";

-- Rename faceValue -> denomination
ALTER TABLE "Stamp" RENAME COLUMN "faceValue" TO "denomination";

-- Rename printing -> printTechnique
ALTER TABLE "Stamp" RENAME COLUMN "printing" TO "printTechnique";

-- Rename quantity -> printRun
ALTER TABLE "Stamp" RENAME COLUMN "quantity" TO "printRun";

-- ============================================
-- 2. ADD NEW COLUMNS to Stamp table
-- ============================================

-- Catalog numbers (direct columns for quick access)
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "wnsNumber" VARCHAR(30) UNIQUE;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "scottNumber" VARCHAR(30);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "michelNumber" VARCHAR(30);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "yvertNumber" VARCHAR(30);

-- Basic data
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "countryCode" CHAR(2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "year" INT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(10);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "faceValueUsd" DECIMAL(10,4);

-- Description and classification (descriptionEs already renamed)
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "theme" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "subtheme" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "tags" TEXT[];

-- Technical characteristics (color, perforation, watermark already exist)
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "paperType" VARCHAR(100);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "sizeMm" VARCHAR(30);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "shape" VARCHAR(50) DEFAULT 'rectangular';

-- Production (printRun, printTechnique already renamed)
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "printer" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "designer" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "engraver" VARCHAR(200);

-- Valuation
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "rarityScore" DECIMAL(3,1) CHECK ("rarityScore" BETWEEN 1 AND 10);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "conditionMintUsd" DECIMAL(10,2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "conditionUsedUsd" DECIMAL(10,2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "marketPriceUsd" DECIMAL(10,2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "marketPriceUpdatedAt" TIMESTAMP WITHOUT TIME ZONE;

-- Images
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "imageThumbUrl" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "imageBackUrl" TEXT;

-- Metadata (search_vector and embedding already exist from setup-db.mjs)
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN DEFAULT false;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "isErrorStamp" BOOLEAN DEFAULT false;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "isRare" BOOLEAN DEFAULT false;

-- ============================================
-- 3. UPDATE COUNTRY TABLE
-- ============================================

ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "code" VARCHAR(2);
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "nameEn" VARCHAR(100);
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "continent" VARCHAR(50);
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "totalStamps" INT DEFAULT 0;
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "stampsFromYear" INT;
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "stampsToYear" INT;

-- Update existing countries with ISO codes
UPDATE "Country" SET "code" = 'PE' WHERE name = 'Perú' AND "code" IS NULL;
UPDATE "Country" SET "code" = 'BR' WHERE name = 'Brasil' AND "code" IS NULL;
UPDATE "Country" SET "code" = 'IL' WHERE name = 'Israel' AND "code" IS NULL;
UPDATE "Country" SET "code" = 'CL' WHERE name = 'Chile' AND "code" IS NULL;

-- ============================================
-- 4. CREATE PRICE_HISTORY TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "PriceHistory" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
  "stampId" TEXT,
  "priceUsd" DECIMAL(10,2),
  condition VARCHAR(20),
  platform VARCHAR(50),
  "saleDate" DATE,
  "listingUrl" TEXT,
  "createdAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Add foreign key if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'PriceHistory_stampId_fkey'
  ) THEN
    ALTER TABLE "PriceHistory"
    ADD CONSTRAINT "PriceHistory_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "Stamp"(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_history_stamp ON "PriceHistory"("stampId");

-- ============================================
-- 5. CREATE SCRAPE_JOB TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "ScrapeJob" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
  source VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  "totalFound" INT DEFAULT 0,
  "totalSaved" INT DEFAULT 0,
  "totalErrors" INT DEFAULT 0,
  "startedAt" TIMESTAMP WITHOUT TIME ZONE,
  "finishedAt" TIMESTAMP WITHOUT TIME ZONE,
  "errorLog" TEXT,
  "createdAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. CREATE/UPDATE COLLECTION TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "Collection" (
  id TEXT PRIMARY KEY DEFAULT uuid_generate_v4(),
  "userId" TEXT,
  "stampId" TEXT,
  condition VARCHAR(20),
  "purchasePrice" DECIMAL(10,2),
  notes TEXT,
  "acquiredAt" DATE,
  "createdAt" TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Add foreign keys if not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Collection_userId_fkey'
  ) THEN
    ALTER TABLE "Collection"
    ADD CONSTRAINT "Collection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Collection_stampId_fkey'
  ) THEN
    ALTER TABLE "Collection"
    ADD CONSTRAINT "Collection_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "Stamp"(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Collection_userId_stampId_unique'
  ) THEN
    ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_stampId_unique" UNIQUE ("userId", "stampId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_collection_user ON "Collection"("userId");
CREATE INDEX IF NOT EXISTS idx_collection_stamp ON "Collection"("stampId");

-- ============================================
-- 7. CREATE PERFORMANCE INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_stamps_country ON "Stamp"("countryCode");
CREATE INDEX IF NOT EXISTS idx_stamps_year ON "Stamp"(year);
CREATE INDEX IF NOT EXISTS idx_stamps_theme ON "Stamp"("theme");
CREATE INDEX IF NOT EXISTS idx_stamps_rarity ON "Stamp"("rarityScore" DESC);
CREATE INDEX IF NOT EXISTS idx_stamps_price ON "Stamp"("marketPriceUsd");
CREATE INDEX IF NOT EXISTS idx_stamps_wns ON "Stamp"("wnsNumber");

-- GIN indexes (may already exist)
CREATE INDEX IF NOT EXISTS idx_stamps_search ON "Stamp" USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_stamps_trgm_name ON "Stamp" USING GIN("nameEs" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stamps_embedding ON "Stamp" USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- 8. ENABLE RLS ON COLLECTION
-- ============================================

ALTER TABLE "Collection" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_collections" ON "Collection";
CREATE POLICY "users_own_collections" ON "Collection"
  FOR ALL USING (auth.uid()::text = "userId");

-- ============================================
-- 9. UPDATE EXISTING DATA
-- ============================================

-- Link existing stamps to countries by code
UPDATE "Stamp" SET "countryCode" = 'BR' WHERE "countryId" = (SELECT id FROM "Country" WHERE name = 'Brasil' LIMIT 1) AND "countryCode" IS NULL;
UPDATE "Stamp" SET "countryCode" = 'PE' WHERE "countryId" = (SELECT id FROM "Country" WHERE name = 'Perú' LIMIT 1) AND "countryCode" IS NULL;

-- ============================================
-- COMPLETE
-- ============================================

SELECT 'Migration v3 completed successfully!' as status;
