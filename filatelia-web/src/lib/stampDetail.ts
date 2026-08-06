/**
 * Presentation logic for the stamp detail page (E3).
 *
 * This is separate from the component for one reason: almost every field it
 * handles is NULL in production. The Colnect detail phase has never run, so
 * `sizeMm`, `colnectCode`, `format`, `emission` and `gum` are empty on all
 * 147,555 rows, and variants do not exist yet at all. The page must render
 * cleanly today, fill in silently when the scraper finally runs, and never
 * show a labelled row with nothing next to it. That behaviour is worth
 * testing, and JSX conditionals are not testable.
 */

export interface StampDetail {
  id: string;
  wnsNumber: string | null;
  scottNumber: string | null;
  michelNumber: string | null;
  yvertNumber: string | null;
  colnectCode: string | null;
  countryCode: string | null;
  countryNameEs: string | null;
  countryNameEn: string | null;
  year: number | null;
  issueDate: string | null;
  denomination: number | null;
  currency: string | null;
  nameEs: string | null;
  nameEn: string | null;
  descriptionEs: string | null;
  descriptionEn: string | null;
  imageUrl: string | null;
  theme: string | null;
  source: string | null;
  isVerified: number;
  isRare: number;
  marketPriceUsd: number | null;
  rarityScore: number | null;
  groupId: string | null;
  groupTitleEs: string | null;
  groupTitleEn: string | null;
  color: string | null;
  perforation: string | null;
  printRun: number | null;
  designer: string | null;
  printer: string | null;
  // Added by migration 0012 — NULL everywhere until the detail scraper runs.
  sizeMm: string | null;
  format: string | null;
  emission: string | null;
  gum: string | null;
  printTechnique: string | null;
  paperType: string | null;
  watermark: string | null;
}

export interface StampVariant {
  id: string;
  colnectCode: string | null;
  nameEs: string | null;
  nameEn: string | null;
  description: string | null;
  denomination: number | null;
  currency: string | null;
  color: string | null;
  perforation: string | null;
  gum: string | null;
  format: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
}

export interface LabelledValue {
  label: string;
  value: string;
}

export interface BrowseLink {
  label: string;
  href: string;
}

export interface BrowseLinks {
  country: BrowseLink | null;
  theme: BrowseLink | null;
  series: BrowseLink | null;
}

export interface BrowseFilters {
  countryCode: string | null;
  theme: string | null;
  groupId: string | null;
  search: string | null;
  yearFrom: string | null;
  yearTo: string | null;
}

/**
 * Scraped text arrives as "", " " or null more or less interchangeably.
 * Everything in this module funnels through here so "missing" means one thing.
 */
function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Numbers need their own guard: 0 is a value, not an absence. */
function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Catalogue reference chips, in the order collectors expect to read them. */
export function buildCatalogRefs(stamp: StampDetail): LabelledValue[] {
  const candidates: LabelledValue[] = [
    { label: "WNS", value: text(stamp.wnsNumber) ?? "" },
    { label: "Scott", value: text(stamp.scottNumber) ?? "" },
    { label: "Michel", value: text(stamp.michelNumber) ?? "" },
    { label: "Yvert", value: text(stamp.yvertNumber) ?? "" },
    { label: "Colnect", value: text(stamp.colnectCode) ?? "" },
  ];
  return candidates.filter((ref) => ref.value !== "");
}

/**
 * The technical block, Colnect's field set. Anything absent is omitted
 * entirely — the caller renders no heading at all when this comes back empty,
 * which is the case for nearly every stamp until the detail scraper runs.
 */
