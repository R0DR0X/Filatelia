#!/usr/bin/env python3
"""
Standalone regression checks for scrapers/enqueue_missing_images.py.

Guards the silent no-op class of bug this repo has already been burned by:
an `INSERT OR IGNORE` into `stamp_queue` does nothing for rows that are already
there, so stamps marked 'done' (or with retries >= 5) would never be
reprocessed and the whole script would appear to succeed while doing nothing.

No network: D1 reads are stubbed and the queue lives in a temporary SQLite file.

Run:  python3 scrapers/test_enqueue_missing_images.py
Exits non-zero if any assertion fails.
"""

import inspect
import json
import re
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import colnect_global_scraper_v3 as scraper  # noqa: E402
import enqueue_missing_images as enq  # noqa: E402
from colnect_global_scraper_v3 import parse_detail_page  # noqa: E402

PASSED = 0
FAILED = 0


def check(label, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        print(f"  FAIL  {label}{(' — ' + detail) if detail else ''}")


STAMP_URL = "https://colnect.com/en/stamps/stamp/12345-Test_Stamp"

D1_ROW = {
    "id": "11111111-2222-3333-4444-555555555555",
    "nameEn": "Test Stamp",
    "nameEs": "Sello de prueba",
    "countryCode": "PE",
    "year": 1950,
    "denomination": 1.5,
    "scottNumber": "123",
    "michelNumber": "456",
    "yvertNumber": None,
    "theme": "Birds",
    "color": "Blue",
    "descriptionEs": "Descripción",
    "source": "colnect",
    "sourceUrl": STAMP_URL,
}


def temp_queue():
    """Return an in-memory-ish queue connection backed by a temp file."""
    tmp = Path(tempfile.mkdtemp(prefix="enqueue_test_")) / "queue.db"
    conn = sqlite3.connect(tmp)
    conn.executescript(enq.QUEUE_DDL)
    conn.commit()
    return conn, tmp


def stamp_queue_columns(ddl_text):
    """Column names declared for stamp_queue inside a DDL blob."""
    body = re.search(
        r"CREATE TABLE IF NOT EXISTS stamp_queue\s*\((.*?)\)\s*;", ddl_text, re.S
    )
    if not body:
        return []
    return [
        line.strip().split()[0]
        for line in body.group(1).strip().splitlines()
        if line.strip()
    ]


def test_local_ddl_matches_the_scraper_schema():
    """The local DDL is a copy; a drift would silently break fetch_pending_detail."""
    scraper_cols = stamp_queue_columns(inspect.getsource(scraper.init_db))
    local_cols = stamp_queue_columns(enq.QUEUE_DDL)
    check("stamp_queue DDL matches colnect_global_scraper_v3.init_db",
          local_cols == scraper_cols and len(local_cols) == 7,
          f"{local_cols} != {scraper_cols}")


def queue_row(conn, source_url=STAMP_URL):
    return conn.execute(
        "SELECT source_url, country_id, country_code, basic_data, status, retries "
        "FROM stamp_queue WHERE source_url = ?",
        (source_url,),
    ).fetchone()


# ─── Checks ───────────────────────────────────────────────────────────────────

def test_done_row_is_reset_to_pending():
    conn, _ = temp_queue()
    conn.execute(
        "INSERT INTO stamp_queue (source_url, country_id, country_code, basic_data, "
        "status, retries, updated_at) VALUES (?,?,?,?,'done',0,?)",
        (STAMP_URL, "173", "PE", "{}", int(time.time())),
    )
    conn.commit()

    enq.enqueue_rows(conn, [enq.build_queue_row(D1_ROW)])
    conn.commit()
    row = queue_row(conn)

    check("a 'done' row is reset to pending (no silent INSERT OR IGNORE no-op)",
          row[4] == "pending", f"status={row[4]}")
    check("resetting a 'done' row does not duplicate it",
          conn.execute("SELECT COUNT(*) FROM stamp_queue").fetchone()[0] == 1)
    check("resetting a 'done' row refreshes basic_data",
          json.loads(row[3]).get("nameEn") == "Test Stamp")
    conn.close()


def test_exhausted_retries_are_reset():
    conn, _ = temp_queue()
    conn.execute(
        "INSERT INTO stamp_queue (source_url, country_id, country_code, basic_data, "
        "status, retries, updated_at) VALUES (?,?,?,?,'pending',7,?)",
        (STAMP_URL, "173", "PE", "{}", int(time.time())),
    )
    conn.commit()

    enq.enqueue_rows(conn, [enq.build_queue_row(D1_ROW)])
    conn.commit()
    row = queue_row(conn)

    check("retries >= 5 is reset to 0", row[5] == 0, f"retries={row[5]}")
    # fetch_pending_detail selects status='pending' AND retries < 5.
    eligible = conn.execute(
        "SELECT COUNT(*) FROM stamp_queue WHERE status='pending' AND retries < 5"
    ).fetchone()[0]
    check("a reset row becomes eligible for fetch_pending_detail", eligible == 1)
    conn.close()


def test_existing_country_id_is_preserved():
    """D1 has no Colnect numeric id; a legacy queue row may. Never lose it."""
    conn, _ = temp_queue()
    conn.execute(
        "INSERT INTO stamp_queue (source_url, country_id, country_code, basic_data, "
        "status, retries, updated_at) VALUES (?,?,?,?,'done',0,?)",
        (STAMP_URL, "212", "TOG", "{}", int(time.time())),
    )
    conn.commit()

    ambiguous = dict(D1_ROW, countryCode="CG")  # CG maps to 2 Colnect ids -> unresolved
    enq.enqueue_rows(conn, [enq.build_queue_row(ambiguous)])
    conn.commit()
    row = queue_row(conn)

    check("an unresolvable country_id never overwrites an existing one",
          row[1] == "212", f"country_id={row[1]}")
    check("a resolvable country_code does overwrite the legacy 3-letter one",
          row[2] == "CG", f"country_code={row[2]}")
    conn.close()


def test_new_row_is_inserted():
    conn, _ = temp_queue()
    enq.enqueue_rows(conn, [enq.build_queue_row(D1_ROW)])
    conn.commit()
    row = queue_row(conn)
    check("a brand-new stamp is inserted as pending", row is not None and row[4] == "pending")
    check("PE resolves to its unambiguous Colnect numeric id",
          row[1] == enq.ISO_TO_COLNECT_ID.get("PE"), f"country_id={row[1]}")
    conn.close()


def test_stamps_without_source_url_are_never_queued():
    for missing in (None, "", "   "):
        row = enq.build_queue_row(dict(D1_ROW, sourceUrl=missing))
        check(f"a stamp with sourceUrl={missing!r} is never queued", row is None)


def test_ambiguous_iso_codes_are_not_guessed():
    for iso2 in ("CG", "CD", "CN", "OM"):
        check(f"ambiguous ISO2 {iso2} is left unresolved instead of guessed",
              iso2 not in enq.ISO_TO_COLNECT_ID)
    check("PE is unambiguous and resolvable", enq.ISO_TO_COLNECT_ID.get("PE") is not None)


def test_basic_data_round_trips_into_parse_detail_page():
    row = enq.build_queue_row(D1_ROW)
    basic_data = json.loads(row[3])

    check("basic_data carries no imageUrl key (D1 has none)",
          "imageUrl" not in basic_data)

    # Exactly what fetch_pending_detail -> detail_worker hands to the parser.
    stamp = parse_detail_page("<html><body></body></html>", STAMP_URL, basic_data, row[1])

    check("parse_detail_page reuses the D1 id (merges, not duplicates)",
          stamp["id"] == D1_ROW["id"], stamp["id"])
    check("parse_detail_page keeps the D1 sourceUrl", stamp["sourceUrl"] == STAMP_URL)
    check("parse_detail_page keeps the D1 name", stamp["nameEn"] == "Test Stamp")
    check("parse_detail_page keeps the D1 year", stamp["year"] == 1950)
    check("parse_detail_page keeps the D1 catalog numbers",
          stamp["scottNumber"] == "123" and stamp["michelNumber"] == "456")
    check("parse_detail_page rebuilds countryCode from the queued Colnect id",
          stamp["countryCode"] == "PE", str(stamp["countryCode"]))
    check("no image in the HTML leaves imageUrl null (never a fabricated URL)",
          stamp["imageUrl"] is None)


def test_empty_country_id_yields_null_country_fields():
    """Verified downstream contract: an empty Colnect id cannot wipe D1 country data.

    country_payload_fields('') -> all four country fields None, and the worker's
    ON CONFLICT(sourceUrl) DO UPDATE never assigns countryId/countryCode.
    """
    basic_data = json.loads(enq.build_queue_row(dict(D1_ROW, countryCode="CG"))[3])
    stamp = parse_detail_page("<html><body></body></html>", STAMP_URL, basic_data, "")
    check("empty Colnect country id -> countryCode None", stamp["countryCode"] is None)
    check("empty Colnect country id -> countryId None", stamp["countryId"] is None)
    check("empty Colnect country id -> countryNameEn None", stamp["countryNameEn"] is None)
    check("empty Colnect country id -> countryNameEs None", stamp["countryNameEs"] is None)


def test_dry_run_writes_nothing():
    tmp_dir = Path(tempfile.mkdtemp(prefix="enqueue_dryrun_"))
    tmp_db = tmp_dir / "progress.db"

    original_db = enq.PROGRESS_DB
    original_fetch = enq.fetch_missing_image_stamps
    try:
        enq.PROGRESS_DB = tmp_db
        enq.fetch_missing_image_stamps = lambda sources: ([dict(D1_ROW)], 0)
        enq.main(["--sources", "colnect"])

        conn = sqlite3.connect(tmp_db)
        count = conn.execute("SELECT COUNT(*) FROM stamp_queue").fetchone()[0]
        conn.close()
        check("dry-run (default) writes no queue rows", count == 0, f"rows={count}")

        enq.main(["--sources", "colnect", "--apply"])
        conn = sqlite3.connect(tmp_db)
        count = conn.execute("SELECT COUNT(*) FROM stamp_queue").fetchone()[0]
        conn.close()
        check("--apply writes the queue row", count == 1, f"rows={count}")
    finally:
        enq.PROGRESS_DB = original_db
        enq.fetch_missing_image_stamps = original_fetch


def main():
    print("=" * 66)
    print("enqueue_missing_images regression checks")
    print("=" * 66)
    test_local_ddl_matches_the_scraper_schema()
    test_new_row_is_inserted()
    test_done_row_is_reset_to_pending()
    test_exhausted_retries_are_reset()
    test_existing_country_id_is_preserved()
    test_stamps_without_source_url_are_never_queued()
    test_ambiguous_iso_codes_are_not_guessed()
    test_basic_data_round_trips_into_parse_detail_page()
    test_empty_country_id_yields_null_country_fields()
    test_dry_run_writes_nothing()

    print("\n" + "=" * 66)
    total = PASSED + FAILED
    print(f"RESULT: {PASSED}/{total} passed, {FAILED} failed")
    print("=" * 66)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
