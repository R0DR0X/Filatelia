# Plan Maestro — filateliaperuana.com
> Stack: Cloudflare Pages + Workers + D1 + R2
> Auditado: 2026-06-14 | Objetivo: web 100% operativa

---

## 1. Mapa Completo de Páginas (Estado Real)

### Páginas Públicas

| Ruta | Archivo | Estado | Problema |
|---|---|---|---|
| `/` | `app/page.tsx` | ⚠️ | "Regístrese"→`/login` (bug), links a `/tienda/accesorios` y `/tienda/albumes` no existen, contador hardcoded |
| `/biblioteca` | `(public)/biblioteca/page.tsx` | ✅ OK | Funcional con filtros y paginación |
| `/catalogo` | `(public)/catalogo/page.tsx` | ✅ OK | Grid de países → grupos de emisión |
| `/catalogo/[slug]` | `(public)/catalogo/[slug]/page.tsx` | ❌ CRASH | Server component sin edge + `generateStaticParams` + prisma con includes anidados → ELIMINAR y redirigir a `/catalogo` |
| `/sello/[id]` | `(public)/sello/[id]/page.tsx` | ✅ OK | Client, edge, fetch al Worker |
| `/paises/[codigo]` | `(public)/paises/[codigo]/page.tsx` | ⚠️ Bug | Edge OK pero busca stamps por `countryId` (no existe en schema) en vez de `countryCode` → 0 sellos mostrados. Además HUÉRFANA |
| `/tienda` | `(public)/tienda/page.tsx` | ❌ CRASH | Server component sin `runtime='edge'` |
| `/colecciones` | `(public)/colecciones/page.tsx` | ❌ CRASH + HUÉRFANA | Server component sin edge. Nadie linkea aquí. Redundante con `/catalogo` → ELIMINAR y redirigir |
| `/estadisticas` | `(public)/estadisticas/page.tsx` | ❌ CRASH + HUÉRFANA | Server component sin edge. Nadie linkea aquí. Convertir a client |
| `/identificar` | `(public)/identificar/page.tsx` | ⚠️ URL muerta + HUÉRFANA | Client OK, pero llama a `/functions/v1/identify-stamp` (URL Supabase muerta). Nadie linkea aquí |
| `/subastas` | `(public)/subastas/page.tsx` | ⚠️ | Estático OK, pero botón "Notificarme" decorativo |
| `/login` | `login/page.tsx` | ✅ OK | Auth real, redirect por rol |
| `/registro` | `registro/page.tsx` | ✅ OK | PBKDF2, guarda en D1 |

### Páginas Privadas

| Ruta | Archivo | Estado | Problema |
|---|---|---|---|
| `/perfil` | — | ❌ NO EXISTE | Directorio vacío, sin page.tsx |
| `/admin/dashboard` | `(admin)/admin/dashboard/page.tsx` | ⚠️ | Existe, datos hardcoded |
| `/admin/importar` | `(admin)/admin/importar/page.tsx` | ⚠️ | UI existe, server action rota |
| `/admin/catalogo` | — | ❌ LINK ROTO | En sidebar pero no existe → 404 |
| `/admin/tienda` | — | ❌ LINK ROTO | En sidebar pero no existe → 404 |
| `/admin/usuarios` | — | ❌ LINK ROTO | En sidebar pero no existe → 404 |
| `/admin/configuracion` | — | ❌ LINK ROTO | En sidebar pero no existe → 404 |

### Links Rotos (Inventario Completo)

| Origen | Link actual | Destino correcto |
|---|---|---|
| `page.tsx` home | `/login` (botón "Regístrese") | `/registro` |
| `page.tsx` home | `/tienda/accesorios` | `/tienda` (no existe subcategoría aún) |
| `page.tsx` home | `/tienda/albumes` | `/tienda` |
| `identificar/page.tsx` | `/functions/v1/identify-stamp` | `https://filatelia-api.rodrigopianto2005.workers.dev/identify-stamp` |
| `(admin)/layout.tsx` sidebar | `/admin/catalogo` | `/admin/catalogos` (cuando se cree) |
| `(admin)/layout.tsx` sidebar | `/admin/tienda` | Quitar de sidebar |
| `(admin)/layout.tsx` sidebar | `/admin/usuarios` | `/admin/usuarios` (cuando se cree) |
| `(admin)/layout.tsx` sidebar | `/admin/configuracion` | Quitar de sidebar |
| `(admin)/layout.tsx` sidebar | Botón "Cerrar Sesión" | Llama `logout()` real |
| Navbar | User icon → `/login` | Condicional: si auth → `/perfil`, si no → `/login` |

### Páginas Huérfanas (Sin Links que lleguen a ellas)

| Ruta | Solución |
|---|---|
| `/colecciones` | Eliminar + redirect 308 a `/catalogo` |
| `/estadisticas` | Agregar al footer (solo visible, no en navbar) |
| `/identificar` | Agregar al navbar como "Identificar" |
| `/paises/[codigo]` | Linkear desde `/catalogo` al dar click en un país (alternativa a la vista inline) |

