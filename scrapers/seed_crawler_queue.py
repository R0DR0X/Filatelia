#!/usr/bin/env python3
"""Rebuild the Colnect detail queue from what is already stored in D1.

WHY THIS WAS REWRITTEN. The previous version POSTed raw SQL to `/query` — the
SQL gateway removed in E0 for security — so it has been dead since that
removal and would have failed the moment anyone reached for it. It also wrote
to `crawler_progress.db`, a database the v3 scraper does not read: the queue it
actually consumes is `stamp_queue` inside `colnect_v3_progress.db`. Seeding the
wrong table in the wrong file looks like success and does nothing.

WHAT IT DOES. Walks `GET /admin/detail-queue` on the Worker (authenticated with
ADMIN_API_TOKEN, the same credential every scraper already needs) and inserts
each stamp that still lacks detail data into `stamp_queue` as `pending`.

WHEN TO USE IT. When the checkpoint database is lost or is on another machine
and the detail phase has nothing to work on. It reseeds from stamps ALREADY in
D1, so it recovers the detail backlog without re-crawling a single listing
page — which is the expensive half.

WHAT IT CANNOT DO. It cannot rebuild `listing_pages`. Those are pages that were
never visited, so by definition D1 knows nothing about them; that queue only
comes from the listing phase (E2.8) or from the original checkpoint file.

    python scrapers/seed_crawler_queue.py            # report only, writes nothing
    python scrapers/seed_crawler_queue.py --apply    # actually seed the queue
"""

import json
import os
import sqlite3
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scraper_env import require_admin_token  # noqa: E402

API_BASE = os.environ.get(
    "FILATELIA_API_BASE",
    "https://filatelia-api.rodrigopianto2005.workers.dev",
).rstrip("/")

# The same file and table the v3 scraper reads. PROGRESS_DB there is a bare
# relative Path, so it resolves against the CWD — run this from the repo root,
# which is also where the scraper is run from.
PROGRESS_DB = "colnect_v3_progress.db"

PAGE_SIZE = 1000
REQUEST_TIMEOUT = 60


def init_db(conn):
    """Create stamp_queue if absent, with the schema the v3 scraper expects.

    Mirrors init_db() in colnect_global_scraper_v3.py deliberately: if the two
    ever drift, this script silently seeds rows the scraper cannot read.
    """
    conn.executescript(
        """
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
    )
    conn.commit()


def fetch_all(token):
    """Walk the admin endpoint by keyset cursor and yield every pending stamp."""
    cursor = ""
    total = 0
    while True:
        res = requests.get(
            f"{API_BASE}/admin/detail-queue",
            params={"limit": PAGE_SIZE, "cursor": cursor},
            headers={"X-Admin-Token": token},
            timeout=REQUEST_TIMEOUT,
        )
        if res.status_code == 403:
            print("❌ 403 del Worker: ADMIN_API_TOKEN no coincide con el secreto desplegado.", file=sys.stderr)
            sys.exit(1)
        if res.status_code != 200:
            print(f"❌ HTTP {res.status_code}: {res.text[:300]}", file=sys.stderr)
            sys.exit(1)

        payload = res.json()
        if not payload.get("success"):
            print(f"❌ El Worker respondió con error: {payload.get('error')}", file=sys.stderr)
            sys.exit(1)

        items = payload.get("items") or []
        total += len(items)
        print(f"   … {total} sellos leídos")
        for item in items:
            yield item

        cursor = payload.get("nextCursor")
        if not cursor:
            return
        # The endpoint is authenticated and cheap, but this walks tens of
        # thousands of rows against production. Pace it.
        time.sleep(0.2)


def main():
    apply = "--apply" in sys.argv
    token = require_admin_token()

    print(f"🔍 Leyendo la cola de detalle desde {API_BASE} …")
    stamps = list(fetch_all(token))

    if not stamps:
        print("✅ No hay sellos pendientes de detalle. Nada que sembrar.")
        return

    print(f"\n📊 {len(stamps)} sellos de Colnect sin datos de detalle.")
    print(f"   Destino: {PROGRESS_DB} → tabla stamp_queue")

    if not apply:
        print("\n   (modo lectura: no se escribió nada)")
        print("   Volvé a correr con --apply para sembrar la cola.")
        for s in stamps[:5]:
            print(f"     ej. {s.get('sourceUrl')}")
        return

    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    init_db(conn)

    now = int(time.time())
    seeded = 0
    for s in stamps:
        source_url = s.get("sourceUrl")
        if not source_url:
            continue
        # `basic_data` is what parse_detail_page reads as its fallback when the
        # detail page omits a field, so it is carried over rather than left
        # empty — a reseeded row should not be poorer than a freshly crawled one.
        basic = json.dumps({
            "id": s.get("id"),
            "nameEn": s.get("nameEn"),
            "year": s.get("year"),
        })
        # INSERT OR IGNORE: a stamp already queued keeps its status and retry
        # count. Reseeding must never reset work that is already in flight.
        conn.execute(
            """
            INSERT OR IGNORE INTO stamp_queue
                (source_url, country_id, country_code, basic_data, status, retries, updated_at)
            VALUES (?, ?, ?, ?, 'pending', 0, ?)
            """,
            (source_url, None, s.get("countryCode"), basic, now),
        )
        seeded += conn.total_changes and 1 or 0

    conn.commit()
    pending = conn.execute(
        "SELECT COUNT(*) FROM stamp_queue WHERE status = 'pending'"
    ).fetchone()[0]
    conn.close()

    print(f"\n✅ Cola sembrada. {pending} sellos en estado 'pending'.")
    print("   Ahora podés correr la fase de detalle. Probá con un lote chico primero.")


if __name__ == "__main__":
    main()
