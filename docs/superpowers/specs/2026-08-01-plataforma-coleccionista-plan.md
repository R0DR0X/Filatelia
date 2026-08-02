# Plan — Plataforma del coleccionista (paridad Colnect + cuentas + valoración + IA)

**Fecha**: 2026-08-01
**Estado**: propuesta, pendiente de aprobación
**Alcance**: ficha de sello con paridad Colnect, cuentas y listas, valoración de colección, IA de condición

---

## Parte 1 — Auditoría: qué existe hoy, archivo por archivo

Todo lo de abajo está verificado contra el código y contra la D1 de producción
(`filatelia-db`, `a06f77b8-6826-4594-8bee-48018e637e01`) el 2026-08-01.

### 1.1 Datos en producción

| Fuente | Sellos | Con año | Con imagen | Con tema | Con perforación | Con descripción | Con tamaño | Con técnica |
|---|---|---|---|---|---|---|---|---|
| wns | 108,947 | 108,947 | 108,946 | 1,000 | 108,911 | 1,000 | **0** | 4,343 |
| colnect | 36,596 | 16,750 | 34,116 | 31,843 | **0** | 15,931 | **0** | **0** |
| excel-import | 1,940 | 1,940 | **0** | 1,940 | 1,832 | **0** | **0** | 1,929 |
| wikidata | 66 | 24 | 43 | 0 | 0 | 0 | **0** | 0 |
| **Total** | **147,555** | | | | | | | |

Otras tablas: `User` = **1 usuario**, `UserCollection` = **0 filas**, `Country` = 111, `StampGroup` = 4,359.
19 tablas en total; `UserCollection`, `Auction` y `Bid` sí están aplicadas en producción.

Lecturas clave:
- **`sizeMm` está vacío en los 147,555 sellos.** Ningún scraper lo extrae.
- Colnect no tiene **ni una** perforación ni técnica de impresión: son campos que solo
  aparecen en la ficha de detalle, y la fase de detalle nunca corrió.
- La cuenta y las listas **nunca se han usado end-to-end en producción** (0 items).

### 1.2 Catálogo y ficha del sello

| Archivo | Estado |
|---|---|
| `workers/filatelia-api/schema.sql:68` — tabla `Stamp` | Completa salvo 4 campos Colnect: `colnectCode`, `format`, `emission`, `gum`. Sin relación de variantes. |
| `workers/filatelia-api/src/index.ts:438` — `GET /stamp/:id` | Funciona; devuelve la fila completa + join de grupo y país. |
| `workers/filatelia-api/src/index.ts:474` — `GET /stamps` | Funciona; paginado y filtro por `source`. |
| `src/app/(public)/sello/[id]/page.tsx` | 8 líneas. Usa `params.id` de forma síncrona — revisar contra la versión de Next de este repo (ver `AGENTS.md`). |
| `src/app/(public)/sello/[id]/SelloDetailClient.tsx` | 294 líneas. **Ya renderiza** números de catálogo, año, descripción, bloque técnico (color, perforación, tirada, diseñador, impresor) y tema. La UI no es el cuello de botella. |
| `SelloDetailClient.tsx:273` — botón "+ Añadir a Mi Colección" | **Muerto**: sin `onClick`, sin handler, sin estado. Es decoración. |

### 1.3 Scraper

| Archivo | Estado |
|---|---|
| `scrapers/colnect_global_scraper_v3.py:333` — `parse_listing_page` | Funciona. Extrae id, nombre, año, denominación, imagen, códigos de catálogo, serie. |
| `scrapers/colnect_global_scraper_v3.py:448` — `parse_detail_page` | **Escrito pero nunca ejecutado.** Mapea colors, themes, perforation, printing, paper, description. **No mapea**: size, format, emission, gum, código Colnect, variantes. |
| `colnect_v3_progress.db` — `listing_pages` | 2,481 hechas / 61,981 pendientes (~4%). |
| `colnect_v3_progress.db` — `stamp_queue` | 14,396 filas, **todas `pending`, cero procesadas**. |
| `colnect_v3.log` (25-jul) | Último run murió: watchdog, todos los workers colgados, lote D1 con 0 de 3 persistidos. |
| VM peruana `100.75.97.61` | Confirmada (Piura, PE, Claro). Shell `fish`. **Sin pip, sin playwright, sin chromium.** Cruda. |

### 1.4 Cuentas y sesión — aquí está el problema serio

