#!/usr/bin/env python3
"""
Enqueue image-less stamps into the Colnect detail queue
=======================================================
Finds stamps in D1 that have no `imageUrl` but do have a `sourceUrl`, and
pushes them into the `stamp_queue` table of the SQLite checkpoint
(`colnect_v3_progress.db`) so that phase 2 of the main scraper picks them up:

    python3 scrapers/enqueue_missing_images.py --apply
    python3 scrapers/colnect_global_scraper_v3.py detail

The detail phase reads the REAL image URL out of the stamp page
(`parse_detail_page` -> `div.item_image img` ... -> `_clean_img_url`), which is
deterministic. It replaces `fix_colnect_pattern_urls.py`, which only guessed
CDN URLs by interpolating between neighbouring Colnect ids.

Scope note: only stamps whose `sourceUrl` points at a Colnect detail page can
be resolved this way. `excel-import` and `wns` rows have no `sourceUrl` at all,
and `wikidata` rows point at wikidata.org, which the Colnect detail parser
cannot read. The realistic ceiling is therefore the Colnect subset, not the
full "stamps without image" count.

Dry-run is the default; writing requires an explicit `--apply`.
"""

import argparse
import json
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))

from colnect_global_scraper_v3 import (  # noqa: E402
    COUNTRY_ISO_MAP,
    PROGRESS_DB,
    QUERY_URL,
)

# Mirrors `init_db()` in colnect_global_scraper_v3. Declared locally (instead of
# calling init_db) so the queue path stays a parameter: init_db always targets
# the production checkpoint, which tests must never touch.
QUEUE_DDL = """
    CREATE TABLE IF NOT EXISTS stamp_queue (
        source_url   TEXT PRIMARY KEY,
        country_id   TEXT,
        country_code TEXT,
        basic_data   TEXT,
        status       TEXT DEFAULT 'pending',
        retries      INTEGER DEFAULT 0,
        updated_at   INTEGER
    );
"""

# Sources whose sourceUrl is a Colnect stamp detail page. Anything else would
# be fed to a parser that cannot read it.
DEFAULT_SOURCES = ("colnect",)

PAGE_SIZE = 1000
# Hard stop so a pathological response can never loop forever. Anything skipped
# because of it is reported explicitly instead of silently dropped.
MAX_PAGES = 100

# Fields copied verbatim from D1 into `basic_data`. They match the keys that
# `parse_detail_page` reads back out of it.
D1_FIELDS = (
    "id", "nameEn", "nameEs", "countryCode", "year", "denomination",
    "scottNumber", "michelNumber", "yvertNumber", "theme", "color",
    "descriptionEs", "source", "sourceUrl",
)


# ─── Colnect numeric country id ───────────────────────────────────────────────

def build_iso_to_colnect_id():
    """Reverse the Colnect id -> ISO2 map, keeping only unambiguous ISO2 codes.

    `stamp_queue.country_id` holds the Colnect NUMERIC country id, which D1 does
    not store. When several Colnect entities share one ISO2 code (Congo, China,
    Oman...) there is no way to tell which one a stamp came from, so those codes
    are left unresolved rather than guessed.
    """
    by_iso = defaultdict(list)
    for colnect_id, entry in COUNTRY_ISO_MAP.items():
        iso2 = (entry or {}).get("iso2")
        if iso2:
            by_iso[iso2].append(colnect_id)
    return {iso2: ids[0] for iso2, ids in by_iso.items() if len(ids) == 1}


ISO_TO_COLNECT_ID = build_iso_to_colnect_id()


# ─── D1 read ──────────────────────────────────────────────────────────────────

def d1_query(sql, params=None, timeout=60):
    res = requests.post(
        QUERY_URL, json={"sql": sql, "params": params or []}, timeout=timeout
    )
    res.raise_for_status()
    body = res.json()
    if not body.get("success"):
        raise RuntimeError(f"D1 query failed: {body.get('error')}")
    return body.get("results") or []


def fetch_missing_image_stamps(sources):
    """Page through every stamp with no image but a usable sourceUrl."""
    placeholders = ",".join("?" for _ in sources)
    sql = f"""
        SELECT {", ".join(D1_FIELDS)}
        FROM Stamp
        WHERE (imageUrl IS NULL OR imageUrl = '')
          AND sourceUrl IS NOT NULL
          AND TRIM(sourceUrl) != ''
          AND source IN ({placeholders})
        ORDER BY id
        LIMIT ? OFFSET ?
    """
    rows = []
    offset = 0
    for page in range(MAX_PAGES):
        batch = d1_query(sql, list(sources) + [PAGE_SIZE, offset])
        if not batch:
            return rows, 0
        rows.extend(batch)
        print(f"  📥 {len(rows):,} candidatos leídos (pág {page + 1})...", flush=True)
        if len(batch) < PAGE_SIZE:
            return rows, 0
        offset += PAGE_SIZE

    remaining = count_missing_image_stamps(sources) - len(rows)
    return rows, max(remaining, 0)


def count_missing_image_stamps(sources):
    placeholders = ",".join("?" for _ in sources)
    rows = d1_query(
        f"""
        SELECT COUNT(*) AS n FROM Stamp
        WHERE (imageUrl IS NULL OR imageUrl = '')
          AND sourceUrl IS NOT NULL
          AND TRIM(sourceUrl) != ''
          AND source IN ({placeholders})
        """,
        list(sources),
    )
    return rows[0]["n"] if rows else 0


# ─── Queue rows ───────────────────────────────────────────────────────────────

