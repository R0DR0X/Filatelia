import { describe, test, expect, vi } from "vitest";
import {
  clampQuantity,
  findItemForStamp,
  planCollectionAction,
  executeCollectionAction,
  listSupportsQuantity,
  updateCollectionItemFields,
  deleteCollectionItemById,
  collectionFailureMessage,
  displayQuantityFor,
} from "../src/lib/collectionControl";
import { UserCollectionItem } from "../src/types/collection";

function makeItem(overrides: Partial<UserCollectionItem> = {}): UserCollectionItem {
  return {
    id: 1,
    userId: "usr_1",
    stampId: "stamp-1",
    listType: "collection",
    condition: "MNH",
    quantity: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("clampQuantity", () => {
  test("passes through a valid positive integer", () => {
    expect(clampQuantity(5)).toBe(5);
  });

  test("clamps 0 and negative numbers up to 1", () => {
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-3)).toBe(1);
  });

  test("floors non-integers", () => {
    expect(clampQuantity(2.7)).toBe(2);
  });

  test("falls back to 1 for NaN/Infinity", () => {
    expect(clampQuantity(NaN)).toBe(1);
    expect(clampQuantity(Infinity)).toBe(1);
  });
});

describe("listSupportsQuantity", () => {
  test("only the collection list carries a meaningful quantity", () => {
    expect(listSupportsQuantity("collection")).toBe(true);
  });

  test("wishlist/trade/ignore are membership-only lists", () => {
    expect(listSupportsQuantity("wishlist")).toBe(false);
    expect(listSupportsQuantity("trade")).toBe(false);
    expect(listSupportsQuantity("ignore")).toBe(false);
  });
});

describe("findItemForStamp", () => {
  test("returns the matching item", () => {
    const items = [makeItem({ id: 1, stampId: "a" }), makeItem({ id: 2, stampId: "b" })];
    expect(findItemForStamp(items, "b")?.id).toBe(2);
  });

  test("returns null when nothing matches", () => {
    expect(findItemForStamp([], "a")).toBeNull();
  });
});

describe("planCollectionAction", () => {
  test("creates when there is no current item", () => {
    const action = planCollectionAction(null, "stamp-1", "wishlist", 1);
    expect(action).toEqual({ kind: "create", stampId: "stamp-1", listType: "wishlist", quantity: 1 });
  });

  test("pins quantity to 1 for non-collection lists even if a caller passes something else", () => {
    const action = planCollectionAction(null, "stamp-1", "trade", 9);
    expect(action).toEqual({ kind: "create", stampId: "stamp-1", listType: "trade", quantity: 1 });
  });

  test("uses the clamped requested quantity for the collection list", () => {
    const action = planCollectionAction(null, "stamp-1", "collection", 0);
    expect(action).toEqual({ kind: "create", stampId: "stamp-1", listType: "collection", quantity: 1 });
  });

  test("no-ops when the same list and same quantity are requested again", () => {
    const current = makeItem({ id: 7, listType: "collection", quantity: 3 });
    const action = planCollectionAction(current, "stamp-1", "collection", 3);
    expect(action).toEqual({ kind: "none" });
  });

  test("updates quantity in place when the list stays the same but quantity changes", () => {
    const current = makeItem({ id: 7, listType: "collection", quantity: 3 });
    const action = planCollectionAction(current, "stamp-1", "collection", 5);
    expect(action).toEqual({ kind: "update", id: 7, quantity: 5 });
  });

  test("switches (delete old, create new) when moving between lists", () => {
    const current = makeItem({ id: 7, listType: "wishlist", quantity: 1 });
    const action = planCollectionAction(current, "stamp-1", "trade", 1);
    expect(action).toEqual({
      kind: "switch",
      deleteId: 7,
      stampId: "stamp-1",
      listType: "trade",
      quantity: 1,
    });
  });

  test("removes the current item when target is 'none'", () => {
    const current = makeItem({ id: 7 });
    const action = planCollectionAction(current, "stamp-1", "none", 1);
    expect(action).toEqual({ kind: "remove", id: 7 });
  });

  test("no-ops clearing when there was nothing to clear", () => {
    const action = planCollectionAction(null, "stamp-1", "none", 1);
    expect(action).toEqual({ kind: "none" });
  });
});

