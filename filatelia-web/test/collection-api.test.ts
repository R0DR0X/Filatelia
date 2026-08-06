import { describe, test, expect, afterEach } from "vitest";
import { GET, POST, PUT, DELETE } from "../src/app/api/collection/route";
import { NextRequest } from "next/server";
import { resetCollectionStore } from "../src/lib/db/collection";
import { signSession } from "../src/lib/session";

// Node's `process.env` coerces every assigned value to a string (see
// test/db-users.test.ts's header comment for the full explanation), so
// tests must replace `process.env` wholesale rather than assigning `DB`
// directly.
function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}

// In-memory fake D1 binding for the UserCollection table plus a read-only
// Stamp lookup table, covering every query shape src/lib/db/collection.ts
// issues: plain SELECT, the JOIN'd SELECT used by getUserCollection /
// getAllUserCollections, INSERT ... RETURNING, UPDATE ... RETURNING,
// DELETE ... RETURNING, and the bulk DELETE used by resetCollectionStore.
function createMockCollectionD1(stamps: Record<string, any>[] = []) {
  let rows: Record<string, any>[] = [];
  let nextId = 1;

  function findStamp(stampId: string) {
    return stamps.find((s) => s.id === stampId);
  }

  function withStampColumns(row: Record<string, any>) {
    const stamp = findStamp(row.stamp_id);
    return {
      ...row,
      stamp_name_es: stamp?.nameEs ?? null,
      stamp_name_en: stamp?.nameEn ?? null,
      stamp_image: stamp?.imageUrl ?? null,
      stamp_scott_number: stamp?.scottNumber ?? null,
    };
  }

  return {
    prepare(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...params: any[]) {
          return {
            async all() {
              if (/^DELETE FROM UserCollection$/i.test(s)) {
                rows = [];
                return { results: [] };
              }

              // Single-row re-read by id, used by the write paths to return a
              // row carrying the same Stamp JOIN columns the list queries
              // return. Must be checked BEFORE the generic JOIN branch below,
              // whose first bound param is the user id, not the row id.
              if (/^SELECT .* FROM UserCollection u LEFT JOIN Stamp .* WHERE u\.id = \?/i.test(s)) {
                const [id, userId] = params;
                const row = rows.find((r) => r.id === id && r.user_id === userId);
                return { results: row ? [withStampColumns(row)] : [] };
              }

              if (/^SELECT .* FROM UserCollection u\s+LEFT JOIN Stamp/i.test(s)) {
                let filtered = rows.filter((r) => r.user_id === params[0]);
                if (/AND u\.list_type = \?/i.test(s)) {
                  filtered = filtered.filter((r) => r.list_type === params[1]);
                }
                return { results: filtered.map(withStampColumns) };
              }

              if (/^SELECT \* FROM UserCollection WHERE user_id = \? AND stamp_id = \? AND list_type = \?$/i.test(s)) {
                const [userId, stampId, listType] = params;
                return {
                  results: rows.filter(
                    (r) => r.user_id === userId && r.stamp_id === stampId && r.list_type === listType
                  ),
                };
              }

              if (/^INSERT INTO UserCollection/i.test(s)) {
                const [userId, stampId, listType, condition, quantity, notes] = params;
                const now = new Date().toISOString();

                // The real table carries UNIQUE(user_id, stamp_id, list_type)
                // (migrations 0006 / 0009). This fake enforces it, because a
                // mock that does not enforce it silently hides the exact
                // race a SELECT-then-INSERT is vulnerable to.
                const existing = rows.find(
                  (r) => r.user_id === userId && r.stamp_id === stampId && r.list_type === listType
                );

                if (existing) {
                  if (!/ON CONFLICT/i.test(s)) {
                    throw new Error(
                      "D1_ERROR: UNIQUE constraint failed: UserCollection.user_id, " +
                      "UserCollection.stamp_id, UserCollection.list_type"
                    );
                  }
                  // ON CONFLICT ... DO UPDATE: addCollectionItem builds this
                  // SET clause from the fields the caller actually supplied,
                  // so the fake must honour the clause it was given instead
                  // of assuming all three columns are always written — a mock
                  // that overwrites everything would hide the silent reset of
                  // a stored quantity/condition/notes on a bare re-add.
                  const excluded: Record<string, any> = { condition, quantity, notes };
                  const conflictFields = s
                    .match(/DO UPDATE SET (.+) RETURNING/i)![1]
                    .split(",")
                    .map((clause) => clause.trim().split(" = ")[0])
                    .filter((field) => field !== "updated_at");
                  for (const field of conflictFields) {
                    existing[field] = excluded[field];
                  }
                  existing.updated_at = now;
                  return { results: [existing] };
                }

                const row = {
                  id: nextId++,
                  user_id: userId,
                  stamp_id: stampId,
                  list_type: listType,
                  condition,
                  quantity,
                  notes,
                  created_at: now,
                  updated_at: now,
                };
                rows.push(row);
                return { results: [row] };
              }

              if (/^UPDATE UserCollection SET/i.test(s)) {
                // Last two bound params are always [id, user_id] per
                // updateCollectionItem's SET-clause builder.
                const id = params[params.length - 2];
                const userId = params[params.length - 1];
                const row = rows.find((r) => r.id === id && r.user_id === userId);
                if (!row) return { results: [] };

                // Params are bound in the exact order the SET clauses were
                // built (condition, quantity, notes, ...), followed by
                // [id, user_id]. Walk the clause list and consume params in
                // lockstep instead of guessing fixed positions.
                const setClauseFields = s
                  .match(/SET (.+) WHERE/i)![1]
                  .split(",")
                  .map((clause) => clause.trim().split(" = ")[0])
                  .filter((field) => field !== "updated_at");
                let paramIdx = 0;
                for (const field of setClauseFields) {
                  (row as any)[field] = params[paramIdx++];
                }
                row.updated_at = new Date().toISOString();
                return { results: [row] };
              }

              if (/^DELETE FROM UserCollection WHERE id = \? AND user_id = \?/i.test(s)) {
                const [id, userId] = params;
                const idx = rows.findIndex((r) => r.id === id && r.user_id === userId);
                if (idx === -1) return { results: [] };
                const [removed] = rows.splice(idx, 1);
                return { results: [{ id: removed.id }] };
              }

              throw new Error(`createMockCollectionD1: unhandled query: ${s}`);
            },
          };
        },
      };
    },
  };
}