Hay **dos sistemas de autenticación que no se hablan**:

| Sistema | Dónde | Cookie | Secreto | Payload |
|---|---|---|---|---|
| Worker | `workers/filatelia-api/src/index.ts:1110-1197` | dominio `*.workers.dev` | `JWT_SECRET` | `{sub, email, name, role}` |
| App Next | `src/lib/session.ts`, `src/middleware.ts` | `fp_session` en el dominio de la app | `APP_SECRET` | `{id, ...}` |

Consecuencia concreta, siguiendo el flujo real:

1. `src/app/registro/page.tsx:24` llama a `register()` de `src/lib/auth.ts:31`.
2. `src/lib/auth.ts:33` hace `fetch` **directo al Worker** `/auth/register`.
3. El Worker crea el usuario y pone su cookie **en el dominio del Worker**.
4. El navegador vuelve a la app Next, que busca `fp_session` **en su propio dominio**. No existe.
5. `src/middleware.ts` protege `/perfil` → **rebota a `/login`**.

**El registro por email/contraseña está roto de punta a punta.** Solo funciona Google OAuth.
Y `src/app/api/auth/login/route.ts:15` devuelve 501 a propósito — se desactivó por una
vulnerabilidad previa, pero los formularios de `/login` y `/registro` siguen ahí, visibles y muertos.

Además, `src/lib/auth.ts` guarda el token en `localStorage`, mientras el resto de la app usa
cookie httpOnly. Dos modelos de sesión conviviendo.

### 1.5 Listas del coleccionista

| Archivo | Estado |
|---|---|
| `db/migrations/0006_user_collections.sql` | Tabla `UserCollection` con `list_type` ∈ (collection, wishlist, trade), `condition` ∈ (MNH, MH, Used, FDC), `notes`, índices y UNIQUE. Aplicada en producción. |
| `src/lib/db/collection.ts` | CRUD completo, validación de list_type y condition, upsert por (user, stamp, list). Sólido. |
| `src/app/api/collection/route.ts` | GET/POST/PUT/DELETE, todos con sesión obligatoria. Correcto. |
| `src/components/collection/CollectionTabs.tsx` | 227 líneas, montado en `/perfil`. |
| `src/components/collection/QuickAddButtons.tsx` | 97 líneas, montado en `/catalogo`. |
| `src/app/(public)/colecciones/` | **Directorio vacío.** La ruta `/colecciones` da 404. Nadie la enlaza. |
| `src/app/perfil/PerfilClient.tsx` | 514 líneas. Colección real vía API, pero **los pedidos son mock hardcodeado** (`totalAmount: 185.00`, sellos de Perú inventados en las líneas 19-49). |
| Faltantes vs Colnect | No existe la lista **`ignore`**. No existen **favoritos** separados de wishlist. No existe **cantidad** por item (un coleccionista tiene 3 del mismo). |

### 1.6 Valoración

No existe. `Stamp` tiene `conditionMintUsd`, `conditionUsedUsd`, `marketPriceUsd`,
`marketPriceUpdatedAt` y `rarityScore` — **las cinco columnas están sin poblar**.
No hay tabla `PriceHistory` en producción. No hay ningún cálculo de valor de colección
en ningún archivo.

### 1.7 IA

| Archivo | Estado |
|---|---|
| `src/app/api/identify/route.ts` | 74 líneas. Proxy a `POST /query` del Worker. Funciona. |
| `workers/filatelia-api/src/index.ts:537` — `/query` | Búsqueda semántica por imagen o texto con Vectorize. |
| `src/lib/match-engine.ts` | 71 líneas, motor de match para intercambios. |
| Calificación de condición | **No existe nada.** La IA actual identifica *qué* sello es, no *en qué estado* está. |

### 1.8 Dos vulnerabilidades críticas encontradas durante la auditoría

**V1 — Gateway SQL público sin autenticación.**
`workers/filatelia-api/src/index.ts:543-550`: si el body trae `sql`, el Worker ejecuta
**SQL arbitrario** contra la D1 de producción. No hay middleware de auth delante.
Verificado en vivo: un `POST` anónimo devolvió resultados de `sqlite_master`.
Cualquiera en internet puede leer `User.password` o hacer `DROP TABLE`.

