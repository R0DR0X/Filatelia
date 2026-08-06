#!/usr/bin/env python3
"""
🌍 Colnect Global Stamp Scraper v3 — Efficient Two-Phase Architecture
======================================================================
Phase 1 (Discovery): Listing pages country/year → harvests sourceUrl + basic fields
Phase 2 (Enrichment): Individual stamp pages → adds rich fields (perf, printer, prices…)

Design principles:
- Dynamic discovery: seeds country base URLs, discovers year/page links dynamically
- Efficiency over speed: conservative delays, retry backoff, no silent failures
- SQLite checkpoint: crash-safe, WAL mode, never re-scrapes done URLs
- User B Proxy: DataImpulse residential, sticky session per worker
- Proper field extraction: verified selectors, none_logged_image filtering
"""

import asyncio
import json
import logging
import os
import random
import re
import sqlite3
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from scraper_env import require_env, require_admin_token

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
COOKIES_FILE = SCRIPT_DIR / "colnect_cookies.json"
COUNTRIES_FILE = SCRIPT_DIR / "colnect_countries_full.json"
ISO_MAP_FILE = SCRIPT_DIR / "colnect_iso_map.json"
PROGRESS_DB  = Path("colnect_v3_progress.db")   # SQLite checkpoint (project root)
LOG_FILE     = Path("colnect_v3.log")

# ── API ─────────────────────────────────────────────────────────────────────
API_URL      = "https://filatelia-api.rodrigopianto2005.workers.dev/import-stamp"
QUERY_URL    = "https://filatelia-api.rodrigopianto2005.workers.dev/query"

# ── Proxy (DataImpulse residential User B - active) ─────────────────────────
# The DataImpulse proxy is OPTIONAL, and defaults to off.
#
# Its only job was to make requests come from a residential IP. The machine
# this scraper is meant to run on — the Piura VM, 100.75.97.61 — already has
# one: its egress is 179.7.15.36, AS12252 América Móvil Perú (Claro), a
# residential Peruvian connection. Paying a proxy to borrow the kind of IP the
# host already has is buying something you own.
#
# Set USE_PROXY=1 to turn it back on, and then the three DataImpulse
# variables become required. The reason to turn it on is NOT anonymity — it is
# IP rotation. A long unthrottled crawl from one address risks that address
# being blocked, and here that address is the VM's real Claro connection, not
# a rented one. Prefer a slow, polite crawl first; reach for the proxy if
# Colnect actually pushes back.
USE_PROXY = os.environ.get("USE_PROXY", "").strip().lower() in {"1", "true", "yes"}

if USE_PROXY:
    PROXY_SERVER = require_env("DATAIMPULSE_HOST", "DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)")
    PROXY_USER   = require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)")
    PROXY_PASS   = require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
else:
    PROXY_SERVER = PROXY_USER = PROXY_PASS = None

# ── Admin auth for /import-stamp ─────────────────────────────────────────────
ADMIN_TOKEN = require_admin_token()

# ── Concurrency ──────────────────────────────────────────────────────────────
LISTING_WORKERS  = 4   # parallel listing-page workers
DETAIL_WORKERS   = 3   # parallel detail-page workers
BATCH_SIZE       = 20  # stamps per D1 API call
MAX_LOGGED_BATCH_ERRORS = 5  # cap per-batch error lines so logs stay readable
LISTING_DELAY    = (2.0, 4.0)  # (min, max) seconds between listing pages
DETAIL_DELAY     = (3.0, 5.5)  # (min, max) seconds between detail pages

# ── Anti-hang budgets ────────────────────────────────────────────────────────
# A dead Chromium used to leave the whole process blocked in epoll_wait with no
# network activity and no log line for ~40h. Every Playwright await now has a
# wall-clock budget, every worker publishes a heartbeat, and a watchdog aborts
# the batch when all of them go silent.
NAV_TIMEOUT_MS          = 25000  # page.goto budget (Playwright-side)
NAV_TIMEOUT_GRACE_S     = 10.0   # extra margin before we distrust goto itself
CONTENT_TIMEOUT_S       = 8.0    # page.content(): cheap call, must return fast
SCROLL_TIMEOUT_S        = 25.0   # page.evaluate(scroll): ~15 steps of 60ms + slack
PAGE_OP_TIMEOUT_S       = 45.0   # context.new_page(), page.route()
BROWSER_SETUP_TIMEOUT_S = 90.0   # chromium.launch() + new_context() over proxy
CLOSE_TIMEOUT_S         = 15.0   # page/context/browser close during teardown
PLAYWRIGHT_STOP_TIMEOUT_S = 30.0 # driver shutdown (can wedge if node is orphaned)
CONTENT_POLL_ATTEMPTS   = 25     # anti-challenge poll iterations in safe_goto

WORKER_STALL_TIMEOUT_S  = 180.0  # a worker silent this long counts as stalled
WATCHDOG_INTERVAL_S     = 15.0   # how often the watchdog inspects heartbeats
WORKER_EXIT_GRACE_S     = 10.0   # queue.join() grace after every worker exited
STALL_RECOVERY_BACKOFF_S = 30.0  # pause before recreating the browser
MAX_CONSECUTIVE_STALL_ABORTS = 3 # bounded retries so we never loop hot
STALL_EXIT_CODE         = 2      # non-zero exit when a phase aborts on a stall

# ── Filtering ────────────────────────────────────────────────────────────────
NONE_LOGGED_PATTERNS = [
    "none_logged_image", "none-stamps", "pass-challenge"
]

# ── UUID namespace ───────────────────────────────────────────────────────────
NAMESPACE_PHILATELY = uuid.UUID("12345678-1234-5678-1234-567812345678")

# ── Country ISO map ─────────────────────────────────────────────────────────
# Generated offline by scrapers/generate_colnect_iso_map.py (pycountry is a
# build-time dependency only — it is never imported at runtime).
# Shape: {"<colnect_id>": {"iso2": "US"|None, "nameEn": str, "nameEs": str}}
COUNTRY_ISO_MAP = {}


