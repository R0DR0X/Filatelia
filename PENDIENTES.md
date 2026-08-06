# PENDIENTES.md — Plataforma del coleccionista

**Creado**: 2026-08-01
**Detalle y auditoría completa**: [`docs/superpowers/specs/2026-08-01-plataforma-coleccionista-plan.md`](docs/superpowers/specs/2026-08-01-plataforma-coleccionista-plan.md)

Checklist ejecutable. Marcar `[x]` al completar. El orden importa: E0 y E1 son bloqueantes.

```
E0 (seguridad) ─┬─> E1 (auth) ──> E4 (cuenta) ──> E5 (valoración) ──> E6 (IA)
                └─> E2 (scraper) ──> E3 (ficha)
```

---

## Estado al 2026-08-06

**En producción y funcionando**: E0, E1, E3 y E4. Las migraciones 0009-0015
están aplicadas en D1. Worker y Pages desplegados.

**No queda desarrollo pendiente.** Al 2026-08-06: `APP_SECRET` rotado, VM de Piura
provisionada, `/admin` revisado y con sus siete secciones enlazadas, Colnect habilitó
el acceso, y se sigue con DataImpulse.

Lo que falta para volver a subir sellos es **operación, y son cuatro cosas concretas**
—ver "Estado real de E2.7 / E2.8" más abajo—: recuperar el checkpoint `.db` que vive
en otra máquina, poner las credenciales del proxy y de Colnect en el entorno, cargar
saldo, y **pedirle a Colnect que ponga la IP de la VM en lista blanca** para no tener
que pelear con su anti-bot ahora que dieron permiso.

**E5 (valoración) y E6 (IA de condición) NO bloquean subir sellos.** Están
esperando decisiones de producto tuyas, no código. Se pueden dejar quietas
indefinidamente sin que nada se rompa.

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
- [x] **E2.3** `parse_detail_page` ya extrae `size` (→ `sizeMm`), `format`, `emission`, `gum` y el código Colnect
- [x] **E2.4** Tests de parseo con HTML fijo (caso de oro: Mt Taranaki) — `scrapers/test_parse.py`, 11 tests.
  El archivo con ese nombre **no era un test**: era un script que abría un navegador real contra Colnect
  gastando proxy. Se conservó como `scrapers/debug_detail_page.py`
- [x] **E2.5** Variantes extraídas por `_parse_variants` y modeladas en `StampVariant`
- [x] **E2.6** **Diagnosticado y corregido.** No era `send_batch_sync`. `importStampHandler` hace
  `ON CONFLICT(sourceUrl)` y `Stamp.sourceUrl` **nunca tuvo índice único**, así que SQLite rechaza
  la sentencia *al parsearla*. Como los sellos de Colnect no traen `wnsNumber`, todos caen en esa
  rama: el lote persiste 0 de N. Reproducido en `test/stamp-detail-schema.test.mjs`; lo arregla la
  migración 0013. **Correr la fase de detalle antes de aplicar 0013 es quemar GB de proxy a cambio de nada.**
- [ ] **E2.7** Correr la fase de detalle sobre los 14,396 pendientes y verificar persistencia
- [ ] **E2.8** Reanudar la fase de listado (61,981 páginas pendientes) tras validar el detalle

## E3 — Ficha con paridad Colnect ✅ CÓDIGO LISTO, FALTA DESPLEGAR

> Escrito y probado. Las migraciones 0012 y 0013 **no están aplicadas en producción**
> (esta sesión no tenía `CLOUDFLARE_API_TOKEN`). Ver `scripts/ops/e3-rollout.sh`.
>
> La ficha degrada campo por campo: los cuatro campos nuevos están NULL en los 147,555
> sellos hasta que corra la fase de detalle, y un campo NULL no se renderiza en vez de
> mostrar una etiqueta vacía. Cuando el scraper corra, las fichas se llenan sin otro deploy.