**V2 — Fallback a usuario demo.**
`workers/filatelia-api/src/index.ts:37-57`: `getAuthenticatedUser` devuelve
`{id: "demo-user-id"}` si el token mide menos de 20 caracteres **o si la verificación
contra Supabase falla por cualquier motivo** (red caída, clave mal configurada).
Un fallo de infraestructura se convierte en un login concedido.

Estas dos bloquean todo lo demás. No tiene sentido construir "tu colección privada"
sobre una base donde cualquiera puede leer y escribir la base de datos entera.

---

## Parte 2 — Plan por épicas

Orden por dependencia, no por atractivo. E0 y E1 son bloqueantes.

### E0 — Cerrar las vulnerabilidades (bloqueante)

| # | Mini-tarea | Archivo |
|---|---|---|
| E0.1 | Escribir test que pruebe que `POST /query` con `sql` y sin credenciales devuelve 401 | `workers/filatelia-api/test/` |
| E0.2 | Exigir un secreto de servicio en la rama SQL de `/query`, o eliminarla y exponer endpoints tipados | `src/index.ts:543` |
| E0.3 | Migrar `src/lib/db/collection.ts` al endpoint tipado o al binding D1 directo | `src/lib/db/collection.ts:17` |
| E0.4 | Test: token inválido o Supabase caído ⇒ 401, nunca `demo-user-id` | `workers/filatelia-api/test/` |
| E0.5 | Quitar los dos fallbacks a `demo-user-id` | `src/index.ts:37-57` |
| E0.6 | Rotar `JWT_SECRET` y `APP_SECRET` (estuvieron expuestos con default hardcodeado) | secrets de Cloudflare |
| E0.7 | Auditar la D1 en busca de escrituras anómalas antes de cerrar | consulta D1 |

### E1 — Una sola sesión (bloqueante para todo lo de cuenta)

| # | Mini-tarea | Archivo |
|---|---|---|
| E1.1 | Decidir dónde vive la sesión: la app Next (recomendado, ya tiene middleware y cookie httpOnly) | decisión |
| E1.2 | Test: registro por email ⇒ cookie `fp_session` válida ⇒ `/perfil` accesible | test de integración |
| E1.3 | Implementar `POST /api/auth/register` en Next, con verificación de contraseña real | `src/app/api/auth/login/route.ts` (hoy 501) |
| E1.4 | Reimplementar `POST /api/auth/login` con comparación timing-safe | ídem |
| E1.5 | Reapuntar `src/lib/auth.ts` del Worker a las rutas Next | `src/lib/auth.ts:12,33` |
| E1.6 | Eliminar `localStorage` como almacén de sesión; la cookie httpOnly es la única fuente | `src/lib/auth.ts:20-22,41-42` |
| E1.7 | Unificar el payload: el Worker emite `sub`, Next lee `id` | `session.ts` / `index.ts` |
| E1.8 | Verificar que Google OAuth sigue funcionando tras el cambio | manual + test |

### E2 — Fase de detalle del scraper

| # | Mini-tarea | Archivo |
|---|---|---|
| E2.1 | Provisionar la VM: venv, pip, playwright, chromium (recordar `bash -lc`, el shell es fish) | VM `100.75.97.61` |
| E2.2 | Desplegar el scraper y las cookies de Colnect en la VM | `scrapers/` |
| E2.3 | Añadir a `parse_detail_page`: `size`, `format`, `emission`, `gum`, código Colnect | `colnect_global_scraper_v3.py:448` |
| E2.4 | Tests de parseo con un HTML fijo de Colnect (usar Mt Taranaki como caso de oro) | `scrapers/test_parse.py` |
| E2.5 | Extraer y modelar **variantes** (el "Click to see variants" de Colnect) | scraper + schema |
| E2.6 | Correr la fase de detalle sobre los 14,396 pendientes; verificar persistencia en D1 | VM |
| E2.7 | Reanudar la fase de listado (61,981 páginas pendientes) tras validar el detalle | VM |
| E2.8 | Diagnosticar por qué el lote de 3 persistió 0 en D1 antes de escalar | `send_batch_sync` |

### E3 — Ficha con paridad Colnect

| # | Mini-tarea | Archivo |
|---|---|---|
| E3.1 | Migración: `colnectCode`, `format`, `emission`, `gum` en `Stamp` | nueva migración |
| E3.2 | Migración: tabla de variantes (`StampVariant` o autorreferencia) | nueva migración |
| E3.3 | Exponer los campos nuevos en `GET /stamp/:id` | `index.ts:438` |
| E3.4 | Renderizar los campos nuevos + variantes en la ficha | `SelloDetailClient.tsx` |
| E3.5 | Revisar `params.id` contra la versión de Next de este repo | `sello/[id]/page.tsx:6` |
| E3.6 | Enlazar tema, país y serie como navegación (Colnect los hace clicables) | `SelloDetailClient.tsx` |