describe("executeCollectionAction", () => {
  test("'none' short-circuits without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await executeCollectionAction({ kind: "none" }, fetchImpl as any);
    expect(result).toEqual({ success: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("'create' issues a POST with stampId/listType/quantity", async () => {
    const item = makeItem({ id: 10, listType: "wishlist", quantity: 1 });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, item }), { status: 201 })
    );
    const result = await executeCollectionAction(
      { kind: "create", stampId: "stamp-1", listType: "wishlist", quantity: 1 },
      fetchImpl as any
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/collection");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ stampId: "stamp-1", listType: "wishlist", quantity: 1 });
    expect(result).toEqual({ success: true, item });
  });

  test("'update' issues a PUT with id/quantity", async () => {
    const item = makeItem({ id: 10, quantity: 4 });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, item }), { status: 200 })
    );
    const result = await executeCollectionAction({ kind: "update", id: 10, quantity: 4 }, fetchImpl as any);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/collection");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ id: 10, quantity: 4 });
    expect(result).toEqual({ success: true, item });
  });

  test("'remove' issues a DELETE with id as a query param", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const result = await executeCollectionAction({ kind: "remove", id: 10 }, fetchImpl as any);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/collection?id=10");
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ success: true });
  });

  test("'switch' issues a DELETE followed by a POST", async () => {
    const item = makeItem({ id: 99, listType: "trade", quantity: 1 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, item }), { status: 201 }));

    const result = await executeCollectionAction(
      { kind: "switch", deleteId: 7, stampId: "stamp-1", listType: "trade", quantity: 1 },
      fetchImpl as any
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/collection?id=7");
    expect(fetchImpl.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchImpl.mock.calls[1][0]).toBe("/api/collection");
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
    expect(result).toEqual({ success: true, item });
  });

  test("'switch' does not create the new membership if the delete fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Item not found or unauthorized" }), { status: 404 }));

    const result = await executeCollectionAction(
      { kind: "switch", deleteId: 7, stampId: "stamp-1", listType: "trade", quantity: 1 },
      fetchImpl as any
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.code).toBe("not_found");
    // Nothing was deleted, so the old membership is still there and the
    // caller must NOT clear its local state.
    expect(result.clearedPrevious).toBeFalsy();
  });

  test("'switch' reports that the old membership was already cleared when the create fails", async () => {
    // The dangerous half of a switch: the DELETE lands, the POST does not.
    // The server now holds NO membership for this stamp, so a caller that
    // keeps showing the old list is lying about the server's state.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid list_type" }), { status: 400 })
      );

    const result = await executeCollectionAction(
      { kind: "switch", deleteId: 7, stampId: "stamp-1", listType: "trade", quantity: 1 },
      fetchImpl as any
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.clearedPrevious).toBe(true);
    // The failure code from the POST is preserved so a 401 can still demote
    // the widget to the login prompt.
    expect(result.code).toBe("validation");
    // Spanish, and it must say what actually happened: the stamp is now in
    // no list at all.
    expect(result.error).toMatch(/ninguna lista/i);
  });

  test("'switch' also reports the cleared membership when the create throws (offline)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"));

    const result = await executeCollectionAction(
      { kind: "switch", deleteId: 7, stampId: "stamp-1", listType: "trade", quantity: 1 },
      fetchImpl as any
    );

    expect(result.success).toBe(false);
    expect(result.clearedPrevious).toBe(true);
    expect(result.code).toBe("network");
  });

  test("maps a 401 mid-session to an 'unauthenticated' code with a Spanish message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unauthenticated" }), { status: 401 }));
    const result = await executeCollectionAction(
      { kind: "create", stampId: "stamp-1", listType: "wishlist", quantity: 1 },
      fetchImpl as any
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("unauthenticated");
    expect(result.error).toMatch(/sesión/i);
  });

  test("maps a 400 to a 'validation' code using the server's message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid quantity: must be an integer >= 1" }), { status: 400 })
    );
    const result = await executeCollectionAction(
      { kind: "update", id: 10, quantity: 0 },
      fetchImpl as any
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("validation");
    expect(result.error).toBe("Invalid quantity: must be an integer >= 1");
  });

  test("maps a thrown fetch (network failure) to a 'network' code", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await executeCollectionAction(
      { kind: "create", stampId: "stamp-1", listType: "wishlist", quantity: 1 },
      fetchImpl as any
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("network");
  });
});