- [x] **E3.1** Migración 0012: `colnectCode`, `format`, `emission`, `gum` en `Stamp`
- [x] **E3.2** Migración 0012: tabla `StampVariant` (tabla hija, no autorreferencia — una
  autorreferencia habría metido cada variante en `/stamps` y en la búsqueda como si fuera un sello más)
- [x] **E3.3** `GET /stamp/:id` devuelve los campos nuevos y `variants`
- [x] **E3.4** Ficha renderiza specs, variantes y los 5 códigos de catálogo — `SelloDetailClient.tsx`
- [x] **E3.5** Revisado: `params` es `Promise` en Next 16.2.4 y `page.tsx` ya lo espera bien. Nada que cambiar
- [x] **E3.6** Tema, país y serie clicables. **Ojo con lo que apareció acá**: el link de país ya existía
  pero `BibliotecaClient` **nunca leía los search params**, así que navegaba y mostraba el catálogo sin
  filtrar — un link muerto que parecía vivo. Arreglado, más los filtros `theme` y `groupId` en el Worker

## E4 — Cuenta del coleccionista ✅ CÓDIGO EN MASTER, FALTA DESPLEGAR

> Estaba terminado en `feat/e4-collector-account` y sin mergear. Mergeado a master.
> Migraciones 0009/0010/0011 **sin aplicar en producción** — ver `scripts/ops/e4-rollout.sh`,
> y el orden ahí **sí importa**: si desplegás Pages antes de 0009 rompés toda escritura a
> `/api/collection`, incluido el flujo que ya está vivo hoy.

- [x] **E4.1** Migración 0009: `ignore` en `list_type` + columna `quantity`
- [x] **E4.2** Validaciones unificadas en una sola fuente de verdad
- [x] **E4.3** Botón muerto conectado
- [x] **E4.4** Widget de 4 estados (collection / wish / swap / ignore) en la ficha
- [x] **E4.5** Página `/colecciones` creada — era el 404
- [x] **E4.6** Pedidos reales en D1 (`Order` / `OrderItem`), sin mocks
- [x] **E4.7** Tests del flujo de listas

## E5 — Valoración de colección ⏸️ NO BLOQUEA NADA

> ⚠️ Bloqueada por la pregunta abierta #1. `conditionMintUsd`, `conditionUsedUsd`,
> `marketPriceUsd` y `rarityScore` existen en el schema pero están **sin poblar**.

- [ ] **E5.1** Decidir la fuente del precio de mercado ← **decisión pendiente, ver abajo**
- [ ] **E5.2** Migración: tabla `PriceHistory` (está en los `.sql` viejos, no en producción)
- [ ] **E5.3** Poblar `conditionMintUsd` / `conditionUsedUsd` desde la fuente elegida
- [ ] **E5.4** Multiplicadores por condición: MNH / MH / Used / FDC — `src/lib/valuation.ts`
- [ ] **E5.5** Cálculo: valor = Σ (precio × multiplicador × cantidad)
- [ ] **E5.6** Mostrar valor total e histórico en `/perfil`
- [ ] **E5.7** Etiquetar el valor como **estimación**, con su fuente y fecha

## E6 — IA de calificación de condición ⏸️ NO BLOQUEA NADA

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

## Para poder dedicarte solo a subir sellos

Todo lo demás está hecho. Esto es lo que queda, en orden.

### Técnico — lo hace un dev

- [x] **T1. `APP_SECRET` rotado** por Rodrigo, 2026-08-06. El valor viejo estaba en el
  historial de git y hay que seguir dándolo por filtrado, pero ya no sirve para nada.
  Verificado en producción después de rotar: el secreto está presente en Pages, y una
  cookie `fp_session` falsificada devuelve **401, no 500** — o sea la verificación HMAC
  corre y rechaza. `/api/auth/me` sin cookie da 401, `/login` da 200, `/admin` redirige.
  *No verificado*: que un login real genere sesión válida, porque no tengo credenciales
  de usuario. Eso se comprueba entrando una vez.
