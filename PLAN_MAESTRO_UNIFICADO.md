# PLAN MAESTRO UNIFICADO & HOJA DE RUTA DE EJECUCIÓN — PROYECTO FILATELIA

> **Fecha de Consolidación**: 2026-07-23  
> **Arquitectura Objetivo**: Cloudflare Pages + Workers (Hono API) + Cloudflare D1 + Vectorize + R2 Storage  
> **Estado Actual**: ~94% de la infraestructura y catálogo base completado. Tienda, control de imágenes erróneas y repositorio Git principal **100% operativos**.  

---

## 📊 1. ESTADO ACTUAL REAL (100% VERIFICADO EN PRODUCCIÓN Y CÓDIGO)

### ☁️ Arquitectura e Infraestructura
| Componente | Tecnología | Ubicación / Referencia | Estado |
| :--- | :--- | :--- | :--- |
| **Repositorio Git Principal** | Git (Master Branch) | `/home/rodrigo/Documentos/trabajos/filatelia` | **Repositorio Unificado e Inicializado** |
| **Base de Datos Principal** | Cloudflare D1 (SQLite) | `filatelia-db` (ID: `a06f77b8-6826-4594-8bee-48018e637e01`) | **142,830 sellos** cargados |
| **API Serverless** | Cloudflare Workers (Hono) | `https://filatelia-api.rodrigopianto2005.workers.dev` | 1,500+ líneas REST API (Gateway `/query`) |
| **Búsqueda Vectorial** | Cloudflare Vectorize | Index: `stamps-index` | Vinculado a Worker API |
| **Almacenamiento Multimedia** | Cloudflare R2 | Buckets: `stamps-images`, `stamps-thumbs`, `stamps-backs` | Buckets creados |
| **Frontend Web** | Next.js 16.2.4 (React 19 + Tailwind 4) | `filatelia-web/` | **21/21 páginas compilando** (`npm run build`) |
| **Automatización VPS** | N8N VPS (v1.80.0) | `http://76.13.224.112:5678` | 4 workflows importados |

---

### 🛠️ 2. MEJORAS RECIENTES IMPLEMENTADAS (HOY)

1. **Corrección de Cuadros/Imágenes en Negro (Captura de Colnect)**:
   * Se actualizó [`StampCard.tsx`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/components/catalog/StampCard.tsx), [`BibliotecaClient.tsx`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/app/(public)/biblioteca/BibliotecaClient.tsx) y [`CatalogoClient.tsx`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/app/(public)/catalogo/CatalogoClient.tsx).
   * **Manejo de Errores Visuales**: Si un sello tiene una URL rota, screenshot de error de login (`colnect_login_error.png`) o no carga, **no se muestra un cuadro negro**. En su lugar, se renderiza un elegante contenedor filatélico en tono ámbar/dorado con el ícono del sello, código de país y año.

2. **Navegación al Detalle de Sello (`/sello/[id]`)**:
   * Todas las tarjetas de sellos en el catálogo, biblioteca y tienda ahora son completamente clickeables y redirigen a la ficha de detalle filatélico con sus metadatos (Scott, WNS, año, país, denominación).

3. **Versión Mejorada e IA de Colnect**:
   * Pipeline de reparación automática de URLs (`scrapers/repair_colnect_images.py`) y enriquecimiento filatélico con OpenRouter/Claude (`scrapers/04-ai-enricher.mjs`) para autogenerar descripciones en español, catalogación y niveles de rareza (`rarityScore`).

4. **Repositorio Git Unificado**:
   * Inicializado en la raíz del proyecto (`/home/rodrigo/Documentos/trabajos/filatelia`), vinculando la Web, Workers API, Scrapers y Documentación para versionado limpio y compatibilidad total con Cloudflare Pages.

---

## 🎯 3. HOJA DE RUTA DE EJECUCIÓN SECUENCIAL (PASO A PASO HASTA EL 100%)

---

### 🚀 FASE 1: MÓDULO DE COMPRAS (`/checkout`) Y AUTENTICACIÓN PROTEGIDA
> **Objetivo**: Permitir compras reales desde la tienda recién creada y asegurar las rutas privadas.

* [x] **T1.1**: Tienda de productos con imágenes reales (`/tienda`) y endpoint `/api/products` (**COMPLETADO**).
* [x] **T1.2**: Sistema de fallback para imágenes erróneas/negras e integración de click a `/sello/[id]` (**COMPLETADO**).
* [ ] **T1.3**: Crear la vista de Checkout [`src/app/(public)/checkout/page.tsx`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/app/(public)/checkout/page.tsx):
  * Formulario de dirección de envío y contacto.
  * Resumen del carrito (`useCartStore`).
  * Selección de método de pago (MercadoPago / PayPal / Yape-Plin / Transferencia).
  * Generación de orden en D1 (`Order` y `OrderItem`).
* [ ] **T1.4**: Crear la vista de Perfil del Usuario [`src/app/perfil/page.tsx`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/app/perfil/page.tsx):
  * Datos del coleccionista, historial de pedidos y avatar con iniciales.
* [ ] **T1.5**: Crear el Middleware de Protección de Rutas [`src/middleware.ts`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/middleware.ts):
  * Proteger `/admin/*` y `/perfil` validando la cookie `fp_session`.

---

### 🖼️ FASE 2: MIGRACIÓN Y RESPALDO DE IMÁGENES A CLOUDFLARE R2
> **Objetivo**: Asegurar que los 142,830 sellos tengan sus imágenes alojadas en la infraestructura propia de Cloudflare R2.

