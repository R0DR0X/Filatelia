# FASE 0 — REPORTE DE RECONOCIMIENTO

**Fecha**: 2026-05-03
**Estado**: Proyecto en etapa temprana, enfoque inicial en Perú

---

## 1. ESTADO ACTUAL DEL PROYECTO

### 1.1 Base de Datos (Supabase PostgreSQL vía Prisma)

| Entidad | Registros | Estado |
|---------|-----------|--------|
| Stamps (Sellos) | **4** | Solo datos de prueba |
| Countries (Países) | **4** | Perú, Brasil, Israel, Chile |
| Catalogs (Catálogos) | **1** | "Colección Clásica de Sudamérica" |
| Products (Tienda) | **0** | Sin productos |
| Users (Usuarios) | **0** | Sin usuarios |

**Diagnóstico**: La base de datos está en estado inicial con datos de prueba. El esquema Prisma está diseñado para un enfoque de catálogo peruano/sudamericano, NO para la visión global de 122,000+ sellos solicitada.

### 1.2 Stack Tecnológico Actual

| Componente | Versión | Uso |
|------------|---------|-----|
| Next.js | 16.2.4 | Framework web (App Router) |
| React | 19.2.4 | UI library |
| Prisma | 7.8.0 | ORM (conectado a Supabase vía Pg adapter) |
| NextAuth | 4.24.14 | Autenticación |
| Tailwind CSS | 4 | Estilos |
| framer-motion | 12.38.0 | Animaciones |
| lucide-react | 1.11.0 | Iconos |
| @tanstack/react-query | 5.100.1 | Data fetching |
| zustand | 5.0.12 | State management |
| Cloudflare R2 | - | Storage (NO Supabase Storage) |

### 1.3 Estructura de Archivos

```
filatelia/
├── filatelia-web/           # App Next.js principal
│   ├── src/
│   │   ├── app/           # Páginas (Next.js App Router)
│   │   │   ├── (admin)/   # Admin dashboard, importar
│   │   │   ├── (public)/  # Catálogo, tienda, colecciones, subastas
│   │   │   ├── login/     # Login page
│   │   │   ├── page.tsx   # Landing page
│   │   │   └── layout.tsx
│   │   ├── components/     # Componentes UI
│   │   │   ├── catalog/   # StampCard, StampGroup
│   │   │   ├── CartDrawer, Navbar, etc.
│   │   ├── lib/           # Prisma client, S3 config
│   │   ├── services/      # catalogService, importService, storeService
│   │   └── store/         # Zustand stores
│   ├── prisma/
│   │   ├── schema.prisma  # Esquema actual (enfocado en Perú)
│   │   └── seed.ts
│   ├── public/            # Imágenes estáticas
│   ├── .env               # DATABASE_URL apunta a Supabase
│   └── package.json
├── 01_Informe_General_del_Proyecto.docx
├── 02_Estructura_de_Base_de_Datos.docx
├── 03_Reglas_del_Catalogo.docx
├── 04_Colores_y_Estilo_Visual.docx
├── 05_Textos_Oficiales_del_Home.docx
├── 06_Lista_de_Estados_de_Catalogo.docx
├── 07_Ejemplo_Excel_de_Carga.xlsx
└── (sin scrapers, sin workflows N8N)
```

### 1.4 LO QUE EXISTE vs LO QUE FALTA

| Requisito Usuario | Estado Actual | Dónde |
|------------------|---------------|--------|
| **122,000+ sellos** | ❌ Solo 4 | Necesita scrapers |
| **Schema global stamps** | ❌ Solo Perú/Sudamérica | Ampliar Prisma schema |
| **WNS Scraper** | ❌ No existe | Crear `scrapers/wns-scraper.js` |
| **Wikidata Scraper** | ❌ No existe | Crear `scrapers/wikidata-scraper.js` |
| **Wikimedia Images** | ❌ No existe | Crear `scrapers/wikimedia-image-scraper.js` |
| **eBay Prices** | ❌ No existe | Crear `scrapers/ebay-price-scraper.js` |
| **N8N Workflows (4)** | ❌ No existe | Instalar y configurar N8N |
| **Supabase Storage** | ❌ Usa Cloudflare R2 | Migrar a Supabase Storage |
| **Supabase Edge Functions** | ❌ No existe | Crear 3 funciones |
| **RLS Policies** | ❌ No existe | Configurar en Supabase |
| **Vector/ embeddings** | ❌ No existe | Agregar pgvector |
| **Búsqueda semántica** | ❌ No existe | Implementar con pgvector |
| **Web UI completa** | ⚠️ Básica | Expandir páginas |
| **Diseño lujo editorial** | ⚠️ Parcial | Mejorar según 04_Colores_y_Estilo_Visual.docx |
| **Identificación IA** | ❌ No existe | Claude Vision + `/identify-stamp` |

---

## 2. DECISIONES DE ARQUITECTURA

### 2.1 Base de Datos: Prisma + Supabase vs Supabase Directo

**Estado actual**: El proyecto usa Prisma como ORM conectado a Supabase vía `PrismaPg` adapter.

**Decisión**: Mantener Prisma como ORM principal (consistencia con código existente) pero:
- Agregar campos faltantes del schema solicitado (WNS number, embeddings, etc.)
- Configurar Supabase Storage (migrar de R2)
- Agregar pgvector extension para búsqueda semántica
- Configurar RLS policies via SQL directo

### 2.2 Storage: Migrar de Cloudflare R2 a Supabase Storage

**Razón**: El usuario solicitó específicamente Supabase Storage buckets (`stamps-images`, `stamps-thumbs`, `stamps-backs`).

**Plan**:
1. Crear buckets en Supabase Storage (públicos)
2. Migrar configuración de `src/lib/s3.ts` a Supabase Storage client
3. Actualizar servicios que suben imágenes

