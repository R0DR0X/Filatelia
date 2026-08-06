# Filatelia — Cierre de deuda: seguridad, subastas, imágenes y scraper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la deuda que queda en producción: dos vulnerabilidades activas, un módulo de subastas que finge estar vivo, un catálogo de imágenes que depende de servidores ajenos, y un scraper que no puede resembrar su cola.

**Architecture:** Cinco fases independientes. Cada una se puede desplegar sola y deja el sistema en un estado mejor que el anterior; ninguna depende de que otra termine. El orden propuesto va por riesgo, no por tamaño: primero lo que ya está siendo explotable, después lo que puede romperse solo, y al final lo que solo cuesta trabajo.

**Tech Stack:** Next.js 16.2.4 (App Router, runtime `edge`) sobre Cloudflare Pages · Cloudflare Workers + Hono · D1 (SQLite) · R2 · Vectorize · Python 3.14 + Playwright para los scrapers · vitest en `filatelia-web/`, `node:test` + `sql.js` en la raíz, `pytest` en `scrapers/`.

## Global Constraints

- **Nunca un secreto con valor por defecto.** Si falta la variable de entorno, el código falla cerrado (500/401), nunca cae a un literal. Esta es la regla que E0 estableció y que este plan termina de aplicar.
- **Nunca un fallback silencioso a datos inventados.** Si la fuente real no está disponible, se devuelve error; no se sirve un mock. Es la lección de E4.6 (pedidos) y de esta ronda (subastas).
- **El binding D1 es la única vía de acceso a datos.** El gateway `POST /query` fue eliminado en E0 y no vuelve. Sin binding, se lanza error — ver el `runQuery` de `src/lib/db/collection.ts`.
- **Migraciones = artefactos revisables.** Se commitean; aplicarlas a producción es un paso operativo aparte, con script de rollout que corre en seco por defecto y solo escribe con `--apply`.
- **Idioma:** código, identificadores, comentarios, mensajes de commit y nombres de test en inglés. Copy de UI en español.
- **Commits convencionales, sin atribución a IA.**
- **TDD:** test que falla primero, mínima implementación, test en verde, commit.

## Estado verificado al 2026-08-06

Todo lo de abajo fue comprobado en el código y contra producción, no inferido de los documentos de plan.