### E4 — Cuenta del coleccionista

| # | Mini-tarea | Archivo |
|---|---|---|
| E4.1 | Migración: añadir `ignore` a `list_type`, y columna `quantity` | nueva migración |
| E4.2 | Actualizar validaciones de lista y cantidad | `collection.ts`, `types/collection.ts`, `api/collection/route.ts` |
| E4.3 | **Conectar el botón muerto** de la ficha a `/api/collection` | `SelloDetailClient.tsx:273` |
| E4.4 | Widget de 4 estados (collection / wish / swap / ignore) en la ficha, como Colnect | `components/collection/` |
| E4.5 | Crear la página `/colecciones` (hoy es un directorio vacío que da 404) | `(public)/colecciones/` |
| E4.6 | Reemplazar los pedidos mock de `/perfil` por datos reales | `PerfilClient.tsx:19-49` |
| E4.7 | Tests de integración de todo el flujo de listas contra D1 real | test |

### E5 — Valoración de colección

| # | Mini-tarea | Archivo |
|---|---|---|
| E5.1 | Definir de dónde sale el precio (fuente de mercado real, no inventado) | **decisión pendiente — ver preguntas abiertas** |
| E5.2 | Migración: tabla `PriceHistory` (existe en los .sql viejos, no en producción) | nueva migración |
| E5.3 | Poblar `conditionMintUsd` / `conditionUsedUsd` desde la fuente elegida | job |
| E5.4 | Multiplicadores por condición: MNH / MH / Used / FDC | `lib/valuation.ts` |
| E5.5 | Cálculo del valor de la colección = Σ (precio × multiplicador × cantidad) | `lib/valuation.ts` |
| E5.6 | Mostrar valor total e histórico en `/perfil` | `PerfilClient.tsx` |
| E5.7 | Etiquetar el valor como **estimación** en la UI, con su fuente y fecha | UI |

### E6 — IA de calificación de condición

| # | Mini-tarea | Archivo |
|---|---|---|
| E6.1 | Definir la escala de grados (¿Colnect? ¿PSE? ¿propia?) | decisión |
| E6.2 | Reunir un set de imágenes etiquetadas para evaluar | datos |
| E6.3 | Endpoint `POST /grade-condition` con visión sobre la foto del usuario | `workers/filatelia-api` |
| E6.4 | Devolver grado + **confianza** + defectos detectados (centrado, dientes, adelgazamientos) | worker |
| E6.5 | Guardar el grado sugerido en `UserCollection`, separado del que declaró el usuario | migración |
| E6.6 | UI: subir foto desde la ficha de tu item, ver el grado sugerido | UI |
| E6.7 | Evaluar exactitud contra el set etiquetado antes de mostrar cifras a usuarios | evaluación |

### E7 — Sets y lotes: **diferido, a propósito**

Dijiste "no sé cómo les gusta a los filatélicos". Esa honestidad es la razón para no
diseñar esto todavía. Un modelo de lotes construido sobre una intuición sin validar es
la forma más cara de descubrir que nadie lo usa. Se define observando usuarios reales
—o preguntándole a un filatélico— no en este documento.

---

## Preguntas abiertas (bloquean E5 y E6)

1. **¿De dónde sale el precio de mercado?** Es la pregunta más importante del plan.
   Sin una fuente real, la "estimación del valor de tu colección" es un número inventado
   que erosiona la confianza del usuario. Opciones: ventas cerradas de eBay, catálogo
   comercial licenciado, o precios de la propia comunidad. Cada una tiene coste legal
   y técnico distinto.
2. **¿Qué escala de condición?** Determina el diseño de E6 completo.
3. **¿Colnect permite este uso de sus datos?** Riesgo legal a evaluar antes de escalar
   de 36k a 500k sellos scrapeados.

---

## Ruta crítica

```
E0 (seguridad) ─┬─> E1 (auth) ──> E4 (cuenta) ──> E5 (valoración) ──> E6 (IA)
                └─> E2 (scraper) ──> E3 (ficha)
```

E2/E3 y E1/E4 pueden avanzar en paralelo una vez cerrado E0.
