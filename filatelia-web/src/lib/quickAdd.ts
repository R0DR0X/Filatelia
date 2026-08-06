/**
 * Descriptors for the three quick-add buttons on a catalogue card.
 *
 * These live outside the component because of the bug that produced them.
 * The buttons used to be laid out by their own text — `+ Colección` became
 * `En Colección` when you clicked it — inside a flex row with no wrapping,
 * on cards as narrow as 79px in a 3-to-8 column grid. Flex items do not
 * shrink below their content, the card clips with overflow-hidden, and the
 * row's width changed with the toggle state, so the layout moved as you used
 * it.
 *
 * The fix makes the rendered width independent of state: the card renders
 * icon-only buttons in a fixed 3-column grid. That means the words below are
 * no longer visible text — they are the accessible name and the tooltip, the
 * ONLY thing telling a user what each icon does. Getting them wrong is now a
 * silent accessibility failure rather than a visible typo, which is exactly
 * why they are unit tested.
 */

import { ListType } from "@/types/collection";

export type QuickAddListType = Extract<ListType, "collection" | "wishlist" | "trade">;

export interface QuickAddSpec {
  listType: QuickAddListType;
  /** Accessible name and tooltip. Describes the ACTION when inactive, the STATE when active. */
  label: string;
  /** Short visible text for the roomy variant. Never rendered in the card. */
  shortLabel: string;
}

/** Fixed order: what you own, what you want, what you will swap. */
export const QUICK_ADD_ORDER: QuickAddListType[] = ["collection", "wishlist", "trade"];

const LABELS: Record<QuickAddListType, { active: string; inactive: string; short: string }> = {
  collection: { active: "En tu colección", inactive: "Añadir a tu colección", short: "Colección" },
  wishlist: { active: "En tus deseos", inactive: "Añadir a tus deseos", short: "Deseos" },
  trade: { active: "En tus intercambios", inactive: "Añadir a tus intercambios", short: "Canje" },
};

export function quickAddSpec(listType: QuickAddListType, isActive: boolean): QuickAddSpec {
  const entry = LABELS[listType];
  return {
    listType,
    label: isActive ? entry.active : entry.inactive,
    shortLabel: entry.short,
  };
}

// There is deliberately no `toggleMembership` set helper here. An earlier
// version had one, because the card treated the three lists as independent
// tags. It does not: a stamp is in at most ONE list, the same model the
// detail page enforces, and the transition is owned by `planCollectionAction`
// in collectionControl.ts. A tested helper implementing the multi-select
// model would be a standing invitation to go back to it.
