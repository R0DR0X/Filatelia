#!/usr/bin/env python3
"""
Build-time generator: Colnect country id -> ISO 3166-1 alpha-2 map.
=================================================================
Reads  scrapers/colnect_countries_full.json  (Colnect country catalogue)
Writes scrapers/colnect_iso_map.json         (consumed by the scraper at runtime)

`pycountry` is a BUILD-TIME dependency only. The scraper must never import it:
it runs on a bare VM and only reads the generated JSON.

Resolution priority:
  1. CURATED_ISO_OVERRIDES  (authoritative, never overridden by pycountry)
  2. pycountry exact match on name / official_name / common_name
  3. pycountry fuzzy search (skipped for compound philatelic entity names)
  4. null

Rule: an unresolvable entity gets iso2 = null. Historical states, colonies,
occupations, revenue/cinderella/illegal/personalized issues and other
philatelic-only entities have no ISO country code and must NOT be given one.
Never fall back to a letter truncation of the name.

Usage:
    python3 scrapers/generate_colnect_iso_map.py
"""

import json
import sys
from pathlib import Path

try:
    import pycountry
except ImportError:  # pragma: no cover - build-time only
    print("FATAL: pycountry is required to regenerate the ISO map "
          "(pip install pycountry). It is NOT needed to run the scraper.")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
COUNTRIES_FILE = SCRIPT_DIR / "colnect_countries_full.json"
OUTPUT_FILE = SCRIPT_DIR / "colnect_iso_map.json"

# Substrings that mark a Colnect entry as a philatelic sub-entity rather than a
# sovereign country. Fuzzy matching is disabled for these to avoid inventing
# codes (e.g. "France: Cinderella Stamps" must never resolve to FR).
COMPOUND_MARKERS = (":", " - ")

# ── Curated overrides ───────────────────────────────────────────────────────
# Authoritative. A value of None forces iso2 = null (entity has no ISO code, or
# pycountry's fuzzy match is demonstrably wrong).
CURATED_ISO_OVERRIDES = {
    # Originally hand-curated entries (repaired against the real Colnect names)
    "225": "US",   # United States of America
    "90":  "GN",   # Guinea
    "91":  "GW",   # Guinea-Bissau
    "191": "SL",   # Sierra Leone
    "41":  "CF",   # Central African Republic
    "212": "TG",   # Togo
    "98":  "HU",   # Hungary
    "939": None,   # France: Personalized Stamps (philatelic entity)
    "108": "JP",   # Japan
    "74":  "FR",   # France
    "177": "RO",   # Romania
    "121": "LR",   # Liberia
    "59":  "DJ",   # Djibouti
    "156": "NE",   # Niger
    "157": "NG",   # Nigeria
    "21":  "BE",   # Belgium
    "81":  "DE",   # Germany, Federal Republic
    "442": "CN",   # China
    "178": "RU",   # Russia
    "106": "IT",   # Italy
    "199": "ES",   # Spain
    "53":  "CI",   # Ivory Coast
    "13":  "AU",   # Australia
    "224": "GB",   # United Kingdom of Great Britain & Northern Ireland
    "38":  "CA",   # Canada
    "30":  "BR",   # Brazil
    "155": "NI",   # Nicaragua
    "169": "PE",   # Peru
    "10":  "AR",   # Argentina
    "105": "IL",   # Israel
    "139": "MX",   # Mexico
    "47":  "CO",   # Colombia
    "43":  "CL",   # Chile
    "227": "UY",   # Uruguay
    "230": "VE",   # Venezuela
    "26":  "BO",   # Bolivia
    "63":  "EC",   # Ecuador
    "168": "PY",   # Paraguay
    "133": "MT",   # Malta
    "176": "RE",   # Reunion
    "52":  "CR",   # Costa Rica

    # Sovereign states pycountry cannot resolve from the Colnect spelling
    "44":  "CN",   # China, People's Republic
    "113": "KP",   # Korea, North
    "114": "KR",   # Korea, South
    "49":  "CG",   # Congo, Republic
    "1462": "CG",  # Congo, Republic (duplicate Colnect entity)
    "50":  "CD",   # Congo, Democratic Republic
    "1473": "CD",  # Congo, Dem. Rep. (duplicate Colnect entity)
    "126": "MO",   # Macau
    "165": "PS",   # Palestinian Territory
    "184": "VC",   # Saint Vincent & The Grenadines
    "171": "PN",   # Pitcairn Islands
    "77":  "TF",   # French Southern and Antarctic Lands
    "473": "SX",   # Sint Maarten (pycountry fuzzy wrongly yields NL)
    "180": "SH",   # Saint Helena

    # Historical / non-sovereign entities: force null
    "248": None,   # Abkhazia (fuzzy wrongly yields GE)
    "249": None,   # Kosovo (no ISO 3166-1 code; fuzzy yields RS)
    "284": None,   # Zaire (historical; fuzzy yields AO)
    "481": None,   # Berlin (historical philatelic entity; fuzzy yields DE)
    "750": None,   # Wurttemberg (historical German state)
    "362": None,   # Newfoundland (historical; fuzzy yields CA)
    "326": None,   # Nevis (philatelic sub-entity of KN)
    "483": None,   # Barbuda (philatelic sub-entity of AG)
    "373": None,   # Tristan da Cunha (philatelic sub-entity of SH)
    "464": None,   # Saint Kitts (philatelic sub-entity of KN)
    "289": None,   # Ajman (historical emirate; fuzzy yields AE)
    "250": None,   # Czechoslovakia
    "252": None,   # Soviet Union, USSR
    "254": None,   # Germany, Democratic Republic
    "257": None,   # Yugoslavia
    "530": None,   # German Realm
    "152": None,   # Netherlands Antilles (dissolved)
    "253": None,   # Ascension Island
    "262": None,   # Northern Cyprus
    "309": None,   # Azores
    "399": None,   # Madeira Islands
    "261": None,   # Alderney
    "415": None,   # Ceylon
    "325": None,   # Malta, Sovereign Military Order of
    "364": None,   # Fantasy Issues
    "46":  "CC",   # Cocos (Keeling) Islands
}


