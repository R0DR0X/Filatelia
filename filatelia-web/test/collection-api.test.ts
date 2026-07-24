import { test } from "node:test";
import assert from "node:assert";
import { GET, POST, PUT, DELETE } from "../src/app/api/collection/route";
import { NextRequest } from "next/server";
import { resetCollectionStore } from "../src/lib/db/collection";
import { signSession } from "../src/lib/session";

test("test_collection_api_unauthenticated_rejected: /api/collection returns 401 when unauthenticated", async () => {
  const request = new NextRequest("http://localhost:3000/api/collection");
  const response = await GET(request);
  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.error, "Unauthenticated");
});

test("test_collection_invalid_enum_rejected: POST /api/collection rejects invalid list_type or condition enum values", async () => {
  const token = await signSession({ id: "usr_test", name: "Test User" });
  
  // Test invalid list_type
  const reqInvalidType = new NextRequest("http://localhost:3000/api/collection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "fp_session=" + token,
    },
    body: JSON.stringify({ stampId: "PE-1857-01", listType: "stolen", condition: "MNH" }),
  });

  const resInvalidType = await POST(reqInvalidType);
  assert.strictEqual(resInvalidType.status, 400);

  // Test invalid condition grade
  const reqInvalidCondition = new NextRequest("http://localhost:3000/api/collection", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "fp_session=" + token,
    },
    body: JSON.stringify({ stampId: "PE-1857-01", listType: "wishlist", condition: "SUPER_PERFECT" }),
  });

  const resInvalidCondition = await POST(reqInvalidCondition);
  assert.strictEqual(resInvalidCondition.status, 400);
});

test("CRUD operations on /api/collection for authenticated user", async () => {
  resetCollectionStore();

  const token = await signSession({ id: "usr_collector_99", name: "Collector 99" });
  const sessionCookie = "fp_session=" + token;

  // 1. Add stamp to collection (POST)
  const postReq = new NextRequest("http://localhost:3000/api/collection", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ stampId: "PE-1857-01", listType: "wishlist", condition: "MNH", notes: "Excelente" }),
  });

  const postRes = await POST(postReq);
  assert.strictEqual(postRes.status, 201);
  const postData = await postRes.json();
  assert.ok(postData.success);
  assert.strictEqual(postData.item.stampId, "PE-1857-01");
  assert.strictEqual(postData.item.condition, "MNH");

  // 2. Fetch stamps (GET)
  const getReq = new NextRequest("http://localhost:3000/api/collection?list_type=wishlist", {
    headers: { Cookie: sessionCookie },
  });
  const getRes = await GET(getReq);
  assert.strictEqual(getRes.status, 200);
  const getData = await getRes.json();
  assert.strictEqual(getData.items.length, 1);

  // 3. Update stamp condition (PUT)
  const putReq = new NextRequest("http://localhost:3000/api/collection", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ id: postData.item.id, condition: "MH", notes: "Actualizado" }),
  });
  const putRes = await PUT(putReq);
  assert.strictEqual(putRes.status, 200);
  const putData = await putRes.json();
  assert.strictEqual(putData.item.condition, "MH");
  assert.strictEqual(putData.item.notes, "Actualizado");

  // 4. Delete stamp (DELETE)
  const delReq = new NextRequest(`http://localhost:3000/api/collection?id=${postData.item.id}`, {
    method: "DELETE",
    headers: { Cookie: sessionCookie },
  });
  const delRes = await DELETE(delReq);
  assert.strictEqual(delRes.status, 200);
});