---

## 2. Arquitectura de Navegación Objetivo

### Navbar (después de los fixes)
```
Logo FP  |  Biblioteca  |  Catálogo  |  Identificar  |  Tienda  |  Subastas  |  [Avatar/Login]
```
- **Biblioteca** → `/biblioteca` (todos los sellos con filtros)
- **Catálogo** → `/catalogo` (agrupado por país/emisión)
- **Identificar** → `/identificar` (subir foto → IA identifica sello)
- **Tienda** → `/tienda` (próximamente)
- **Subastas** → `/subastas` (próximamente)
- **Avatar** → dropdown: Mi Perfil | Admin Panel (si admin) | Cerrar Sesión
- **Login icon** → `/login` (si no hay sesión)

### Mapa de Rutas Final (lo que quedará operativo)
```
/                         → Home
├── /biblioteca           → Todos los sellos (filtros + paginación)
├── /catalogo             → Países → Grupos de emisión
│   └── Clic en país      → Vista inline de emisiones del país
├── /sello/[id]           → Detalle de sello individual
├── /paises/[codigo]      → Página de país (alternativa con datos adicionales)
├── /identificar          → Subir foto → IA identifica sello (pendiente AI)
├── /tienda               → Empty state "próximamente"
├── /subastas             → Empty state "próximamente"
├── /estadisticas         → Stats del sitio (solo footer)
├── /login                → Formulario login
├── /registro             → Formulario registro
├── /perfil               → Perfil usuario (protegida)
└── /admin/               → Panel admin (protegido, solo admin)
    ├── /dashboard        → Resumen con datos reales
    ├── /sellos           → CRUD de sellos
    ├── /grupos           → CRUD de grupos
    ├── /catalogos        → CRUD de catálogos
    ├── /usuarios         → Gestión usuarios
    ├── /analitica        → Visitas y estadísticas
    └── /importar         → Importar sellos (CSV/Excel)

ELIMINADAS (redirect 308):
/catalogo/[slug]          → /catalogo
/colecciones              → /catalogo
```

---

## 3. Compatibilidad Cloudflare Pages

### Reglas Absolutas

```
✅ FUNCIONA                              ❌ NO FUNCIONA
────────────────────────────────         ──────────────────────────────
"use client" (browser puro)              Server components sin runtime='edge'
Server components + runtime='edge'       revalidatePath / revalidateTag / ISR
fetch() nativo                           Server Actions ("use server")
Edge middleware (src/middleware.ts)       fs, path, net, child_process
Buffer (con nodejs_compat ya activado)   @prisma/client real (binarios Node)
next/image con unoptimized:true ✅       next/image optimization server
Worker API (Hono) ✅                     Supabase Auth / Supabase Client
PBKDF2 / Web Crypto API ✅               bcrypt (necesita binarios Node)
```

### Páginas que necesitan `runtime='edge'` si son server components
Regla: todo lo que haga async data-fetching en el servidor necesita `export const runtime = 'edge'`.
Alternativa preferida: convertir a `"use client"` y hacer fetch en el cliente.

---

## 4. Stack de Referencia

```
Frontend (CF Pages)
  Next.js 16.2.4 con @cloudflare/next-on-pages
  Tailwind CSS v4 · Framer Motion · Lucide React
  Zustand (carrito) · @tanstack/react-query

Backend (CF Worker desplegado)
  URL: https://filatelia-api.rodrigopianto2005.workers.dev
  Framework: Hono.js
  Auth: PBKDF2 + JWT (httpOnly cookie fp_session)
  DB binding: D1 (SQLite) → filatelia-db

Base de datos (D1 activa)
  47,156 sellos WNS (countryCode, year, denomination, imageUrl, wnsNumber)
  82 países con nombres en español
  Autenticación completa (User, Role, UserRole)
  Analytics (SiteVisit)
  Catálogos, Grupos de emisión

Storage (R2)
  stamps-images · stamps-thumbs · stamps-backs
  Imágenes WNS linkeadas desde wnsstamps.post (pendiente mirror a R2)

AI / Vectorize (PENDIENTE — no bloquea launch)
  Embeddings: pendiente generación masiva
  /identify-stamp: endpoint existe en Worker pero sin embeddings no funciona bien
```

---

## 5. Código Muerto a Eliminar

### Archivos a Borrar
```
src/services/catalogService.ts      → Nadie lo importa en producción
src/services/storeService.ts        → Nadie lo importa en producción
src/services/importService.ts       → Solo lo llama importActions (que también muere)
src/app/actions/importActions.ts    → Server action + revalidatePath, incompatible edge
prisma/ (directorio completo)       → Real Prisma ORM, nunca se usa en runtime
src/app/(public)/catalogo/[slug]/page.tsx → Sistema viejo, reemplazado por CatalogoClient
src/app/(public)/colecciones/page.tsx     → Redundante con /catalogo
```