def load_iso_map():
    """Load the Colnect id -> ISO2 map. Missing/broken file is fatal."""
    if not ISO_MAP_FILE.exists():
        raise SystemExit(
            f"FATAL: {ISO_MAP_FILE} no existe. Genéralo con "
            f"`python3 scrapers/generate_colnect_iso_map.py` antes de scrapear. "
            f"Sin este mapa los countryCode/countryId serían inválidos y D1 "
            f"rechazaría el 100% de los sellos."
        )
    try:
        with open(ISO_MAP_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise SystemExit(f"FATAL: no se pudo leer {ISO_MAP_FILE}: {e}")
    if not isinstance(data, dict) or not data:
        raise SystemExit(f"FATAL: {ISO_MAP_FILE} está vacío o malformado.")
    return data


def country_meta(country_id):
    """Return (iso2, nameEn, nameEs) for a Colnect numeric country id.

    iso2 is None when the entity has no ISO 3166-1 code (historical states,
    colonies, occupations, cinderella/revenue/illegal issues...). Never
    fabricate a code: an unknown country is better than a wrong one.
    """
    entry = COUNTRY_ISO_MAP.get(str(country_id or "")) or {}
    iso2 = entry.get("iso2") or None
    return iso2, entry.get("nameEn"), entry.get("nameEs")


def country_payload_fields(country_id):
    """Build the country-related fields sent to the import API."""
    iso2, name_en, name_es = country_meta(country_id)
    return {
        "countryCode": iso2,
        "countryId": f"country-{iso2.lower()}" if iso2 else None,
        "countryNameEn": name_en if iso2 else None,
        "countryNameEs": name_es if iso2 else None,
    }

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

COUNTRY_ISO_MAP = load_iso_map()


# ═══════════════════════════════════════════════════════════════════════════
# ── SQLite Checkpoint ────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

def init_db():
    conn = sqlite3.connect(PROGRESS_DB)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS listing_pages (
            url          TEXT PRIMARY KEY,
            country_id   TEXT,
            country_code TEXT,
            status       TEXT DEFAULT 'pending',
            stamps_found INTEGER DEFAULT 0,
            errors       INTEGER DEFAULT 0,
            updated_at   INTEGER
        );
        CREATE TABLE IF NOT EXISTS stamp_queue (
            source_url   TEXT PRIMARY KEY,
            country_id   TEXT,
            country_code TEXT,
            basic_data   TEXT,
            status       TEXT DEFAULT 'pending',
            retries      INTEGER DEFAULT 0,
            updated_at   INTEGER
        );
    """)
    conn.commit()
    conn.close()


def db_exec(sql, params=()):
    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(sql, params)
    conn.commit()
    conn.close()


def db_query(sql, params=()):
    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return rows


def mark_listing(url, status, stamps_found=0, errors=0):
    db_exec(
        "UPDATE listing_pages SET status = ?, stamps_found = ?, errors = ?, updated_at = ? WHERE url = ?",
        (status, stamps_found, errors, int(time.time()), url)
    )


def enqueue_listing_url(url, country_id, country_code):
    if not url or not url.startswith("https://colnect.com"):
        return
    db_exec(
        "INSERT OR IGNORE INTO listing_pages (url, country_id, country_code, status, updated_at) VALUES (?,?,?,'pending',?)",
        (url, country_id, country_code, int(time.time()))
    )


def enqueue_stamps(stamps_basic):
    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    for s in stamps_basic:
        conn.execute(
            "INSERT OR IGNORE INTO stamp_queue "
            "(source_url, country_id, country_code, basic_data, status, updated_at) "
            "VALUES (?,?,?,?,'pending',?)",
            (
                s["sourceUrl"],
                # country_id holds the Colnect numeric id (needed to rebuild
                # listing URLs); country_code holds the ISO2 (may be empty).
                s.get("colnectCountryId", ""),
                s.get("countryCode") or "",
                json.dumps(s, ensure_ascii=False),
                int(time.time()),
            )
        )
    conn.commit()
    conn.close()


def fetch_pending_listing(limit=500):
    rows = db_query(
        "SELECT url, country_id, country_code FROM listing_pages "
        "WHERE status = 'pending' ORDER BY rowid LIMIT ?",
        (limit,)
    )
    return [{"url": r[0], "country_id": r[1], "country_code": r[2]} for r in rows]


def fetch_pending_detail(limit=500):
    rows = db_query(
        "SELECT source_url, country_id, country_code, basic_data FROM stamp_queue "
        "WHERE status = 'pending' AND retries < 5 ORDER BY rowid LIMIT ?",
        (limit,)
    )
    return [
        {
            "source_url": r[0],
            "country_id": r[1],
            "country_code": r[2],
            "basic_data": json.loads(r[3]) if r[3] else {},
        }
        for r in rows
    ]


def mark_stamp(source_url, status):
    db_exec(
        "UPDATE stamp_queue SET status = ?, updated_at = ? WHERE source_url = ?",
        (status, int(time.time()), source_url)
    )


def increment_stamp_retry(source_url):
    db_exec(
        "UPDATE stamp_queue SET retries = retries + 1, updated_at = ? WHERE source_url = ?",
        (int(time.time()), source_url)
    )


# ═══════════════════════════════════════════════════════════════════════════
# ── Country Seeding ──────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

def load_countries():
    if COUNTRIES_FILE.exists():
        with open(COUNTRIES_FILE, encoding="utf-8") as f:
            data = json.load(f)
        for c in data:
            if "sc" in c:
                c["stamps_count"] = c.pop("sc")
        data.sort(key=lambda x: x.get("stamps_count", 0), reverse=True)
        log.info(f"✅ {len(data)} países cargados desde {COUNTRIES_FILE.name}")
        return data
    return []


def seed_country_base_urls(countries):
    """Seed country base URLs into listing_pages."""
    inserted = 0
    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    for c in countries:
        cid   = str(c["id"])
        cslug = c["name"]
        # ISO2 from the generated map, or empty when the entity has no ISO code.
        ccode = country_meta(cid)[0] or ""
        base  = f"https://colnect.com/en/stamps/list/country/{cid}-{cslug}"
        conn.execute(
            "INSERT OR IGNORE INTO listing_pages (url, country_id, country_code, updated_at) VALUES (?,?,?,?)",
            (base, cid, ccode, int(time.time()))
        )
        inserted += 1
    conn.commit()
    conn.close()
    log.info(f"📋 {inserted} URLs base de países encoladas.")


# ═══════════════════════════════════════════════════════════════════════════
# ── HTML Parsers ─────────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

def _clean_img_url(raw):
    if not raw or raw.startswith("data:"):
        return None
    if any(p in raw for p in NONE_LOGGED_PATTERNS):
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    raw = raw.replace("/t/", "/b/", 1) if "/t/" in raw else raw
    raw = raw.replace("/items/thumb/", "/items/full/", 1) if "/items/thumb/" in raw else raw
    return raw


def parse_listing_page(html, country_id, country_code):
    """Parse a listing page. Returns (stamps, discovered_urls)."""
    soup = BeautifulSoup(html, "html.parser")
    items = soup.select("div.pl-it")
    stamps = []
    discovered_urls = []

    # 1. Discover year and pagination links
    for a in soup.select("a[href*='/stamps/list/country/']"):
        href = a.get("href", "")
        if href.startswith("/"):
            full_url = "https://colnect.com" + href
            discovered_urls.append(full_url)

    for item in items:
        try:
            link = item.select_one("h2.item_header a, h2 a")
            if not link:
                continue

            href = link.get("href", "")
            source_url = ("https://colnect.com" + href) if href.startswith("/") else href
            if not source_url or "/stamp/" not in source_url:
                continue

            name = link.get_text(strip=True)
            if len(name) < 2:
                continue

            stamp_id = str(uuid.uuid5(NAMESPACE_PHILATELY, source_url))

            meta = item.select_one("div.i_d")
            series = catalog_codes = colors = themes_str = ""
            if meta:
                for row in meta.select("div"):
                    txt = row.get_text(strip=True)
                    if ":" in txt:
                        lbl, val = txt.split(":", 1)
                        lbl, val = lbl.strip(), val.strip()
                        if lbl == "Series":
                            series = val
                        elif lbl == "Catalog codes":
                            catalog_codes = val
                        elif lbl == "Colors":
                            colors = val
                        elif lbl == "Themes":
                            themes_str = val

            img_el = item.select_one("div.item_thumb img")
            image_url = None
            if img_el:
                candidate = img_el.get("data-src") or img_el.get("src")
                image_url = _clean_img_url(candidate)

            year_m = re.search(r"\b(18\d{2}|19\d{2}|20\d{2})\b", f"{series} {name}")
            year = int(year_m.group(1)) if year_m else None

            denom_el  = item.select_one("div.item_price")
            denom_txt = denom_el.get_text(strip=True) if denom_el else ""
            denomination = None
            dm = re.match(r"^([\d.,]+)", denom_txt)
            if dm:
                try:
                    denomination = float(dm.group(1).replace(",", "."))
                except ValueError:
                    pass

            def _extract_code(prefix, text):
                m = re.search(rf"{prefix}:([A-Za-z0-9\s#\-+]+?)(?:,|$)", text)
                return m.group(1).strip() if m else None

            desc_el = item.select_one("div.pl_desc")
            description = desc_el.get_text(strip=True) if desc_el else None

            stamps.append({
                "id":           stamp_id,
                "nameEn":       name,
                "nameEs":       name,
                # Colnect numeric id: kept for checkpoint bookkeeping and URL
                # building only — it is NOT a valid D1 Country.id.
                "colnectCountryId": str(country_id or ""),
                **country_payload_fields(country_id),
                "year":         year,
                "denomination": denomination,
                "imageUrl":     image_url,
                "scottNumber":  _extract_code("Sn", catalog_codes),
                "michelNumber": _extract_code("Mi", catalog_codes),
                "yvertNumber":  _extract_code("Yt", catalog_codes),
                # Routed through _clean_cell for the same reason the detail
                # parser is: this is the phase that actually ran, and it is
                # where the 3,280 "Login to see complete item details" themes
                # in production came from.
                "theme":        _clean_cell(themes_str.replace("|", ",")),
                "color":        _clean_cell(colors),
                "descriptionEs": _clean_cell(description),
                "source":       "colnect",
                "sourceUrl":    source_url,
                "series":       series or None,
            })
        except Exception as e:
            log.debug(f"parse_listing item error: {e}")

    return stamps, list(set(discovered_urls))


def _resolve_colnect_country_id(basic_data, country_id=None):
    """Recover the Colnect numeric country id from any checkpoint generation.

    Rows queued before the ISO fix stored the numeric id under "countryId";
    newer rows use "colnectCountryId". Resolving here (instead of trusting the
    stored country_code) upgrades legacy rows at send time without a migration.
    """
    for candidate in (country_id, basic_data.get("colnectCountryId"), basic_data.get("countryId")):
        candidate = str(candidate or "")
        if candidate.isdigit():
            return candidate
    return ""


# Colnect serves its own copy in the cells we read whenever the session is
# unauthenticated or rate-limited. Stored verbatim, those messages become
# "data": production ended up with 3,280 stamps whose theme was
# "Login to see complete item details" and 591 reading "Confirm you are human
# to view details", cleaned out by migration 0015. Nothing stopped the next
# listing run from writing them straight back, so they are refused here.
#
# WHOLE-CELL MATCH, NOT A SUBSTRING. 110 production stamps carry a genuine
# "Human Rights" theme; a substring rule keyed on "human" would have destroyed
# every one of them. Comparison is lowercased and stripped because the exact
# wording and casing belong to Colnect, not to us.
_SCRAPER_ARTIFACT_CELLS = frozenset({
    "login to see complete item details",
    "confirm you are human to view details",
})


def _clean_cell(value):
    """Normalise a scraped cell to a real value or None.

    The Worker upserts every detail field with COALESCE(excluded.x, x), which
    treats "" as a value, not as an absence. Returning an empty string here
    would make the detail phase OVERWRITE a good listing-phase value with
    nothing — the run would destroy data instead of enriching it.

    Cells that are Colnect's anti-bot/paywall message rather than a value are
    treated the same as an empty cell: unknown, so None.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.lower() in _SCRAPER_ARTIFACT_CELLS:
        return None
    return text


def _parse_variants(soup, source_url):
    """Extract the variants behind Colnect's "Click to see variants" (E2.5).

    Returns a list, never None: the importer distinguishes "no variants" from
    "variants not parsed", and an absent JSON key travels differently from [].
    """
    variants = []
    seen_urls = set()

    for el in soup.select("div.variants a.variant, .item_variants a, a.variant"):
        href = el.get("href")
        variant_url = urljoin(source_url, href) if href else None
        # The same variant can be reachable from more than one node on the
        # page; the DB has a UNIQUE index on sourceUrl, so a duplicate here
        # would make the whole batch's variant upsert fail.
        if variant_url and variant_url in seen_urls:
            continue
        if variant_url:
            seen_urls.add(variant_url)

        name_el = el.select_one(".variant_name, .name")
        code_el = el.select_one(".variant_code, .code")
        name = _clean_cell(name_el.get_text() if name_el else el.get_text())

        variants.append({
            "nameEn":      name,
            "nameEs":      name,
            "colnectCode": _clean_cell(code_el.get_text() if code_el else None),
            "sourceUrl":   variant_url,
        })

    return variants


def parse_detail_page(html, source_url, basic_data, country_id=None):
    """Parse an individual stamp detail page."""
    soup = BeautifulSoup(html, "html.parser")
    info = {}

    for dl in soup.select("div.i_d dl, .stamp_details dl, #item_details dl"):
        dts = dl.find_all("dt")
        dds = dl.find_all("dd")
        for dt, dd in zip(dts, dds):
            lbl = dt.get_text(strip=True).lower().rstrip(":")
            val = dd.get_text(strip=True)
            if lbl and val:
                info[lbl] = val

    front_img_el = soup.select_one(
        "div.item_image img, #item_image img, .stamp_image img, "
        "div.item_thumb img, div[class*='image'] img"
    )
    back_img_el = soup.select_one(
        "div.item_image_back img, .stamp_back img, #back_image img"
    )

    def _get_img(el):
        if not el:
            return None
        raw = el.get("data-src") or el.get("src")
        return _clean_img_url(raw)

    image_url      = _get_img(front_img_el) or basic_data.get("imageUrl")
    image_back_url = _get_img(back_img_el)

    name = basic_data.get("nameEn") or ""
    title_tag = soup.find("title")
    if title_tag and title_tag.string:
        parts = title_tag.string.split(" - ")
        if parts and len(parts[0]) > 2:
            name = parts[0].strip()

    year = basic_data.get("year")
    year_raw = info.get("issued on") or info.get("issue date") or info.get("year")
    if year_raw:
        ym = re.search(r"\b(18\d{2}|19\d{2}|20\d{2})\b", year_raw)
        if ym:
            year = int(ym.group(1))

    colnect_country_id = _resolve_colnect_country_id(basic_data, country_id)

    return {
        "id":             basic_data.get("id") or str(uuid.uuid5(NAMESPACE_PHILATELY, source_url)),
        "source":         "colnect",
        "sourceUrl":      source_url,
        "colnectCountryId": colnect_country_id,
        **country_payload_fields(colnect_country_id),
        "nameEn":         name,
        "nameEs":         name,
        "year":           year,
        "denomination":   basic_data.get("denomination"),
        "imageUrl":       image_url,
        "imageBackUrl":   image_back_url,
        "scottNumber":    basic_data.get("scottNumber"),
        "michelNumber":   basic_data.get("michelNumber"),
        "yvertNumber":    basic_data.get("yvertNumber"),
        "color":          _clean_cell(info.get("colors")) or basic_data.get("color"),
        "theme":          _clean_cell(info.get("themes")) or basic_data.get("theme"),
        "perforation":    _clean_cell(info.get("perforation")),
        "printTechnique": _clean_cell(info.get("printing")),
        "paperType":      _clean_cell(info.get("paper")),
        # E2.3 — the four fields the detail page (E3) needs but nothing ever
        # parsed. `sizeMm` is the reason all 147,555 production rows have a
        # NULL size: the column existed, the parser never filled it.
        "sizeMm":         _clean_cell(info.get("size")),
        "format":         _clean_cell(info.get("format")),
        "emission":       _clean_cell(info.get("emission")),
        "gum":            _clean_cell(info.get("gum")),
        "colnectCode":    _clean_cell(info.get("colnect code")),
        "descriptionEs":  _clean_cell(info.get("description")) or basic_data.get("descriptionEs"),
        "series":         basic_data.get("series"),
        # E2.5 — always a list, so the importer can tell "none" from "unknown".
        "variants":       _parse_variants(soup, source_url),
    }


# ═══════════════════════════════════════════════════════════════════════════
# ── D1 API ───────────────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

def send_batch_sync(stamps):
    """Send a batch of stamps to Cloudflare D1.

    Returns the set of sourceUrls that were NOT persisted; an empty set means
    the whole batch was accepted. The worker imports each stamp independently,
    so a single bad stamp must not force its 19 healthy siblings into retry.

    Total failures (transport error, non-200 after retries, nothing persisted,
    or a response whose `failedIds` is missing/unusable — e.g. an older worker
    still deployed) report every stamp in the batch as failed.
    """
    if not stamps:
        return set()

    all_urls = {s.get("sourceUrl") for s in stamps if s.get("sourceUrl")}
    url_by_id = {s.get("id"): s.get("sourceUrl") for s in stamps if s.get("id")}

    def resolve_failed(failed_ids):
        """Map the worker's failedIds back to sourceUrls; None if unusable."""
        if not isinstance(failed_ids, list) or not failed_ids:
            return None
        resolved = set()
        for fid in failed_ids:
            url = url_by_id.get(fid)
            if url is None:
                # Unknown id: cannot prove which stamps persisted, be conservative.
                return None
            resolved.add(url)
        return resolved

    for attempt in range(4):
        try:
            res = requests.post(
                API_URL,
                json={"stamps": stamps},
                headers={"Content-Type": "application/json", "X-Admin-Token": ADMIN_TOKEN},
                timeout=30,
            )
            if res.status_code == 200:
                result = res.json()
                ins  = result.get("inserted", 0)
                upd  = result.get("updated", 0)
                skip = result.get("skipped", 0)
                errors = result.get("errors") or []

                # The endpoint returns HTTP 200 + success:true even when every
                # stamp was rejected. Never report that as a success.
                if errors:
                    shown = errors[:MAX_LOGGED_BATCH_ERRORS]
                    for msg in shown:
                        log.warning(f"  ⚠️ D1 rechazó un sello: {msg}")
                    if len(errors) > len(shown):
                        log.warning(f"  ⚠️ ...y {len(errors) - len(shown)} errores más ocultos.")
                    log.warning(
                        f"  ❌ D1: {len(errors)}/{len(stamps)} sellos rechazados "
                        f"(+{ins} insertados, {upd} actualizados, {skip} omitidos)"
                    )
                    failed_urls = resolve_failed(result.get("failedIds"))
                    if failed_urls is None:
                        log.warning(
                            "  ⚠️ Respuesta sin failedIds utilizable — "
                            "se reintenta el lote completo."
                        )
                        return set(all_urls)
                    return failed_urls

                if ins == 0 and upd == 0:
                    log.warning(
                        f"  ❌ D1: 0 insertados y 0 actualizados de {len(stamps)} enviados "
                        f"({skip} omitidos) — lote no persistido."
                    )
                    return set(all_urls)

                log.info(
                    f"  📦 D1: +{ins} insertados, {upd} actualizados, {skip} omitidos "
                    f"({len(stamps)} enviados)"
                )
                return set()
            if res.status_code == 429:
                wait = 10 * (attempt + 1)
                log.warning(f"  ⚠️ D1 rate-limit 429. Esperando {wait}s...")
                time.sleep(wait)
            else:
                log.warning(f"  ⚠️ D1 HTTP {res.status_code}: {res.text[:200]}")
        except Exception as e:
            log.warning(f"  ⚠️ D1 excepción (intento {attempt+1}): {e}")
        time.sleep(3 * (attempt + 1))
    return set(all_urls)


# ═══════════════════════════════════════════════════════════════════════════
# ── Anti-hang: timeouts, heartbeats, watchdog ────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

class BrowserStalled(RuntimeError):
    """A browser operation exceeded its wall-clock budget (or the browser died).

    Playwright's own timeouts only fire when the CDP connection is alive. When
    Chromium dies or the connection wedges, the await never returns at all —
    that is what this exception exists to surface.
    """

    def __init__(self, operation, timeout=None):
        self.operation = operation
        self.timeout = timeout
        if timeout is None:
            super().__init__(f"{operation}: browser is not usable")
        else:
            super().__init__(f"{operation}: no response after {timeout:.0f}s")


async def with_timeout(awaitable, timeout, operation):
    """Await `awaitable` with a hard wall-clock budget.

    Raises BrowserStalled instead of blocking forever. Every Playwright await
    in this module must go through here.
    """
    try:
        return await asyncio.wait_for(awaitable, timeout=timeout)
    except asyncio.TimeoutError:
        raise BrowserStalled(operation, timeout) from None


# Heartbeat sentinel: a worker that never reported progress, or one that
# declared itself dead. Never treated as fresh.
NEVER_REPORTED = None
SILENT_FOREVER = float("inf")


def stalled_workers(heartbeats, now, threshold=WORKER_STALL_TIMEOUT_S):
    """Pure decision helper: which workers have gone silent?

    `heartbeats` maps worker id -> last time.monotonic() stamp, or None for a
    worker that never reported progress / declared itself dead (its silence is
    infinite, never fresh).

    Returns [(worker_id, silent_seconds)], longest silence first. Boundary rule:
    a silence exactly equal to `threshold` counts as STALLED (>= threshold).
    Side-effect free by design so it can be tested without a browser.
    """
    stalled = []
    for worker_id, stamp in heartbeats.items():
        silent = SILENT_FOREVER if stamp is NEVER_REPORTED else now - stamp
        if silent >= threshold:
            stalled.append((worker_id, silent))
    stalled.sort(key=lambda pair: (-pair[1], str(pair[0])))
    return stalled


def should_abort(heartbeats, now, threshold=WORKER_STALL_TIMEOUT_S):
    """Pure decision helper: must the batch be aborted?

    True only when there is at least one active worker and EVERY active worker
    is stalled. Workers that finished cleanly remove themselves from the map, so
    an empty map means "nothing left to supervise", not "everything is stuck".
    """
    if not heartbeats:
        return False
    return len(stalled_workers(heartbeats, now, threshold)) == len(heartbeats)


def _format_silence(silent):
    if silent == SILENT_FOREVER:
        return "nunca reportó progreso"
    return f"{silent:.0f}s sin progreso"


async def watchdog_loop(phase_label, heartbeats, threshold=None, interval=None):
    """Thin async shell around stalled_workers()/should_abort().

    Returns the stalled worker list as soon as the whole batch is wedged; the
    caller uses that completion to unblock the phase. Thresholds resolve at call
    time so tests can drive it fast.
    """
    threshold = WORKER_STALL_TIMEOUT_S if threshold is None else threshold
    interval  = WATCHDOG_INTERVAL_S if interval is None else interval
    while True:
        await asyncio.sleep(interval)
        now = time.monotonic()
        snapshot = dict(heartbeats)
        if not should_abort(snapshot, now, threshold):
            continue
        stalled = stalled_workers(snapshot, now, threshold)
        log_stall_alert(phase_label, stalled, threshold)
        return stalled


def log_stall_alert(phase_label, stalled, threshold=WORKER_STALL_TIMEOUT_S):
    """Log a stall so loudly that no one can skim past it in a log file."""
    bar = "!" * 78
    log.error(bar)
    log.error(f"🚨🚨🚨 WATCHDOG: TODOS LOS WORKERS DE {phase_label} ESTÁN COLGADOS 🚨🚨🚨")
    log.error(f"🚨 Umbral de bloqueo: {threshold:.0f}s sin heartbeat.")
    for worker_id, silent in stalled:
        log.error(f"🚨   worker {worker_id}: {_format_silence(silent)}")
    log.error("🚨 Causa típica: Chromium muerto o conexión CDP congelada.")
    log.error("🚨 Abortando el lote: se cancelan los workers y se recrea el navegador.")
    log.error(bar)


async def _await_workers(workers):
    """Await every worker task (wrapped: asyncio.wait() only accepts Tasks)."""
    await asyncio.gather(*workers, return_exceptions=True)


async def drain_queue_with_watchdog(phase_label, queue, workers, heartbeats,
                                    threshold=None, interval=None, exit_grace=None):
    """Wait for the queue to drain without ever being able to hang.

    `await queue.join()` alone is unrecoverable: if every worker wedges, or a
    worker dies holding an un-acked item, it blocks forever. Race it against the
    watchdog and against worker exhaustion instead.

    Returns True when the batch was aborted, False on a clean drain.
    """
    join_task    = asyncio.create_task(queue.join())
    watchdog     = asyncio.create_task(
        watchdog_loop(phase_label, heartbeats, threshold, interval))
    workers_task = asyncio.create_task(_await_workers(workers))

    done, _ = await asyncio.wait(
        {join_task, watchdog, workers_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    aborted = watchdog in done

    if not aborted and workers_task in done and not join_task.done():
        # Every worker exited without draining the queue: their in-flight items
        # never got task_done(), so join() can never complete on its own.
        try:
            grace = WORKER_EXIT_GRACE_S if exit_grace is None else exit_grace
            await asyncio.wait_for(asyncio.shield(join_task), grace)
        except asyncio.TimeoutError:
            aborted = True
            bar = "!" * 78
            log.error(bar)
            log.error(f"🚨🚨🚨 WATCHDOG: TODOS LOS WORKERS DE {phase_label} MURIERON "
                      f"SIN VACIAR LA COLA 🚨🚨🚨")
            log.error(f"🚨 Quedan {queue.qsize()} elementos sin procesar. Abortando el lote.")
            log.error(bar)

    watchdog.cancel()
    if aborted:
        for worker in workers:
            worker.cancel()
        join_task.cancel()
    await asyncio.gather(workers_task, join_task, watchdog, return_exceptions=True)
    return aborted


async def close_quietly(label, page, context, browser):
    """Tear down browser objects without ever blocking the phase."""
    for name, obj in (("page", page), ("context", context), ("browser", browser)):
        if obj is None:
            continue
        try:
            await with_timeout(obj.close(), CLOSE_TIMEOUT_S, f"{name}.close ({label})")
        except Exception as e:
            log.warning(f"  ⚠️ No se pudo cerrar {name} ({label}): {e}")


def ensure_browser_alive(browser, label):
    """Raise BrowserStalled when Chromium is gone, instead of awaiting a corpse."""
    if browser is not None and not browser.is_connected():
        raise BrowserStalled(f"browser desconectado ({label})")


async def stop_playwright(playwright):
    """Stop the driver with a budget: an orphaned node driver can wedge here."""
    try:
        await with_timeout(playwright.stop(), PLAYWRIGHT_STOP_TIMEOUT_S, "playwright.stop")
    except Exception as e:
        log.warning(f"  ⚠️ playwright.stop() no respondió limpiamente: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# ── Browser Helpers ──────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def make_context(playwright):
    """Create a Playwright browser context, optionally behind the proxy.

    Without USE_PROXY the requests leave from the host's own address, which on
    the Piura VM is already a residential Claro Peru connection. See the
    USE_PROXY comment near the top for why that is the default.
    """
    context_options = {
        "user_agent": random.choice(USER_AGENTS),
        "viewport": {"width": 1280, "height": 720},
        "locale": "en-US",
        # Only claim a US timezone when a US-ish proxy exit is actually in
        # use. Announcing America/New_York from a Peruvian IP is a mismatch a
        # fingerprinter can read, so unproxied runs tell the truth instead.
        "timezone_id": "America/New_York" if USE_PROXY else "America/Lima",
    }
    if USE_PROXY:
        context_options["proxy"] = {
            "server":   f"http://{PROXY_SERVER}",
            "username": PROXY_USER,
            "password": PROXY_PASS,
        }

    browser = await playwright.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
    )
    context = await browser.new_context(**context_options)
    await context.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")

    if COOKIES_FILE.exists():
        try:
            with open(COOKIES_FILE) as f:
                cookies = json.load(f)
            for c in cookies:
                c.setdefault("domain", ".colnect.com")
                c.setdefault("path", "/")
            await context.add_cookies(cookies)
        except Exception as e:
            log.warning(f"Cookie load error: {e}")
    return browser, context


async def safe_goto(page, url, timeout=NAV_TIMEOUT_MS):
    """Navigate and return the settled HTML, or None.

    Raises BrowserStalled when an await never returns: that is a dead browser,
    not a bad page, and the worker must stop rather than keep looping.
    """
    try:
        await with_timeout(
            page.goto(url, wait_until="domcontentloaded", timeout=timeout),
            timeout / 1000 + NAV_TIMEOUT_GRACE_S,
            f"page.goto({url})",
        )
    except BrowserStalled:
        raise
    except Exception as e:
        log.warning(f"goto error {url}: {e}")
        return None

    for _ in range(CONTENT_POLL_ATTEMPTS):
        try:
            cur = page.url
            html = await with_timeout(page.content(), CONTENT_TIMEOUT_S,
                                      f"page.content({url})")
        except BrowserStalled:
            raise
        except Exception:
            await asyncio.sleep(1.0)
            continue

        if any(p in cur or p in html for p in ["pass-challenge", "anubis", "challenge"]):
            await asyncio.sleep(1.0)
            continue
        if len(html) > 2500:
            return html
        await asyncio.sleep(1.0)

    return None


async def scroll_page(page):
    """Scroll page incrementally up to 15 steps max.

    Propagates BrowserStalled: a scroll that never returns means the renderer
    is gone, which is exactly the condition that used to hang the process.
    """
    try:
        await with_timeout(page.evaluate("""
            () => new Promise(resolve => {
                let pos = 0;
                let steps = 0;
                const step = () => {
                    pos += 300;
                    steps += 1;
                    window.scrollTo(0, pos);
                    if (pos < document.body.scrollHeight && steps < 15) setTimeout(step, 60);
                    else resolve();
                };
                step();
            })
        """), SCROLL_TIMEOUT_S, "page.evaluate(scroll_page)")
    except BrowserStalled:
        raise
    except Exception as e:
        log.debug(f"scroll_page error: {e}")
    await asyncio.sleep(1.0)


# ═══════════════════════════════════════════════════════════════════════════
# ── Phase 1: Listing Worker ──────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def listing_worker(worker_id, queue, playwright, result_lock, counters,
                         batch_buffer, heartbeats):
    log.info(f"🕷  Listing worker {worker_id} iniciado.")
    label = f"listing {worker_id}"
    heartbeats[worker_id] = time.monotonic()
    browser = context = page = None

    try:
        browser, context = await with_timeout(
            make_context(playwright), BROWSER_SETUP_TIMEOUT_S, f"make_context ({label})")
        page = await with_timeout(
            context.new_page(), PAGE_OP_TIMEOUT_S, f"context.new_page ({label})")

        await with_timeout(
            page.route("**/*", lambda r: r.abort()
                if r.request.resource_type in ("image", "media", "font") else r.continue_()),
            PAGE_OP_TIMEOUT_S, f"page.route ({label})")

        heartbeats[worker_id] = time.monotonic()

        while True:
            try:
                item = queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            url        = item["url"]
            country_id = item["country_id"]
            ccode      = item["country_code"]

            ensure_browser_alive(browser, label)
            heartbeats[worker_id] = time.monotonic()

            await asyncio.sleep(random.uniform(*LISTING_DELAY))

            try:
                html = await safe_goto(page, url)
                if not html:
                    mark_listing(url, "error")
                    async with result_lock:
                        counters["listing_errors"] += 1
                    heartbeats[worker_id] = time.monotonic()
                    queue.task_done()
                    continue

                await scroll_page(page)
                try:
                    html = await with_timeout(page.content(), CONTENT_TIMEOUT_S,
                                              f"page.content({url})")
                except BrowserStalled:
                    raise
                except Exception:
                    pass

                stamps, discovered_urls = parse_listing_page(html, country_id, ccode)

                # Enqueue newly discovered year/page URLs
                for disc_url in discovered_urls:
                    enqueue_listing_url(disc_url, country_id, ccode)

                if stamps:
                    enqueue_stamps(stamps)
                    mark_listing(url, "done", stamps_found=len(stamps))

                    async with result_lock:
                        counters["stamps_discovered"] += len(stamps)
                        batch_buffer.extend(stamps)
                        name = url.split("colnect.com")[1][:50]
                        log.info(f"  ✅ [{worker_id}] {name} → {len(stamps)} sellos")

                        if len(batch_buffer) >= BATCH_SIZE:
                            to_send = batch_buffer.copy()
                            batch_buffer.clear()
                            loop = asyncio.get_running_loop()
                            await loop.run_in_executor(None, send_batch_sync, to_send)

                else:
                    mark_listing(url, "empty")

            except BrowserStalled:
                # Leave the item un-acked on purpose: the batch is aborting and
                # the URL must stay pending for the next (fresh browser) batch.
                raise
            except Exception as e:
                log.warning(f"  ❌ [{worker_id}] Error en {url}: {e}")
                mark_listing(url, "error")
                async with result_lock:
                    counters["listing_errors"] += 1

            heartbeats[worker_id] = time.monotonic()
            queue.task_done()

    except asyncio.CancelledError:
        heartbeats[worker_id] = NEVER_REPORTED
        raise
    except BrowserStalled as e:
        heartbeats[worker_id] = NEVER_REPORTED
        log.error(f"🚨 [{worker_id}] Navegador bloqueado ({e}). Worker de listado abortado.")
    except Exception as e:
        heartbeats[worker_id] = NEVER_REPORTED
        log.error(f"🚨 [{worker_id}] Worker de listado terminó con error inesperado: {e}")
    else:
        heartbeats.pop(worker_id, None)
    finally:
        await close_quietly(label, page, context, browser)
    log.info(f"🕷  Listing worker {worker_id} finalizado.")


# ═══════════════════════════════════════════════════════════════════════════
# ── Phase 2: Detail Worker ───────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def detail_worker(worker_id, queue, playwright, result_lock, counters,
                        batch_buffer, heartbeats):
    log.info(f"🔬 Detail worker {worker_id} iniciado.")
    label = f"detail {worker_id}"
    heartbeats[worker_id] = time.monotonic()
    browser = context = page = None

    try:
        browser, context = await with_timeout(
            make_context(playwright), BROWSER_SETUP_TIMEOUT_S, f"make_context ({label})")
        page = await with_timeout(
            context.new_page(), PAGE_OP_TIMEOUT_S, f"context.new_page ({label})")

        heartbeats[worker_id] = time.monotonic()

        while True:
            try:
                item = queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            source_url = item["source_url"]
            basic_data = item["basic_data"]

            ensure_browser_alive(browser, label)
            heartbeats[worker_id] = time.monotonic()

            await asyncio.sleep(random.uniform(*DETAIL_DELAY))

            try:
                html = await safe_goto(page, source_url)
                if not html:
                    increment_stamp_retry(source_url)
                    async with result_lock:
                        counters["detail_errors"] += 1
                    heartbeats[worker_id] = time.monotonic()
                    queue.task_done()
                    continue

                stamp = parse_detail_page(html, source_url, basic_data, item.get("country_id"))
                if not stamp:
                    increment_stamp_retry(source_url)
                    heartbeats[worker_id] = time.monotonic()
                    queue.task_done()
                    continue

                async with result_lock:
                    batch_buffer.append(stamp)
                    counters["detail_done"] += 1
                    name = (stamp.get("nameEn") or source_url)[:45]
                    log.info(f"  🔬 [{worker_id}] {name} ({stamp.get('countryCode')}) ✅")

                    if len(batch_buffer) >= BATCH_SIZE:
                        to_send = batch_buffer.copy()
                        batch_buffer.clear()
                        loop = asyncio.get_running_loop()
                        failed = await loop.run_in_executor(None, send_batch_sync, to_send)
                        for s in to_send:
                            # Only retire a stamp once D1 actually accepted it,
                            # otherwise it would be lost silently. Failure is
                            # per stamp: one bad sello no reintenta el lote.
                            if s.get("sourceUrl") in failed:
                                increment_stamp_retry(s["sourceUrl"])
                            else:
                                mark_stamp(s["sourceUrl"], "done")

            except BrowserStalled:
                # Item stays un-acked and pending: the batch is aborting.
                raise
            except Exception as e:
                log.warning(f"  ❌ [{worker_id}] Error detalle {source_url}: {e}")
                increment_stamp_retry(source_url)
                async with result_lock:
                    counters["detail_errors"] += 1

            heartbeats[worker_id] = time.monotonic()
            queue.task_done()

    except asyncio.CancelledError:
        heartbeats[worker_id] = NEVER_REPORTED
        raise
    except BrowserStalled as e:
        heartbeats[worker_id] = NEVER_REPORTED
        log.error(f"🚨 [{worker_id}] Navegador bloqueado ({e}). Worker de detalle abortado.")
    except Exception as e:
        heartbeats[worker_id] = NEVER_REPORTED
        log.error(f"🚨 [{worker_id}] Worker de detalle terminó con error inesperado: {e}")
    else:
        heartbeats.pop(worker_id, None)
    finally:
        await close_quietly(label, page, context, browser)
    log.info(f"🔬 Detail worker {worker_id} finalizado.")


# ═══════════════════════════════════════════════════════════════════════════
# ── Main Orchestrator ────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def run_listing_phase():
    """Phase 1: Discover stamps from listing pages continuously.

    Returns True when the phase gave up after repeated stalls.
    """
    counters     = {"stamps_discovered": 0, "listing_errors": 0}
    result_lock  = asyncio.Lock()
    batch_buffer = []
    consecutive_aborts = 0
    gave_up = False

    while True:
        pending = fetch_pending_listing(limit=1000)
        if not pending:
            log.info("✅ No hay páginas de listado pendientes en este lote.")
            break

        log.info(f"\n🌍 FASE 1 — Listado: procesando lote de {len(pending):,} páginas...\n")
        queue = asyncio.Queue()
        for item in pending:
            await queue.put(item)

        heartbeats = {}
        playwright = await async_playwright().start()
        try:
            workers = [
                asyncio.create_task(listing_worker(
                    i, queue, playwright, result_lock, counters, batch_buffer, heartbeats))
                for i in range(LISTING_WORKERS)
            ]
            aborted = await drain_queue_with_watchdog(
                "FASE 1 (listado)", queue, workers, heartbeats)
        finally:
            await stop_playwright(playwright)

        if not aborted:
            consecutive_aborts = 0
            continue

        consecutive_aborts += 1
        log.error(
            f"🚨 Lote de listado abortado por bloqueo "
            f"({consecutive_aborts}/{MAX_CONSECUTIVE_STALL_ABORTS} consecutivos)."
        )
        if consecutive_aborts >= MAX_CONSECUTIVE_STALL_ABORTS:
            log.error("💀 Fase 1 abandonada: el navegador se bloquea una y otra vez.")
            gave_up = True
            break
        log.error(f"🔁 Recreando el navegador en {STALL_RECOVERY_BACKOFF_S:.0f}s...")
        await asyncio.sleep(STALL_RECOVERY_BACKOFF_S)

    # Always flush: an aborted batch must not silently drop buffered stamps.
    if batch_buffer:
        send_batch_sync(batch_buffer)
        batch_buffer.clear()

    log.info(f"✅ Fase 1 completa. Total sellos descubiertos: {counters['stamps_discovered']:,}")
    return gave_up


async def run_detail_phase():
    """Phase 2: Enrich stamps with full detail page data.

    Returns True when the phase gave up after repeated stalls.
    """
    counters     = {"detail_done": 0, "detail_errors": 0}
    result_lock  = asyncio.Lock()
    batch_buffer = []
    consecutive_aborts = 0
    gave_up = False

    while True:
        pending = fetch_pending_detail(limit=1000)
        if not pending:
            log.info("✅ No hay sellos pendientes de detalle.")
            break

        log.info(f"\n🔬 FASE 2 — Detalle: procesando lote de {len(pending):,} sellos...\n")
        queue = asyncio.Queue()
        for item in pending:
            await queue.put(item)

        heartbeats = {}
        playwright = await async_playwright().start()
        try:
            workers = [
                asyncio.create_task(detail_worker(
                    i, queue, playwright, result_lock, counters, batch_buffer, heartbeats))
                for i in range(DETAIL_WORKERS)
            ]
            aborted = await drain_queue_with_watchdog(
                "FASE 2 (detalle)", queue, workers, heartbeats)
        finally:
            await stop_playwright(playwright)

        if not aborted:
            consecutive_aborts = 0
            continue

        consecutive_aborts += 1
        log.error(
            f"🚨 Lote de detalle abortado por bloqueo "
            f"({consecutive_aborts}/{MAX_CONSECUTIVE_STALL_ABORTS} consecutivos)."
        )
        if consecutive_aborts >= MAX_CONSECUTIVE_STALL_ABORTS:
            log.error("💀 Fase 2 abandonada: el navegador se bloquea una y otra vez.")
            gave_up = True
            break
        log.error(f"🔁 Recreando el navegador en {STALL_RECOVERY_BACKOFF_S:.0f}s...")
        await asyncio.sleep(STALL_RECOVERY_BACKOFF_S)

    # Always flush: an aborted batch must not silently drop buffered stamps.
    if batch_buffer:
        failed = send_batch_sync(batch_buffer)
        for s in batch_buffer:
            if s.get("sourceUrl") in failed:
                increment_stamp_retry(s["sourceUrl"])
            else:
                mark_stamp(s["sourceUrl"], "done")
        batch_buffer.clear()

    log.info(f"✅ Fase 2 completa. Detalles extraídos: {counters['detail_done']:,}")
    return gave_up


async def main():
    init_db()

    # Reset errors from past runs so we retry them safely
    db_exec("UPDATE listing_pages SET status = 'pending' WHERE status = 'error'")

    count = db_query("SELECT COUNT(*) FROM listing_pages")[0][0]
    if count == 0:
        log.info("🌱 Primera ejecución — sembrando base URLs de países...")
        countries = load_countries()
        seed_country_base_urls(countries)

    mode = sys.argv[1] if len(sys.argv) > 1 else "both"
    stalled = False
    if mode in ("listing", "both"):
        stalled = await run_listing_phase() or stalled

    if mode in ("detail", "both"):
        stalled = await run_detail_phase() or stalled

    if stalled:
        # Exit non-zero so a supervisor can tell "died" from "finished".
        log.error("💀 PROCESO ABORTADO POR BLOQUEO DEL NAVEGADOR — "
                  f"trabajo incompleto, saliendo con código {STALL_EXIT_CODE}.")
        return STALL_EXIT_CODE

    log.info("\n🎉 Proceso finalizado.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
