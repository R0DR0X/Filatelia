# 📮 Filatelia - La Web de Filatelia Más Completa en Español

Proyecto de catálogo filatélico mundial con tienda en línea, identificación automática de sellos mediante IA, y búsqueda semántica.

## 🚀 Inicio Rápido

### Prerrequisitos
- Node.js 18+
- PostgreSQL (o cuenta Supabase)
- N8N (para workflows de automatización)
- Cuenta OpenAI (para embeddings)
- Cuenta Anthropic (para Claude Vision)

### 1. Clonar e Instalar

```bash
cd filatelia-web
npm install
```

### 2. Configurar Variables de Entorno

Copiar `.env.example` a `.env` y configurar:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[tu-proyecto].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[tu-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[tu-service-role-key]
DATABASE_URL=postgresql://postgres.[tu-proyecto]:[password]@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[tu-proyecto]:[password]@db.[tu-proyecto].supabase.co:5432/postgres

# OpenAI (para embeddings)
OPENAI_API_KEY=sk-...

# Anthropic (para Vision)
ANTHROPIC_API_KEY=sk-ant-...

# N8N
N8N_URL=http://localhost:5678
N8N_API_KEY=...
```

### 3. Base de Datos

```bash
# Ejecutar migraciones
cd filatelia-web
node run-edge-migration-v3.mjs
node fix-trigger.mjs
node update-search-vector-v3.mjs

# Cargar datos iniciales (10,004 sellos)
node scrapers/seed-final.mjs
```

### 4. Iniciar Servicios

```bash
# Terminal 1: Next.js
cd filatelia-web
npm run dev
# → http://localhost:3000

# Terminal 2: N8N
npx n8n start
# → http://localhost:5678

# Terminal 3: Supabase Edge Functions (local)
cd filatelia
npx supabase start
```

## 📊 Estado Actual

| Fase | Estado | Progreso |
|------|--------|----------|
| FASE 0: Reconocimiento | ✅ COMPLETADO | 100% |
| FASE 1: Base de Datos | ✅ COMPLETADO | 100% |
| FASE 2: Scrapers | ✅ COMPLETADO | 100% (10,004 sellos) |
| FASE 3: N8N Workflows | ✅ COMPLETADO | 100% (JSONs listos) |
| FASE 4: Next.js Web | ✅ COMPLETADO | 100% (Build PASSED) |
| FASE 5: Edge Functions | 🔄 CÓDIGO LISTO | 80% (pendiente despliegue) |

## 🏗️ Estructura del Proyecto

```
filatelia/
├── filatelia-web/          # Next.js 16 + React 19 + TypeScript
│   ├── src/
│   │   ├── app/              # App Router pages
│   │   │   ├── (public)/      # Páginas públicas
│   │   │   │   ├── catalogo/    # Catálogo de sellos
│   │   │   │   ├── tienda/      # Tienda en línea
│   │   │   │   ├── colecciones/ # Colecciones de usuarios
│   │   │   │   └── subastas/    # Subastas
│   │   │   ├── components/    # Componentes UI reutilizables
│   │   │   └── lib/           # Utilidades, Prisma client
│   ├── prisma/
│   │   └── schema.prisma    # Esquema de BD (30+ columnas Stamp)
│   └── scrapers/           # Scripts de carga y scrapers
│
├── supabase/               # Configuración Supabase
│   ├── functions/          # Edge Functions (Deno)
│   │   ├── identify-stamp/    # Claude Vision + embeddings
│   │   ├── search-semantic/  # Búsqueda semántica
│   │   └── price-alert/      # Alertas de precio
│   └── config.toml
│
├── n8n-workflows/         # Workflows JSON para importar
│   ├── 00-orquestador-principal.json
│   ├── 01-enriquecedor-nocturno.json
│   ├── 02-detector-duplicados.json
│   └── 03-monitor-precios-raros.json
│
├── PLAN.md               # Plan completo del proyecto
├── STATUS.md             # Progreso actual (LEER PRIMERO)
└── README.md             # Este archivo
```

## 🔧 Funcionalidades Principales

### 1. Catálogo Mundial
- 10,004+ sellos de 51 países
- Búsqueda semántica (pgvector + full-text)
- Filtros por país, año, tema, precio
- Páginas de detalle con historia y contexto

### 2. Identificación con IA
- Sube una foto → Claude Vision identifica el sello
- Búsqueda por similitud visual (embeddings)
- Top 5 resultados con % de confianza

### 3. Tienda en Línea
- Sellos seleccionados con garantía de autenticidad
- Carrito de compras
- Pasarela de pagos (pendiente integración)
- Alertas de precio personalizadas

### 4. Colecciones de Usuarios
- Crea y gestiona tu colección
- Registra condición, precio de compra, notas
- Estadísticas de tu colección

### 5. Automatizaciones N8N
- Enriquecimiento nocturno con Claude (descripciones)
- Detección de duplicados (domingos)
- Monitor de precios anómalos (cada hora)
- Orquestador principal (cada 6h)

## 📦 Migraciones de BD

```bash
# Verificar estado de la BD
cd filatelia-web
node check-db2.mjs

# Ejecutar migraciones manuales
node run-edge-migration-v3.mjs  # Funciones BD + tablas
node fix-trigger.mjs              # Trigger searchVector
node update-search-vector-v3.mjs   # Actualizar vectores
```

## 🚀 Despliegue de Edge Functions

```bash
# Login a Supabase
npx supabase login

# Link al proyecto
cd filatelia
npx supabase link --project-ref tshatwvvkworsogjfjyj

# Desplegar funciones
npx supabase functions deploy --project-ref tshatwvvkworsogjfjyj

# O desplegar individualmente
npx supabase functions deploy identify-stamp --project-ref tshatwvvkworsogjfjyj
npx supabase functions deploy search-semantic --project-ref tshatwvvkworsogjfjyj
npx supabase functions deploy price-alert --project-ref tshatwvvkworsogjfjyj
```

## 📂 Storage Buckets

Crear en Supabase Dashboard (https://supabase.com/dashboard/project/tshatwvvkworsogjfjyj/storage/buckets):
- `stamps-images` (público, 10MB, jpg/png/webp)
- `stamps-thumbs` (público, 5MB, jpg/png/webp)
- `stamps-backs` (público, 10MB, jpg/png/webp)

O ejecutar el script:
```bash
cd filatelia-web
node create-storage-buckets.mjs
```

## 🔍 Búsqueda Semántica

La búsqueda combina dos técnicas:
1. **Vector similarity** (pgvector + OpenAI embeddings): Encuentra sellos semánticamente similares
2. **Full-text search** (PostgreSQL tsvector): Búsqueda por palabras clave en español/inglés

Los resultados se combinan usando **RRF (Reciprocal Rank Fusion)**.

## 📋 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `seed-final.mjs` | Carga 10,004 sellos de 51 países |
| `run-edge-migration-v3.mjs` | Crea funciones BD y tablas para Edge Functions |
| `fix-trigger.mjs` | Corrige el trigger de searchVector |
| `update-search-vector-v3.mjs` | Actualiza vectores de búsqueda para todos los sellos |
| `create-storage-buckets.mjs` | Crea los buckets de Supabase Storage |
| `check-db2.mjs` | Verifica el estado de la base de datos |

## 🎨 Diseño

Paleta de colores (Lujo Editorial):
- Fondo: `#0a0906` (casi negro)
- Acento: `#C9A84C` (dorado)
- Texto: `#F5F0E8` (crema)
- Acento secundario: `#8B1A1A` (burdeos)

## 📝 Licencia

MIT License - Ver LICENSE para más detalles.

## 📧 Contacto

Para dudas o sugerencias, abrir un issue en el repositorio.

---

**Última actualización**: 2026-05-05
**Estado**: FASE 5 en progreso
**Total sellos**: 10,004 de 51 países