### Dependencias a Quitar (package.json)
```
dependencies:
  @supabase/supabase-js    → Reemplazado por Worker JWT (no importado en ningún src/)
  axios                    → No se usa, tenemos fetch nativo
  shadcn-ui                → Solo CLI de init, no código de runtime

devDependencies:
  prisma                   → Real Prisma nunca se usa (tenemos src/lib/prisma.ts custom)
  @prisma/client           → Mismo motivo
  dotenv                   → Next.js gestiona .env automáticamente

Sección "prisma": { "seed": ... }  → Quitar del package.json
```

### Dependencias a AGREGAR
```
devDependencies:
  @cloudflare/next-on-pages    → CRÍTICO: sin esto no hay build para CF Pages
```

### Scripts a AGREGAR (package.json)
```json
"build:cf": "npx @cloudflare/next-on-pages",
"preview": "npx wrangler pages dev .vercel/output/static --compatibility-flag nodejs_compat"
```

---

## 6. Plan de Implementación por Épicas

---

### ÉPICA 0 — LIMPIEZA Y BUILD TOOLS ⛔ BLOQUEANTE
*Sin esto no hay deploy. Va primero.*

#### T0.1 Agregar @cloudflare/next-on-pages
- [ ] `npm install --save-dev @cloudflare/next-on-pages`
- [ ] Agregar `build:cf` y `preview` en scripts
- [ ] Agregar en `next.config.ts`:
  ```ts
  import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";
  if (process.env.NODE_ENV === "development") {
    await setupDevPlatform();
  }
  ```

#### T0.2 Limpiar dependencias muertas
- [ ] Quitar de dependencies: `@supabase/supabase-js`, `axios`, `shadcn-ui`, `dotenv`
- [ ] Quitar de devDependencies: `prisma`, `@prisma/client`
- [ ] Quitar sección `"prisma"` de package.json
- [ ] `npm install` para regenerar lockfile

#### T0.3 Borrar archivos muertos
- [ ] `rm src/services/catalogService.ts`
- [ ] `rm src/services/storeService.ts`
- [ ] `rm src/services/importService.ts`
- [ ] `rm src/app/actions/importActions.ts`
- [ ] `rm -rf prisma/`
- [ ] `rm src/app/(public)/catalogo/[slug]/page.tsx`
- [ ] `rm src/app/(public)/colecciones/page.tsx`

#### T0.4 Redirects para rutas eliminadas
**Archivo:** `next.config.ts`
```ts
async redirects() {
  return [
    { source: '/catalogo/:slug', destination: '/catalogo', permanent: true },
    { source: '/colecciones', destination: '/catalogo', permanent: true },
  ];
}
```

#### T0.5 Fix tienda/page.tsx (CRASH en prod)
**Archivo:** `src/app/(public)/tienda/page.tsx`
- [ ] Convertir a `"use client"` + quitar `import { prisma }`
- [ ] Contenido: Banner, estructura con filtros laterales, grid vacío con empty state elegante
- [ ] Empty state: "Las primeras piezas llegarán pronto" + formulario "Avísame"
- [ ] Quitar links a `/tienda/accesorios` y `/tienda/albumes` de home por ahora

#### T0.6 Fix estadisticas/page.tsx (CRASH en prod)
**Archivo:** `src/app/(public)/estadisticas/page.tsx`
- [ ] Convertir a `"use client"` → `EstadisticasClient.tsx`
- [ ] Reemplazar queries de prisma por fetches al Worker:
  - `GET /analytics/stats` (admin) O nuevo endpoint público `GET /stats/public`
  - Para stats de sellos: `GET /stamps?limit=1` y leer `pagination.total`
  - Para stats de países: `GET /countries` y contar
- [ ] Quitar `embedding`, `searchVector` y datos de enrichment (son internos, no relevantes para el público)
- [ ] Mantener: total sellos, total países, total visitas, gráfico por año

#### T0.7 Fix identificar/page.tsx (URL muerta)
**Archivo:** `src/app/(public)/identificar/page.tsx`
- [ ] Cambiar URL de `/functions/v1/identify-stamp` a:
  `https://filatelia-api.rodrigopianto2005.workers.dev/identify-stamp`
- [ ] Agregar manejo de error graceful cuando no hay embeddings:
  "El identificador IA está en calibración. Prueba la Biblioteca con filtros."
- [ ] Quitar `export const dynamic = "force-dynamic"` (es página client, no aplica)

#### T0.8 Fix paises/[codigo]/page.tsx (bug de datos)
**Archivo:** `src/app/(public)/paises/[codigo]/page.tsx`
- [ ] Cambiar `prisma.stamp.findMany({ where: { countryId: country.id } })`
  por `prisma.stamp.findMany({ where: { countryCode: countryCode } })`
- [ ] Agregar link "Ver en Catálogo" → `/catalogo` (para ver grupos)
- [ ] Agregar link "Ver en Biblioteca" → `/biblioteca?countryCode=XX`
- [ ] Reemplazar `<MapPin>` placeholder por bandera real: `flagcdn.com/40x30/{code}.png`

---

### ÉPICA 1 — NAVEGACIÓN LIMPIA Y SIN HUÉRFANAS

