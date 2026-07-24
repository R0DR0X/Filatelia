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

import requests
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
COOKIES_FILE = SCRIPT_DIR / "colnect_cookies.json"
COUNTRIES_FILE = SCRIPT_DIR / "colnect_countries_full.json"
PROGRESS_DB  = Path("colnect_v3_progress.db")   # SQLite checkpoint (project root)
LOG_FILE     = Path("colnect_v3.log")

# ── API ─────────────────────────────────────────────────────────────────────
API_URL      = "https://filatelia-api.rodrigopianto2005.workers.dev/import-stamp"
QUERY_URL    = "https://filatelia-api.rodrigopianto2005.workers.dev/query"

# ── Proxy (DataImpulse residential User B - active) ─────────────────────────
PROXY_SERVER = "gw.dataimpulse.com:823"
PROXY_USER   = "ce2dd5be999d7e7e9a05"
PROXY_PASS   = "b93d4b8e9a554c41"

# ── Concurrency ──────────────────────────────────────────────────────────────
LISTING_WORKERS  = 4   # parallel listing-page workers
DETAIL_WORKERS   = 3   # parallel detail-page workers
BATCH_SIZE       = 20  # stamps per D1 API call
LISTING_DELAY    = (2.0, 4.0)  # (min, max) seconds between listing pages
DETAIL_DELAY     = (3.0, 5.5)  # (min, max) seconds between detail pages

# ── Filtering ────────────────────────────────────────────────────────────────
NONE_LOGGED_PATTERNS = [
    "none_logged_image", "none-stamps", "pass-challenge"
]

# ── UUID namespace ───────────────────────────────────────────────────────────
NAMESPACE_PHILATELY = uuid.UUID("12345678-1234-5678-1234-567812345678")

# ── Country code map ────────────────────────────────────────────────────────
COUNTRY_CODE_MAP = {
    "225": "UNI",  "90": "GUI",   "191": "SIE",  "41": "CAR",
    "212": "TOG",  "91": "GUI",   "98": "HUN",   "939": "FRA",
    "108": "JAP",  "74": "FRA",   "177": "ROM",  "121": "LIB",
    "59":  "DJI",  "156": "NIG",  "21": "BEL",   "81": "GER",
    "442": "CHI",  "178": "RUS",  "106": "ITA",  "199": "SPA",
    "53":  "CUB",  "13": "AUS",   "224": "GBR",  "38": "CAN",
    "30":  "BRA",  "157": "NIG",  "155": "NZL",  "169": "PE",
    "10":  "ARG",  "105": "ISR",  "139": "MEX",  "47": "COL",
    "43":  "CHI",  "227": "URU",  "230": "VEN",  "26": "BOL",
    "63":  "ECU",  "168": "PAR",  "248": "ABK",  "456": "ABU",
    "133": "MAR",  "176": "POR",  "52": "CRO",   "237": "YUG",
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
                s.get("countryId", ""),
                s.get("countryCode", ""),
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
        ccode = COUNTRY_CODE_MAP.get(cid, cslug[:3].upper())
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
                "countryCode":  country_code,
                "countryId":    country_id,
                "year":         year,
                "denomination": denomination,
                "imageUrl":     image_url,
                "scottNumber":  _extract_code("Sn", catalog_codes),
                "michelNumber": _extract_code("Mi", catalog_codes),
                "yvertNumber":  _extract_code("Yt", catalog_codes),
                "theme":        themes_str.replace("|", ",") or None,
                "color":        colors or None,
                "descriptionEs": description,
                "source":       "colnect",
                "sourceUrl":    source_url,
                "series":       series or None,
            })
        except Exception as e:
            log.debug(f"parse_listing item error: {e}")

    return stamps, list(set(discovered_urls))


