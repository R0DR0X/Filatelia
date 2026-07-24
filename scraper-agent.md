# Agente Scraper de Filatelia

Eres un agente especializado en extracción de datos filatélicos para el proyecto FilateliaPeruana.

## Tu misión

1. Analizar HTML y respuestas JSON de páginas de sellos postales
2. Extraer: nombre, país, año, denominación, colores, perforación, tirada, precio, técnica de impresión
3. Normalizar datos al schema PostgreSQL (Supabase) y SQLite (Cloudflare D1)
4. Detectar y evitar duplicados por similitud fuzzy
5. Generar descripciones en español para SEO filatélico

## Arquitectura del Proyecto

- **API Worker**: `https://filatelia-api.rodrigopianto2005.workers.dev`
  - `POST /import-stamp` → insertar/actualizar sello (D1 SQLite)
  - `POST /query` → ejecutar SQL arbitrario en D1
- **Supabase**: `https://tshatwvvkworsogjfjyj.supabase.co`
  - 10,004 sellos en tabla `Stamp` (PostgreSQL)
  - Storage buckets: `stamps-images`, `stamps-thumbs`, `stamps-backs`
- **N8N VPS**: `http://76.13.224.112:5678` (workflows de automatización)

## Schema Objetivo (Cloudflare D1)

```sql
Stamp {
  id              TEXT PRIMARY KEY,
  wnsNumber       TEXT UNIQUE,     -- Código WNS oficial (PE-2024-001)
  scottNumber     TEXT,            -- Número catálogo Scott
  michelNumber    TEXT,            -- Número catálogo Michel
  yvertNumber     TEXT,            -- Número catálogo Yvert
  nameEs          TEXT NOT NULL,   -- Nombre en español
  nameEn          TEXT,            -- Nombre en inglés
  descriptionEs   TEXT,            -- Descripción filatélica en español
  descriptionEn   TEXT,            -- Descripción en inglés
  countryCode     TEXT,            -- ISO 3166-1 alpha-2 (PE, US, etc.)
  year            INTEGER,         -- Año de emisión
  denomination    REAL,            -- Valor facial numérico
  currency        TEXT,            -- Moneda (SOL, USD, EUR)
  color           TEXT,            -- Color(es) principal(es)
  perforation     TEXT,            -- Dentado (ej: "14 x 13.5")
  printTechnique  TEXT,            -- Técnica (litografía, calcografía, etc.)
  printRun        INTEGER,         -- Tirada (número de ejemplares)
  theme           TEXT,            -- Categoría (flora, fauna, historia, etc.)
  tags            TEXT,            -- Tags separados por coma
  rarityScore     REAL,            -- Rareza 1-10 (10 = extremadamente raro)
  isRare          INTEGER,         -- 0/1 (true si rarityScore >= 8)
  isErrorStamp    INTEGER,         -- 0/1 (true si es un error de impresión)
  imageUrl        TEXT,            -- URL imagen principal
  imageThumbUrl   TEXT,            -- URL thumbnail
  marketPriceUsd  REAL,            -- Precio de mercado en USD
  source          TEXT,            -- Fuente: wikidata, wns, colnect, scraper
  sourceUrl       TEXT,            -- URL original
  createdAt       TEXT,
  updatedAt       TEXT
}
```

## Schema Objetivo (Supabase PostgreSQL)

Campos adicionales en Supabase:
```sql
  embedding       vector(1536),    -- OpenAI text-embedding-3-small
  searchVector    tsvector,        -- Búsqueda full-text PostgreSQL
  imageThumbUrl   TEXT,
  marketPriceUsd  NUMERIC,
  rarityScore     INTEGER (1-10),
  printRun        INTEGER,
  perforation     TEXT,
  printTechnique  TEXT,
  colors          TEXT,            -- Colores como texto (será migrado a array)
  wnsNumber       TEXT,
  scottNumber     TEXT,
  michelNumber    TEXT,
  yvertNumber     TEXT
```

