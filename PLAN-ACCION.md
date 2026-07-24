# PLAN DE ACCION — FILATELIA
**Fecha**: 2026-05-04
**Estado general**: ~90% estructura completada, falta contenido e integración

---

## ✅ YA COMPLETADO (No tocar)

### Base de Datos (Supabase)
- ✅ Proyecto `tshatwvvkworsogjfjyj` (filatelia) verificado
- ✅ 10,004 sellos cargados en tabla `Stamp`
- ✅ 51 países en tabla `Country`
- ✅ Tablas: `PriceHistory`, `ScrapeJob`, `Collection`, `PriceAlert`
- ✅ Funciones BD: `match_stamps_by_embedding`, `stamp_search_vector_trigger`
- ✅ Índices: GIN, trgm, ivfflat
- ✅ 3 Storage buckets: `stamps-images`, `stamps-thumbs`, `stamps-backs`

### Edge Functions (Desplegadas)
- ✅ `identify-stamp` → Claude Vision + embeddings
- ✅ `search-semantic` → Búsqueda semántica pgvector
- ✅ `price-alert` → CRUD alertas de precio

### N8N (VPS)
- ✅ URL: http://76.13.224.112:5678
- ✅ 4 workflows importados al VPS:
  - `00 - Orquestador Principal (cada 6h)` (ID: 8412ueHQ5aJhU78R)
  - `01 - Enriquecedor Nocturno (2:00 AM)` (ID: 5vJYJ9k9uHZmP5zO)
  - `02 - Detector de Duplicados (Domingo 3:00 AM)` (ID: Ow0qIUouo3j6DhpI)
  - `03 - Monitor de Precios Raros (cada hora)` (ID: Xwozgbu8nhUD749a)

### Web (Next.js)
- ✅ Build pasado (Next.js 16.2.4)
- ✅ Páginas: `/`, `/catalogo`, `/tienda`, `/colecciones`, `/subastas`, `/login`, `/admin`
- ✅ Páginas creadas: `/sello/[id]`, `/identificar`, `/paises/[codigo]`, `/estadisticas`

---

## ❌ PENDIENTE POR FASES

---

## 🗂️ FASE 1 — Fuentes Abiertas (Completar)

### 1.1 Wikimedia Commons (Imágenes)
**Estado**: ❌ 0% imágenes cargadas
**Prioridad**: 🔴 Crítica

**Acciones**:
1. Crear script `fetch-wikimedia.mjs`:
   - Conectar a Wikimedia API REST: `https://commons.wikimedia.org/w/api.php`
   - Buscar imágenes por país: `action=query&list=search&srsearch=postage stamp [COUNTRY]`
   - Extraer URLs de imágenes en alta resolución
   - Descargar y subir a Supabase Storage (`stamps-images`)
   - Generar thumbnails y subir a `stamps-thumbs`
   - Actualizar campo `imageUrl` en tabla `Stamp`

2. Ejecutar en batches de 50 sellos
3. Validar formatos: jpg, png, webp

**Script ya preparado**: `generate-embeddings.mjs` (usar estructura similar)

---

### 1.2 Wikidata SPARQL (Mejorar)
**Estado**: ⚠️ Scraper creado pero falla (0 resultados)
**Prioridad**: 🟡 Media

**Acciones**:
1. Corregir query SPARQL:
   ```sparql
   SELECT ?stamp ?stampLabel ?year ?country ?countryLabel ?description WHERE {
     ?stamp wdt:P31 wd:Q644371.  # instances of postage stamp
     ?stamp wdt:P495 ?country.  # country of origin
     ?stamp wdt:P577 ?year.      # publication date
     SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
   }
   ```
2. Mapear resultados al schema de `Stamp`
3. Hacer upsert (no duplicar)

---

### 1.3 StampData.com (Integrar)
**Estado**: ❌ No integrado
**Prioridad**: 🟢 Baja

**Acciones**:
1. Scrapear catálogo experimental de StampData.com
2. Extraer links a Wikipedia, personas y cosas representadas
3. Enriquecer tabla `Stamp` con `wikipediaUrl`, `personRepresented`, `thingRepresented`

---

## 🤖 FASE 2 — Los Bots N8N (Completar)

### 2.1 Bot 1: Harvester Libre (WNS + Wikimedia) ✅
**Estado**: ✅ Importado al VPS
**Pendiente**: Configurar credenciales en http://76.13.224.112:5678:
- Supabase Postgres (ya tienes los datos)
- Wikimedia API (gratis, sin key)
- Claude API (para análisis de imágenes)