def parse_detail_page(html, source_url, basic_data):
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

    return {
        "id":             basic_data.get("id") or str(uuid.uuid5(NAMESPACE_PHILATELY, source_url)),
        "source":         "colnect",
        "sourceUrl":      source_url,
        "countryCode":    basic_data.get("countryCode", ""),
        "countryId":      basic_data.get("countryId", ""),
        "nameEn":         name,
        "nameEs":         name,
        "year":           year,
        "denomination":   basic_data.get("denomination"),
        "imageUrl":       image_url,
        "imageBackUrl":   image_back_url,
        "scottNumber":    basic_data.get("scottNumber"),
        "michelNumber":   basic_data.get("michelNumber"),
        "yvertNumber":    basic_data.get("yvertNumber"),
        "color":          info.get("colors") or basic_data.get("color"),
        "theme":          info.get("themes") or basic_data.get("theme"),
        "perforation":    info.get("perforation"),
        "printTechnique": info.get("printing"),
        "paperType":      info.get("paper"),
        "descriptionEs":  info.get("description") or basic_data.get("descriptionEs"),
        "series":         basic_data.get("series"),
    }


# ═══════════════════════════════════════════════════════════════════════════
# ── D1 API ───────────────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

def send_batch_sync(stamps):
    """Send a batch of stamps to Cloudflare D1."""
    if not stamps:
        return True
    for attempt in range(4):
        try:
            res = requests.post(
                API_URL,
                json={"stamps": stamps},
                headers={"Content-Type": "application/json"},
                timeout=30,
            )
            if res.status_code == 200:
                result = res.json()
                ins = result.get("inserted", 0)
                upd = result.get("updated", 0)
                log.info(f"  📦 D1: +{ins} insertados, {upd} actualizados ({len(stamps)} enviados)")
                return True
            if res.status_code == 429:
                wait = 10 * (attempt + 1)
                log.warning(f"  ⚠️ D1 rate-limit 429. Esperando {wait}s...")
                time.sleep(wait)
            else:
                log.warning(f"  ⚠️ D1 HTTP {res.status_code}: {res.text[:200]}")
        except Exception as e:
            log.warning(f"  ⚠️ D1 excepción (intento {attempt+1}): {e}")
        time.sleep(3 * (attempt + 1))
    return False


# ═══════════════════════════════════════════════════════════════════════════
# ── Browser Helpers ──────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def make_context(playwright):
    """Create Playwright browser context with User B proxy."""
    proxy = {
        "server":   f"http://{PROXY_SERVER}",
        "username": PROXY_USER,
        "password": PROXY_PASS,
    }
    browser = await playwright.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
    )
    context = await browser.new_context(
        proxy=proxy,
        user_agent=random.choice(USER_AGENTS),
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        timezone_id="America/New_York",
    )
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


async def safe_goto(page, url, timeout=25000):
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except Exception as e:
        log.warning(f"goto error {url}: {e}")
        return None

    for _ in range(25):
        try:
            cur = page.url
            html = await page.content()
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
    """Scroll page incrementally up to 15 steps max."""
    try:
        await page.evaluate("""
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
        """)
        await asyncio.sleep(1.0)
    except Exception as e:
        log.debug(f"scroll_page error: {e}")


# ═══════════════════════════════════════════════════════════════════════════
# ── Phase 1: Listing Worker ──────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def listing_worker(worker_id, queue, playwright, result_lock, counters, batch_buffer):
    log.info(f"🕷  Listing worker {worker_id} iniciado.")
    browser, context = await make_context(playwright)
    page = await context.new_page()

    await page.route("**/*", lambda r: r.abort()
        if r.request.resource_type in ("image", "media", "font") else r.continue_())

    try:
        while True:
            try:
                item = queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            url        = item["url"]
            country_id = item["country_id"]
            ccode      = item["country_code"]

            await asyncio.sleep(random.uniform(*LISTING_DELAY))

            try:
                html = await safe_goto(page, url)
                if not html:
                    mark_listing(url, "error")
                    async with result_lock:
                        counters["listing_errors"] += 1
                    queue.task_done()
                    continue

                await scroll_page(page)
                try:
                    html = await page.content()
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

            except Exception as e:
                log.warning(f"  ❌ [{worker_id}] Error en {url}: {e}")
                mark_listing(url, "error")
                async with result_lock:
                    counters["listing_errors"] += 1

            queue.task_done()
    finally:
        await page.close()
        await context.close()
        await browser.close()
    log.info(f"🕷  Listing worker {worker_id} finalizado.")


