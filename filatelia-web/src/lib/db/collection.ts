import { UserCollectionItem, ListType, ConditionGrade, CollectionRequestPayload } from "@/types/collection";

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

function mapRow(row: any): UserCollectionItem {
  return {
    id: row.id,
    userId: row.user_id,
    stampId: row.stamp_id,
    listType: row.list_type,
    condition: row.condition,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const VALID_LIST_TYPES: ListType[] = ["collection", "wishlist", "trade"];
const VALID_CONDITIONS: ConditionGrade[] = ["MNH", "MH", "Used", "FDC"];

/**
 * Test-only utility: clears the UserCollection table so integration tests
 * (which run against a real D1 instance, local or remote) start from a clean
 * slate. Not used by production code paths.
 */
export async function resetCollectionStore(): Promise<void> {
  await runQuery("DELETE FROM UserCollection", []);
}

export async function getUserCollection(userId: string, listType?: ListType): Promise<UserCollectionItem[]> {
  const params: any[] = [userId];
  let sql = "SELECT * FROM UserCollection WHERE user_id = ?";
  if (listType) {
    sql += " AND list_type = ?";
    params.push(listType);
  }
  sql += " ORDER BY updated_at DESC";

  const rows = await runQuery(sql, params);
  return rows.map(mapRow);
}

export async function getAllUserCollections(): Promise<UserCollectionItem[]> {
  // Cap preserved from the previous implementation to bound payload size
  // until real pagination is introduced.
  const rows = await runQuery("SELECT * FROM UserCollection LIMIT 5000", []);
  return rows.map(mapRow);
}

export async function addCollectionItem(userId: string, payload: CollectionRequestPayload): Promise<UserCollectionItem> {
  if (!payload.stampId || !payload.listType) {
    throw new Error("Missing required fields: stampId and listType");
  }

  if (!VALID_LIST_TYPES.includes(payload.listType)) {
    throw new Error(`Invalid list_type '${payload.listType}'. Must be collection, wishlist, or trade.`);
  }

  const condition: ConditionGrade = payload.condition || "MNH";
  if (!VALID_CONDITIONS.includes(condition)) {
    throw new Error(`Invalid condition '${condition}'. Must be MNH, MH, Used, or FDC.`);
  }

  const notes = payload.notes ?? "";

  const existingRows = await runQuery(
    "SELECT * FROM UserCollection WHERE user_id = ? AND stamp_id = ? AND list_type = ?",
    [userId, payload.stampId, payload.listType]
  );

  if (existingRows.length > 0) {
    const rows = await runQuery(
      `UPDATE UserCollection
       SET condition = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND stamp_id = ? AND list_type = ?
       RETURNING *`,
      [condition, notes, userId, payload.stampId, payload.listType]
    );
    return mapRow(rows[0]);
  }

  const rows = await runQuery(
    `INSERT INTO UserCollection (user_id, stamp_id, list_type, condition, notes)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [userId, payload.stampId, payload.listType, condition, notes]
  );
  return mapRow(rows[0]);
}

export async function updateCollectionItem(
  userId: string,
  id: number,
  updates: { condition?: ConditionGrade; notes?: string }
): Promise<UserCollectionItem> {
  if (updates.condition && !VALID_CONDITIONS.includes(updates.condition)) {
    throw new Error(`Invalid condition '${updates.condition}'`);
  }

  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.condition) {
    setClauses.push("condition = ?");
    params.push(updates.condition);
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

  return mapRow(rows[0]);
}

export async function deleteCollectionItem(userId: string, id: number): Promise<boolean> {
  const rows = await runQuery(
    "DELETE FROM UserCollection WHERE id = ? AND user_id = ? RETURNING id",
    [id, userId]
  );
  return rows.length > 0;
}
