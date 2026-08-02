# PENDIENTES.md — Plataforma del coleccionista

**Creado**: 2026-08-01
**Detalle y auditoría completa**: [`docs/superpowers/specs/2026-08-01-plataforma-coleccionista-plan.md`](docs/superpowers/specs/2026-08-01-plataforma-coleccionista-plan.md)

Checklist ejecutable. Marcar `[x]` al completar. El orden importa: E0 y E1 son bloqueantes.

```
E0 (seguridad) ─┬─> E1 (auth) ──> E4 (cuenta) ──> E5 (valoración) ──> E6 (IA)
                └─> E2 (scraper) ──> E3 (ficha)
```

---

## E0 — Cerrar vulnerabilidades ✅ CERRADO (desplegado 2026-08-02)

- [x] **E0.1** Test: `POST /query` con `sql` y sin credenciales devuelve 401
- [x] **E0.2** La rama SQL se **eliminó** en vez de esconderla tras un secreto: un gateway de SQL con contraseña sigue siendo un gateway de SQL
- [x] **E0.3** El caller usa el binding D1 directo — `filatelia-web/src/lib/db/collection.ts`
- [x] **E0.4** Test: token inválido o Supabase caído ⇒ 401, nunca `demo-user-id`
- [x] **E0.5** Fallbacks a `demo-user-id` eliminados
- [~] **E0.6** `JWT_SECRET` ya no existe en el Worker desplegado. **`APP_SECRET` no se ha rotado** y sigue pendiente; ambos están en el historial de git, así que hay que darlos por filtrados
- [x] **E0.7** Auditoría forense de la D1: sin rastro de manipulación, coincide con el baseline

### Cerrado además, no estaba en el plan

Aparecieron auditando, todas verificadas en vivo antes y después:

- [x] `POST /import-stamp` **no tenía ninguna autenticación** — cualquiera escribía en la tabla `Stamp` de producción. El README lo llamaba "el endpoint seguro"
- [x] `POST /upload-image` sin auth: escritura arbitraria en un bucket R2 público **y** SSRF (el Worker traía la URL que le pasaras)
- [x] `POST /admin/seed-countries` sin auth pese al prefijo `/admin/`
- [x] `requireAdmin` daba admin a cualquier correo `@filateliaperuana.com` y a cualquier usuario si la tabla `User` tenía una sola fila
- [x] El proxy admin dejaba que `..` escapara del prefijo `/admin/`
- [x] `/analytics/visit` ejecutaba `CREATE TABLE` en cada visita e insertaba texto sin límite. Ahora 60 req/min por IP
- [x] `/api/bids` construía la identidad desde datos sin verificar

## E1 — Una sola sesión ✅ CERRADO (desplegado 2026-08-02)

> La app Next es la única autoridad de sesión: cookie `fp_session` httpOnly, HMAC con
> `APP_SECRET`, respaldada por D1. El Worker perdió sus rutas `/auth/*` y su JWT.
> El navegador no guarda ninguna credencial.

- [x] **E1.1** La sesión vive en la app Next
- [x] **E1.2** Test: registro por email ⇒ cookie válida ⇒ `/perfil` accesible
- [x] **E1.3** `POST /api/auth/register` con PBKDF2 real
- [x] **E1.4** `POST /api/auth/login` con comparación timing-safe
- [x] **E1.5** `src/lib/auth.ts` apunta a las rutas Next
- [x] **E1.6** `localStorage` eliminado como almacén de sesión
- [x] **E1.7** Payload unificado en `id`
- [x] **E1.8** Google OAuth verificado, y de paso cerrado un pre-hijacking de cuenta

Extras: sesión deslizante de 30 días con techo absoluto de 90; el rol de admin se
resuelve en D1 en cada petición en vez de confiar en la sesión, así que revocar
un admin surte efecto en la siguiente petición y no a los 30 días.

**Falta una sola cosa de E0+E1**: entrar a `/admin` desde un navegador con sesión real y
confirmar el flujo de punta a punta. Todas las capas están verificadas por separado.
Artefactos archivados en `openspec/changes/archive/2026-08-02-unified-session/`.

## E2 — Fase de detalle del scraper ⏸️ BLOQUEADO POR ANCHO DE BANDA

> Está escrita en `parse_detail_page` pero **nunca se ejecutó**. Hay 14,396 sellos en cola,
> todos `pending`. Por eso las fichas de Colnect salen vacías.
>
> **2026-08-02**: parado por falta de GB en el proxy, no por código. La VM peruana tampoco
> tiene el repo clonado todavía (sí tiene ya `ADMIN_API_TOKEN` en el entorno, que los
> scrapers ahora exigen para arrancar).

- [ ] **E2.1** Provisionar la VM peruana `100.75.97.61`: venv, pip, playwright, chromium (shell es `fish` → usar `bash -lc`)
- [ ] **E2.2** Desplegar scraper y cookies de Colnect en la VM
- [ ] **E2.3** Añadir a `parse_detail_page`: `size`, `format`, `emission`, `gum`, código Colnect — `scrapers/colnect_global_scraper_v3.py:448`
- [ ] **E2.4** Tests de parseo con HTML fijo (caso de oro: Mt Taranaki) — `scrapers/test_parse.py`
- [ ] **E2.5** Extraer y modelar **variantes** ("Click to see variants")
- [ ] **E2.6** Diagnosticar por qué el último lote persistió 0 de 3 en D1 — `send_batch_sync`
- [ ] **E2.7** Correr la fase de detalle sobre los 14,396 pendientes y verificar persistencia
- [ ] **E2.8** Reanudar la fase de listado (61,981 páginas pendientes) tras validar el detalle

