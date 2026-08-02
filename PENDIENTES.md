# PENDIENTES.md — Plataforma del coleccionista

**Creado**: 2026-08-01
**Detalle y auditoría completa**: [`docs/superpowers/specs/2026-08-01-plataforma-coleccionista-plan.md`](docs/superpowers/specs/2026-08-01-plataforma-coleccionista-plan.md)

Checklist ejecutable. Marcar `[x]` al completar. El orden importa: E0 y E1 son bloqueantes.

```
E0 (seguridad) ─┬─> E1 (auth) ──> E4 (cuenta) ──> E5 (valoración) ──> E6 (IA)
                └─> E2 (scraper) ──> E3 (ficha)
```

---

## E0 — Cerrar vulnerabilidades 🔴 BLOQUEANTE

> El endpoint `/query` ejecuta SQL arbitrario contra la D1 de producción sin autenticación.
> Verificado en vivo. Nada de lo demás debe construirse antes de cerrar esto.

- [ ] **E0.1** Test: `POST /query` con `sql` y sin credenciales devuelve 401 — `workers/filatelia-api/test/`
- [ ] **E0.2** Exigir secreto de servicio en la rama SQL, o eliminarla y exponer endpoints tipados — `workers/filatelia-api/src/index.ts:543`
- [ ] **E0.3** Migrar el caller al endpoint tipado o al binding D1 directo — `filatelia-web/src/lib/db/collection.ts:17`
- [ ] **E0.4** Test: token inválido o Supabase caído ⇒ 401, nunca `demo-user-id`
- [ ] **E0.5** Quitar los dos fallbacks a `demo-user-id` — `workers/filatelia-api/src/index.ts:37-57`
- [ ] **E0.6** Rotar `JWT_SECRET` y `APP_SECRET` (tenían default hardcodeado en el código)
- [ ] **E0.7** Auditar la D1 en busca de escrituras anómalas antes de cerrar el hueco

## E1 — Una sola sesión 🔴 BLOQUEANTE

> Hoy el registro por email crea el usuario en el Worker pero **no autentica en la app Next**:
> cookies en dominios distintos, secretos distintos, payloads distintos. Solo funciona Google OAuth.

- [ ] **E1.1** Decidir dónde vive la sesión (recomendado: la app Next, ya tiene middleware y cookie httpOnly)
- [ ] **E1.2** Test: registro por email ⇒ cookie `fp_session` válida ⇒ `/perfil` accesible
- [ ] **E1.3** Implementar `POST /api/auth/register` en Next con verificación real de contraseña
- [ ] **E1.4** Reimplementar `POST /api/auth/login` con comparación timing-safe — `src/app/api/auth/login/route.ts` (hoy devuelve 501 a propósito)
- [ ] **E1.5** Reapuntar `src/lib/auth.ts:12,33` del Worker a las rutas Next
- [ ] **E1.6** Eliminar `localStorage` como almacén de sesión — `src/lib/auth.ts:20-22,41-42`
- [ ] **E1.7** Unificar el payload: el Worker emite `sub`, Next lee `id`
- [ ] **E1.8** Verificar que Google OAuth sigue funcionando tras el cambio

## E2 — Fase de detalle del scraper

> Está escrita en `parse_detail_page` pero **nunca se ejecutó**. Hay 14,396 sellos en cola,
> todos `pending`. Por eso las fichas de Colnect salen vacías.

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
