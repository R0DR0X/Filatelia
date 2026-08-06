import { test } from "node:test";
import assert from "node:assert";
import {
  buildCatalogRefs,
  buildTechnicalSpecs,
  buildBrowseLinks,
  buildVariantLabel,
  parseBrowseFilters,
  type StampDetail,
  type StampVariant,
} from "../src/lib/stampDetail";

/**
 * The detail page has to render against data that is mostly absent. All
 * 147,555 production rows have NULL sizeMm, and the four E3 columns
 * (colnectCode, format, emission, gum) are NULL for every one of them until
 * the Colnect detail phase runs. "Renders nothing" and "renders an empty
 * label" look identical in a screenshot and are completely different bugs, so
 * the field selection is a pure function with tests rather than a pile of
 * `&&` in JSX.
 */
const EMPTY: StampDetail = {
  id: "s1",
  wnsNumber: null, scottNumber: null, michelNumber: null, yvertNumber: null,
  colnectCode: null,
  countryCode: null, countryNameEs: null, countryNameEn: null,
  year: null, issueDate: null, denomination: null, currency: null,
  nameEs: null, nameEn: null, descriptionEs: null, descriptionEn: null,
  imageUrl: null, theme: null, source: null,
  isVerified: 0, isRare: 0,
  marketPriceUsd: null, rarityScore: null,
  groupId: null, groupTitleEs: null, groupTitleEn: null,
  color: null, perforation: null, printRun: null, designer: null, printer: null,
  sizeMm: null, format: null, emission: null, gum: null,
  printTechnique: null, paperType: null, watermark: null,
};

test("a stamp with no catalogue numbers offers no reference chips", () => {
  assert.deepStrictEqual(buildCatalogRefs(EMPTY), []);
});

test("catalogue chips appear in catalogue order and skip the missing ones", () => {
  const refs = buildCatalogRefs({ ...EMPTY, wnsNumber: "NZ001.06", colnectCode: "NZ-1234", yvertNumber: "2312" });
  assert.deepStrictEqual(refs, [
    { label: "WNS", value: "NZ001.06" },
    { label: "Yvert", value: "2312" },
    { label: "Colnect", value: "NZ-1234" },
  ]);
});

test("an all-NULL stamp shows no technical specs block at all", () => {
  // This is the case for essentially every stamp in production today.
  assert.deepStrictEqual(buildTechnicalSpecs(EMPTY), []);
});

test("the four E3 fields reach the specs block once the scraper fills them", () => {
  const specs = buildTechnicalSpecs({
    ...EMPTY,
    color: "Multicolor",
    sizeMm: "30 x 40",
    format: "Stamp",
    emission: "Commemorative",
    gum: "PVA",
    printRun: 1_500_000,
  });
  const byLabel = Object.fromEntries(specs.map((s) => [s.label, s.value]));

  assert.strictEqual(byLabel["Tamaño"], "30 x 40");
  assert.strictEqual(byLabel["Formato"], "Stamp");
  assert.strictEqual(byLabel["Emisión"], "Commemorative");
  assert.strictEqual(byLabel["Goma"], "PVA");
  assert.strictEqual(byLabel["Color"], "Multicolor");
  // Print run is a number and must reach the UI already formatted.
  // es-PE groups with commas, not periods — the rest of the app already
  // formats this way, so the detail page must not diverge from it.
  assert.strictEqual(byLabel["Tiraje"], "1,500,000");
});

test("a zero print run is a real value, not a missing one", () => {
  // `printRun && ...` would drop this. A stamp with a recorded run of 0 is
  // philatelically meaningful (an announced-but-unissued printing).
  const specs = buildTechnicalSpecs({ ...EMPTY, printRun: 0 });
  assert.deepStrictEqual(specs, [{ label: "Tiraje", value: "0" }]);
});

test("whitespace-only scraped text counts as missing", () => {
  // Colnect detail cells frequently come back as "" or " " rather than absent.
  assert.deepStrictEqual(buildTechnicalSpecs({ ...EMPTY, color: "   ", gum: "" }), []);
});

// ── E3.6: navigation ────────────────────────────────────────────────────────