const STAMPS = [
  {
    id: "PE-1857-01",
    nameEs: "Sello Peru 1857",
    nameEn: "Peru Stamp 1857",
    imageUrl: "https://example.com/pe-1857-01.jpg",
    scottNumber: "PE1",
  },
];

describe("/api/collection", () => {
  afterEach(() => {
    clearMockD1();
  });

  test("test_collection_api_unauthenticated_rejected: /api/collection returns 401 when unauthenticated", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    const request = new NextRequest("http://localhost:3000/api/collection");
    const response = await GET(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthenticated");
  });

  test("test_collection_invalid_enum_rejected: POST /api/collection rejects invalid list_type or condition enum values", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    const token = await signSession({ id: "usr_test", name: "Test User" });

    const reqInvalidType = new NextRequest("http://localhost:3000/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "fp_session=" + token },
      body: JSON.stringify({ stampId: "PE-1857-01", listType: "stolen", condition: "MNH" }),
    });
    const resInvalidType = await POST(reqInvalidType);
    expect(resInvalidType.status).toBe(400);

    const reqInvalidCondition = new NextRequest("http://localhost:3000/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "fp_session=" + token },
      body: JSON.stringify({ stampId: "PE-1857-01", listType: "wishlist", condition: "SUPER_PERFECT" }),
    });
    const resInvalidCondition = await POST(reqInvalidCondition);
    expect(resInvalidCondition.status).toBe(400);
  });

  test("CRUD operations on /api/collection for authenticated user", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();

    const token = await signSession({ id: "usr_collector_99", name: "Collector 99" });
    const sessionCookie = "fp_session=" + token;

    const postReq = new NextRequest("http://localhost:3000/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ stampId: "PE-1857-01", listType: "wishlist", condition: "MNH", notes: "Excelente" }),
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.success).toBe(true);
    expect(postData.item.stampId).toBe("PE-1857-01");
    expect(postData.item.condition).toBe("MNH");
    // No quantity sent: defaults to 1.
    expect(postData.item.quantity).toBe(1);

    const getReq = new NextRequest("http://localhost:3000/api/collection?list_type=wishlist", {
      headers: { Cookie: sessionCookie },
    });
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.items.length).toBe(1);
    // GET joins Stamp, so the stamp fields must be populated.
    expect(getData.items[0].stampTitle).toBe("Sello Peru 1857");
    expect(getData.items[0].stampImage).toBe("https://example.com/pe-1857-01.jpg");
    expect(getData.items[0].stampCatalogNumber).toBe("PE1");

    const putReq = new NextRequest("http://localhost:3000/api/collection", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ id: postData.item.id, condition: "MH", notes: "Actualizado", quantity: 3 }),
    });
    const putRes = await PUT(putReq);
    expect(putRes.status).toBe(200);
    const putData = await putRes.json();
    expect(putData.item.condition).toBe("MH");
    expect(putData.item.notes).toBe("Actualizado");
    expect(putData.item.quantity).toBe(3);

    const delReq = new NextRequest(`http://localhost:3000/api/collection?id=${postData.item.id}`, {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    });
    const delRes = await DELETE(delReq);
    expect(delRes.status).toBe(200);
  });

  // Regression: the list pages replace their local row with the item the PUT
  // returns. `UPDATE ... RETURNING *` carries only UserCollection columns, so
  // an item without the Stamp JOIN columns turned a card with a thumbnail,
  // title and catalog number into a grey placeholder the moment the user
  // edited it.
  test("PUT returns an item enriched with the same Stamp fields GET returns", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();

    const token = await signSession({ id: "usr_enriched_put", name: "Enriched User" });
    const sessionCookie = "fp_session=" + token;

    const postRes = await POST(
      new NextRequest("http://localhost:3000/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ stampId: "PE-1857-01", listType: "collection", condition: "MNH" }),
      })
    );
    const created = (await postRes.json()).item;

    const putRes = await PUT(
      new NextRequest("http://localhost:3000/api/collection", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ id: created.id, condition: "Used" }),
      })
    );
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()).item;

    // The edit itself landed...
    expect(updated.condition).toBe("Used");
    // ...and the display fields survived it.
    expect(updated.stampTitle).toBe("Sello Peru 1857");
    expect(updated.stampImage).toBe("https://example.com/pe-1857-01.jpg");
    expect(updated.stampCatalogNumber).toBe("PE1");
  });

  test("PUT on a stamp with no matching Stamp row still returns the updated item", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();

    const token = await signSession({ id: "usr_orphan_put", name: "Orphan User" });
    const sessionCookie = "fp_session=" + token;

    const postRes = await POST(
      new NextRequest("http://localhost:3000/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ stampId: "PE-UNKNOWN-99", listType: "collection" }),
      })
    );
    const created = (await postRes.json()).item;

    const putRes = await PUT(
      new NextRequest("http://localhost:3000/api/collection", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ id: created.id, notes: "Sin sello asociado" }),
      })
    );
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()).item;
    expect(updated.id).toBe(created.id);
    expect(updated.notes).toBe("Sin sello asociado");
    expect(updated.stampTitle).toBeUndefined();
  });

  test("'ignore' is accepted as a list type", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();
    const token = await signSession({ id: "usr_ignore", name: "Ignore User" });

    const postReq = new NextRequest("http://localhost:3000/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "fp_session=" + token },
      body: JSON.stringify({ stampId: "PE-1857-01", listType: "ignore" }),
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.item.listType).toBe("ignore");
  });

  test("quantity: rejects zero, negative and non-integer values", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();
    const token = await signSession({ id: "usr_qty", name: "Qty User" });

    for (const quantity of [0, -1, 1.5, "three"]) {
      const req = new NextRequest("http://localhost:3000/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "fp_session=" + token },
        body: JSON.stringify({ stampId: "PE-1857-01", listType: "wishlist", quantity }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    }
  });

  // The UNIQUE(user_id, stamp_id, list_type) constraint is real (0006/0009)
  // and the mock above enforces it. These two tests pin down what a repeat
  // add does, and prove two simultaneous first-time adds cannot collide.
  test("two concurrent first-time adds of the same stamp do not violate UNIQUE", async () => {
    const mock = createMockCollectionD1(STAMPS);
    setMockD1(mock);
    await resetCollectionStore();
    const token = await signSession({ id: "usr_race", name: "Race User" });
    const sessionCookie = "fp_session=" + token;

    const makeReq = () =>
      new NextRequest("http://localhost:3000/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ stampId: "PE-1857-01", listType: "collection", quantity: 1 }),
      });

    const [first, second] = await Promise.all([POST(makeReq()), POST(makeReq())]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const getRes = await GET(
      new NextRequest("http://localhost:3000/api/collection?list_type=collection", {
        headers: { Cookie: sessionCookie },
      })
    );
    const getData = await getRes.json();
    expect(getData.items).toHaveLength(1);
  });

  test("a repeat add OVERWRITES quantity (last write wins), it does not increment", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();
    const token = await signSession({ id: "usr_repeat", name: "Repeat User" });
    const sessionCookie = "fp_session=" + token;

    const post = (quantity: number) =>
      POST(
        new NextRequest("http://localhost:3000/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie },
          body: JSON.stringify({ stampId: "PE-1857-01", listType: "collection", quantity }),
        })
      );

    await post(2);
    const secondRes = await post(5);
    expect(secondRes.status).toBe(201);
    const secondData = await secondRes.json();
    // 5, not 7: the control is a "set my quantity to N" widget, not a
    // "+1 to my pile" button.
    expect(secondData.item.quantity).toBe(5);

    const getRes = await GET(
      new NextRequest("http://localhost:3000/api/collection?list_type=collection", {
        headers: { Cookie: sessionCookie },
      })
    );
    const getData = await getRes.json();
    expect(getData.items).toHaveLength(1);
    expect(getData.items[0].quantity).toBe(5);
  });

  test("a repeat add that OMITS quantity leaves the stored quantity untouched", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();
    const token = await signSession({ id: "usr_omit_qty", name: "Omit Qty User" });
    const sessionCookie = "fp_session=" + token;

    const post = (body: Record<string, any>) =>
      POST(
        new NextRequest("http://localhost:3000/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie },
          body: JSON.stringify(body),
        })
      );

    // The collector owns 5 copies.
    await post({ stampId: "PE-1857-01", listType: "collection", quantity: 5 });

    // A bare re-add (no quantity in the payload) is NOT a statement about
    // how many copies they own — it must not destroy the stored count.
    const bareRes = await post({ stampId: "PE-1857-01", listType: "collection" });
    expect(bareRes.status).toBe(201);
    expect((await bareRes.json()).item.quantity).toBe(5);

    // An explicit quantity still overwrites (last write wins).
    const explicitRes = await post({ stampId: "PE-1857-01", listType: "collection", quantity: 2 });
    expect((await explicitRes.json()).item.quantity).toBe(2);

    // A brand-new row with no quantity still defaults to 1.
    const freshRes = await post({ stampId: "PE-1857-01", listType: "wishlist" });
    expect((await freshRes.json()).item.quantity).toBe(1);
  });

  test("a repeat add that OMITS condition/notes leaves the stored values untouched", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();
    const token = await signSession({ id: "usr_omit_fields", name: "Omit Fields User" });
    const sessionCookie = "fp_session=" + token;

    const post = (body: Record<string, any>) =>
      POST(
        new NextRequest("http://localhost:3000/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: sessionCookie },
          body: JSON.stringify(body),
        })
      );

    await post({
      stampId: "PE-1857-01",
      listType: "collection",
      condition: "Used",
      notes: "Matasellos de Lima",
    });

    const bareRes = await post({ stampId: "PE-1857-01", listType: "collection" });
    const bareData = await bareRes.json();
    expect(bareData.item.condition).toBe("Used");
    expect(bareData.item.notes).toBe("Matasellos de Lima");

    // Explicitly supplied values still overwrite.
    const explicitRes = await post({
      stampId: "PE-1857-01",
      listType: "collection",
      condition: "MH",
      notes: "Reevaluado",
    });
    const explicitData = await explicitRes.json();
    expect(explicitData.item.condition).toBe("MH");
    expect(explicitData.item.notes).toBe("Reevaluado");

    // A brand-new row with neither field still gets the defaults.
    const freshRes = await post({ stampId: "PE-1857-01", listType: "trade" });
    const freshData = await freshRes.json();
    expect(freshData.item.condition).toBe("MNH");
    expect(freshData.item.notes ?? "").toBe("");
  });

  test("quantity: accepts a valid positive integer", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    await resetCollectionStore();
    const token = await signSession({ id: "usr_qty_ok", name: "Qty OK User" });

    const req = new NextRequest("http://localhost:3000/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "fp_session=" + token },
      body: JSON.stringify({ stampId: "PE-1857-01", listType: "wishlist", quantity: 5 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.item.quantity).toBe(5);
  });
});

describe("resetCollectionStore guard", () => {
  afterEach(() => {
    clearMockD1();
    delete (process.env as any).__ORIGINAL_NODE_ENV_RESTORED;
  });

  test("refuses to run outside a test environment", async () => {
    setMockD1(createMockCollectionD1(STAMPS));
    const original = process.env.NODE_ENV;
    process.env = Object.assign({}, process.env, { NODE_ENV: "production" });
    try {
      await expect(resetCollectionStore()).rejects.toThrow();
    } finally {
      process.env = Object.assign({}, process.env, { NODE_ENV: original });
    }
  });
});