## E3 — Ficha con paridad Colnect

> La UI ya renderiza casi todo. Solo faltan 4 campos y las variantes.

- [ ] **E3.1** Migración: `colnectCode`, `format`, `emission`, `gum` en `Stamp`
- [ ] **E3.2** Migración: tabla de variantes (`StampVariant` o autorreferencia)
- [ ] **E3.3** Exponer los campos nuevos en `GET /stamp/:id` — `workers/filatelia-api/src/index.ts:438`
- [ ] **E3.4** Renderizar campos nuevos + variantes — `src/app/(public)/sello/[id]/SelloDetailClient.tsx`
- [ ] **E3.5** Revisar `params.id` contra la versión de Next de este repo — `sello/[id]/page.tsx:6` (ver `AGENTS.md`)
- [ ] **E3.6** Enlazar tema, país y serie como navegación (Colnect los hace clicables)

## E4 — Cuenta del coleccionista

> `UserCollection` ya existe con collection/wishlist/trade y grados MNH/MH/Used/FDC.
> Falta `ignore`, falta cantidad, y falta conectar la UI.

- [ ] **E4.1** Migración: añadir `ignore` a `list_type` + columna `quantity`
- [ ] **E4.2** Actualizar validaciones — `src/lib/db/collection.ts`, `src/types/collection.ts`, `src/app/api/collection/route.ts`
- [ ] **E4.3** **Conectar el botón muerto** "+ Añadir a Mi Colección" (no tiene `onClick`) — `SelloDetailClient.tsx:273`
- [ ] **E4.4** Widget de 4 estados (collection / wish / swap / ignore) en la ficha, como Colnect
- [ ] **E4.5** Crear la página `/colecciones` — hoy `src/app/(public)/colecciones/` es un **directorio vacío que da 404**
- [ ] **E4.6** Reemplazar los pedidos mock hardcodeados — `src/app/perfil/PerfilClient.tsx:19-49`
- [ ] **E4.7** Tests de integración del flujo completo de listas contra D1 real

## E5 — Valoración de colección

> ⚠️ Bloqueada por la pregunta abierta #1. `conditionMintUsd`, `conditionUsedUsd`,
> `marketPriceUsd` y `rarityScore` existen en el schema pero están **sin poblar**.

- [ ] **E5.1** Decidir la fuente del precio de mercado ← **decisión pendiente, ver abajo**
- [ ] **E5.2** Migración: tabla `PriceHistory` (está en los `.sql` viejos, no en producción)
- [ ] **E5.3** Poblar `conditionMintUsd` / `conditionUsedUsd` desde la fuente elegida
- [ ] **E5.4** Multiplicadores por condición: MNH / MH / Used / FDC — `src/lib/valuation.ts`
- [ ] **E5.5** Cálculo: valor = Σ (precio × multiplicador × cantidad)
- [ ] **E5.6** Mostrar valor total e histórico en `/perfil`
- [ ] **E5.7** Etiquetar el valor como **estimación**, con su fuente y fecha

## E6 — IA de calificación de condición

> ⚠️ Bloqueada por la pregunta abierta #2. La IA actual identifica *qué* sello es
> (`/api/identify` → `/query`), no *en qué estado* está. Eso no existe.

- [ ] **E6.1** Definir la escala de grados (¿Colnect? ¿PSE? ¿propia?) ← **decisión pendiente**
- [ ] **E6.2** Reunir un set de imágenes etiquetadas para evaluar
- [ ] **E6.3** Endpoint `POST /grade-condition` con visión sobre la foto del usuario
- [ ] **E6.4** Devolver grado + **confianza** + defectos (centrado, dientes, adelgazamientos)
- [ ] **E6.5** Guardar el grado sugerido en `UserCollection`, separado del que declaró el usuario
- [ ] **E6.6** UI: subir foto desde tu item y ver el grado sugerido
- [ ] **E6.7** Evaluar exactitud contra el set etiquetado **antes** de mostrar cifras a usuarios

## E7 — Sets y lotes ⏸️ DIFERIDO A PROPÓSITO

No se diseña todavía. "No sé cómo les gusta a los filatélicos" es la razón exacta para no
construirlo: un modelo de lotes basado en intuición sin validar es la forma más cara de
descubrir que nadie lo usa. Se define observando usuarios reales o preguntándole a un filatélico.

---

## Decisiones pendientes (bloquean E5 y E6)

- [ ] **1. ¿De dónde sale el precio de mercado?** La pregunta más importante del plan. Sin fuente
  real, "el valor de tu colección" es un número inventado y erosiona la confianza. Opciones:
  ventas cerradas de eBay, catálogo comercial licenciado, o precios de la propia comunidad.
  Cada una con coste legal y técnico distinto.
- [ ] **2. ¿Qué escala de condición?** Determina el diseño completo de E6.
- [ ] **3. ¿Los términos de Colnect permiten este uso?** Riesgo legal a evaluar antes de escalar
  de 36k a 500k sellos scrapeados.

---

## Contexto rápido

**Producción** (D1 `filatelia-db`, verificado 2026-08-01): 147,555 sellos —
wns 108,947 / colnect 36,596 / excel-import 1,940 / wikidata 66.
`User` = 1 fila. `UserCollection` = 0 filas. **`sizeMm` está NULL en los 147,555.**

**VM peruana**: `ssh rodrigo@100.75.97.61` (password auth). Piura, PE, Claro.
Ubuntu, 4 vCPU, 15 GB RAM. Shell `fish`. Sin pip, sin playwright, sin chromium todavía.