- [x] **T2. VM peruana provisionada** (E2.1 + E2.2), 2026-08-06. `scrapers/venv` con
  todo lo de `scrapers/requirements.txt`, y Chromium de Playwright verificado
  arrancando y saliendo a la red. El repo ya estaba clonado — la nota vieja que decía
  lo contrario estaba desactualizada. `ADMIN_API_TOKEN` está en el entorno.
  ```
  scrapers/venv/bin/python -m pytest scrapers/test_parse.py    # 18 passed
  ```
- [x] **T3. `/admin` revisado**, 2026-08-06. El flujo entra y funciona. Apareció otra
  cosa: el menú lateral listaba **2 secciones de 7**. Sellos, Catálogos, Grupos,
  Usuarios y Analítica estaban implementadas y solo se llegaba tecleando la URL.
  Ya están enlazadas.
- [~] **T3b. La cola del scraper se mira por terminal, y así se queda.** Decisión de
  Rodrigo (2026-08-06): no se construye pantalla de admin para los 14,396 pendientes.
  Con un solo operador, un `ssh` y un `tail` hacen el trabajo y no hay que mantenerlos.
  Reabrir esto solo si alguien más termina operando el scraper.

### No técnico — depende de vos

- [x] **T4. Se sigue con DataImpulse.** Decisión de Rodrigo (2026-08-06): si hay que
  pagarlo, se paga. El scraper usa el proxy **por defecto** y sigue exigiendo las tres
  variables `DATAIMPULSE_*` al arrancar.
  `USE_PROXY=0` corre directo, sin proxy y sin exigir credenciales. Sirve para trabajar
  el parser en local, probar un puñado de páginas, o seguir crawleando el día que se
  acabe el saldo en vez de que todo se detenga. Es viable porque la VM ya sale por
  `179.7.15.36`, `AS12252 América Móvil Perú` (Claro), residencial, en Piura —
  verificado desde la máquina. Lo que el proxy agrega sobre eso es **rotación de IP**,
  y eso es lo que vale la pena pagar a volumen: un crawl largo desde una sola dirección
  puede terminar con esa dirección bloqueada, y en directo esa dirección es la conexión
  real de Claro, no una alquilada.
- [x] **T5. Términos de Colnect: habilitan el acceso.** Confirmado por Rodrigo,
  hablado directamente con ellos (2026-08-06). Decisión #3 cerrada.

Las fichas se llenan solas a medida que entran los datos: el esquema, el Worker y la
UI ya están desplegados esperándolos. **No hace falta otro deploy.**

### Estado real de E2.7 / E2.8, auditado en la VM el 2026-08-06

No se pueden correr todavía. Tres bloqueos, verificados en la máquina:

1. **La cola no existe en esta VM.** `colnect_v3_progress.db` no está. Ahí viven las
   dos tablas del checkpoint: `listing_pages` (las 61,981 páginas) y `stamp_queue`
   (los 14,396 sellos). Sin ese archivo, la fase de detalle abre una base nueva,
   encuentra 0 pendientes y no hace nada. **Los 14,396 están en otra máquina** —
   probablemente la de Colab, por `colnect_colab_progress.json`. Hay que recuperar
   ese `.db` o volver a construir la cola.
2. **Eso invierte el orden.** `stamp_queue` la llena la fase de listado. En esta
   máquina, sin el `.db` recuperado, **E2.8 va antes que E2.7**, no al revés.
3. **Faltan credenciales**: `DATAIMPULSE_HOST/USER/PASS` y `COLNECT_USER/PASS` no
   están en el entorno. `ADMIN_API_TOKEN` sí. El proxy es obligatorio por defecto,
   así que sin las tres de DataImpulse el scraper ni arranca.

Y un hallazgo aparte, que importa más que los tres:

4. **Colnect está detrás de Anubis.** Una petición directa desde la IP de la VM
   devuelve **HTTP 485 con cuerpo vacío** — un desafío anti-bot, no la página. Las
   cookies guardadas son del 23 de julio. Este repo ya carga con herramientas para
   pelear contra eso (`vm_solve_anubis.py`, `test_anubis_bypass.py`,
   `temp_anubis_bypass.html`), o sea que es una pelea vieja.

   **Ahora que Colnect dio permiso explícito, esa pelea no hay que darla: hay que
   pedir que la eviten.** Lo que corresponde pedirles es que pongan la IP de la VM
   (`179.7.15.36`) en lista blanca, o una cuenta habilitada para acceso automatizado.
   Mantener un solucionador de proof-of-work contra un sitio que te autorizó es
   gastar trabajo y ancho de banda en un problema que ellos apagan con un click —
   y que se vuelve a encender cada vez que cambien el desafío.

---

## Decisiones pendientes (bloquean E5 y E6)

- [ ] **1. ¿De dónde sale el precio de mercado?** La pregunta más importante del plan. Sin fuente
  real, "el valor de tu colección" es un número inventado y erosiona la confianza. Opciones:
  ventas cerradas de eBay, catálogo comercial licenciado, o precios de la propia comunidad.
  Cada una con coste legal y técnico distinto.
- [ ] **2. ¿Qué escala de condición?** Determina el diseño completo de E6.
- [x] **3. ¿Los términos de Colnect permiten este uso?** **Sí.** Rodrigo lo habló
  directamente con Colnect y habilitan el acceso (2026-08-06). Esto no solo desbloquea
  escalar: si hay permiso explícito, vale la pena preguntarles si tienen API o export
  de datos. Scrapear es la peor forma de obtener datos que alguien te daría igual.

### Alcance de E5 y E6, definido 2026-08-06

Ambas son **por suscriptor, sobre los sellos de su propia colección** — no una
valoración global del catálogo. Es decir: el valor que se calcula es el de *tu*
colección (Σ precio × multiplicador de condición × cantidad, sobre tus filas de
`UserCollection`), y el grado por IA se aplica a *la foto de tu ejemplar*, no al
sello del catálogo. Eso ya está bien encaminado en el esquema: `UserCollection`
tiene `quantity` y `condition` por usuario, y E6.5 guarda el grado sugerido
separado del declarado. Lo que sigue faltando para E5 es de dónde sale el precio
(decisión #1) y para E6 qué escala se usa (decisión #2).

---

## Contexto rápido

**Producción** (D1 `filatelia-db`, verificado 2026-08-01): 147,555 sellos —
wns 108,947 / colnect 36,596 / excel-import 1,940 / wikidata 66.
`User` = 1 fila. `UserCollection` = 0 filas. **`sizeMm` está NULL en los 147,555**
porque el parser nunca lo extrajo; la columna siempre existió (ya corregido, E2.3).

**Migraciones pendientes de aplicar en producción**: 0009, 0010, 0011 (E4) y
0012, 0013 (E3). Ninguna se aplicó todavía. Los dos scripts de rollout corren
en seco por defecto y solo escriben con `--apply`:

```
bash scripts/ops/e4-rollout.sh      # E4 — el orden importa, leer la cabecera
bash scripts/ops/e3-rollout.sh      # E3 + el fix E2.6
```

El de E3 cuenta primero los `sourceUrl` duplicados y **se niega** a crear el
índice único mientras haya alguno: si los hay, significa que el importador
venía tratando filas distintas como el mismo sello, y eso hay que mirarlo
antes de borrar nada.

**VM peruana**: `ssh rodrigo@100.75.97.61` (password auth). Piura, PE, Claro.
Ubuntu, 4 vCPU, 15 GB RAM. Shell `fish`. Sin pip, sin playwright, sin chromium todavía.