def _looks_compound(display: str) -> bool:
    return any(marker in display for marker in COMPOUND_MARKERS)


def resolve_iso2(display: str):
    """Resolve a Colnect display name to an ISO 3166-1 alpha-2 code, or None."""
    for lookup in ("name", "official_name", "common_name"):
        try:
            match = pycountry.countries.get(**{lookup: display})
        except Exception:
            match = None
        if match is not None:
            return match.alpha_2

    if _looks_compound(display):
        return None

    try:
        matches = pycountry.countries.search_fuzzy(display)
    except Exception:
        matches = []
    if matches:
        return matches[0].alpha_2

    return None


def build_map(countries):
    iso_map = {}
    for country in countries:
        cid = str(country["id"])
        display = (country.get("display") or country.get("name") or "").strip()
        if cid in CURATED_ISO_OVERRIDES:
            iso2 = CURATED_ISO_OVERRIDES[cid]
        else:
            iso2 = resolve_iso2(display)
        iso_map[cid] = {
            # No Spanish source exists; nameEs mirrors nameEn rather than
            # fabricating a translation.
            "iso2": iso2,
            "nameEn": display,
            "nameEs": display,
        }
    return iso_map


def main():
    if not COUNTRIES_FILE.exists():
        print(f"FATAL: {COUNTRIES_FILE} not found.")
        return 1

    with open(COUNTRIES_FILE, encoding="utf-8") as f:
        countries = json.load(f)

    iso_map = build_map(countries)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(iso_map, f, ensure_ascii=False, indent=2, sort_keys=True)

    total = len(iso_map)
    resolved = sum(1 for v in iso_map.values() if v["iso2"])
    unresolved = total - resolved
    distinct = len({v["iso2"] for v in iso_map.values() if v["iso2"]})

    print(f"Wrote {OUTPUT_FILE}")
    print(f"  total countries : {total}")
    print(f"  resolved ISO2   : {resolved}")
    print(f"  null (no ISO2)  : {unresolved}")
    print(f"  distinct ISO2   : {distinct}")

    bad = [(cid, v["iso2"]) for cid, v in iso_map.items()
           if v["iso2"] and len(v["iso2"]) != 2]
    if bad:
        print(f"  ERROR: non-2-letter codes emitted: {bad}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
