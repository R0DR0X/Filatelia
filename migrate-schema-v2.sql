-- Migration: Update schema for global stamps database
-- Generated: 2026-05-03
-- Fixed: Use TEXT for IDs (Prisma convention) and handle existing schema

-- ============================================
-- 1. UPDATE COUNTRY TABLE
-- ============================================

ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "code" VARCHAR(2);
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "nameEn" VARCHAR(100);
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "continent" VARCHAR(50);
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "totalStamps" INT DEFAULT 0;
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "stampsFromYear" INT;
ALTER TABLE "Country" ADD COLUMN IF NOT EXISTS "stampsToYear" INT;

UPDATE "Country" SET "code" = 'PE' WHERE name = 'Perú' AND "code" IS NULL;
UPDATE "Country" SET "code" = 'BR' WHERE name = 'Brasil' AND "code" IS NULL;
UPDATE "Country" SET "code" = 'IL' WHERE name = 'Israel' AND "code" IS NULL;
UPDATE "Country" SET "code" = 'CL' WHERE name = 'Chile' AND "code" IS NULL;

-- ============================================
-- 2. UPDATE STAMP TABLE
-- ============================================

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "wnsNumber" VARCHAR(30) UNIQUE;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "scottNumber" VARCHAR(30);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "michelNumber" VARCHAR(30);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "yvertNumber" VARCHAR(30);

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "countryCode" CHAR(2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "year" INT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "denomination" DECIMAL(12,4);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(10);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "faceValueUsd" DECIMAL(10,4);

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "descriptionEs" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "theme" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "subtheme" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "tags" TEXT[];

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "color" TEXT[];
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "perforation" VARCHAR(50);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "watermark" VARCHAR(100);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "printTechnique" VARCHAR(100);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "paperType" VARCHAR(100);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "sizeMm" VARCHAR(30);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "shape" VARCHAR(50) DEFAULT 'rectangular';

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "printRun" BIGINT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "printer" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "designer" VARCHAR(200);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "engraver" VARCHAR(200);

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "rarityScore" DECIMAL(3,1) CHECK ("rarityScore" BETWEEN 1 AND 10);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "conditionMintUsd" DECIMAL(10,2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "conditionUsedUsd" DECIMAL(10,2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "marketPriceUsd" DECIMAL(10,2);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "marketPriceUpdatedAt" TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "imageThumbUrl" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "imageBackUrl" TEXT;

ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "source" VARCHAR(50);
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN DEFAULT false;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "isErrorStamp" BOOLEAN DEFAULT false;
ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "isRare" BOOLEAN DEFAULT false;

-- ============================================
-- 3. CREATE/UPDATE PRICE_HISTORY TABLE
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
-- 4. CREATE SCRAPE_JOB TABLE
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
-- 5. CREATE/UPDATE COLLECTION TABLE
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_unique ON "Collection"("userId", "stampId");
CREATE INDEX IF NOT EXISTS idx_collection_user ON "Collection"("userId");
CREATE INDEX IF NOT EXISTS idx_collection_stamp ON "Collection"("stampId");

-- ============================================
-- 6. CREATE INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_stamps_country ON "Stamp"("countryCode");
CREATE INDEX IF NOT EXISTS idx_stamps_year ON "Stamp"(year);
CREATE INDEX IF NOT EXISTS idx_stamps_theme ON "Stamp"("theme");
CREATE INDEX IF NOT EXISTS idx_stamps_rarity ON "Stamp"("rarityScore" DESC);
CREATE INDEX IF NOT EXISTS idx_stamps_price ON "Stamp"("marketPriceUsd");
CREATE INDEX IF NOT EXISTS idx_stamps_wns ON "Stamp"("wnsNumber");

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_stamps_search ON "Stamp" USING GIN(search_vector);

-- Trigram index for fuzzy name search
CREATE INDEX IF NOT EXISTS idx_stamps_trgm_name ON "Stamp" USING GIN("nameEs" gin_trgm_ops);

-- Vector index for embedding similarity search
CREATE INDEX IF NOT EXISTS idx_stamps_embedding ON "Stamp" USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- 7. ENABLE RLS ON COLLECTION
-- ============================================

ALTER TABLE "Collection" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_collections" ON "Collection";
CREATE POLICY "users_own_collections" ON "Collection"
  FOR ALL USING (auth.uid() = "userId");

-- ============================================
-- 8. UPDATE EXISTING DATA
-- ============================================

UPDATE "Stamp" SET "countryCode" = 'BR' WHERE "countryId" = (SELECT id FROM "Country" WHERE name = 'Brasil' LIMIT 1) AND "countryCode" IS NULL;
UPDATE "Stamp" SET "countryCode" = 'PE' WHERE "countryId" = (SELECT id FROM "Country" WHERE name = 'Perú' LIMIT 1) AND "countryCode" IS NULL;

-- ============================================
-- COMPLETE
-- ============================================

SELECT 'Migration completed successfully!' as status;