// The shared request helpers the collection list pages (/perfil and
// /colecciones) call instead of hand-rolling their own PUT/DELETE.
describe("updateCollectionItemFields", () => {
  test("issues a PUT with the id and only the supplied fields", async () => {
    const item = makeItem({ id: 10, condition: "MH", quantity: 4, notes: "Nota" });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, item }), { status: 200 })
    );

    const result = await updateCollectionItemFields(
      10,
      { condition: "MH", quantity: 4, notes: "Nota" },
      fetchImpl as any
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/collection");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ id: 10, condition: "MH", quantity: 4, notes: "Nota" });
    expect(result).toEqual({ success: true, item });
  });

  test("omits fields the caller did not supply (an absent quantity is not a reset)", async () => {
    const item = makeItem({ id: 10 });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, item }), { status: 200 })
    );

    await updateCollectionItemFields(10, { condition: "MNH", quantity: undefined }, fetchImpl as any);

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ id: 10, condition: "MNH" });
  });

  test("maps a server error through the same code/message mapping", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Collection item not found" }), { status: 404 })
    );
    const result = await updateCollectionItemFields(10, { condition: "MNH" }, fetchImpl as any);
    expect(result.success).toBe(false);
    expect(result.code).toBe("not_found");
  });

  test("maps a thrown fetch (timeout/offline) to a 'network' code", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("AbortError"));
    const result = await updateCollectionItemFields(10, { condition: "MNH" }, fetchImpl as any);
    expect(result.success).toBe(false);
    expect(result.code).toBe("network");
  });
});

// The list pages used to swallow a failed edit/delete into console.error, so
// a 401 on the trash icon left the card on screen with no message and a
// failed save looked exactly like a successful one. This is the single
// decision both pages and CollectionTabs now share: "is there something the
// user must be told, and if so, in Spanish?".
describe("collectionFailureMessage", () => {
  test("returns null for a successful result (nothing to tell the user)", () => {
    expect(collectionFailureMessage({ success: true })).toBeNull();
    expect(collectionFailureMessage({ success: true, item: makeItem() })).toBeNull();
  });

  test("passes the Spanish message a failed result already carries", () => {
    const message = collectionFailureMessage({
      success: false,
      error: "Tu sesión expiró. Inicia sesión de nuevo para continuar.",
      code: "unauthenticated",
    });
    expect(message).toBe("Tu sesión expiró. Inicia sesión de nuevo para continuar.");
  });

  test("never returns an empty message for a failure without one", () => {
    const message = collectionFailureMessage({ success: false });
    expect(message).toBeTruthy();
    // Spanish, matching the surrounding UI copy.
    expect(message).toMatch(/no se pudo/i);
  });
});

// After a failed write the stepper must show what the SERVER holds, not the
// optimistic value the click produced: showing 4 while the server still has 3
// makes the next "+" plan an update to 5 and silently skip a value.
describe("displayQuantityFor", () => {
  test("reflects the stored quantity of a collection item", () => {
    expect(displayQuantityFor(makeItem({ listType: "collection", quantity: 3 }))).toBe(3);
  });

  test("is pinned to 1 for membership-only lists", () => {
    expect(displayQuantityFor(makeItem({ listType: "wishlist", quantity: 7 }))).toBe(1);
    expect(displayQuantityFor(makeItem({ listType: "trade", quantity: 7 }))).toBe(1);
    expect(displayQuantityFor(makeItem({ listType: "ignore", quantity: 7 }))).toBe(1);
  });

  test("is 1 when there is no membership at all", () => {
    expect(displayQuantityFor(null)).toBe(1);
  });
});

describe("deleteCollectionItemById", () => {
  test("issues a DELETE with the id as a query param", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const result = await deleteCollectionItemById(10, fetchImpl as any);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/collection?id=10");
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ success: true });
  });

  test("maps a thrown fetch (timeout/offline) to a 'network' code", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("AbortError"));
    const result = await deleteCollectionItemById(10, fetchImpl as any);
    expect(result.success).toBe(false);
    expect(result.code).toBe("network");
  });
});