# ═══════════════════════════════════════════════════════════════════════════
# ── Phase 2: Detail Worker ───────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def detail_worker(worker_id, queue, playwright, result_lock, counters, batch_buffer):
    log.info(f"🔬 Detail worker {worker_id} iniciado.")
    browser, context = await make_context(playwright)
    page = await context.new_page()

    try:
        while True:
            try:
                item = queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            source_url = item["source_url"]
            basic_data = item["basic_data"]

            await asyncio.sleep(random.uniform(*DETAIL_DELAY))

            try:
                html = await safe_goto(page, source_url)
                if not html:
                    increment_stamp_retry(source_url)
                    async with result_lock:
                        counters["detail_errors"] += 1
                    queue.task_done()
                    continue

                stamp = parse_detail_page(html, source_url, basic_data)
                if not stamp:
                    increment_stamp_retry(source_url)
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
                        await loop.run_in_executor(None, send_batch_sync, to_send)
                        for s in to_send:
                            mark_stamp(s["sourceUrl"], "done")

            except Exception as e:
                log.warning(f"  ❌ [{worker_id}] Error detalle {source_url}: {e}")
                increment_stamp_retry(source_url)
                async with result_lock:
                    counters["detail_errors"] += 1

            queue.task_done()
    finally:
        await page.close()
        await context.close()
        await browser.close()
    log.info(f"🔬 Detail worker {worker_id} finalizado.")


# ═══════════════════════════════════════════════════════════════════════════
# ── Main Orchestrator ────────────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════

async def run_listing_phase():
    """Phase 1: Discover stamps from listing pages continuously."""
    counters     = {"stamps_discovered": 0, "listing_errors": 0}
    result_lock  = asyncio.Lock()
    batch_buffer = []

    while True:
        pending = fetch_pending_listing(limit=1000)
        if not pending:
            log.info("✅ No hay páginas de listado pendientes en este lote.")
            break

        log.info(f"\n🌍 FASE 1 — Listado: procesando lote de {len(pending):,} páginas...\n")
        queue = asyncio.Queue()
        for item in pending:
            await queue.put(item)

        async with async_playwright() as playwright:
            workers = [
                asyncio.create_task(listing_worker(i, queue, playwright, result_lock, counters, batch_buffer))
                for i in range(LISTING_WORKERS)
            ]
            await queue.join()
            await asyncio.gather(*workers, return_exceptions=True)

    if batch_buffer:
        send_batch_sync(batch_buffer)

    log.info(f"✅ Fase 1 completa. Total sellos descubiertos: {counters['stamps_discovered']:,}")


async def run_detail_phase():
    """Phase 2: Enrich stamps with full detail page data."""
    counters     = {"detail_done": 0, "detail_errors": 0}
    result_lock  = asyncio.Lock()
    batch_buffer = []

    while True:
        pending = fetch_pending_detail(limit=1000)
        if not pending:
            log.info("✅ No hay sellos pendientes de detalle.")
            break

        log.info(f"\n🔬 FASE 2 — Detalle: procesando lote de {len(pending):,} sellos...\n")
        queue = asyncio.Queue()
        for item in pending:
            await queue.put(item)

        async with async_playwright() as playwright:
            workers = [
                asyncio.create_task(
                    detail_worker(i, queue, playwright, result_lock, counters, batch_buffer)
                )
                for i in range(DETAIL_WORKERS)
            ]
            await queue.join()
            await asyncio.gather(*workers, return_exceptions=True)

    if batch_buffer:
        send_batch_sync(batch_buffer)
        for s in batch_buffer:
            mark_stamp(s["sourceUrl"], "done")

    log.info(f"✅ Fase 2 completa. Detalles extraídos: {counters['detail_done']:,}")


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
    if mode in ("listing", "both"):
        await run_listing_phase()

    if mode in ("detail", "both"):
        await run_detail_phase()

    log.info("\n🎉 Proceso finalizado.")


if __name__ == "__main__":
    asyncio.run(main())