#### T1.1 Actualizar Navbar
**Archivo:** `src/components/Navbar.tsx`
- [ ] Nuevo orden: Biblioteca | Catálogo | **Identificar** | Tienda | Subastas
- [ ] Auth state con `getCachedUser()`:
  - Sin sesión: icono User → `/login`
  - Con sesión: avatar con inicial → dropdown:
    - "Mi Perfil" → `/perfil`
    - "Admin Panel" → `/admin/dashboard` (solo si role=admin)
    - "Cerrar sesión" → `logout()` + `window.location.href = '/'`
- [ ] Dropdown: `useState(false)` + click outside con `useEffect`
- [ ] Mobile: menú hamburguesa funcional con las mismas opciones

#### T1.2 Fix Home page — links y contador
**Archivo:** `src/app/page.tsx`
- [ ] Botón "Regístrese" → href `/registro` (corregir `/login`)
- [ ] "Accesorios" → href `/tienda` (en vez de `/tienda/accesorios`)
- [ ] "Álbumes" → href `/tienda` (en vez de `/tienda/albumes`)
- [ ] Contador de visitas: `useEffect` → `fetch(API/analytics/total)` → mostrar número real
- [ ] Formatear número con `toLocaleString('es-PE')`

#### T1.3 Fix Admin Sidebar — quitar links rotos
**Archivo:** `src/app/(admin)/layout.tsx`
- [ ] Quitar link `/admin/catalogo` (no existe) → reemplazar por `/admin/catalogos` (cuando exista) o quitar por ahora
- [ ] Quitar link `/admin/tienda` (no existe y no se va a crear)
- [ ] Quitar link `/admin/configuracion` (no existe)
- [ ] Mantener: Dashboard, Importar
- [ ] Agregar: Sellos (`/admin/sellos`), Grupos (`/admin/grupos`), Usuarios (`/admin/usuarios`), Analítica (`/admin/analitica`)
- [ ] Botón Cerrar Sesión: `import { logout } from "@/lib/auth"` + `logout()` + redirect
- [ ] Detectar ruta activa con `usePathname()` (convertir layout a client para esto)

#### T1.4 Agregar link a /estadisticas desde Footer
**Archivo:** `src/app/layout.tsx`
- [ ] Agregar al footer link "Estadísticas" → `/estadisticas`
- [ ] Ampliar footer: logo, copyright, links (Biblioteca, Catálogo, Identificar, Estadísticas)

---

### ÉPICA 2 — AUTH Y PERFIL

#### T2.1 Página Perfil `/perfil`
**Archivos nuevos:** `src/app/perfil/page.tsx` + `src/app/perfil/PerfilClient.tsx`
- [ ] `PerfilClient.tsx`:
  - `useEffect` → `getMe()` (fetch a `/auth/me` con token)
  - Si no hay sesión → `router.push('/login?from=/perfil')`
  - Loading state mientras carga
  - Avatar: círculo con inicial del nombre (color moss-green)
  - Datos: nombre completo, email, rol (badge "Admin" o "Usuario")
  - Sección "Mi Cuenta": fecha de registro
  - Botón "Ir a Biblioteca" → `/biblioteca`
  - Botón "Cerrar sesión" → `logout()` → redirect `/`
  - Si admin: banner "Panel de Administración" → `/admin/dashboard`
- [ ] `page.tsx`: wrapper con metadata `"Mi Perfil | Filatelia Peruana"`

#### T2.2 Middleware de protección de rutas
**Archivo nuevo:** `src/middleware.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/admin/:path*', '/perfil'],
};

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get('fp_session')?.value;
  if (!cookie) {
    return NextResponse.redirect(new URL(`/login?from=${req.nextUrl.pathname}`, req.url));
  }
  // Para rutas admin, verificar rol en el JWT payload (base64 decode del body)
  if (req.nextUrl.pathname.startsWith('/admin')) {
    try {
      const [, payload] = cookie.split('.');
      const decoded = JSON.parse(atob(payload));
      if (decoded.role !== 'admin') {
        return NextResponse.redirect(new URL('/', req.url));
      }
    } catch {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }
  return NextResponse.next();
}
```
- [ ] Verificar que el JWT del Worker usa estructura `header.payload.signature` (base64 estándar)
- [ ] Ajustar decode si el Worker usa formato diferente

#### T2.3 Fix login redirect al perfil
**Archivo:** `src/app/login/page.tsx`
- [ ] Leer `?from=` query param y redirigir a esa ruta tras login exitoso
  (actualmente redirige a `/admin/dashboard` o `/perfil` sin considerar `from`)

---

### ÉPICA 3 — ANALYTICS

#### T3.1 Endpoint público GET /analytics/total (Worker)
**Archivo:** `workers/filatelia-api/src/index.ts`
- [ ] Agregar:
  ```typescript
  app.get('/analytics/total', async (c) => {
    const row = await c.env.DB.prepare('SELECT COUNT(*) as total FROM SiteVisit').first() as any;
    return c.json({ total: row?.total || 0 }, 200, {
      'Cache-Control': 'public, max-age=300'
    });
  });
  ```