| Hallazgo | Evidencia |
| --- | --- |
| `/api/auctions/settle` acepta secretos hardcodeados | `SETTLEMENT_KEY \|\| "filatelia_settlement_secret_2026"` y `ADMIN_TOKEN \|\| "admin"` en el código; **ninguna de las dos variables existe** en `wrangler pages secret list` (solo hay `ADMIN_API_TOKEN`, `APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) |
| El endpoint está vivo | `POST /api/auctions/settle` con clave incorrecta → 401 |
| Subastas en memoria | `src/lib/db/auctions.ts:109` — `let auctionsStore: Auction[] = [...INITIAL_AUCTIONS]` |
| Producción sirve datos inventados | `GET /api/auctions` devuelve `auc-01`, "Perú 1857 1d Azul" |
| Imágenes hotlinked | `GET /stamps` devuelve `imageUrl` en `www.wnsstamps.post` y Colnect |
| Credenciales en git | `web/tienda filatelica.txt`, rastreado desde `223a457` |
| Cola del scraper ausente | `colnect_v3_progress.db` no existe en la VM |

---

## File Structure

**Fase 0 — Seguridad**
- Modificar: `filatelia-web/src/app/api/auctions/settle/route.ts` — quitar los literales de fallback.
- Modificar: `filatelia-web/src/lib/db/auctions.ts:241-263` — misma corrección en `settleExpiredAuctions`.
- Crear: `filatelia-web/src/lib/settlementAuth.ts` — única fuente de verdad de la autorización de liquidación, testeable sin red.
- Crear: `filatelia-web/test/settlement-auth.test.ts`.
- Eliminar: `web/tienda filatelica.txt`.
- Crear: `docs/ops/2026-08-06-credenciales-filtradas.md` — qué se filtró y qué hay que rotar.

**Fase 1 — Subastas sobre D1**
- Crear: `filatelia-web/db/migrations/0016_create_auction_tables.sql` — la versión aplicable, consolidando las dos copias huérfanas.
- Modificar: `filatelia-web/src/lib/db/auctions.ts` — reemplazar los stores por D1.
- Crear: `filatelia-web/test/db-auctions.test.ts` — con D1 falso, patrón de `test/db-orders.test.ts`.
- Crear: `scripts/ops/auctions-rollout.sh`.
- Eliminar: `db/migrations/0004_auctions_bids.sql`, `migrations/0005_create_auctions_and_bids.sql`.

**Fase 2 — Imágenes a R2** (sin cambios en el Worker: `/admin/upload-image` ya sirve)
- Crear: `scrapers/mirror_images_to_r2.py` — descarga en la VM y sube bytes en base64.
- Crear: `scrapers/test_mirror_images.py`.
- Crear: `scripts/ops/images-r2-rollout.sh` — aplica el ledger a `Stamp.imageUrl`.

**Fase 3 — Vectorize**
- Crear: `scripts/ops/vectorize-status.sh` — responde si el índice tiene vectores antes de decidir nada.

**Fase 4 — Scraper**
- Ya escrito (commit `7cbbcef`): `GET /admin/detail-queue` + `scrapers/seed_crawler_queue.py`. Falta desplegar y correr.

---

## FASE 0 — Seguridad (hacer primero, no depende de nada)

### Task 1: Cerrar el bypass de autorización en la liquidación de subastas

**Files:**
- Create: `filatelia-web/src/lib/settlementAuth.ts`
- Create: `filatelia-web/test/settlement-auth.test.ts`
- Modify: `filatelia-web/src/app/api/auctions/settle/route.ts`
- Modify: `filatelia-web/src/lib/db/auctions.ts:241-247`

**Interfaces:**
- Produces: `isSettlementAuthorized(headers: {settlementKey?: string | null; authorization?: string | null}, env: {SETTLEMENT_KEY?: string}): {ok: true} | {ok: false; reason: "misconfigured" | "unauthorized"}`
- Consumes: nada.

**Por qué importa.** Hoy la ruta arma su clave así:

```ts
const validKey = process.env.SETTLEMENT_KEY || "filatelia_settlement_secret_2026";
const adminToken = process.env.ADMIN_TOKEN || "admin";
```

Ninguna de las dos variables está configurada en Pages, así que **los literales están activos**, y están en el historial de git. Cualquiera que lea el repo puede liquidar subastas. Además `settleExpiredAuctions` solo valida `if (settlementKeyHeader && ...)`, o sea que llamarla **sin** cabecera saltea la comprobación por completo.

- [ ] **Step 1: Write the failing test**

```ts
// filatelia-web/test/settlement-auth.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { isSettlementAuthorized } from "../src/lib/settlementAuth";

test("with no SETTLEMENT_KEY configured, nothing is authorized", () => {
  // The old code fell back to a literal here, so an unconfigured deployment
  // was wide open to anyone who had read the repository.
  const r = isSettlementAuthorized({ settlementKey: "filatelia_settlement_secret_2026" }, {});
  assert.deepStrictEqual(r, { ok: false, reason: "misconfigured" });
});

test("an absent header does not skip the check", () => {
  // settleExpiredAuctions only validated `if (header && ...)`, so calling it
  // with no header at all passed straight through.
  assert.deepStrictEqual(
    isSettlementAuthorized({}, { SETTLEMENT_KEY: "s3cret" }),
    { ok: false, reason: "unauthorized" },
  );
});

test("the configured key authorizes", () => {
  assert.deepStrictEqual(
    isSettlementAuthorized({ settlementKey: "s3cret" }, { SETTLEMENT_KEY: "s3cret" }),
    { ok: true },
  );
});

test("a wrong key does not authorize", () => {
  assert.deepStrictEqual(
    isSettlementAuthorized({ settlementKey: "nope" }, { SETTLEMENT_KEY: "s3cret" }),
    { ok: false, reason: "unauthorized" },
  );
});

test("the removed Bearer admin path is gone", () => {
  assert.deepStrictEqual(
    isSettlementAuthorized({ authorization: "Bearer admin" }, { SETTLEMENT_KEY: "s3cret" }),
    { ok: false, reason: "unauthorized" },
  );
});

test("an empty configured key is treated as unconfigured", () => {
  assert.deepStrictEqual(
    isSettlementAuthorized({ settlementKey: "" }, { SETTLEMENT_KEY: "" }),
    { ok: false, reason: "misconfigured" },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd filatelia-web && ./node_modules/.bin/vitest run test/settlement-auth.test.ts
```
Expected: FAIL — `Cannot find module '../src/lib/settlementAuth'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// filatelia-web/src/lib/settlementAuth.ts
/**
 * Authorization for the auction settlement trigger.
 *
 * Extracted because the previous inline version had two defects that are only
 * visible when the rules are read together: it fell back to the literals
 * "filatelia_settlement_secret_2026" and "admin" when the environment was
 * unset (and it IS unset in production, so those literals were live), and the
 * downstream check ran only `if (header && ...)`, so omitting the header
 * skipped it entirely.
 *
 * Fails closed: an unconfigured deployment authorizes nobody.
 */
export type SettlementAuthResult =
  | { ok: true }
  | { ok: false; reason: "misconfigured" | "unauthorized" };

export function isSettlementAuthorized(
  headers: { settlementKey?: string | null; authorization?: string | null },
  env: { SETTLEMENT_KEY?: string }
): SettlementAuthResult {
  const configured = (env.SETTLEMENT_KEY || "").trim();
  // No key configured means the trigger is not enabled, not that everyone may
  // fire it.
  if (configured === "") return { ok: false, reason: "misconfigured" };

  const presented = (headers.settlementKey || "").trim();
  if (presented === "") return { ok: false, reason: "unauthorized" };

  return presented === configured ? { ok: true } : { ok: false, reason: "unauthorized" };
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd filatelia-web && ./node_modules/.bin/vitest run test/settlement-auth.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the route to it**

Reemplazar el bloque de autorización de `src/app/api/auctions/settle/route.ts` por:

```ts
import { isSettlementAuthorized } from "@/lib/settlementAuth";

// ...dentro de POST:
const auth = isSettlementAuthorized(
  {
    settlementKey: request.headers.get("x-settlement-key"),
    authorization: request.headers.get("authorization"),
  },
  { SETTLEMENT_KEY: (process.env as any).SETTLEMENT_KEY }
);

if (!auth.ok) {
  // 503 rather than 401 when unconfigured: the caller's credential is not the
  // problem, the deployment is, and answering 401 would send an operator
  // hunting for a wrong key that does not exist.
  const status = auth.reason === "misconfigured" ? 503 : 401;
  return NextResponse.json(
    { success: false, error: "Unauthorized settlement trigger", code: "UNAUTHORIZED_SETTLEMENT" },
    { status }
  );
}

const result = await settleExpiredAuctions();
```

Y en `src/lib/db/auctions.ts`, borrar la comprobación interna y el parámetro:

```ts
// La ruta es la única que autoriza. Dejar una segunda comprobación con su
// propio literal por defecto fue justamente lo que creó el bypass.
export async function settleExpiredAuctions(): Promise<{ settledCount: number; settledIds: string[] }> {
```

- [ ] **Step 6: Run the whole suite**

```
cd filatelia-web && ./node_modules/.bin/vitest run
```
Expected: PASS. Si `test/auction-settlement.test.mjs` (raíz) pasaba la clave vieja, actualizarlo.

- [ ] **Step 7: Commit**

```bash
git add filatelia-web/src/lib/settlementAuth.ts filatelia-web/test/settlement-auth.test.ts \
        filatelia-web/src/app/api/auctions/settle/route.ts filatelia-web/src/lib/db/auctions.ts
git commit -m "fix(auctions): stop accepting hardcoded settlement credentials"
```

- [ ] **Step 8: Operador — configurar el secreto ANTES de desplegar**

```bash
cd filatelia-web && npx wrangler pages secret put SETTLEMENT_KEY
```
Sin esto, tras el deploy la liquidación responde 503. Eso es correcto y preferible al estado actual, pero conviene no descubrirlo en producción.

---

### Task 2: Purgar y rotar las credenciales filtradas

**Files:**
- Delete: `web/tienda filatelica.txt`
- Create: `docs/ops/2026-08-06-credenciales-filtradas.md`

**Por qué importa.** El archivo está rastreado en git desde `223a457` y contiene el usuario y contraseña de la base MySQL de la tienda vieja, y el **login de administrador de WordPress**. Borrarlo no lo saca del historial: quien tenga un clon, lo tiene.

- [ ] **Step 1: Escribir el registro de la fuga**

```markdown
<!-- docs/ops/2026-08-06-credenciales-filtradas.md -->
# Credenciales filtradas en el repositorio

**Detectado:** 2026-08-06
**Archivo:** `web/tienda filatelica.txt` — rastreado desde el commit `223a457`

## Qué se filtró
- Base MySQL de la tienda WordPress anterior: nombre de base, usuario y contraseña.
- Cuenta de **administrador** de ese WordPress: usuario y contraseña.

## Estado
- [ ] Contraseña de la base MySQL rotada
- [ ] Contraseña del administrador de WordPress rotada
- [ ] Verificado que ese WordPress no expone datos de clientes de la tienda actual

## Por qué borrar el archivo no alcanza
Sigue en el historial de git y el repositorio tiene remoto en GitHub. Cualquier
clon anterior a esta fecha conserva los valores. La única mitigación real es
rotar. Reescribir el historial (`git filter-repo`) se evaluó y se descarta:
reescribe todos los hashes, rompe cualquier clon existente, y **no recupera**
los valores ya expuestos — rotar es igual de necesario con o sin reescritura.

## Si esa tienda ya no se usa
Darla de baja es mejor que rotar: una instalación de WordPress sin mantener es
una superficie de ataque permanente, con credenciales rotadas o sin ellas.
```

- [ ] **Step 2: Borrar el archivo y commitear**

```bash
git rm 'web/tienda filatelica.txt'
git add docs/ops/2026-08-06-credenciales-filtradas.md
git commit -m "docs(ops): record the leaked store credentials and remove the file"
```

- [ ] **Step 3: Operador — rotar**

Rotar la contraseña de MySQL y la del administrador de WordPress, o dar de baja la instalación. Marcar las casillas del documento al terminar.

---

## FASE 1 — Subastas sobre D1

### Task 3: Consolidar las migraciones huérfanas de subastas

**Files:**
- Create: `filatelia-web/db/migrations/0016_create_auction_tables.sql`
- Delete: `db/migrations/0004_auctions_bids.sql`, `migrations/0005_create_auctions_and_bids.sql`

**Por qué importa.** Existen dos copias del esquema de subastas, en dos carpetas distintas, **y difieren entre sí**. Ninguna de las dos está en `filatelia-web/db/migrations/`, que es la secuencia que los scripts de rollout aplican de verdad. Por eso las tablas no existen en producción pese a estar "creadas" hace meses.

- [ ] **Step 1: Escribir la migración**

```sql
-- D1 Migration v16: create the Auction and Bid tables for real.
--
-- WHY THIS IS A NEW FILE AND NOT A MOVE. The schema already existed twice —
-- db/migrations/0004_auctions_bids.sql and
-- migrations/0005_create_auctions_and_bids.sql — in two directories, with
-- differences between them, and neither in filatelia-web/db/migrations, which
-- is the sequence the rollout scripts actually apply. That is why the tables
-- do not exist in production despite having been "created" months ago. Both
-- copies are deleted in the same commit so there is one place to look.
--
-- Column names stay snake_case to match what src/lib/db/auctions.ts already
-- maps, and the CHECK constraints are kept: test/auction-d1-constraints.test.mjs
-- asserts them, and the API validates the same values independently.
--
-- NOT EXECUTED BY THIS CHANGE. See scripts/ops/auctions-rollout.sh.

CREATE TABLE IF NOT EXISTS Auction (
  id TEXT PRIMARY KEY,
  stamp_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  starting_price REAL NOT NULL,
  min_increment REAL NOT NULL DEFAULT 5.0,
  current_highest_bid REAL NOT NULL,
  current_highest_bidder_id TEXT,
  current_highest_bidder_name TEXT,
  total_bids INTEGER NOT NULL DEFAULT 0,
  start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Bid (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES Auction(id) ON DELETE CASCADE,
  bidder_id TEXT NOT NULL,
  bidder_name TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'outbid', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auction_status ON Auction(status);
CREATE INDEX IF NOT EXISTS idx_auction_end_time ON Auction(end_time);
CREATE INDEX IF NOT EXISTS idx_bid_auction_id ON Bid(auction_id);
CREATE INDEX IF NOT EXISTS idx_bid_bidder_id ON Bid(bidder_id);
```

- [ ] **Step 2: Verificar que el esquema es válido y que las CHECK muerden**

```bash
cd /home/rodrigo/Documentos/trabajos/filatelia
node --test test/auction-d1-constraints.test.mjs
```
Actualizar en ese test la ruta del `.sql` a `filatelia-web/db/migrations/0016_create_auction_tables.sql`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git rm db/migrations/0004_auctions_bids.sql migrations/0005_create_auctions_and_bids.sql
git add filatelia-web/db/migrations/0016_create_auction_tables.sql test/auction-d1-constraints.test.mjs
git commit -m "feat(auctions): put the auction schema in the migration sequence that runs"
```

---

### Task 4: Mover lecturas de subastas a D1

**Files:**
- Modify: `filatelia-web/src/lib/db/auctions.ts`
- Create: `filatelia-web/test/db-auctions.test.ts`

**Interfaces:**
- Produces: `getAuctions(status?: string, sortBy?: string): Promise<Auction[]>` y `getAuctionById(id: string): Promise<AuctionWithDetails | null>` — mismas firmas que hoy, distinta fuente.
- Consumes: la tabla `Auction` de Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// filatelia-web/test/db-auctions.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { getAuctions } from "../src/lib/db/auctions";

// Same convention as test/db-orders.test.ts: process.env string-coerces
// assigned values, so the whole object has to be replaced.
function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}
afterEach(clearMockD1);

const ROWS = [
  { id: "a1", stamp_id: "s1", title: "Perú 1857", description: null, image_url: null,
    starting_price: 100, min_increment: 5, current_highest_bid: 120,
    current_highest_bidder_id: "u1", current_highest_bidder_name: "Ana", total_bids: 2,
    start_time: "2026-08-01T00:00:00Z", end_time: "2999-01-01T00:00:00Z",
    status: "active", created_at: "", updated_at: "" },
];

function mockD1(rows: any[]) {
  return {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }),
  };
}

describe("getAuctions", () => {
  it("reads from D1, not from an in-memory seed", async () => {
    setMockD1(mockD1(ROWS));
    const res = await getAuctions();
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a1");
    expect(res[0].currentHighestBid).toBe(120);
  });

  it("returns nothing when the table is empty instead of inventing auctions", async () => {
    // The old implementation shipped INITIAL_AUCTIONS, so production served
    // "auc-01 — Perú 1857 1d Azul" to every visitor. An empty table must read
    // as an empty marketplace.
    setMockD1(mockD1([]));
    expect(await getAuctions()).toEqual([]);
  });

  it("fails loudly without the D1 binding rather than falling back", async () => {
    clearMockD1();
    await expect(getAuctions()).rejects.toThrow(/D1 binding/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd filatelia-web && ./node_modules/.bin/vitest run test/db-auctions.test.ts
```
Expected: FAIL — devuelve las subastas sembradas, y no lanza sin binding.

- [ ] **Step 3: Write minimal implementation**

En `src/lib/db/auctions.ts`, borrar `INITIAL_AUCTIONS`, `INITIAL_BIDS`, `auctionsStore`, `bidsStore` y `resetAuctionsStore`, y agregar:

```ts
// D1-backed access for the Auction/Bid tables (migration 0016). Same shape and
// same reasoning as src/lib/db/collection.ts: there is no network fallback,
// because the /query gateway was removed in E0.
const runQuery = async (sql: string, params: any[] = []): Promise<any[]> => {
  const d1 = (process.env as any).DB;
  if (!d1 || typeof d1.prepare !== "function") {
    throw new Error(
      "D1 binding 'DB' is unavailable in this environment. Run this code where " +
      "the D1 binding is attached (e.g. `wrangler pages dev`)."
    );
  }
  const res = await d1.prepare(sql).bind(...params).all();
  return res.results || [];
};

function rowToAuction(r: any): Auction {
  return {
    id: r.id,
    stampId: r.stamp_id,
    title: r.title,
    description: r.description ?? undefined,
    imageUrl: r.image_url ?? undefined,
    startingPrice: r.starting_price,
    minIncrement: r.min_increment,
    currentHighestBid: r.current_highest_bid,
    currentHighestBidderId: r.current_highest_bidder_id ?? undefined,
    currentHighestBidderName: r.current_highest_bidder_name ?? undefined,
    totalBids: r.total_bids,
    startTime: r.start_time,
    endTime: r.end_time,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getAuctions(status?: string, sortBy?: string): Promise<Auction[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (status && status !== "all") { where.push("status = ?"); params.push(status); }

  // Expiry is derived in the query rather than mutated on read. The old code
  // flipped rows to "ended" as a side effect of listing them, which meant a
  // page view wrote state.
  const order =
    sortBy === "ending_soon" ? "end_time ASC"
    : sortBy === "highest_bid" ? "current_highest_bid DESC"
    : "created_at DESC";

  const rows = await runQuery(
    `SELECT * FROM Auction ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}`,
    params
  );
  return rows.map(rowToAuction);
}
```

Reescribir `getAuctionById` con el mismo patrón, agregando las pujas:

```ts
export async function getAuctionById(id: string): Promise<AuctionWithDetails | null> {
  const rows = await runQuery(`SELECT * FROM Auction WHERE id = ?`, [id]);
  if (rows.length === 0) return null;
  const bids = await runQuery(
    `SELECT * FROM Bid WHERE auction_id = ? ORDER BY created_at DESC`, [id]
  );
  return {
    ...rowToAuction(rows[0]),
    bids: bids.map((b: any) => ({
      id: b.id, auctionId: b.auction_id, bidderId: b.bidder_id,
      bidderName: b.bidder_name, amount: b.amount, status: b.status,
      createdAt: b.created_at,
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd filatelia-web && ./node_modules/.bin/vitest run test/db-auctions.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add filatelia-web/src/lib/db/auctions.ts filatelia-web/test/db-auctions.test.ts
git commit -m "feat(auctions): read auctions from D1 instead of an in-memory seed"
```

---

### Task 5: Convertir la puja en una escritura atómica real

**Files:**
- Modify: `filatelia-web/src/lib/db/auctions.ts` — `placeBid`
- Modify: `filatelia-web/test/db-auctions.test.ts`

**Interfaces:**
- Produces: `placeBid(auctionId, bidderId, bidderName, amount, expectedCurrentHighestBid?)` — misma firma y mismos `code` de error que hoy (`AUCTION_NOT_FOUND`, `AUCTION_EXPIRED`, `BID_TOO_LOW`, `CONCURRENT_BID_CONFLICT`), porque `src/app/api/bids/route.ts` los mapea a códigos HTTP.

**Por qué importa.** El control de concurrencia actual lee, compara en memoria y después escribe. Entre la lectura y la escritura entra otra puja. En memoria eso ya era una carrera; sobre D1 se resuelve de verdad con un `UPDATE` condicional que hace la comparación y la escritura en una sola sentencia.

- [ ] **Step 1: Write the failing test**

```ts
// añadir a filatelia-web/test/db-auctions.test.ts
import { placeBid } from "../src/lib/db/auctions";

/** D1 fake that reports how many rows an UPDATE changed. */
function mockD1Write(rows: any[], changes: number, seen: string[] = []) {
  return {
    prepare: (sql: string) => ({
      bind: (...p: any[]) => ({
        all: async () => ({ results: rows }),
        run: async () => { seen.push(sql.replace(/\s+/g, " ").trim()); return { meta: { changes } }; },
      }),
    }),
    batch: async () => [{ meta: { changes } }],
  };
}

describe("placeBid", () => {
  it("rejects a bid below the minimum increment", async () => {
    setMockD1(mockD1Write(ROWS, 1));
    const r = await placeBid("a1", "u2", "Beto", 121);
    expect(r.success).toBe(false);
    expect(r.code).toBe("BID_TOO_LOW");
  });

  it("rejects a bid on an auction that already ended", async () => {
    setMockD1(mockD1Write([{ ...ROWS[0], end_time: "2000-01-01T00:00:00Z" }], 1));
    const r = await placeBid("a1", "u2", "Beto", 500);
    expect(r.code).toBe("AUCTION_EXPIRED");
  });

  it("reports a conflict when the conditional update changes no row", async () => {
    // Zero rows changed means another bid landed between the read and the
    // write. That is the whole point of doing the comparison inside the UPDATE.
    setMockD1(mockD1Write(ROWS, 0));
    const r = await placeBid("a1", "u2", "Beto", 130, 120);
    expect(r.success).toBe(false);
    expect(r.code).toBe("CONCURRENT_BID_CONFLICT");
  });

  it("guards the update with the expected highest bid", async () => {
    const seen: string[] = [];
    setMockD1(mockD1Write(ROWS, 1, seen));
    const r = await placeBid("a1", "u2", "Beto", 130, 120);
    expect(r.success).toBe(true);
    const update = seen.find((s) => s.startsWith("UPDATE Auction"));
    expect(update).toContain("current_highest_bid = ?");
    expect(update).toContain("WHERE id = ?");
    // Without these the UPDATE would overwrite a newer bid.
    expect(update).toContain("status = 'active'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd filatelia-web && ./node_modules/.bin/vitest run test/db-auctions.test.ts
```
Expected: FAIL — la implementación aún toca `auctionsStore`.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function placeBid(
  auctionId: string,
  bidderId: string,
  bidderName: string,
  amount: number,
  expectedCurrentHighestBid?: number
): Promise<{ success: boolean; bid?: Bid; updatedAuction?: Auction; error?: string; code?: string }> {
  const roundedAmount = Math.round(amount * 100) / 100;

  const rows = await runQuery(`SELECT * FROM Auction WHERE id = ?`, [auctionId]);
  if (rows.length === 0) {
    return { success: false, error: "Subasta no encontrada", code: "AUCTION_NOT_FOUND" };
  }
  const auction = rowToAuction(rows[0]);
  const nowIso = new Date().toISOString();

  if (auction.status !== "active" || auction.endTime <= nowIso) {
    return { success: false, error: "La subasta ha finalizado", code: "AUCTION_EXPIRED" };
  }

  const minRequired = auction.currentHighestBid > 0
    ? Math.round((auction.currentHighestBid + auction.minIncrement) * 100) / 100
    : Math.round(auction.startingPrice * 100) / 100;

  if (roundedAmount < minRequired) {
    return {
      success: false,
      error: `La oferta mínima permitida es S/. ${minRequired.toFixed(2)}`,
      code: "BID_TOO_LOW",
    };
  }

  const guard = expectedCurrentHighestBid !== undefined
    ? expectedCurrentHighestBid
    : auction.currentHighestBid;

  const d1 = (process.env as any).DB;
  // The comparison lives INSIDE the UPDATE. A read-then-write cannot be made
  // safe by checking harder before writing: another bid fits in the gap. If
  // this changes zero rows, someone else got there first.
  const upd = await d1.prepare(`
    UPDATE Auction
       SET current_highest_bid = ?,
           current_highest_bidder_id = ?,
           current_highest_bidder_name = ?,
           total_bids = total_bids + 1,
           updated_at = datetime('now')
     WHERE id = ?
       AND current_highest_bid = ?
       AND status = 'active'
       AND end_time > datetime('now')
  `).bind(roundedAmount, bidderId, bidderName, auctionId, guard).run();

  if (!upd?.meta?.changes) {
    return {
      success: false,
      error: "Conflicto de concurrencia: Otro coleccionista realizó una puja superior hace un instante",
      code: "CONCURRENT_BID_CONFLICT",
    };
  }

  const bidId = `bid-${crypto.randomUUID()}`;
  await d1.batch([
    d1.prepare(`UPDATE Bid SET status = 'outbid' WHERE auction_id = ? AND status = 'accepted'`)
      .bind(auctionId),
    d1.prepare(`
      INSERT INTO Bid (id, auction_id, bidder_id, bidder_name, amount, status)
      VALUES (?, ?, ?, ?, ?, 'accepted')
    `).bind(bidId, auctionId, bidderId, bidderName, roundedAmount),
  ]);

  return {
    success: true,
    bid: {
      id: bidId, auctionId, bidderId, bidderName,
      amount: roundedAmount, status: "accepted", createdAt: nowIso,
    },
    updatedAuction: {
      ...auction,
      currentHighestBid: roundedAmount,
      currentHighestBidderId: bidderId,
      currentHighestBidderName: bidderName,
      totalBids: auction.totalBids + 1,
      updatedAt: nowIso,
    },
  };
}
```

- [ ] **Step 4: Run tests**

```
cd filatelia-web && ./node_modules/.bin/vitest run
cd .. && node --test test/auction-occ-concurrency.test.mjs test/auction-bid-calc.test.mjs
```
Expected: PASS. Adaptar los tests de la raíz que asumían el store en memoria.

- [ ] **Step 5: Commit**

```bash
git add filatelia-web/src/lib/db/auctions.ts filatelia-web/test/db-auctions.test.ts test/
git commit -m "fix(auctions): make a bid an atomic conditional update instead of a race"
```

---

### Task 6: Liquidación y pujas del usuario sobre D1

**Files:**
- Modify: `filatelia-web/src/lib/db/auctions.ts` — `settleExpiredAuctions`, `getUserBids`
- Modify: `filatelia-web/test/db-auctions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// añadir a filatelia-web/test/db-auctions.test.ts
import { settleExpiredAuctions, getUserBids } from "../src/lib/db/auctions";

describe("settleExpiredAuctions", () => {
  it("closes only auctions whose end time has passed", async () => {
    const seen: string[] = [];
    setMockD1(mockD1Write([{ id: "a-old" }], 1, seen));
    const r = await settleExpiredAuctions();
    expect(r.settledIds).toEqual(["a-old"]);
    const upd = seen.find((s) => s.startsWith("UPDATE Auction"));
    expect(upd).toContain("status = 'ended'");
    expect(upd).toContain("end_time <=");
  });
});

describe("getUserBids", () => {
  it("returns only that bidder's rows", async () => {
    setMockD1(mockD1Write([{ id: "b1", auction_id: "a1", bidder_id: "u1",
      bidder_name: "Ana", amount: 120, status: "accepted", created_at: "" }], 1));
    const r = await getUserBids("u1");
    expect(r).toHaveLength(1);
    expect(r[0].bidderId).toBe("u1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```
cd filatelia-web && ./node_modules/.bin/vitest run test/db-auctions.test.ts
```

- [ ] **Step 3: Implement**

```ts
export async function settleExpiredAuctions(): Promise<{ settledCount: number; settledIds: string[] }> {
  const expired = await runQuery(
    `SELECT id FROM Auction WHERE status = 'active' AND end_time <= datetime('now')`
  );
  if (expired.length === 0) return { settledCount: 0, settledIds: [] };

  const d1 = (process.env as any).DB;
  await d1.prepare(
    `UPDATE Auction SET status = 'ended', updated_at = datetime('now')
      WHERE status = 'active' AND end_time <= datetime('now')`
  ).bind().run();

  const settledIds = expired.map((r: any) => r.id);
  return { settledCount: settledIds.length, settledIds };
}

export async function getUserBids(userId: string): Promise<Bid[]> {
  const rows = await runQuery(
    `SELECT * FROM Bid WHERE bidder_id = ? ORDER BY created_at DESC`, [userId]
  );
  return rows.map((b: any) => ({
    id: b.id, auctionId: b.auction_id, bidderId: b.bidder_id,
    bidderName: b.bidder_name, amount: b.amount, status: b.status, createdAt: b.created_at,
  }));
}
```

- [ ] **Step 4: Run the full suite**

```
cd filatelia-web && ./node_modules/.bin/vitest run && cd .. && npm test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add filatelia-web/src/lib/db/auctions.ts filatelia-web/test/db-auctions.test.ts
git commit -m "feat(auctions): settle and list bids from D1"
```

---

### Task 7: Rollout de subastas

**Files:**
- Create: `scripts/ops/auctions-rollout.sh`

- [ ] **Step 1: Escribir el script**

Copiar la estructura de `scripts/ops/e3-rollout.sh` (dry-run por defecto, `d1_query` que detecta el sobre de error de wrangler, `--apply` para escribir) y reemplazar las comprobaciones por:

```bash
step "Phase 1 — read-only preflight"
tables=$(d1_query "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('Auction','Bid');") || die_on_d1
if [[ "$(scalar "$tables")" == "2" ]]; then ok "Auction and Bid exist."; TABLES=yes; else
  bad "Auction/Bid missing (found $(scalar "$tables") of 2)."
  info "Until 0016 lands, /api/auctions answers 500 — which is correct:"
  info "the previous build answered 200 with invented auctions."
  TABLES=no
fi

step "Phase 2 — migration"
if [[ "$TABLES" != "yes" ]]; then
  if gated "apply 0016 to production D1"; then
    npx wrangler d1 execute "$DB_NAME" --remote --file="$MIGRATIONS_DIR/0016_create_auction_tables.sql" \
      && ok "0016 applied" || bad "0016 failed"
  fi
else ok "0016 not needed."; fi
```

Y en la fase 3, el orden y su motivo:

```
  Apply the migration BEFORE deploying Pages. The new build has no in-memory
  fallback: without the tables, /api/auctions and /subastas answer 500.

  The marketplace will be EMPTY after this. That is the point — production has
  been serving one invented auction ("Perú 1857 1d Azul") to every visitor.
  Real auctions are created from /admin, not seeded by the code.

       cd filatelia-web && npm run build:cf && npx wrangler pages deploy
```

- [ ] **Step 2: Verificar**

```bash
bash -n scripts/ops/auctions-rollout.sh && bash scripts/ops/auctions-rollout.sh
```
Expected: sintaxis OK y el preflight reporta que faltan las tablas.

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/auctions-rollout.sh
git commit -m "chore(ops): add the auctions rollout script"
```

---

## FASE 2 — Imágenes propias en R2

> **No hace falta ningún endpoint nuevo.** `POST /admin/upload-image` ya existe,
> ya está detrás de `requireAdmin`, y ya acepta dos formas de cuerpo:
> `{key, bucket?, url}` (el Worker descarga) o `{key, bucket?, data: "base64…", contentType?}`
> (el llamador descarga y manda los bytes). El comentario en el código dice
> textualmente que la segunda existe para "scraper downloaded locally (with
> cookies, etc.)" — que es exactamente este caso.
>
> **Se usa la vía base64, no la de URL.** La vía de URL exige agregar
> `wnsstamps.post` y Colnect a `WIKIMEDIA_UPLOAD_ALLOWLIST`, y esa allowlist
> existe porque `/upload-image` tuvo un SSRF: el Worker traía la URL que le
> pasaras. Ampliarla para 147k imágenes agranda esa superficie sin necesidad.
> Descargando en la VM y subiendo bytes, el Worker nunca hace una petición a un
> host controlado por el llamador. Además es la única vía que funciona para las
> imágenes de Colnect, que necesitan cookies de sesión.

### Task 8: Espejar imágenes a R2 desde la VM

**Files:**
- Create: `scrapers/mirror_images_to_r2.py`
- Create: `scrapers/test_mirror_images.py`

**Interfaces:**
- Consumes: `GET /admin/detail-queue` (Task 11 / commit `7cbbcef`) para paginar, y `POST /admin/upload-image` con cuerpo base64.
- Produces: `r2_key_for(stamp_id: str, source_url: str) -> str` y `already_mirrored(image_url: str) -> bool`.

**Por qué importa.** Los 147,555 sellos apuntan a `wnsstamps.post` y a Colnect. Los tres buckets R2 existen, están enlazados al Worker, y `/r2/:bucket/:key` ya sirve desde ellos — pero el catálogo nunca los usa. El día que cualquiera de esos dos servidores bloquee hotlinking o reordene rutas, el catálogo entero queda en blanco de golpe, sin que nadie haya tocado una línea.

- [ ] **Step 1: Write the failing test**

```python
# scrapers/test_mirror_images.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
for _v in ("DATAIMPULSE_HOST","DATAIMPULSE_USER","DATAIMPULSE_PASS","ADMIN_API_TOKEN"):
    os.environ.setdefault(_v, "test-placeholder-not-a-credential")

from mirror_images_to_r2 import r2_key_for, already_mirrored


def test_the_key_is_stable_for_the_same_stamp():
    # Re-running the mirror must overwrite the same object, not create a
    # second copy per run. R2 is billed per stored byte.
    a = r2_key_for("stamp-1", "https://www.wnsstamps.post/images/T600/AE024.2003.jpg")
    b = r2_key_for("stamp-1", "https://www.wnsstamps.post/images/T600/AE024.2003.jpg")
    assert a == b


def test_the_key_keeps_the_extension():
    key = r2_key_for("stamp-1", "https://www.wnsstamps.post/images/T600/AE024.2003.jpg")
    assert key.endswith(".jpg")


def test_two_stamps_never_collide():
    a = r2_key_for("stamp-1", "https://example.test/a.jpg")
    b = r2_key_for("stamp-2", "https://example.test/a.jpg")
    assert a != b


def test_a_url_with_no_extension_still_produces_a_key():
    key = r2_key_for("stamp-1", "https://example.test/image")
    assert key and "/" in key


def test_an_already_mirrored_url_is_skipped():
    # The run must be resumable: 147k images will not finish in one pass.
    assert already_mirrored("https://filatelia-api.rodrigopianto2005.workers.dev/r2/images/x.jpg")
    assert not already_mirrored("https://www.wnsstamps.post/images/T600/AE024.2003.jpg")
    assert not already_mirrored(None)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
scrapers/venv/bin/python -m pytest scrapers/test_mirror_images.py -q
```
Expected: FAIL — `ModuleNotFoundError: mirror_images_to_r2`.

- [ ] **Step 3: Write minimal implementation**

```python
#!/usr/bin/env python3
"""Mirror catalogue images into R2 so the catalogue stops hotlinking.

Production imageUrls point at www.wnsstamps.post and Colnect. The R2 buckets
exist and /r2/:bucket/:key already serves from them; nothing uses them. If
either host blocks hotlinking, all 147,555 stamps go blank at once.

Uploads go through the BASE64 body of POST /admin/upload-image, not its URL
body. The URL path would require adding those hosts to the Worker's upload
allowlist, and that allowlist exists because /upload-image once had an SSRF.
Downloading here and posting bytes means the Worker never fetches a
caller-controlled host — and it is the only path that works for Colnect
images, which need session cookies.

    python scrapers/mirror_images_to_r2.py --limit 10        # dry run
    python scrapers/mirror_images_to_r2.py --limit 10 --apply
"""

import base64
import hashlib
import json
import os
import sys
import time
from urllib.parse import urlparse

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scraper_env import require_admin_token  # noqa: E402

API_BASE = os.environ.get(
    "FILATELIA_API_BASE",
    "https://filatelia-api.rodrigopianto2005.workers.dev",
).rstrip("/")

# Every stamp already mirrored serves from here; used to skip on re-runs.
R2_PREFIX = f"{API_BASE}/r2/"
LEDGER = "r2_mirror_ledger.jsonl"
REQUEST_TIMEOUT = 60


def r2_key_for(stamp_id: str, source_url: str) -> str:
    """A stable object key for a stamp's image.

    Derived from the stamp id, so the same stamp always overwrites its own
    object instead of accumulating one copy per run — R2 bills stored bytes.
    The source URL only contributes the extension.
    """
    ext = os.path.splitext(urlparse(source_url or "").path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        ext = ".jpg"
    digest = hashlib.sha256(stamp_id.encode()).hexdigest()[:2]
    return f"stamps/{digest}/{stamp_id}{ext}"


def already_mirrored(image_url) -> bool:
    return bool(image_url) and str(image_url).startswith(R2_PREFIX)


def mirror_one(token: str, stamp: dict) -> str | None:
    """Download one image and push it to R2. Returns the new URL, or None."""
    source = stamp.get("imageUrl")
    if not source or already_mirrored(source):
        return None

    got = requests.get(source, timeout=REQUEST_TIMEOUT)
    if got.status_code != 200 or not got.content:
        print(f"   ! {stamp['id']}: origen respondió {got.status_code}")
        return None

    key = r2_key_for(stamp["id"], source)
    res = requests.post(
        f"{API_BASE}/admin/upload-image",
        headers={"X-Admin-Token": token, "Content-Type": "application/json"},
        json={
            "key": key,
            "bucket": "images",
            "data": base64.b64encode(got.content).decode(),
            "contentType": got.headers.get("Content-Type", "image/jpeg"),
        },
        timeout=REQUEST_TIMEOUT,
    )
    if res.status_code != 200 or not res.json().get("success"):
        print(f"   ! {stamp['id']}: R2 rechazó la subida ({res.status_code})")
        return None

    return f"{R2_PREFIX}images/{key}"
```

Y el `main()`, que **solo escribe el ledger** — no toca `imageUrl` todavía:

```python
def main():
    apply = "--apply" in sys.argv
    limit = 10
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    token = require_admin_token()

    res = requests.get(
        f"{API_BASE}/admin/detail-queue",
        params={"limit": limit},
        headers={"X-Admin-Token": token},
        timeout=REQUEST_TIMEOUT,
    )
    stamps = res.json().get("items", [])
    print(f"{len(stamps)} sellos a evaluar")

    if not apply:
        for s in stamps[:5]:
            print(f"   {s['id']} → {r2_key_for(s['id'], s.get('imageUrl') or '')}")
        print("\n(modo lectura: no se subió nada)")
        return

    with open(LEDGER, "a") as ledger:
        for s in stamps:
            new_url = mirror_one(token, s)
            if new_url:
                # The ledger is written BEFORE anything in D1 changes, so a
                # bad batch can always be reverted to the original URLs.
                ledger.write(json.dumps({
                    "stampId": s["id"], "old": s.get("imageUrl"), "new": new_url,
                }) + "\n")
                ledger.flush()
                print(f"   ✓ {s['id']}")
            time.sleep(0.1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
scrapers/venv/bin/python -m pytest scrapers/test_mirror_images.py -q
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scrapers/mirror_images_to_r2.py scrapers/test_mirror_images.py
git commit -m "feat(ops): mirror catalogue images into R2 instead of hotlinking"
```

---

### Task 9: Cambiar `imageUrl` solo después de verificar que R2 sirve

**Files:**
- Create: `scripts/ops/images-r2-rollout.sh`

**Por qué separado de la Task 8.** Subir a R2 es aditivo y reversible: si sale mal, se borra el objeto y no pasó nada. Cambiar `imageUrl` es lo que puede dejar el catálogo en blanco. Van en pasos distintos para que entre uno y otro haya una verificación humana.

- [ ] **Step 1: Espejar 10 sellos**

```bash
scrapers/venv/bin/python scrapers/mirror_images_to_r2.py --limit 10 --apply
```

- [ ] **Step 2: Verificar que R2 los sirve de verdad**

```bash
head -1 r2_mirror_ledger.jsonl | python3 -c "import sys,json;print(json.load(sys.stdin)['new'])" \
  | xargs -I{} curl -s -o /dev/null -w "%{http_code} %{content_type}\n" {}
```
Expected: `200 image/jpeg` (o el tipo que corresponda). **Si esto no da 200, parar acá**: cambiar `imageUrl` ahora dejaría esos sellos sin imagen.

- [ ] **Step 3: Escribir el script de rollout que aplica el ledger**

Estructura de `scripts/ops/e3-rollout.sh` (dry-run por defecto, `--apply` para escribir). Debe leer `r2_mirror_ledger.jsonl` y por cada línea:

```sql
UPDATE Stamp SET imageUrl = ?, updatedAt = datetime('now')
 WHERE id = ? AND imageUrl = ?;
```

El `AND imageUrl = ?` es lo que lo hace seguro: si alguien cambió esa imagen entre el espejado y el rollout, la fila no se toca en vez de pisar el cambio. El script debe reportar cuántas filas quedaron sin actualizar por esa razón, en vez de callarlo.

- [ ] **Step 4: Aplicar sobre los 10 y mirar el catálogo en el navegador**

- [ ] **Step 5: Commit y repetir por lotes**

```bash
git add scripts/ops/images-r2-rollout.sh
git commit -m "chore(ops): apply the R2 image ledger to D1 in verifiable batches"
```

---

## FASE 3 — Vectorize

### Task 10: Averiguar si el índice tiene vectores antes de decidir nada

**Files:**
- Create: `scripts/ops/vectorize-status.sh`

**Por qué importa.** `/identificar` son 198 líneas reales y el Worker consulta `c.env.VECTORIZE`. Pero según `PLAN_MAESTRO_UNIFICADO.md` los embeddings nunca se generaron. Si el índice está vacío, la identificación por foto responde correctamente **y no encuentra nada nunca** — que es indistinguible de "el sello no está en el catálogo".

- [ ] **Step 1: Escribir el script**

```bash
#!/usr/bin/env bash
# Read-only: reports whether stamps-index actually holds vectors.
# Everything about /identificar depends on this answer, and nothing in the
# code makes an empty index distinguishable from "no match found".
set -uo pipefail
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-7f76e45b57067d4bfc128d1049a20607}"
npx wrangler vectorize info stamps-index
```

- [ ] **Step 2: Correrlo y anotar el resultado en `PENDIENTES.md`**

Si `vectorCount` es 0: la búsqueda visual **no funciona** y hay que generar embeddings (fase aparte, no incluida acá porque su alcance depende de este número). Si es > 0: verificar con una foto real antes de darla por buena.

- [ ] **Step 3: Commit**

```bash
git add scripts/ops/vectorize-status.sh
git commit -m "chore(ops): add a read-only Vectorize index status check"
```

---

## FASE 4 — Desbloquear el scraper

### Task 11: Desplegar el endpoint de cola y resembrar

Ya está escrito y commiteado (`7cbbcef`); falta ejecutarlo.

**Prerrequisitos, auditados en la VM el 2026-08-06.** Ninguno es código: los cuatro son cosas que tienen que existir antes de que esta tarea pueda correr. Se listan acá y no solo en `PENDIENTES.md` para que quien ejecute el plan no arranque a ciegas.

| Falta | Detalle |
| --- | --- |
| El checkpoint | `colnect_v3_progress.db` **no existe en la VM**. Ahí viven `listing_pages` (61,981 páginas) y `stamp_queue` (14,396 sellos). Rodrigo lo tiene en otra máquina y lo va a subir. |
| Credenciales | `DATAIMPULSE_HOST/USER/PASS` y `COLNECT_USER/PASS` no están en el entorno. Solo está `ADMIN_API_TOKEN`. Como `USE_PROXY` es 1 por defecto, el scraper ni arranca sin las tres de DataImpulse. |
| Saldo | El proxy DataImpulse necesita GB. Decisión tomada: se paga y se sigue usando. |
| Sesión de Colnect | `scrapers/colnect_cookies.json` es del **23 de julio**. Una petición directa desde la VM devolvió **HTTP 485 con cuerpo vacío** — el desafío de Anubis, no la página. Hay que renovar la sesión con `scrapers/vm_solve_anubis.py` / `refresh_cookies.py` antes de cualquier corrida. |

**El orden está invertido respecto a lo que dice el plan original.** `stamp_queue` la llena la fase de listado. Si el checkpoint **se recupera**, se puede correr E2.7 (detalle) directo. Si **no** se recupera, hay dos caminos y no son equivalentes:

- `seed_crawler_queue.py --apply` reconstruye `stamp_queue` desde los sellos que **ya están en D1**. Recupera el backlog de detalle sin volver a crawlear una sola página de listado, que es la mitad cara.
- Reconstruir `listing_pages` **no tiene atajo**: son páginas que nunca se visitaron, así que D1 no sabe que existen. Solo salen de correr E2.8 de nuevo.

- [ ] **Step 0: Verificar los cuatro prerrequisitos antes de seguir**

```bash
ls -la colnect_v3_progress.db 2>/dev/null || echo "FALTA el checkpoint"
for v in DATAIMPULSE_HOST DATAIMPULSE_USER DATAIMPULSE_PASS COLNECT_USER COLNECT_PASS ADMIN_API_TOKEN; do
  fish -c "set -q $v; and echo '$v ok'; or echo \"$v FALTA\""
done
```

- [ ] **Step 1: Desplegar el Worker**

```bash
cd workers/filatelia-api && npx wrangler deploy
```

- [ ] **Step 2: Verificar el endpoint**

```bash
curl -s -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  "https://filatelia-api.rodrigopianto2005.workers.dev/admin/detail-queue?limit=3" | head -c 400
```
Expected: `{"success":true,"items":[...],"nextCursor":"...","count":3}`

- [ ] **Step 3: Restaurar el checkpoint si aparece, o resembrar**

Si `colnect_v3_progress.db` se recupera de la otra máquina, copiarlo a la raíz del repo en la VM. Si no:

```bash
python scrapers/seed_crawler_queue.py            # en seco
python scrapers/seed_crawler_queue.py --apply    # sembrar
```

- [ ] **Step 4: Correr la fase de detalle con un lote de 3 y verificar persistencia**

Antes de los 14,396. Con la migración 0013 aplicada, un lote que antes persistía 0 de 3 ahora debe persistir 3 de 3.

- [ ] **Step 5: Recién entonces, el lote completo**

---

## Orden recomendado y por qué

1. **Fase 0** — es lo único que ya está siendo explotable hoy. No depende de ninguna decisión de producto.
2. **Fase 2 (imágenes)** — es lo único que puede romperse **solo**, sin que nadie toque nada, y deja el catálogo entero en blanco.
3. **Fase 1 (subastas)** — mucho valor por poco trabajo: la lógica de pujas ya está escrita y probada, solo cambia dónde vive el estado.
4. **Fase 4 (scraper)** — depende de recuperar el checkpoint y de las credenciales.
5. **Fase 3 (Vectorize)** — es una verificación barata que puede convertirse en un proyecto grande; conviene saber el número antes de prometer nada.

## Hallazgos que no son tareas

Cosas que aparecieron auditando y que ya están decididas o cerradas. Se dejan escritas para que nadie las vuelva a "descubrir" y las reabra.

- **Colnect autoriza el acceso.** Rodrigo lo habló directamente con ellos. **No tienen API ni export de datos disponibles**, así que el parser se queda. Decisión #3 del plan original: cerrada.
- **No se va a pedir lista blanca de IP.** Se evaluó pedirle a Colnect que habilite `179.7.15.36` para saltear Anubis. Rodrigo decidió seguir con la solución que ya está construida (`vm_solve_anubis.py`), aunque sea el camino difícil. No reabrir.
- **El proxy sigue siendo DataImpulse, por defecto.** Se descubrió que la VM ya sale por una IP residencial de Claro Perú (`179.7.15.36`, AS12252), que es justo lo que el proxy vende, y se dejó `USE_PROXY=0` como salida. Pero la decisión es pagar y usarlo: lo que el proxy agrega es **rotación de IP**, y sin él la dirección que se expone al bloqueo es la conexión real de la VM.
- **La cola del scraper se mira por terminal.** Se descartó construir una pantalla de admin para los 14,396 pendientes. Con un operador, `ssh` y `tail` alcanzan. Reabrir solo si alguien más opera el scraper.
- **`seed_crawler_queue.py` estaba muerto** desde E0 (mandaba SQL crudo al gateway `/query` eliminado) y además escribía en `crawler_progress.db`, una base que el scraper v3 no lee. Ya está reescrito (commit `7cbbcef`) contra `GET /admin/detail-queue`.
- **E5 y E6 son por suscriptor.** Alcance definido por Rodrigo: el valor que se calcula es el de **tu** colección (Σ precio × multiplicador de condición × cantidad sobre tus filas de `UserCollection`), y el grado por IA aplica a la foto de **tu** ejemplar, no al sello del catálogo. El esquema ya lo soporta.
- **`APP_SECRET` rotado** el 2026-08-06 y verificado: una cookie `fp_session` falsificada devuelve 401, no 500. Lo que **no** se verificó es que un login real genere sesión válida — falta hacerlo entrando una vez.

## Lo que este plan NO cubre, y por qué

- **E5 (valoración) y E6 (IA de condición)**: bloqueadas por decisiones de producto (fuente de precio de mercado, escala de condición). Construirlas sin esas respuestas es la forma cara de descubrir que se eligió mal.
- **E7 (sets y lotes)**: diferido a propósito desde el plan original.
- **Requerimientos de la comunidad filatélica**: no existe ningún documento en el repositorio que los recoja. `web/estructura.txt` son siete líneas de campos de producto de WooCommerce; los `PLAN*.md` son hojas de ruta de infraestructura. Antes de construir funcionalidad de comunidad hay que conseguir esos requerimientos de donde estén.