---

### 2.2 Bot 2: Stealth Scraper (NUEVO)
**Estado**: ❌ No creado
**Prioridad**: 🟡 Media

**Acciones**:
1. Crear N8N workflow `05-stealth-scraper.json`:
   - **Trigger**: Schedule (cada 12h)
   - **Rotate User-Agent**: Lista de 50 UAs reales
   - **Proxy**: Bright Data / Oxylabs (IPs residenciales)
   - **Puppeteer node**: Renderizar JS
   - **Delay random**: 8-25 seg entre requests
   - **Respetar robots.txt**: Horarios configurables
   - **Claude Code**: Analizar HTML extraído
2. Sitios objetivo:
   - eBay (precios históricos)
   - Delcampe (subastas Europa)
   - Colnect (catálogo comunitario)
3. Importar al VPS via API

---

### 2.3 Bot 3: Precio en Vivo (eBay API) ✅
**Estado**: ✅ Importado al VPS (`03 - Monitor de Precios Raros`)
**Pendiente**:
1. Obtener eBay Affiliates API key (gratis con cuenta)
2. Configurar en workflow: buscar por `nombre + número catálogo`
3. Extraer precio promedio vendido (últimos 90 días)
4. Guardar en `PriceHistory`

---

### 2.4 Bot 4: Enriquecedor IA ✅
**Estado**: ✅ Importado al VPS (`01 - Enriquecedor Nocturno`)
**Pendiente**:
1. Configurar Anthropic API key
2. Batch nocturno: tomar sellos sin `descriptionEs`
3. Claude Vision: describir para catálogo filatélico
4. Identificar: país, año, tema, personaje, técnica
5. Clasificar rareza del 1 al 10
6. Generar embedding vectorial
7. Actualizar PostgreSQL

---

## 🧠 FASE 3 — Claude Code como Cerebro

### 3.1 Crear `scraper-agent.md`
**Estado**: ❌ No existe
**Prioridad**: 🟡 Media

**Acciones**:
1. Crear archivo `G:\rodri\filatelia\scraper-agent.md`:
   ```markdown
   # Agente Scraper de Filatelia
   
   Eres un agente especializado en extracción de datos filatélicos.
   
   ## Tu misión:
   1. Analizar HTML de páginas de sellos
   2. Extraer: nombre, país, año, denominación, color, perforación, tirada, precio
   3. Normalizar datos al schema PostgreSQL
   4. Detectar duplicados por similitud fuzzy
   5. Generar descripciones en español para SEO
   
   ## Schema objetivo:
   - stamps: id, wns_number, scott_number, country, year, denomination,
             theme, color, perforation, print_run, condition, description_es,
             rarity_score, image_url, market_price, source_url
   
   ## Reglas:
   - Siempre verifica duplicados antes de insertar
   - Enriquece con contexto histórico del personaje/evento representado
   - Detecta si es error de impresión (muy valioso)
   ```
2. Usar este archivo como contexto para futuras tareas de scraping

---

## 🗃️ FASE 4 — Base de Datos Bestial

### 4.1 Generar Embeddings (10,004 sellos)
**Estado**: ❌ 0% (0 de 10,004)
**Prioridad**: 🔴 Crítica

**Acciones**:
1. Obtener OpenAI API key
2. Ejecutar script `generate-embeddings.mjs`:
   ```powershell
   cd G:\rodri\filatelia
   $env:OPENAI_API_KEY="sk-..."
   node generate-embeddings.mjs
   ```
3. Procesa en batches de 50, delay 1s (respetar rate limits)
4. Verificar: `SELECT COUNT(*) FROM "Stamp" WHERE embedding IS NOT NULL`

---

### 4.2 Alinear Schema FASE 4
**Estado**: ⚠️ Parcial (ya tienes `Stamp` con 30+ columnas)
**Prioridad**: 🟢 Baja

**Diferencias**:
| Campo FASE 4 | Campo Actual | Acción |
|--------------|-------------|--------|
| `wns_number` | `wnsNumber` | ✅ Igual (camelCase vs snake_case) |
| `scott_number` | `scottNumber` | ✅ Igual |
| `denomination` | `denomination` | ✅ Existe |
| `colors TEXT[]` | `colors` (texto) | ⚠️ Convertir a array |
| `perforation` | `perforation` | ✅ Existe |
| `print_run` | `printRun` | ✅ Existe |
| `rarity_score` | `rarityScore` | ✅ Existe |
| `embedding vector(1536)` | `embedding` | ⚠️ Verificar dimensión |

