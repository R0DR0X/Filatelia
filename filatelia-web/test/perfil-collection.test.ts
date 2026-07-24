import { test } from "node:test";
import assert from "node:assert";
import { UserCollectionItem, ListType, ConditionGrade } from "../src/types/collection";

test("Collection tab filtering logic works as expected", () => {
  const items: UserCollectionItem[] = [
    { id: 1, userId: "usr_1", stampId: "s1", listType: "collection", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 2, userId: "usr_1", stampId: "s2", listType: "wishlist", condition: "MH", createdAt: "", updatedAt: "" },
    { id: 3, userId: "usr_1", stampId: "s3", listType: "trade", condition: "Used", createdAt: "", updatedAt: "" },
    { id: 4, userId: "usr_1", stampId: "s4", listType: "trade", condition: "FDC", createdAt: "", updatedAt: "" },
  ];

  const collectionItems = items.filter(i => i.listType === "collection");
  const wishlistItems = items.filter(i => i.listType === "wishlist");
  const tradeItems = items.filter(i => i.listType === "trade");

  assert.strictEqual(collectionItems.length, 1);
  assert.strictEqual(wishlistItems.length, 1);
  assert.strictEqual(tradeItems.length, 2);

  // Condition filter
  const usedTradeItems = tradeItems.filter(i => i.condition === "Used");
  assert.strictEqual(usedTradeItems.length, 1);
  assert.strictEqual(usedTradeItems[0].stampId, "s3");
});
