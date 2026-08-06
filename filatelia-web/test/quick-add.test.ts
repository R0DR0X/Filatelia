import { test } from "node:test";
import assert from "node:assert";
import {
  QUICK_ADD_ORDER,
  quickAddSpec,
  toggleMembership,
  type QuickAddListType,
} from "../src/lib/quickAdd";

test("there are exactly three quick-add lists, in a stable order", () => {
  // The card renders these into a fixed 3-column grid. A fourth entry would
  // silently wrap to a second row and reintroduce the overflow this replaced.
  assert.deepStrictEqual(QUICK_ADD_ORDER, ["collection", "wishlist", "trade"]);
});

test("every list has an accessible name in both states", () => {
  // Icon-only buttons: this string is the ONLY thing naming the control for a
  // screen reader or a hover. An empty one is an invisible failure.
  for (const listType of QUICK_ADD_ORDER) {
    for (const active of [true, false]) {
      const spec = quickAddSpec(listType, active);
      assert.ok(spec.label.trim().length > 0, `${listType}/${active} needs a label`);
      assert.ok(spec.shortLabel.trim().length > 0, `${listType}/${active} needs a short label`);
    }
  }
});

test("the label describes the action when inactive and the state when active", () => {
  assert.strictEqual(quickAddSpec("collection", false).label, "Añadir a tu colección");
  assert.strictEqual(quickAddSpec("collection", true).label, "En tu colección");
  assert.strictEqual(quickAddSpec("wishlist", false).label, "Añadir a tus deseos");
  assert.strictEqual(quickAddSpec("trade", true).label, "En tus intercambios");
});

test("the two states are always distinguishable", () => {
  // If a list ever read the same active and inactive, the button would give no
  // feedback at all to anyone relying on the accessible name.
  for (const listType of QUICK_ADD_ORDER) {
    assert.notStrictEqual(
      quickAddSpec(listType, true).label,
      quickAddSpec(listType, false).label,
      `${listType} must read differently when active`,
    );
  }
});

test("no two lists share a label", () => {
  const labels = QUICK_ADD_ORDER.flatMap((l) => [
    quickAddSpec(l, true).label,
    quickAddSpec(l, false).label,
  ]);
  assert.strictEqual(new Set(labels).size, labels.length, "labels must be unique");
});

test("the short label never changes with state", () => {
  // This is the invariant the layout bug violated. The card sizes its buttons
  // from a grid rather than from text, but the roomy variant must not start
  // resizing on click either.
  for (const listType of QUICK_ADD_ORDER) {
    assert.strictEqual(
      quickAddSpec(listType, true).shortLabel,
      quickAddSpec(listType, false).shortLabel,
      `${listType}'s visible text must not change width on toggle`,
    );
  }
});

test("toggling adds a list that is not there", () => {
  assert.deepStrictEqual(toggleMembership([], "collection"), ["collection"]);
});

test("toggling removes a list that is there", () => {
  assert.deepStrictEqual(toggleMembership(["collection", "trade"], "collection"), ["trade"]);
});

test("toggling one list never disturbs the others", () => {
  const before: QuickAddListType[] = ["wishlist", "trade"];
  assert.deepStrictEqual(toggleMembership(before, "collection"), ["wishlist", "trade", "collection"]);
  assert.deepStrictEqual(before, ["wishlist", "trade"], "the input must not be mutated");
});

test("toggling twice returns to the starting set", () => {
  const start: QuickAddListType[] = ["wishlist"];
  const round = toggleMembership(toggleMembership(start, "collection"), "collection");
  assert.deepStrictEqual([...round].sort(), [...start].sort());
});