export function buildTechnicalSpecs(stamp: StampDetail): LabelledValue[] {
  const printRun = num(stamp.printRun);
  const specs: Array<LabelledValue | null> = [
    text(stamp.color) ? { label: "Color", value: text(stamp.color)! } : null,
    text(stamp.sizeMm) ? { label: "Tamaño", value: text(stamp.sizeMm)! } : null,
    text(stamp.format) ? { label: "Formato", value: text(stamp.format)! } : null,
    text(stamp.emission) ? { label: "Emisión", value: text(stamp.emission)! } : null,
    text(stamp.perforation) ? { label: "Perforación", value: text(stamp.perforation)! } : null,
    text(stamp.gum) ? { label: "Goma", value: text(stamp.gum)! } : null,
    text(stamp.paperType) ? { label: "Papel", value: text(stamp.paperType)! } : null,
    text(stamp.watermark) ? { label: "Filigrana", value: text(stamp.watermark)! } : null,
    text(stamp.printTechnique) ? { label: "Impresión", value: text(stamp.printTechnique)! } : null,
    printRun !== null ? { label: "Tiraje", value: printRun.toLocaleString("es-PE") } : null,
    text(stamp.designer) ? { label: "Diseñador", value: text(stamp.designer)! } : null,
    text(stamp.printer) ? { label: "Impresor", value: text(stamp.printer)! } : null,
  ];
  return specs.filter((spec): spec is LabelledValue => spec !== null);
}

/**
 * E3.6 — country, theme and series as catalogue navigation, the way Colnect
 * does it. Each link is only produced when it can carry a label a human can
 * read: a stamp always has a `groupId`, but linking a raw `group-nz-2006`
 * slug is worse than not linking at all.
 */
export function buildBrowseLinks(stamp: StampDetail): BrowseLinks {
  const countryCode = text(stamp.countryCode)?.toUpperCase() ?? null;
  const countryLabel = text(stamp.countryNameEs) ?? text(stamp.countryNameEn) ?? countryCode;
  const theme = text(stamp.theme);
  const groupId = text(stamp.groupId);
  const seriesLabel = text(stamp.groupTitleEs) ?? text(stamp.groupTitleEn);

  return {
    country: countryCode && countryLabel
      ? { label: countryLabel, href: `/biblioteca?countryCode=${encodeURIComponent(countryCode)}` }
      : null,
    theme: theme
      ? { label: theme, href: `/biblioteca?theme=${encodeURIComponent(theme)}` }
      : null,
    series: groupId && seriesLabel
      ? { label: seriesLabel, href: `/biblioteca?groupId=${encodeURIComponent(groupId)}` }
      : null,
  };
}

/**
 * The other half of E3.6. The catalogue page ignored its query string
 * entirely, so the country link that already existed in the detail
 * breadcrumb navigated to an unfiltered catalogue — a link that looks like it
 * works. Adding two more links without this would have tripled the problem.
 *
 * Empty values are dropped rather than forwarded: `?countryCode=` reaching the
 * Worker as a real filter matches nothing and shows an empty catalogue.
 */
export function parseBrowseFilters(params: URLSearchParams): BrowseFilters {
  const year = (key: string): string | null => {
    const raw = text(params.get(key));
    return raw !== null && /^\d{1,4}$/.test(raw) ? raw : null;
  };

  return {
    countryCode: text(params.get("countryCode"))?.toUpperCase() ?? null,
    theme: text(params.get("theme")),
    groupId: text(params.get("groupId")),
    search: text(params.get("search")),
    yearFrom: year("yearFrom"),
    yearTo: year("yearTo"),
  };
}

/**
 * Colnect variants are usually unnamed and identified purely by what makes
 * them different from the base stamp, so the label is assembled from whatever
 * distinguishes this one.
 */
export function buildVariantLabel(variant: StampVariant): string {
  const name = text(variant.nameEs) ?? text(variant.nameEn);
  if (name) return name;

  const denomination = num(variant.denomination);
  const currency = text(variant.currency);
  const traits = [
    denomination !== null ? [String(denomination), currency].filter(Boolean).join(" ") : null,
    text(variant.color),
    text(variant.perforation),
    text(variant.gum),
    text(variant.format),
  ].filter((trait): trait is string => trait !== null && trait !== "");

  return traits.length > 0 ? traits.join(" · ") : "Variante";
}
