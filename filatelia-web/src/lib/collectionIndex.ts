/**
 * A stamp-id → membership lookup for pages that render many stamps at once.
 *
 * WHY THIS EXISTS. The catalogue draws up to 16 stamps per emission group and
 * many groups per country. Having each card ask `/api/collection` for itself
 * would fire dozens of identical requests for one screen, all returning the
 * same full list — the endpoint has no per-stamp filter. One fetch per page,
 * indexed here, is the difference between 1 request and ~100.
 *
 * ONE MEMBERSHIP PER STAMP. `UserCollection` is UNIQUE per
 * (user, stamp, list_type), so the database permits a stamp to sit in several
 * lists at once — but the product does not. The detail page's four-state
 * control (collection / wishlist / trade / ignore) is single-select and
 * implements a switch as delete-then-create precisely so a stamp never
 * accumulates memberships. The catalogue card used to disagree with that,
 * toggling each list independently, which is how a stamp could end up in two
 * lists that the detail page could then neither display nor fully remove.
 * This index takes the detail page's model as the truth: at most one
 * membership per stamp.
 */

import { UserCollectionItem } from "@/types/collection";

export type CollectionIndex = Record<string, UserCollectionItem>;

/**
 * Builds the lookup. When the stored data already contains several
 * memberships for one stamp — which existing rows may, since the catalogue
 * card used to create them — the FIRST is kept, matching `findItemForStamp`
 * in collectionControl.ts so both surfaces agree on which one is shown.
 */
export function buildCollectionIndex(items: UserCollectionItem[]): CollectionIndex {
  const index: CollectionIndex = {};
  for (const item of items) {
    if (!item || typeof item.stampId !== "string" || item.stampId === "") continue;
    if (index[item.stampId]) continue;
    index[item.stampId] = item;
  }
  return index;
}

/** The membership for a stamp, or null. */
export function itemForStamp(index: CollectionIndex, stampId: string): UserCollectionItem | null {
  return index[stampId] ?? null;
}

/** Returns a new index with `item` recorded for its stamp. Never mutates. */
export function withItem(index: CollectionIndex, item: UserCollectionItem): CollectionIndex {
  return { ...index, [item.stampId]: item };
}

/** Returns a new index with the stamp's membership dropped. Never mutates. */
export function withoutStamp(index: CollectionIndex, stampId: string): CollectionIndex {
  if (!(stampId in index)) return index;
  const next = { ...index };
  delete next[stampId];
  return next;
}