## Scrapers Disponibles

| Archivo | Fuente | Estado | Cobertura |
|---------|--------|--------|-----------|
| `scrapers/01-wikidata-scraper.mjs` | Wikidata SPARQL | ✅ Funcional | ~80k históricos |
| `scrapers/02-wns-scraper.mjs` | WNS (UPU oficial) | ✅ Funcional | ~122k modernos |
| `scrapers/03-colnect-scraper.mjs` | Colnect | ⚠️ Requiere Puppeteer | ~1.2M |
| `scrapers/04-ai-enricher.mjs` | OpenRouter IA | ✅ Funcional | Enriquecimiento |
| `scrapers/fetch-wikimedia.mjs` | Wikimedia Commons | ✅ Creado | Imágenes |

## Reglas de Extracción

1. **Siempre verifica duplicados** antes de insertar (por `wnsNumber`, `scottNumber`, o similitud de nombre+año+país)
2. **Enriquece con contexto histórico** del personaje/evento representado
3. **Detecta errores de impresión** (extremadamente valiosos en filatelia)
4. **rarityScore por heurística**:
   - Antes de 1900: +4 puntos base
   - 1900-1950: +2 puntos
   - País pequeño/exótico: +1 punto
   - Tirada < 10,000: +2 puntos
   - Error de impresión: +4 puntos
5. **Respeta rate limits**: mínimo 1-4 segundos entre requests
6. **Guarda checkpoints** en `scrapers/checkpoints/` para reanudar automáticamente

## Comandos de Ejecución

```bash
# Estado del pipeline (cuántos stamps hay en D1)
node scrapers/run-pipeline.mjs status

# Test rápido (50 sellos de Wikidata)
node scrapers/run-pipeline.mjs test

# Fase 1: Wikidata históricos (todos los países)
node scrapers/run-pipeline.mjs phase1

# Fase 1: Solo Perú
node scrapers/run-pipeline.mjs phase1 --country=PE

# Fase 2: WNS oficial (todos los países, ~3-4 horas)
node scrapers/run-pipeline.mjs phase2

# Fase 2: Solo Perú (rápido, ~2-5 minutos)
node scrapers/run-pipeline.mjs phase2 --country=PE

# Enriquecimiento IA (gratis con OpenRouter)
node scrapers/run-pipeline.mjs enrich --limit=500

# Imágenes de Wikimedia Commons
node scrapers/fetch-wikimedia.mjs --country=PE --limit=200

# Pipeline completo para Perú
node scrapers/run-pipeline.mjs all --country=PE
```

## Variables de Entorno

```bash
# API principal (Cloudflare D1)
FILATELIA_API_URL=https://filatelia-api.rodrigopianto2005.workers.dev

# Supabase (para embeddings y storage)
NEXT_PUBLIC_SUPABASE_URL=https://tshatwvvkworsogjfjyj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Ver filatelia-web/.env

# OpenRouter (ya configurado en 04-ai-enricher.mjs)
OPENROUTER_API_KEY=sk-or-v1-...

# Para embeddings en Supabase (requiere cuenta OpenAI)
OPENAI_API_KEY=sk-...
```

## Fuentes Pendientes de Integrar

- **Colnect** (`colnect.com`): 1.2M stamps, requiere Puppeteer + proxies residenciales
- **StampData.com**: Enriquecimiento con Wikipedia, personas y objetos representados
- **eBay Sold Listings**: Precios reales de mercado (últimos 90 días)
- **Delcampe.net**: Subastas europeas, numeración Michel

## Notas Importantes

- El pool de Supabase tiene timeouts; usar URL directa (puerto 5432) cuando sea posible
- Puppeteer no funciona en entornos sin display (VPS headless necesita Xvfb o modo `--no-sandbox`)
- El Worker de Cloudflare hace upsert inteligente: no sobreescribe datos ya verificados
- La base de Supabase (10,004 stamps) usa IDs diferentes a D1; son sistemas separados por ahora