def build_queue_row(stamp):
    """Turn a D1 row into a (source_url, country_id, country_code, basic_data) tuple.

    `basic_data` keeps the D1 `id` so the detail parse merges onto the existing
    record instead of minting a new one, and deliberately carries no `imageUrl`
    key: the whole point is that D1 has none.
    """
    source_url = (stamp.get("sourceUrl") or "").strip()
    if not source_url:
        return None

    country_code = (stamp.get("countryCode") or "").strip()
    colnect_country_id = ISO_TO_COLNECT_ID.get(country_code, "")

    basic_data = {k: stamp.get(k) for k in D1_FIELDS if stamp.get(k) is not None}
    basic_data["sourceUrl"] = source_url
    basic_data["colnectCountryId"] = colnect_country_id

    return (
        source_url,
        colnect_country_id,
        country_code,
        json.dumps(basic_data, ensure_ascii=False),
    )


def existing_statuses(conn, source_urls):
    """Map source_url -> (status, retries) for rows already in the queue."""
    found = {}
    urls = list(source_urls)
    for i in range(0, len(urls), 400):
        chunk = urls[i:i + 400]
        placeholders = ",".join("?" for _ in chunk)
        for url, status, retries in conn.execute(
            f"SELECT source_url, status, retries FROM stamp_queue "
            f"WHERE source_url IN ({placeholders})",
            chunk,
        ):
            found[url] = (status, retries)
    return found


# `INSERT OR IGNORE` would be a silent no-op for rows already marked 'done' or
# exhausted on retries — exactly the stamps we need to reprocess. The upsert
# forces them back to pending/0 while keeping a country_id we cannot rebuild.
UPSERT_SQL = """
    INSERT INTO stamp_queue
        (source_url, country_id, country_code, basic_data, status, retries, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?)
    ON CONFLICT(source_url) DO UPDATE SET
        status       = 'pending',
        retries      = 0,
        basic_data   = excluded.basic_data,
        country_id   = CASE WHEN excluded.country_id   != '' THEN excluded.country_id
                            ELSE stamp_queue.country_id END,
        country_code = CASE WHEN excluded.country_code != '' THEN excluded.country_code
                            ELSE stamp_queue.country_code END,
        updated_at   = excluded.updated_at
"""


def enqueue_rows(conn, rows):
    """Insert or reset the given queue rows. Caller owns the transaction."""
    now = int(time.time())
    conn.executemany(UPSERT_SQL, [r + (now,) for r in rows])


# ─── Reporting ────────────────────────────────────────────────────────────────

def summarize(stamps, rows, existing, skipped_no_url, truncated, sources, applied):
    per_source = defaultdict(int)
    for s in stamps:
        per_source[s.get("source") or "?"] += 1

    reset_done = sum(1 for st, _ in existing.values() if st == "done")
    reset_exhausted = sum(1 for st, r in existing.values() if st != "done" and r >= 5)
    reset_other = len(existing) - reset_done - reset_exhausted
    new_rows = len(rows) - len(existing)

    print("\n" + "=" * 66)
    print("RESUMEN" + ("  (APLICADO)" if applied else "  (DRY-RUN — no se escribió nada)"))
    print("=" * 66)
    print(f"  Fuentes consultadas   : {', '.join(sources)}")
    print(f"  Candidatos en D1      : {len(stamps):,}")
    for src, n in sorted(per_source.items()):
        print(f"      - {src:<14}: {n:,}")
    if skipped_no_url:
        print(f"  Descartados sin URL   : {skipped_no_url:,}")
    if truncated:
        print(f"  ⚠️  NO leídos (tope de {MAX_PAGES} páginas): {truncated:,}")
    print(f"  Encolables            : {len(rows):,}")
    print(f"      - nuevos          : {new_rows:,}")
    print(f"      - ya en la cola   : {len(existing):,}")
    print(f"          · status 'done' → reset a pending : {reset_done:,}")
    print(f"          · retries >= 5  → reset a 0       : {reset_exhausted:,}")
    print(f"          · otros estados → reset a pending : {reset_other:,}")
    print("=" * 66)
    if not applied:
        print("  Ejecuta con --apply para escribir en la cola.")
    else:
        print("  Siguiente paso: python3 scrapers/colnect_global_scraper_v3.py detail")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Encola sellos sin imagen en stamp_queue para la fase de detalle."
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="escribe en stamp_queue (por defecto solo simula)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="explícito, pero redundante: simular es el comportamiento por defecto",
    )
    parser.add_argument(
        "--sources", default=",".join(DEFAULT_SOURCES),
        help=("fuentes de D1 a encolar, separadas por coma. Solo 'colnect' tiene "
              "sourceUrl que el parser de detalle sabe leer."),
    )
    args = parser.parse_args(argv)

    sources = tuple(s.strip() for s in args.sources.split(",") if s.strip())
    if not sources:
        parser.error("--sources no puede quedar vacío")
    if args.dry_run and args.apply:
        parser.error("--dry-run y --apply son excluyentes")

    print(f"🔎 Buscando sellos sin imagen con sourceUrl ({', '.join(sources)})...", flush=True)
    stamps, truncated = fetch_missing_image_stamps(sources)

    rows = []
    skipped_no_url = 0
    for s in stamps:
        row = build_queue_row(s)
        if row is None:
            skipped_no_url += 1
        else:
            rows.append(row)

    conn = sqlite3.connect(PROGRESS_DB)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(QUEUE_DDL)
        existing = existing_statuses(conn, [r[0] for r in rows])
        if args.apply and rows:
            enqueue_rows(conn, rows)
            conn.commit()
    finally:
        conn.close()

    summarize(stamps, rows, existing, skipped_no_url, truncated, sources, args.apply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
