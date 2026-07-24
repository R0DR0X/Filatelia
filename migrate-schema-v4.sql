-- Migration Schema v4: Extended AI Enrichment Fields & Stamp Market Prices Table
-- Target: Cloudflare D1 / SQLite & Postgres Compatibility
-- Date: 2026-07-23

-- ============================================
-- 1. ADD EXTENDED AI ENRICHMENT FIELDS TO STAMP TABLE
-- ============================================

ALTER TABLE "Stamp" ADD COLUMN "description_es" TEXT;
ALTER TABLE "Stamp" ADD COLUMN "description_en" TEXT;

-- Add themes / categories tag storage
ALTER TABLE "Stamp" ADD COLUMN "themes" TEXT;

-- Valuation and Market Pricing
ALTER TABLE "Stamp" ADD COLUMN "rarity_score" REAL;
ALTER TABLE "Stamp" ADD COLUMN "market_price_usd" REAL;
ALTER TABLE "Stamp" ADD COLUMN "market_price_eur" REAL;
ALTER TABLE "Stamp" ADD COLUMN "last_enriched_at" DATETIME;

-- Ensure camelCase aliases for backward compatibility with existing JS models
ALTER TABLE "Stamp" ADD COLUMN "marketPriceEur" REAL;
ALTER TABLE "Stamp" ADD COLUMN "lastEnrichedAt" DATETIME;

-- ============================================
-- 2. CREATE STAMP_MARKET_PRICES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS "stamp_market_prices" (
  "id" TEXT PRIMARY KEY,
  "stamp_id" TEXT NOT NULL,
  "source" TEXT NOT NULL, -- 'ebay', 'colnect', etc.
  "listing_url" TEXT,
  "title" TEXT,
  "price_raw" TEXT,
  "price_usd" REAL,
  "price_eur" REAL,
  "currency" TEXT,
  "seller" TEXT,
  "condition_note" TEXT,
  "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("stamp_id") REFERENCES "Stamp"("id") ON DELETE CASCADE
);

-- Indices for price history queries
CREATE INDEX IF NOT EXISTS "idx_stamp_market_prices_stamp" ON "stamp_market_prices"("stamp_id");
CREATE INDEX IF NOT EXISTS "idx_stamp_market_prices_source" ON "stamp_market_prices"("source");
CREATE INDEX IF NOT EXISTS "idx_stamp_market_prices_created" ON "stamp_market_prices"("created_at");

-- Complete message indicator
SELECT 'Migration v4 completed successfully!' AS status;
