import {
  UserCollectionItem,
  ListType,
  ConditionGrade,
  CollectionRequestPayload,
  VALID_LIST_TYPES,
  VALID_CONDITIONS,
  isValidListType,
  isValidCondition,
} from "@/types/collection";

// D1-backed access for the UserCollection table (migration 0006_user_collections.sql).
// Requires the direct D1 binding (process.env.DB), injected by the Cloudflare
// Pages/Workers edge runtime (see wrangler.toml). There is no network
// fallback: the Worker's /query endpoint no longer accepts arbitrary `sql`
// (that gateway was a critical vulnerability and has been removed entirely),
// so an environment without the DB binding simply cannot run these queries.
// Run `wrangler pages dev` locally to get the binding instead of `next dev`.
const runQuery = async (sql: string, params: any[] = []): Promise<any[]> => {
  const d1 = (process.env as any).DB;
  if (!d1 || typeof d1.prepare !== "function") {
    throw new Error(
      "D1 binding 'DB' is unavailable in this environment. The remote SQL gateway " +
      "has been removed for security reasons; run this code where the D1 binding " +
      "is attached (e.g. `wrangler pages dev`)."
    );
  }
  const res = await d1.prepare(sql).bind(...params).all();
  return res.results || [];
};

// Columns pulled from Stamp (workers/filatelia-api/schema.sql) via the LEFT
// JOIN in getUserCollection/getAllUserCollections below: nameEs/nameEn for
// the display title (Spanish wins, English is the fallback, matching this
// app's Spanish-first UI copy convention), imageUrl for stampImage, and
// scottNumber for stampCatalogNumber. LEFT JOIN (not INNER) so a
// UserCollection row is never hidden just because its stamp_id doesn't
// resolve to a Stamp row.
const STAMP_JOIN_COLUMNS =
  "s.nameEs as stamp_name_es, s.nameEn as stamp_name_en, s.imageUrl as stamp_image, s.scottNumber as stamp_scott_number";

// The one SELECT shape that produces a fully displayable row. Every read and
// every write path composes it from this single constant, so adding a display
// column means editing STAMP_JOIN_COLUMNS and mapRow — and nothing else — for
// it to appear in the list responses AND in the response of the write that
// touched the row.
const COLLECTION_SELECT =
  `SELECT u.*, ${STAMP_JOIN_COLUMNS} FROM UserCollection u LEFT JOIN Stamp s ON u.stamp_id = s.id`;

function mapRow(row: any): UserCollectionItem {
  const item: UserCollectionItem = {
    id: row.id,
    userId: row.user_id,
    stampId: row.stamp_id,
    listType: row.list_type,
    condition: row.condition,
    quantity: row.quantity ?? 1,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // Only present on rows produced by the Stamp JOIN (getUserCollection /
  // getAllUserCollections); INSERT/UPDATE/DELETE ... RETURNING rows don't
  // carry these columns and mapRow correctly leaves them undefined.
  if ("stamp_name_es" in row || "stamp_name_en" in row) {
    item.stampTitle = row.stamp_name_es || row.stamp_name_en || undefined;
    item.stampImage = row.stamp_image ?? undefined;
    item.stampCatalogNumber = row.stamp_scott_number ?? undefined;
  }

  return item;
}

// Guards against the documented incident of a test suite deleting rows from
// PRODUCTION D1 (see filatelia project history). This function is wired
// only from tests, but nothing in the type system stops it from being
// imported and called elsewhere, so it independently refuses to run unless
// NODE_ENV is 'test' — the value vitest sets automatically for every test
// run in this repo, and something no test-runner-driven call site can
// accidentally leave unset in a real deployment (Next/Cloudflare Pages runs
// with NODE_ENV 'production' or 'development', never 'test').
//
// LIMIT OF THIS GUARD, stated plainly because the doc comment below used to
// promise more than it delivers: NODE_ENV === 'test' says something about
// the PROCESS, and nothing whatsoever about WHICH DATABASE is bound. A D1
// binding exposes no database name, id or environment to application code,
// so there is no signal here that could distinguish a local D1 from the
// production one — any "is this production?" check would be a guess dressed
// up as a guarantee. A test process bound to remote D1 (`wrangler pages dev
// --remote`, or an integration run against the real database) would still
// pass this check and still delete every row. The guard is therefore
// treated as what it is — protection against a NON-test process — and the
// contract below is narrowed to match, rather than inventing a second check
// that cannot actually see the database.
function assertRunningInTestEnvironment(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "resetCollectionStore() refused to run: NODE_ENV is not 'test'. This " +
      "function deletes every row in UserCollection and must never run " +
      "against a real (dev/prod) D1 binding."
    );
  }
}

