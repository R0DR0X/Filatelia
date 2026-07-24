import { test } from "node:test";
import assert from "node:assert";
import { calculateReciprocalMatches } from "../src/lib/match-engine";
import { UserCollectionItem } from "../src/types/collection";

test("calculateReciprocalMatches correctly computes 2-way trade proposals", () => {
  // User A: Trade=[S1, S2, S3], Wishlist=[S4, S5]
  // User B: Trade=[S4, S6], Wishlist=[S1, S7]
  const items: UserCollectionItem[] = [
    { id: 1, userId: "usr_A", stampId: "S1", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 2, userId: "usr_A", stampId: "S2", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 3, userId: "usr_A", stampId: "S3", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 4, userId: "usr_A", stampId: "S4", listType: "wishlist", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 5, userId: "usr_A", stampId: "S5", listType: "wishlist", condition: "MNH", createdAt: "", updatedAt: "" },

    { id: 6, userId: "usr_B", stampId: "S4", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 7, userId: "usr_B", stampId: "S6", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 8, userId: "usr_B", stampId: "S1", listType: "wishlist", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 9, userId: "usr_B", stampId: "S7", listType: "wishlist", condition: "MNH", createdAt: "", updatedAt: "" },
  ];

  const proposals = calculateReciprocalMatches("usr_A", items);
  assert.strictEqual(proposals.length, 1);

  const p = proposals[0];
  assert.strictEqual(p.partnerUserId, "usr_B");
  assert.deepStrictEqual(p.itemsYouGive, ["S1"]);
  assert.deepStrictEqual(p.itemsYouGet, ["S4"]);
  // Wishlist size total: usr_A (2) + usr_B (2) = 4. Items matched: 1 + 1 = 2. Match Score: 2/4 * 100 = 50.0%
  assert.strictEqual(p.matchScore, 50.0);
});

test("calculateReciprocalMatches excludes non-reciprocal matches (|M_AC| = 0)", () => {
  // User A: Trade=[S1], Wishlist=[S2]
  // User C: Trade=[S2], Wishlist=[S3] (User C has S2 wanted by A, but wants S3 which A does NOT have)
  const items: UserCollectionItem[] = [
    { id: 1, userId: "usr_A", stampId: "S1", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 2, userId: "usr_A", stampId: "S2", listType: "wishlist", condition: "MNH", createdAt: "", updatedAt: "" },

    { id: 3, userId: "usr_C", stampId: "S2", listType: "trade", condition: "MNH", createdAt: "", updatedAt: "" },
    { id: 4, userId: "usr_C", stampId: "S3", listType: "wishlist", condition: "MNH", createdAt: "", updatedAt: "" },
  ];

  const proposals = calculateReciprocalMatches("usr_A", items);
  assert.strictEqual(proposals.length, 0); // Excluded because User C wants nothing User A has (|M_AC| = 0)
});
