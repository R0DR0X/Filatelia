import { test } from "node:test";
import assert from "node:assert";
import {
  buildCollectionIndex,
  itemForStamp,
  withItem,
  withoutStamp,
} from "../src/lib/collectionIndex";
import { UserCollectionItem } from "../src/types/collection";

function item(over: Partial<UserCollectionItem> & { id: number; stampId: string }): UserCollectionItem {
  return {
    userId: "usr_1",
    listType: "collection",
    condition: "MNH",
    quantity: 1,
    createdAt: "",
    updatedAt: "",
    ...over,
  } as UserCollectionItem;
}

test("an empty collection indexes to nothing", () => {
  assert.deepStrictEqual(buildCollectionIndex([]), {});
});

test("each stamp is reachable by its id", () => {
  const index = buildCollectionIndex([
    item({ id: 1, stampId: "s1", listType: "collection" }),
    item({ id: 2, stampId: "s2", listType: "wishlist" }),
  ]);
  assert.strictEqual(itemForStamp(index, "s1")?.listType, "collection");
  assert.strictEqual(itemForStamp(index, "s2")?.listType, "wishlist");
});

test("a stamp with no membership reads as null, not undefined", () => {
  assert.strictEqual(itemForStamp(buildCollectionIndex([]), "ghost"), null);
});

test("a stamp stored in two lists keeps the first, like the detail page does", () => {
  // The old catalogue card toggled each list independently, so production may
  // hold a stamp in both collection and wishlist. findItemForStamp in
  // collectionControl.ts returns the first match; this must agree, or the
  // catalogue and the ficha would disagree about the same stamp.
  const index = buildCollectionIndex([
    item({ id: 1, stampId: "s1", listType: "collection" }),
    item({ id: 2, stampId: "s1", listType: "wishlist" }),
  ]);
  assert.strictEqual(itemForStamp(index, "s1")?.id, 1);
  assert.strictEqual(Object.keys(index).length, 1);
});

test("rows with no usable stamp id are skipped rather than indexed under junk", () => {
  const index = buildCollectionIndex([
    item({ id: 1, stampId: "" }),
    { ...item({ id: 2, stampId: "x" }), stampId: undefined } as unknown as UserCollectionItem,
    item({ id: 3, stampId: "s3" }),
  ]);
  assert.deepStrictEqual(Object.keys(index), ["s3"]);
});

test("adding an item does not mutate the original index", () => {
  const before = buildCollectionIndex([item({ id: 1, stampId: "s1" })]);
  const after = withItem(before, item({ id: 2, stampId: "s2", listType: "trade" }));
  assert.strictEqual(itemForStamp(before, "s2"), null, "the original must be untouched");
  assert.strictEqual(itemForStamp(after, "s2")?.listType, "trade");
});

test("adding an item for a stamp that already has one replaces it", () => {
  // This is what a switch looks like locally: one membership in, one out.
  const before = buildCollectionIndex([item({ id: 1, stampId: "s1", listType: "collection" })]);
  const after = withItem(before, item({ id: 9, stampId: "s1", listType: "trade" }));
  assert.strictEqual(itemForStamp(after, "s1")?.listType, "trade");
  assert.strictEqual(Object.keys(after).length, 1, "a stamp still holds exactly one membership");
});

test("removing a stamp does not mutate the original index", () => {
  const before = buildCollectionIndex([item({ id: 1, stampId: "s1" })]);
  const after = withoutStamp(before, "s1");
  assert.strictEqual(itemForStamp(before, "s1")?.id, 1);
  assert.strictEqual(itemForStamp(after, "s1"), null);
});

test("removing a stamp that was never there returns the same index", () => {
  const before = buildCollectionIndex([item({ id: 1, stampId: "s1" })]);
  assert.strictEqual(withoutStamp(before, "ghost"), before, "no pointless re-render");
});