/**
 * Test-only utility: clears the UserCollection table so a test starts from a
 * clean slate.
 *
 * ONLY SAFE against a throwaway database — in this repo, the in-memory fake
 * D1 binding the vitest suite injects (see test/collection-api.test.ts).
 * It must NEVER be called from a test run bound to a real D1 instance,
 * local or remote: `DELETE FROM UserCollection` is unconditional, and the
 * NODE_ENV guard cannot tell which database is bound (see
 * assertRunningInTestEnvironment above). Binding a real database is the
 * caller's decision and the caller's risk; this function offers no
 * protection against it.
 *
 * Not used by production code paths.
 */
export async function resetCollectionStore(): Promise<void> {
  assertRunningInTestEnvironment();
  await runQuery("DELETE FROM UserCollection", []);
}

// Re-reads a single row through COLLECTION_SELECT so a write path can return
// the same shape a list read returns. Returns null when the row is gone (a
// concurrent DELETE between the write and this read) — callers decide what
// that means for them.
async function selectCollectionItem(userId: string, id: number): Promise<UserCollectionItem | null> {
  const rows = await runQuery(`${COLLECTION_SELECT} WHERE u.id = ? AND u.user_id = ?`, [id, userId]);
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getUserCollection(userId: string, listType?: ListType): Promise<UserCollectionItem[]> {
  const params: any[] = [userId];
  let sql = `${COLLECTION_SELECT} WHERE u.user_id = ?`;
  if (listType) {
    sql += " AND u.list_type = ?";
    params.push(listType);
  }
  sql += " ORDER BY u.updated_at DESC";

  const rows = await runQuery(sql, params);
  return rows.map(mapRow);
}

export async function getAllUserCollections(): Promise<UserCollectionItem[]> {
  // Cap preserved from the previous implementation to bound payload size
  // until real pagination is introduced.
  const rows = await runQuery(`${COLLECTION_SELECT} LIMIT 5000`, []);
  return rows.map(mapRow);
}

// Validates a caller-supplied quantity: must be a positive integer (>= 1).
// `undefined` is allowed and means "use the default" (1) — callers decide
// that default, this helper only rejects values that are actually present
// but invalid. Mirrors the DB-level CHECK(quantity >= 1) added in
// db/migrations/0009_add_quantity_and_ignore_list_type.sql (belt and
// suspenders — see that migration's header for why both layers enforce it).
function validateQuantity(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid quantity '${value}'. Must be an integer >= 1.`);
  }
  return value;
}

export async function addCollectionItem(userId: string, payload: CollectionRequestPayload): Promise<UserCollectionItem> {
  if (!payload.stampId || !payload.listType) {
    throw new Error("Missing required fields: stampId and listType");
  }

  if (!isValidListType(payload.listType)) {
    throw new Error(`Invalid list_type '${payload.listType}'. Must be one of: ${VALID_LIST_TYPES.join(", ")}.`);
  }

  const condition: ConditionGrade = payload.condition || "MNH";
  if (!isValidCondition(condition)) {
    throw new Error(`Invalid condition '${condition}'. Must be one of: ${VALID_CONDITIONS.join(", ")}.`);
  }

  const quantity = validateQuantity(payload.quantity);
  const notes = payload.notes ?? "";

  // ATOMIC UPSERT, deliberately not SELECT-then-INSERT-or-UPDATE. Two
  // concurrent first-time adds of the same (user, stamp, list) — a
  // double-clicked button is enough — would both see no row and both
  // INSERT, and the loser would hit UNIQUE(user_id, stamp_id, list_type)
  // and surface as a raw, unexplained 400. `ON CONFLICT ... DO UPDATE`
  // collapses both cases into one statement the database resolves itself.
  //
  // REPEAT-ADD SEMANTICS (settled here, and the only place they are
  // stated). A field is written on conflict ONLY when the caller actually
  // supplied it:
  //
  //   - SUPPLIED  -> overwrite, last write wins, never increment. The one
  //     caller that sends a quantity is the collection control's stepper
  //     (src/components/collection/CollectionControl.tsx), a "set my count
  //     to N" widget showing the current value: incrementing would make
  //     pressing "+" once jump from 3 to 7.
  //   - OMITTED   -> leave the existing row alone. The defaults computed
  //     above (quantity 1, condition MNH, empty notes) describe a NEW
  //     membership, not an instruction to erase a stored one. `/api/collection`
  //     explicitly permits omitting any of the three, so treating an absent
  //     field as "reset it" let a collector who owns 5 copies lose that
  //     count to any code path that re-posted without a quantity.
  //
  // This mirrors updateCollectionItem below, which already builds its SET
  // clause from the fields the caller supplied.
  const conflictUpdates: string[] = [];
  if (payload.condition !== undefined) conflictUpdates.push("condition = excluded.condition");
  if (payload.quantity !== undefined) conflictUpdates.push("quantity = excluded.quantity");
  if (payload.notes !== undefined) conflictUpdates.push("notes = excluded.notes");
  conflictUpdates.push("updated_at = CURRENT_TIMESTAMP");

  const rows = await runQuery(
    `INSERT INTO UserCollection (user_id, stamp_id, list_type, condition, quantity, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, stamp_id, list_type) DO UPDATE SET
       ${conflictUpdates.join(", ")}
     RETURNING *`,
    [userId, payload.stampId, payload.listType, condition, quantity, notes]
  );
  return mapRow(rows[0]);
}

export async function updateCollectionItem(
  userId: string,
  id: number,
  updates: { condition?: ConditionGrade; quantity?: number; notes?: string }
): Promise<UserCollectionItem> {
  if (updates.condition && !isValidCondition(updates.condition)) {
    throw new Error(`Invalid condition '${updates.condition}'`);
  }

  const quantity = updates.quantity !== undefined ? validateQuantity(updates.quantity) : undefined;

  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.condition) {
    setClauses.push("condition = ?");
    params.push(updates.condition);
  }

  if (quantity !== undefined) {
    setClauses.push("quantity = ?");
    params.push(quantity);
  }

  if (updates.notes !== undefined) {
    setClauses.push("notes = ?");
    params.push(updates.notes);
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");

  params.push(id, userId);

  const rows = await runQuery(
    `UPDATE UserCollection SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ? RETURNING *`,
    params
  );

  if (rows.length === 0) {
    throw new Error("Collection item not found");
  }

  // `UPDATE ... RETURNING *` carries only UserCollection columns, so the item
  // it produces has no stampTitle/stampImage/stampCatalogNumber. Callers
  // (both list pages) swap their local row for this response, so returning
  // the bare row blanked the card's thumbnail, title and catalog number until
  // a full reload. Re-read through COLLECTION_SELECT instead of teaching each
  // caller which fields to preserve: the enrichment then lives in exactly one
  // place, and a display column added to STAMP_JOIN_COLUMNS later reaches
  // this response for free rather than silently going missing here.
  //
  // The re-read is a second statement, so a concurrent DELETE can land
  // between the two. The UPDATE did happen, so the honest answer in that case
  // is the row it returned — unenriched, but never a spurious "not found".
  const enriched = await selectCollectionItem(userId, id);
  return enriched ?? mapRow(rows[0]);
}

export async function deleteCollectionItem(userId: string, id: number): Promise<boolean> {
  const rows = await runQuery(
    "DELETE FROM UserCollection WHERE id = ? AND user_id = ? RETURNING id",
    [id, userId]
  );
  return rows.length > 0;
}