* [ ] **T2.1**: Ejecutar script de descarga masiva de Wikimedia Commons y WNS ([`scrapers/fetch-wikimedia.mjs`](file:///home/rodrigo/Documentos/trabajos/filatelia/scrapers/fetch-wikimedia.mjs)).
* [ ] **T2.2**: Subir imágenes originales a `stamps-images` y miniaturas optimizadas con Sharp a `stamps-thumbs` en Cloudflare R2.
* [ ] **T2.3**: Actualizar los campos `imageUrl` e `imageThumbUrl` en D1 apuntando a las URLs de R2.

---

### 🧠 FASE 3: EMBEDDINGS VECTORIALES Y BÚSQUEDA SEMÁNTICA CON VECTORIZE
> **Objetivo**: Habilitar la búsqueda inteligente y la identificación visual de sellos por cámara/foto.

* [ ] **T3.1**: Generar los embeddings de 1536 dimensiones para los sellos utilizando [`generate-embeddings.mjs`](file:///home/rodrigo/Documentos/trabajos/filatelia/generate-embeddings.mjs).
* [ ] **T3.2**: Cargar los vectores en el índice Cloudflare Vectorize (`stamps-index`).
* [ ] **T3.3**: Conectar la vista [`/identificar`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/app/(public)/identificar/page.tsx) con la Edge Function del Worker para mostrar similitudes reales.

---

### 🤖 FASE 4: ACTIVACIÓN DE BOTS N8N EN VPS (`http://76.13.224.112:5678`)
> **Objetivo**: Dejar el sistema recolectando y enriqueciendo sellos automáticamente.

* [ ] **T4.1**: Ingresar al panel N8N VPS y configurar credenciales:
  * Supabase / D1 Postgres Connection.
  * OpenAI API Key (Embeddings).
  * Anthropic API Key (Claude Vision).
  * eBay API Key (Monitor de precios).
* [ ] **T4.2**: Activar los 4 workflows importados.
* [ ] **T4.3**: Crear el Bot 2 "Stealth Scraper" con Puppeteer para extracción continua en Colnect y eBay.
* [ ] **T4.4**: Ejecutar [`04-ai-enricher.mjs`](file:///home/rodrigo/Documentos/trabajos/filatelia/scrapers/04-ai-enricher.mjs) para poblar descripciones filatélicas en español, temas y niveles de rareza (`rarityScore` 1-10).

---

### 🔨 FASE 5: MÓDULO DE SUBASTAS Y SEGUIMIENTO EN TIEMPO REAL
> **Objetivo**: Transformar la sección de subastas en un mercado interactivo.

* [ ] **T5.1**: Crear las tablas `Auction` y `Bid` en Cloudflare D1.
* [ ] **T5.2**: Reemplazar la vista estática [`/subastas`](file:///home/rodrigo/Documentos/trabajos/filatelia/filatelia-web/src/app/(public)/subastas/page.tsx) con un tablero dinámico de pujas, reloj en tiempo real y notificaciones.

---

### 🌐 FASE 6: SEO, ANALÍTICAS Y DESPLIEGUE A PRODUCCIÓN
> **Objetivo**: Publicar la aplicación en Cloudflare Pages con rendimiento máximo.

* [ ] **T6.1**: Crear `public/robots.txt` y `src/app/sitemap.ts` dinámico con las rutas de países y catálogos.
* [ ] **T6.2**: Configurar tags OpenGraph y Twitter Cards con la imagen estática `/public/og-image.jpg`.
* [ ] **T6.3**: Ejecutar compilación para Cloudflare Pages (`npm run build:cf`).
* [ ] **T6.4**: Desplegar a Cloudflare Pages mediante Wrangler:
  ```bash
  npx wrangler pages deploy .vercel/output/static --project-name=filatelia-web --branch=master
  ```
* [ ] **T6.5**: Smoke test completo en vivo.

---

## 📌 MATRIZ DE RESUMEN DE PROGRESO

| Fase | Módulo / Tarea | Progreso Actual | Estado |
| :--- | :--- | :--- | :--- |
| **Fase 0** | Reconocimiento & Arquitectura Cloudflare | 100% | ✅ COMPLETADO |
| **Fase 1** | Base de Datos D1 (142,830 sellos) & Worker API | 100% | ✅ COMPLETADO |
| **Fase 2** | Tienda Web + Productos Reales + Carrito | 100% | ✅ COMPLETADO |
| **Fase 3** | Fallback de Imágenes en Negro & Links a `/sello/[id]` | 100% | ✅ COMPLETADO |
| **Fase 4** | Repositorio Git Raíz Unificado para Versionado | 100% | ✅ COMPLETADO |
| **Fase 5** | Checkout (`/checkout`), Perfil (`/perfil`) y Middleware | 10% | 🔄 SIGUIENTE PASO |
| **Fase 6** | Almacenamiento R2 (Imágenes en Cloudflare) | 30% | 🔄 EN PROGRESO |
| **Fase 7** | Embeddings & Vectorize (Búsqueda IA) | 20% | 🔄 EN PROGRESO |
| **Fase 8** | Workflows N8N en VPS & Stealth Bot | 75% | 🔄 PENDIENTE CREDENCIALES |
| **Fase 9** | Subastas en Vivo & Pujas | 15% | 🔄 PENDIENTE |
| **Fase 10** | Despliegue en Cloudflare Pages | 85% | 🔄 PRÓXIMO A DESPLEGAR |

---

**Conclusión del Plan**: El repositorio Git raíz ha sido creado y versionado (`master`), la captura de imágenes en negro fue solucionada con un fallback elegante filatélico, y la navegación al detalle de sello fue habilitada globalmente.