### 2.3 N8N: Instalación y Configuración

**Estado**: No hay N8N instalado.

**Plan**:
1. Instalar N8N local o usar N8N Cloud
2. Crear los 4 workflows solicitados
3. Configurar credenciales y webhooks

---

## 3. ROADMAP DETALLADO (FASES 1-5)

### FASE 1 — ACTUALIZAR BASE DE DATOS EN SUPABASE ✅→🔄

**1.1** Agregar extensiones (uuid-ossp, pg_trgm, unaccent, vector)
**1.2** Ampliar schema Prisma con campos faltantes:
- `wnsNumber`, `scottNumber`, `michelNumber`, `yvertNumber`
- `faceValueUsd`, `descriptionEs/En`, `theme`, `subtheme`, `tags`
- `color` (array), `perforation`, `watermark`, `printTechnique`
- `rarityScore`, `conditionMintUsd`, `conditionUsedUsd`
- `imageUrl`, `imageThumbUrl`, `imageBackUrl`
- `embedding` (vector), `searchVector` (tsvector)
- `source`, `sourceUrl`, `isVerified`, `isErrorStamp`, `isRare`

**1.3** Crear buckets en Supabase Storage:
- `stamps-images` (público)
- `stamps-thumbs` (público)
- `stamps-backs` (público)

**1.4** Configurar RLS policies para `collections`

**1.5** Crear tabla `price_history` para histórico de precios

**1.6** Crear tabla `scrape_jobs` para control de scrapers

### FASE 2 — SCRAPERS (orden de construcción)

**2.1** `scrapers/wns-scraper.js`
- Fuente: https://www.wnsstamps.post/en/Stamps-Search
- 122,000+ sellos globales
- Paginación por país y año (2002-hoy)
- Delay 3-5 segundos, reintentos con backoff

**2.2** `scrapers/wikidata-scraper.js`
- Wikidata SPARQL API
- Enriquecimiento de datos existentes
- Fuzzy matching para evitar duplicados

**2.3** `scrapers/wikimedia-image-scraper.js`
- Wikimedia Commons API
- Categorías: Postage stamps by country, Error stamps, Rare stamps
- Generar thumbnails con Sharp
- Matchear con sellos existentes

**2.4** `scrapers/ebay-price-scraper.js`
- eBay Browse API
- Precios reales de mercado
- Actualizar `market_price_usd` y `price_history`

### FASE 3 — WORKFLOWS N8N

**3.1** Instalar/configurar N8N
**3.2** Workflow 1: "Orquestador principal" (cada 6 horas)
**3.3** Workflow 2: "Enriquecedor nocturno con Claude" (2:00 AM diario)
**3.4** Workflow 3: "Detector de duplicados" (domingo 3:00 AM)
**3.5** Workflow 4: "Monitor de precios raros" (cada hora)

### FASE 4 — NEXT.JS WEB (MEJORAS)

**4.1** Mantener estructura Next.js 16.2.4 existente
**4.2** Expandir páginas:
- `/` (Landing) - Ya existe, mejorar con contador y mapa mundial
- `/catalogo` - Ya existe, agregar filtros avanzados, búsqueda semántica
- `/sello/[id]` - Crear página de detalle con zoom, historial precios, similares IA
- `/identificar` - Crear upload + Claude Vision identification
- `/paises/[codigo]` - Crear página por país
- `/coleccion` - Ya existe, mejorar con valor total, gaps, sugerencias
- `/estadisticas` - Crear dashboard con stats

**4.3** Implementar diseño lujo editorial:
- Paleta: #0a0906 (near-black), #C9A84C (dorado), #F5F0E8 (crema), #8B1A1A (rojo sello)
- Tipografía: Playfair Display (display), DM Sans (body)
- Efectos: grain texture, microanimaciones Framer Motion

### FASE 5 — SUPABASE EDGE FUNCTIONS

**5.1** `/functions/identify-stamp` - Claude Vision + embedding similarity
**5.2** `/functions/search-semantic` - Text embedding + pgvector + full-text
**5.3** `/functions/price-alert` - Alertas de precio para usuarios

---

## 4. PRIMEROS PASOS (INMEDIATO)

1. ✅ **FASE 0 COMPLETADA** - Reporte generado
2. 🔄 **Siguiente**: FASE 1 - Actualizar schema Prisma y base de datos
3. Crear tabla `stamps` expandida con todos los campos solicitados
4. Migrar storage de R2 a Supabase Storage
5. Comenzar con WNS Scraper (FUENTE OFICIAL)

---

## 5. DEPENDENCIAS ADICIONALES REQUERIDAS

```bash
# Supabase
npm install @supabase/supabase-js @supabase/ssr

# Scraping
npm install puppeteer cheerio axios

# Image processing
npm install sharp form-data

# AI/OAI
npm install openai

# N8N (instalar global o en proyecto)
npm install n8n
```

---

## 6. NOTAS IMPORTANTES

1. **Prisma vs SQL directo**: El usuario proporcionó SQL directo para Supabase, pero el proyecto usa Prisma. Decisión: Traducir el SQL al schema de Prisma y usar `prisma migrate` o `prisma db push`.

2. **Enfoque global vs Perú**: El schema actual es para un catálogo peruano. Se ampliará para soportar todos los países del mundo.

3. **Scrapers**: Los 4 scrapers deben ser independientes, con checkpoint para reanudar, y robustos (retry + backoff).

4. **N8N**: Si no hay servidor N8N disponible, se puede usar N8N Cloud o instalar local con Docker.

---

**Generado**: 2026-05-03
**Siguiente paso**: Ejecutar FASE 1 (Actualizar Base de Datos)