test("nothing to browse by means no browse links", () => {
  assert.deepStrictEqual(buildBrowseLinks(EMPTY), { country: null, theme: null, series: null });
});

test("country, theme and series each become a filtered catalogue link", () => {
  const links = buildBrowseLinks({
    ...EMPTY,
    countryCode: "nz",
    countryNameEs: "Nueva Zelanda",
    theme: "Montañas",
    groupId: "group-nz-2006",
    groupTitleEs: "Paisajes 2006",
  });

  assert.deepStrictEqual(links.country, { label: "Nueva Zelanda", href: "/biblioteca?countryCode=NZ" });
  assert.deepStrictEqual(links.theme, { label: "Montañas", href: "/biblioteca?theme=Monta%C3%B1as" });
  assert.deepStrictEqual(links.series, { label: "Paisajes 2006", href: "/biblioteca?groupId=group-nz-2006" });
});

test("a theme with a slash or ampersand survives the round trip into a link", () => {
  const links = buildBrowseLinks({ ...EMPTY, theme: "Fauna & Flora / Aves" });
  assert.strictEqual(links.theme?.href, "/biblioteca?theme=Fauna%20%26%20Flora%20%2F%20Aves");
  assert.strictEqual(
    parseBrowseFilters(new URLSearchParams(links.theme!.href.split("?")[1])).theme,
    "Fauna & Flora / Aves",
  );
});

test("a series with no title is not linkable even when it has an id", () => {
  // Every stamp has a groupId (it is NOT NULL); a link labelled with a raw
  // `group-xx-1994` slug is worse than no link.
  assert.strictEqual(buildBrowseLinks({ ...EMPTY, groupId: "group-nz-2006" }).series, null);
});

// ── The catalogue side of those links ───────────────────────────────────────

test("the catalogue reads every filter the detail page can link to", () => {
  const filters = parseBrowseFilters(
    new URLSearchParams("countryCode=pe&theme=Aves&groupId=group-pe-1994&search=cormoran&yearFrom=1990&yearTo=1999"),
  );
  assert.deepStrictEqual(filters, {
    countryCode: "PE",
    theme: "Aves",
    groupId: "group-pe-1994",
    search: "cormoran",
    yearFrom: "1990",
    yearTo: "1999",
  });
});

test("an empty query string yields no filters rather than empty-string filters", () => {
  // `?countryCode=` must not become `countryCode=""`, which the Worker would
  // treat as a real filter and match nothing.
  const filters = parseBrowseFilters(new URLSearchParams("countryCode=&theme=&search="));
  assert.deepStrictEqual(filters, {
    countryCode: null, theme: null, groupId: null, search: null, yearFrom: null, yearTo: null,
  });
});

test("a non-numeric year in the URL is discarded, not forwarded", () => {
  const filters = parseBrowseFilters(new URLSearchParams("yearFrom=abc&yearTo=1999"));
  assert.strictEqual(filters.yearFrom, null);
  assert.strictEqual(filters.yearTo, "1999");
});

// ── Variants ────────────────────────────────────────────────────────────────

const VARIANT: StampVariant = {
  id: "v1", colnectCode: null, nameEs: null, nameEn: null, description: null,
  denomination: null, currency: null, color: null, perforation: null,
  gum: null, format: null, imageUrl: null, sourceUrl: null,
};

test("a variant falls back to its distinguishing traits when it has no name", () => {
  // Colnect variants are often unnamed and identified only by what differs.
  assert.strictEqual(
    buildVariantLabel({ ...VARIANT, perforation: "13½", color: "Azul" }),
    "Azul · 13½",
  );
});

test("a named variant uses its name", () => {
  assert.strictEqual(buildVariantLabel({ ...VARIANT, nameEs: "Sin dentar", color: "Azul" }), "Sin dentar");
});

test("a variant with nothing to show still gets a stable label", () => {
  assert.strictEqual(buildVariantLabel(VARIANT), "Variante");
});

test("a variant's face value is part of its label", () => {
  assert.strictEqual(
    buildVariantLabel({ ...VARIANT, denomination: 1.5, currency: "NZD" }),
    "1.5 NZD",
  );
});