**Acción**: Solo verificar que los tipos coincidan, no es urgente.

---

### 4.3 Cargar Imágenes de Sellos
**Estado**: ❌ 0% (`imageUrl` vacío en 10,004 sellos)
**Prioridad**: 🔴 Crítica

**Acciones**:
1. Ejecutar script de Wikimedia (FASE 1.1)
2. Subir imágenes a Supabase Storage:
   - `stamps-images` (originales, hasta 10MB)
   - `stamps-thumbs` (thumbnails, hasta 5MB)
3. Actualizar `Stamp.imageUrl` y `Stamp.imageThumbUrl`
4. Verificar: `SELECT COUNT(*) FROM "Stamp" WHERE "imageUrl" IS NOT NULL`

---

## 📋 ORDEN DE EJECUCION RECOMENDADO

### 🔴 Crítico (Hacer ya)
1. **Configurar N8N VPS** → http://76.13.224.112:5678
   - Agregar credenciales: Supabase Postgres, Anthropic API, OpenAI API, eBay API
   - Activar workflows (botón "Active")

2. **Generar Embeddings** → Requiere OpenAI API key
   ```powershell
   cd G:\rodri\filatelia
   $env:OPENAI_API_KEY="sk-..."
   node generate-embeddings.mjs
   ```

3. **Cargar Imágenes Wikimedia** → Crear script `fetch-wikimedia.mjs`
   - Usar Wikimedia API REST (gratis)
   - Subir a Supabase Storage
   - Actualizar `Stamp.imageUrl`

### 🟡 Medio Plazo
4. **Crear Bot 2 (Stealth Scraper)** → N8N workflow nuevo
   - Con proxies residenciales
   - Puppeteer para sitios con anti-scraping

5. **Crear `scraper-agent.md`** → Contexto para Claude Code
   - Agente especializado en extracción filatélica

6. **Mejorar Wikidata SPARQL** → Corregir queries
   - Obtener más metadatos: artistas, grabadores, tiradas

### 🟢 Baja Prioridad
7. **Integrar StampData.com** → Enriquecimiento adicional
8. **Mejorar diseño lujo editorial** → Paleta #0a0906, #C9A84C
9. **Integrar pasarela de pagos** → Stripe / PayPal / MercadoPago
10. **Scrapers avanzados** → Colnect, Delcampe, eBay histórico

---

## 🔑 CREDENCIALES REQUERIDAS

| Servicio | Dónde obtenerla | Para qué |
|----------|-------------------|---------|
| **OpenAI API** | https://platform.openai.com | Embeddings (búsqueda semántica) |
| **Anthropic API** | https://console.anthropic.com | Claude Vision (identificación) |
| **eBay API** | https://developer.ebay.com | Precios históricos |
| **N8N API Key** | http://76.13.224.112:5678/settings/api | Para importar workflows vía API |

---

## 📊 PROGRESO POR FASES (Actualizado)

| Fase | Nombre | Progreso | Estado |
|------|---------|-----------|--------|
| FASE 1 | Fuentes Abiertas | 70% | 🔄 En progreso |
| FASE 2 | Bots N8N | 80% | 🔄 En progreso |
| FASE 3 | Claude Code Cerebro | 0% | ❌ Pendiente |
| FASE 4 | Base de Datos | 90% | 🔄 En progreso |

**Progreso general estimado**: 85% (estructura lista, falta contenido)

---

## ⚡ COMANDOS ÚTILES PARA REANUDAR

```bash
# Verificar embeddings generados
cd filatelia-web && node check-db2.mjs

# Generar embeddings (requiere OPENAI_API_KEY)
cd G:\rodri\filatelia
$env:OPENAI_API_KEY="sk-..."
node generate-embeddings.mjs

# Iniciar Next.js dev server (si no está corriendo)
cd filatelia-web && npm run dev

# Acceder a N8N VPS
http://76.13.224.112:5678

# Verificar Edge Functions desplegadas
https://supabase.com/dashboard/project/tshatwvvkworsogjfjyj/functions

# Desplegar nueva Edge Function (si se crea una)
cd G:\rodri\filatelia
npx supabase functions deploy [nombre-funcion] --project-ref tshatwvvkworsogjfjyj
```

---

**Para reanudar**: Lee `PLAN-ACCION.md`, configura credenciales en N8N VPS, y ejecuta las tareas críticas (embeddings + imágenes).