#### T3.2 AnalyticsTracker component
**Archivo nuevo:** `src/components/AnalyticsTracker.tsx`
```typescript
"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname?.startsWith('/admin')) return; // no trackear admin
    fetch(`${API}/analytics/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname, referrer: document.referrer }),
    }).catch(() => {}); // fire and forget
  }, [pathname]);
  return null;
}
```
- [ ] Importar en `src/app/layout.tsx` como `<AnalyticsTracker />`

---

### ÉPICA 4 — ADMIN PANEL COMPLETO

#### T4.1 Dashboard con datos reales
**Archivos:** `src/app/(admin)/admin/dashboard/page.tsx` → convertir a client
- [ ] Crear `DashboardClient.tsx`:
  - Token del localStorage para llamadas autenticadas
  - Fetch paralelo:
    - `GET /admin/stamps?limit=1` → `pagination.total` → total sellos
    - `GET /admin/users?limit=1` → total usuarios (si endpoint existe)
    - `GET /analytics/stats` → visitas totales y hoy
    - `GET /admin/catalogs?limit=1` → total catálogos
  - StatCards con datos reales
  - Feed actividad: top paths de `/analytics/stats`
- [ ] `page.tsx`: wrapper `export default function Page() { return <DashboardClient /> }`

#### T4.2 Admin Sellos `/admin/sellos`
**Archivos nuevos:** `page.tsx` + `SellosAdminClient.tsx`
- [ ] Tabla paginada (20 por página): `GET /admin/stamps?page=X&q=Y&limit=20`
  - Columnas: Thumb | WNS | Nombre EN | País | Año | Denominación | Acciones
- [ ] Buscador con debounce 300ms (q param)
- [ ] Modal Editar sello:
  - Campos: nameEs, nameEn, scottNumber, marketPriceUsd, theme
  - Submit → `PUT /admin/stamp/:id` con `Authorization: Bearer {token}`
- [ ] Botón Eliminar → confirm alert → `DELETE /admin/stamp/:id`
- [ ] Badge WNS number, thumbnail con fallback
- [ ] Verificar que `GET /admin/stamps` existe en Worker (tiene q, page, limit params)

#### T4.3 Admin Grupos `/admin/grupos`
**Archivos nuevos:** `page.tsx` + `GruposAdminClient.tsx`
- [ ] Tabla: `GET /admin/groups?page=X`
  - Columnas: Título ES | Catálogo ID | Año | Acciones
- [ ] Modal Crear: catalogId, titleEs, titleEn, year → `POST /admin/group`
- [ ] Modal Editar → `PUT /admin/group/:id`
- [ ] Eliminar → confirm → `DELETE /admin/group/:id`

#### T4.4 Admin Catálogos `/admin/catalogos`
**Archivos nuevos:** `page.tsx` + `CatalogosAdminClient.tsx`
- [ ] Verificar que `GET /admin/catalogs` existe en Worker
  - Si no existe, agregar:
    ```typescript
    app.get('/admin/catalogs', async (c) => {
      const admin = await requireAdmin(c);
      if (!admin) return c.json({ error: 'Forbidden' }, 403);
      const page = parseInt(c.req.query('page') || '1');
      const limit = parseInt(c.req.query('limit') || '20');
      const offset = (page - 1) * limit;
      const [countRes, dataRes] = await c.env.DB.batch([
        c.env.DB.prepare('SELECT COUNT(*) as total FROM Catalog'),
        c.env.DB.prepare('SELECT * FROM Catalog ORDER BY name ASC LIMIT ? OFFSET ?').bind(limit, offset),
      ]);
      const total = (countRes.results[0] as any)?.total || 0;
      return c.json({ success: true, catalogs: dataRes.results, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
    });
    ```
- [ ] Tabla: nombre, descripción, estado, acciones
- [ ] Crear/Editar/Eliminar catálogo (con check "no eliminar si tiene grupos")

#### T4.5 Admin Usuarios `/admin/usuarios`
**Archivos nuevos:** `page.tsx` + `UsuariosAdminClient.tsx`
- [ ] Verificar que `GET /admin/users` existe en Worker
  - Si no: agregar endpoint con JOIN User+UserRole+Role
- [ ] Tabla: Nombre | Email | Rol (badge) | Fecha registro | Acciones
- [ ] Cambiar rol: dropdown user/admin → `PUT /admin/user/:id/role`
  - Si no existe: agregar en Worker
- [ ] Eliminar usuario: confirm → `DELETE /admin/user/:id`
  - Si no existe: agregar en Worker

#### T4.6 Admin Analítica `/admin/analitica`
**Archivo nuevo:** `src/app/(admin)/admin/analitica/page.tsx`
- [ ] Fetch `GET /analytics/stats` con token
- [ ] Cards: Visitas Totales | Hoy | Ayer
- [ ] Tabla "Top 10 Páginas" con barra de progreso CSS
- [ ] Tabla "Sellos más buscados" (si se trackea en el futuro)

#### T4.7 Admin Importar (refactorizado)
**Archivo:** `src/app/(admin)/admin/importar/page.tsx`
- [ ] Quitar `importCatalogAction` (server action muerta)
- [ ] Nuevo flujo: parsear Excel en browser con `xlsx` (ya en devDeps)
  - Leer archivo → preview tabla de primeras 10 filas
  - Validar columnas requeridas: countryCode, denomination, year
  - Submit → `POST /import-stamp` con array JSON (máx 50 filas por request)
  - Mostrar progreso y resultado fila a fila
- [ ] Sección "Importación Masiva (CLI)": instrucciones con código de ejemplo
- [ ] Link para descargar plantilla xlsx

#### T4.8 Endpoints faltantes en Worker
**Archivo:** `workers/filatelia-api/src/index.ts`
- [ ] Verificar y agregar si no existen:
  - `GET /admin/catalogs` (listado paginado)
  - `POST /admin/catalog` (crear)
  - `PUT /admin/catalog/:id` (editar)
  - `DELETE /admin/catalog/:id` (eliminar, bloqueado si tiene grupos)
  - `GET /admin/users` (listado con roles)
  - `PUT /admin/user/:id/role` (cambiar rol)
  - `DELETE /admin/user/:id`
  - `GET /admin/stamps` con params `q`, `page`, `limit` (verificar que q filtra por nombre/WNS)
  - `GET /analytics/total` (público)
  - `GET /countries/:code` (detalle de un país)

---

### ÉPICA 5 — PÁGINAS PÚBLICAS CORREGIDAS

#### T5.1 Tienda `/tienda` (empty state elegante)
**Archivo:** `src/app/(public)/tienda/page.tsx` → reescribir como client
- [ ] `"use client"` + quitar todo lo de prisma
- [ ] Estructura: banner verde musgo + sideba filtros (hardcoded: Sellos, Accesorios, Álbumes)
- [ ] Grid principal con `ComingSoonGrid`:
  - 6 tarjetas skeleton con animación de pulso
  - Overlay con badge "Próximamente"
  - Texto: "Estamos preparando las primeras piezas — Julio 2026"
- [ ] Formulario "Avísame": input email → `POST /analytics/visit` o tabla de waitlist
- [ ] Cards informativas: "Envíos a todo el Perú" | "Garantía de autenticidad"

#### T5.2 Estadísticas `/estadisticas` (convertir a client)
**Archivos:** `src/app/(public)/estadisticas/page.tsx` + `EstadisticasClient.tsx`
- [ ] `"use client"` + quitar todo lo de prisma
- [ ] Fetch:
  - Total sellos: `GET /stamps?limit=1` → `pagination.total`
  - Total países: `GET /countries` → `countries.length`
  - Visitas: `GET /analytics/total` → `total`
  - Sellos por año: nuevo endpoint `GET /stats/by-year` O query `GET /stamps?groupBy=year` (si existe)
- [ ] Simplificar: quitar métricas de embeddings/enrichment (internas)
- [ ] Mostrar: 3 cards (sellos, países, visitas) + gráfico de barras CSS por año
- [ ] Agregar link en footer al `/estadisticas`

#### T5.3 Identificar `/identificar` (fix URL y UX)
**Archivo:** `src/app/(public)/identificar/page.tsx`
- [ ] Cambiar URL a `${API}/identify-stamp`
- [ ] Agregar estado de error elegante cuando el Worker no tiene embeddings:
  ```
  🔍 El identificador aún está en calibración.
  Mientras tanto, prueba buscar en la [Biblioteca →]
  ```
- [ ] Agregar link en la página a `/biblioteca` y a `/catalogo`
- [ ] Quitar `export const dynamic = "force-dynamic"` (no aplica en client)

#### T5.4 Página País `/paises/[codigo]` (fix bug + mejoras)
**Archivo:** `src/app/(public)/paises/[codigo]/page.tsx`
- [ ] Fix crítico: cambiar `countryId: country.id` por `countryCode: countryCode` en prisma.stamp.findMany
- [ ] Reemplazar placeholder `<MapPin>` por bandera real: `<img src={\`https://flagcdn.com/40x30/${countryCode.toLowerCase()}.png\`} />`
- [ ] Agregar link "Ver álbum de emisiones" → `/catalogo` (y en JS abrir el país directamente)
- [ ] Agregar link "Buscar en Biblioteca" → `/biblioteca?countryCode={code}`
- [ ] Mostrar nombre en español del país (ya viene del prisma.country.findFirst)

#### T5.5 Subastas `/subastas` (botón funcional)
**Archivo:** `src/app/(public)/subastas/page.tsx`
- [ ] Botón "Notificarme al lanzamiento": abrir modal con email input
- [ ] Submit → `POST /analytics/visit` con path `/subastas-notificacion` (o nueva tabla waitlist)
- [ ] Confirmar con mensaje de éxito visual

---

### ÉPICA 6 — SEO BÁSICO

#### T6.1 robots.txt
**Archivo nuevo:** `public/robots.txt`
```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /perfil
Sitemap: https://filateliaperuana.com/sitemap.xml
```

#### T6.2 Sitemap dinámico
**Archivo nuevo:** `src/app/sitemap.ts`
- [ ] Páginas estáticas con prioridad:
  - `/` priority 1.0
  - `/biblioteca`, `/catalogo` priority 0.9
  - `/identificar`, `/tienda`, `/subastas` priority 0.7
  - `/login`, `/registro` priority 0.5
- [ ] Países dinámicos: fetch a Worker `/countries` → generar `/paises/[code]` para 82
- [ ] `export const runtime = 'edge'` en el archivo
- [ ] No incluir los 47k sellos individuales (demasiado para el sitemap inicial)

#### T6.3 Open Graph básico
**Archivo:** `src/app/layout.tsx`
- [ ] Agregar en metadata:
  ```typescript
  openGraph: {
    siteName: 'Filatelia Peruana',
    type: 'website',
    locale: 'es_PE',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image' },
  ```
- [ ] Crear `/public/og-image.jpg` (imagen estática de 1200x630px para redes sociales)

---

### ÉPICA 7 — ERROR PAGES Y LOADING STATES

#### T7.1 Página 404
**Archivo nuevo:** `src/app/not-found.tsx`
- [ ] Estilo coherente con el sitio (fondo negro, verde musgo)
- [ ] Texto: "Este sello no está en la colección" + "Error 404"
- [ ] Botones: "Volver al Inicio" | "Buscar en Biblioteca"
- [ ] Ilustración: sello con X o sello dañado (SVG inline)

#### T7.2 Página error genérica
**Archivo nuevo:** `src/app/error.tsx`
- [ ] `"use client"` (required por Next.js)
- [ ] Mensaje de error genérico + botón "Recargar"

#### T7.3 Loading states de navegación
**Archivos nuevos:**
- [ ] `src/app/(public)/biblioteca/loading.tsx` → skeleton grid de 12 tarjetas
- [ ] `src/app/(public)/catalogo/loading.tsx` → skeleton grid de países
- [ ] `src/app/(admin)/admin/dashboard/loading.tsx` → skeleton de stat cards

---

### ÉPICA 8 — DEPLOY

#### T8.1 Verificar Worker API antes del build
- [ ] `curl https://filatelia-api.rodrigopianto2005.workers.dev/countries | jq '.countries | length'` → debe ser 82
- [ ] `curl https://filatelia-api.rodrigopianto2005.workers.dev/stamps?limit=1` → debe devolver datos
- [ ] Si hay nuevos endpoints (T4.8): `cd workers/filatelia-api && npx wrangler deploy`

#### T8.2 Build del frontend
```bash
cd filatelia-web
npm install          # regenerar lockfile tras limpiar deps
npm run build        # next build
npm run build:cf     # npx @cloudflare/next-on-pages
```
- [ ] Resolver cada error de build antes de continuar
- [ ] Verificar que `.vercel/output/static` se generó

#### T8.3 Deploy a Cloudflare Pages (rama master = producción)
```bash
npx wrangler pages deploy .vercel/output/static \
  --project-name=filatelia-web \
  --branch=master
```

#### T8.4 Smoke Test Post-Deploy

| Ruta | Verificar |
|---|---|
| `/` | Hero carga, contador de visitas muestra número real, links correctos |
| `/biblioteca` | Sellos se cargan, filtros funcionan, link a `/sello/[id]` funciona |
| `/catalogo` | Grid de países, clic en país muestra grupos, link a Biblioteca funciona |
| `/sello/[cualquier-id]` | Imagen, datos (WNS, denominación, año), breadcrumb → Biblioteca |
| `/paises/pe` | "Perú" con bandera, sellos listados (no vacío) |
| `/identificar` | Formulario de subida, error graceful si IA no lista |
| `/tienda` | Empty state elegante, sin crash |
| `/estadisticas` | Datos reales (47k sellos, 82 países, visitas) |
| `/colecciones` | Redirect 308 a `/catalogo` |
| `/catalogo/peru` | Redirect 308 a `/catalogo` |
| `/login` | Form, error con creds malas, redirect correcto por rol |
| `/registro` | Form, crea cuenta, redirect `/perfil` |
| `/perfil` | Redirige a `/login` si no hay sesión |
| `/perfil` (auth) | Muestra nombre, email, rol |
| `/admin/dashboard` | Redirige a `/login` si no auth |
| `/admin/dashboard` (admin) | Stats reales, sidebar con links funcionales |
| `/admin/sellos` | Tabla con sellos paginados, buscador, editar/eliminar |
| `/admin/usuarios` | Lista usuarios con roles |
| Navbar | Login muestra avatar si hay sesión, dropdown funciona |
| Footer | Links a Biblioteca, Catálogo, Estadísticas funcionan |

---

## 7. Orden de Implementación (Fases)

```
FASE A — Limpieza y base (esto primero, ~2h)
  T0.1 → @cloudflare/next-on-pages + scripts
  T0.2 → Limpiar deps muertas de package.json
  T0.3 → Borrar archivos muertos
  T0.4 → Redirects en next.config.ts
  T0.5 → Fix tienda (client, empty state)
  T0.6 → Fix estadisticas (client, Worker API)
  T0.7 → Fix identificar (URL Worker)
  T0.8 → Fix paises/[codigo] (bug countryCode)

FASE B — Navegación limpia (~1.5h)
  T1.1 → Navbar actualizada (Identificar + auth state)
  T1.2 → Fix home (botón registro, links tienda, contador real)
  T1.3 → Fix admin sidebar (quitar links rotos)
  T1.4 → Footer con link a estadísticas

FASE C — Auth completo (~1.5h)
  T2.1 → Página /perfil
  T2.2 → middleware.ts (proteger /admin y /perfil)
  T2.3 → Fix login redirect con ?from param

FASE D — Analytics (~0.5h)
  T3.1 → Endpoint /analytics/total en Worker
  T3.2 → AnalyticsTracker en layout.tsx

FASE E — Admin completo (~4h)
  T4.1 → Dashboard con datos reales
  T4.8 → Endpoints faltantes en Worker (hacer antes del resto)
  T4.2 → Admin Sellos
  T4.5 → Admin Usuarios
  T4.6 → Admin Analítica
  T4.3 → Admin Grupos
  T4.4 → Admin Catálogos
  T4.7 → Admin Importar (refactorizado)

FASE F — Páginas y SEO (~2h)
  T5.1 → Tienda empty state mejorada
  T5.5 → Subastas botón funcional
  T6.1 → robots.txt
  T6.2 → sitemap.ts
  T6.3 → OG tags en layout
  T7.1 → not-found.tsx
  T7.2 → error.tsx
  T7.3 → loading.tsx (biblioteca, catálogo, admin)

FASE G — Deploy (~1h)
  T8.1 → Verificar Worker API
  T8.2 → Build (npm install + build + build:cf)
  T8.3 → Deploy rama master
  T8.4 → Smoke test completo
```

---

## 8. Pendiente para Sprints Futuros (no bloquea launch)

### AI / Embeddings (pendiente hasta nuevo aviso)
- Script para generar embeddings de 47k sellos con Workers AI `@cf/baai/bge-base-en-v1.5`
- Upsert en Vectorize index `stamps-index`
- Una vez listo: `/identificar` funcionará automáticamente
- Búsqueda semántica en Biblioteca ("buscar por descripción")

### Tienda completa (Fase 2)
- Productos reales en D1: tabla `Product` con precio, stock, categoría
- Worker endpoints: `GET /products`, `GET /products/:id`
- Página producto: `/tienda/producto/[id]`
- Checkout básico (Stripe o MercadoPago)
- Gestión de órdenes en admin

### Imágenes en R2 (Fase 2)
- Script para mirror de imágenes WNS (wnsstamps.post → R2)
- Actualizar `imageUrl` en D1 con URLs de R2
- Thumbnails automáticos via Worker

### CF Turnstile en login/registro
- Protección anti-bot en formularios de auth
- Requiere cuenta CF y widget en el form

### SEO avanzado
- Metadata dinámica por página de sello (generateMetadata + fetch al Worker)
- JSON-LD Schema.org `Product` en páginas de sellos
- Sitemap de sellos individuales (sitemap index + sitemaps paginados)

### Temáticas en el Catálogo
- Tab "Por Temáticas" en `/catalogo`
- Seeds: Flora, Fauna, Deportes, Aviación, Navidad, Gatos, Ferrocarriles, Cruz Roja, Ajedrez, Faros, Historia Postal
- Filtro `theme` en el Worker `/stamps` endpoint

### Seguridad reforzada
- Rate limiting en auth (KV: 5 intentos / 15 min por IP)
- Security headers en Worker (X-Frame-Options, CSP, etc.)
- R2 signed URLs para imágenes premium

---

## 9. Taxonomía Filatélica (Referencia para seeds futuros)

### Estados de conservación
| Código | Nombre | Multiplicador precio |
|---|---|---|
| MNH | Mint Never Hinged | 1.0 |
| MH | Mint Hinged | 0.3–0.5 |
| NG | No Gum | 0.15–0.2 |
| USED | Usado | 0.2 |
| CTO | Cancelled to Order | 0.1–0.15 |
| FDC | First Day Cover | Variable |
| FLT | Con defectos | 0.05–0.1 |

### Sistemas de numeración (soportados)
Scott (EE.UU.) · Michel (Alemania) · Yvert & Tellier (Francia) · Stanley Gibbons (UK) · Facit (Escandinavia)

### Temáticas para seed futuro
Flora · Fauna · Deportes/JJOO · Aviación · Navidad · Gatos · Perros · Ajedrez · Ferrocarriles · Cruz Roja · Escultismo · Automóviles · Hongos · Faros · Historia Postal

### Estados de entidades
- Catálogos: `active`, `building`, `draft`, `inactive`
- Sellos / Grupos: `active`, `draft`, `archived`
- Productos: `active`, `draft`, `out_of_stock`, `archived`
- Usuarios: `active`, `suspended`, `pending_verification`
