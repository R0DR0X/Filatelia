#!/usr/bin/env python3
"""
Image Resolver for Colnect Stamps
=====================================
Recovers missing stamp images using two strategies:

Strategy A — CDN Interpolation (no login required):
  For stamps in the same series, Colnect CDN folders are shared.
  If stamp X has image /b/1431/447/..., stamp X+1 is likely /b/1431/448/...
  We interpolate from known neighbours in the same series.

Strategy B — Authenticated page scrape (session cookies):
  For stamps where Strategy A fails, navigate the page with session cookies.
  Works for stamps where Colnect shows the image to logged-in users.
  Does NOT work for fully restricted/premium stamps — those get marked 'restricted'.

Rate: 4-6 seconds between requests (no proxy needed, uses local authenticated IP).
"""

import asyncio
import httpx
import json
import os
import random
import re
import requests
import sqlite3
import time
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

# --- Config ---
API_URL       = "https://filatelia-api.rodrigopianto2005.workers.dev/query"
COOKIES_FILE  = "scrapers/colnect_cookies_images.json"
PROGRESS_DB   = "image_resolver_progress.db"
ANUBIS_EXPIRY = 1845937200 # Dec 2028 (fallback)
BATCH_FETCH   = 200
NONE_LOGGED   = "none_logged_image"
NONE_STAMPS   = "none-stamps"
NONE_LOGGED_VAL = "https://i.colnect.net/items/thumb/none_logged_image.jpg"

# Generate a unique proxy session ID for this run to ensure a fresh, consistent IP
SESSION_ID = "crawler_session_vm"
PROXY_URL = f"http://ce2dd5be999d7e7e9a05__sessid.{SESSION_ID}:b93d4b8e9a554c41@gw.dataimpulse.com:823"

# CDN base for direct requests (works for public images)
CDN_BASE = "https://i.colnect.net/b"


# --- Local checkpoint DB ---

def init_db():
    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS done (
            sourceUrl TEXT PRIMARY KEY,
            status    TEXT,
            updated   INTEGER
        )
    """)
    conn.commit()
    conn.close()


def mark_done(source_url: str, status: str = "ok"):
    conn = sqlite3.connect(PROGRESS_DB)
    conn.execute(
        "INSERT OR REPLACE INTO done (sourceUrl, status, updated) VALUES (?, ?, ?)",
        (source_url, status, int(time.time()))
    )
    conn.commit()
    conn.close()


def already_done(source_url: str) -> bool:
    conn = sqlite3.connect(PROGRESS_DB)
    row = conn.execute("SELECT 1 FROM done WHERE sourceUrl = ?", (source_url,)).fetchone()
    conn.close()
    return row is not None


def done_count() -> dict:
    conn = sqlite3.connect(PROGRESS_DB)
    rows = conn.execute("SELECT status, COUNT(*) FROM done GROUP BY status").fetchall()
    conn.close()
    return dict(rows)


# --- D1 helpers ---

def fetch_missing_stamps(offset: int = 0, limit: int = BATCH_FETCH) -> list:
    """Fetch stamps from D1 still having placeholder images, with retries."""
    sql = f"""
        SELECT id, sourceUrl, imageUrl FROM Stamp
        WHERE source = 'colnect'
          AND imageUrl = '{NONE_LOGGED_VAL}'
        ORDER BY id
        LIMIT {limit} OFFSET {offset}
    """
    for attempt in range(5):
        try:
            res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=45)
            if res.status_code == 200 and res.json().get("success"):
                return res.json().get("results", [])
            print(f"  ⚠️  D1 fetch attempt {attempt+1} failed: HTTP {res.status_code}")
        except Exception as e:
            print(f"  ⚠️  D1 fetch error on attempt {attempt+1}: {e}")
        time.sleep(2.0 * (attempt + 1))
    return []


def count_missing() -> int:
    sql = f"SELECT COUNT(*) as n FROM Stamp WHERE source='colnect' AND imageUrl = '{NONE_LOGGED_VAL}'"
    for attempt in range(3):
        try:
            res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=30)
            if res.status_code == 200:
                return res.json().get("results", [{}])[0].get("n", 0)
        except Exception as e:
            print(f"  ⚠️  D1 count error on attempt {attempt+1}: {e}")
        time.sleep(2.0 * (attempt + 1))
    return -1


def fetch_series_neighbours(source_url: str) -> list:
    """
    Fetch other stamps in the same country that have a real image URL.
    """
    try:
        parts = source_url.split("/stamp/")[-1].split("-")
        # The last token is the country slug
        country = parts[-1] if parts else None
        if not country:
            return []

        sql = f"""
            SELECT sourceUrl, imageUrl FROM Stamp
            WHERE source = 'colnect'
              AND sourceUrl LIKE '%-{country}'
              AND (imageUrl LIKE '%i.colnect.net/b/%' OR imageUrl LIKE '%i.colnect.net/f/%')
              AND imageUrl != '{NONE_LOGGED_VAL}'
              AND imageUrl != '{NONE_STAMPS}'
            LIMIT 1000
        """
        for attempt in range(3):
            try:
                res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=30)
                if res.status_code == 200 and res.json().get("success"):
                    return res.json().get("results", [])
            except Exception as e:
                print(f"  ⚠️  Country neighbour query attempt {attempt+1} failed: {e}")
            time.sleep(1.5 * (attempt + 1))
    except Exception as e:
        print(f"  ⚠️  Country neighbour query critical failure: {e}")
    return []


def parse_cdn_path(image_url: str):
    """Parse type, folder and index from a CDN URL like /b/1431/447/name.jpg or /f/6132/969/..."""
    m = re.search(r"/([bf])/(\d+)/(\d+)/", image_url)
    if m:
        return m.group(1), int(m.group(2)), int(m.group(3))
    return None, None, None


def get_stamp_id_from_url(source_url: str) -> int | None:
    """Extract the numeric Colnect stamp ID from the sourceUrl."""
    m = re.search(r"/stamp/(\d+)-", source_url)
    return int(m.group(1)) if m else None


async def try_cdn_interpolation(source_url: str, neighbours: list) -> str | None:
    """
    Build candidate CDN URLs by interpolating from closest neighbours by ID.
    Tests candidates in parallel via asyncio.gather using streaming GET requests.
    """
    target_id = get_stamp_id_from_url(source_url)
    if not target_id:
        return None

    # Build map: stamp_id -> (type, folder, index)
    id_to_cdn = {}
    for n in neighbours:
        nid = get_stamp_id_from_url(n.get("sourceUrl", ""))
        ctype, folder, idx = parse_cdn_path(n.get("imageUrl", ""))
        if nid and ctype and folder and idx:
            id_to_cdn[nid] = (ctype, folder, idx)

    if not id_to_cdn:
        return None

    # Sort neighbours by absolute ID difference to target_id
    sorted_ids = sorted(id_to_cdn.keys(), key=lambda x: abs(x - target_id))
    
    # Pick the 5 closest neighbours to generate candidate ranges
    closest_ids = sorted_ids[:5]
    
    candidates = {} # (ctype, folder, idx) -> min_distance_from_prediction
    for nid in closest_ids:
        ctype, folder, idx = id_to_cdn[nid]
        id_diff = target_id - nid
        base_idx = idx + id_diff
        
        # Test a range of -15 to +15 around the predicted index
        for d in range(-15, 16):
            cand_idx = base_idx + d
            if cand_idx > 0:
                key = (ctype, folder, cand_idx)
                dist = abs(d)
                if key not in candidates or dist < candidates[key]:
                    candidates[key] = dist

    if not candidates:
        return None

    print(f"  🔍 Generated {len(candidates)} unique candidates from closest neighbours.")

    # Build the candidate URLs using the name slug (underscores replaced with hyphens)
    name_slug = "image"
    parts = source_url.split("/stamp/")[-1].split("-")
    if len(parts) >= 3:
        name_slug = parts[1].replace("_", "-").replace(" ", "-")

    candidate_urls = []
    for (ctype, folder, idx), dist in candidates.items():
        full_url = f"https://i.colnect.net/{ctype}/{folder}/{idx}/{name_slug}.jpg"
        candidate_urls.append((ctype, folder, idx, dist, full_url))

    proxy_url = PROXY_URL
    semaphore = asyncio.Semaphore(10)
    
    async def check_url(ctype, folder, idx, dist, url, client):
        async with semaphore:
            try:
                # Use stream("GET") to read headers and immediately close, preventing body download
                async with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}, timeout=3.5) as r:
                    if r.status_code == 200:
                        return url, dist
            except Exception:
                pass
            return None

    async with httpx.AsyncClient(proxy=proxy_url, timeout=4.0, follow_redirects=True) as client:
        tasks = [check_url(ctype, folder, idx, dist, url, client) for ctype, folder, idx, dist, url in candidate_urls]
        results = await asyncio.gather(*tasks)
        
        valid_results = [res for res in results if res is not None]
        if valid_results:
            # Sort by the closest index offset to choose the most mathematically likely one
            valid_results.sort(key=lambda x: x[1])
            return valid_results[0][0]

    return None


def extract_image_from_html(html: str) -> str | None:
    """Extract real CDN image URL from stamp page HTML."""
    soup = BeautifulSoup(html, "html.parser")

    for sel in [".stamp_image img", "#item_image img", ".main-image img", "img.item_pic"]:
        el = soup.select_one(sel)
        if el:
            src = el.get("src") or el.get("data-src") or ""
            if "i.colnect.net" in src and NONE_LOGGED not in src and NONE_STAMPS not in src:
                return src

    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if "i.colnect.net" in src and NONE_LOGGED not in src and NONE_STAMPS not in src:
            if any(p in src for p in ["/b/", "/f/", "/t/"]) and "/flags/" not in src:
                return src

    return None


def update_d1(source_url: str, image_url: str) -> bool:
    """Update imageUrl in D1 for a stamp, only if current value is a placeholder."""
    if image_url.startswith("//"):
        image_url = "https:" + image_url
    if "/t/" in image_url:
        image_url = image_url.replace("/t/", "/b/", 1)
    elif "/f/" in image_url:
        image_url = image_url.replace("/f/", "/b/", 1)

    sql = """
        UPDATE Stamp
        SET imageUrl = ?, updatedAt = datetime('now')
        WHERE sourceUrl = ?
          AND (imageUrl LIKE '%none_logged_image%' OR imageUrl IS NULL)
    """
    try:
        res = requests.post(API_URL, json={"sql": sql, "params": [image_url, source_url]}, timeout=20)
        return res.status_code == 200 and res.json().get("success", False)
    except Exception as e:
        print(f"  ⚠️  D1 update error: {e}")
    return False


def load_cookies() -> list:
    if not os.path.exists(COOKIES_FILE):
        print(f"⚠️  Cookies file not found: {COOKIES_FILE}")
        return []
    with open(COOKIES_FILE) as f:
        cookies = json.load(f)
    dynamic_expiry = int(time.time() + 180 * 24 * 3600)
    for c in cookies:
        if "anubis" in c.get("name", ""):
            c["expires"] = dynamic_expiry
        c.setdefault("domain", "colnect.com")
        c.setdefault("path", "/")
    return cookies


# --- Main ---

async def resolve_images():
    init_db()
    cookies = load_cookies()

    total_missing = count_missing()
    print(f"🔍 Stamps with missing images in D1: {total_missing}")
    if total_missing == 0:
        print("✅ Nothing to do!")
        return

    print(f"🍪 Loaded {len(cookies)} cookies.")
    print("🚀 Starting image resolver (Strategy A: CDN interpolation, Strategy B: page scrape)")
    print(f"   Using proxy session: {SESSION_ID}")
    print("   Delay: 20.0s before browser page crawls\n")

    resolved_a = 0  # CDN interpolation wins
    resolved_b = 0  # Page scrape wins
    restricted = 0  # Login required (can't recover)
    failed = 0

    async with async_playwright() as pw:
        proxy_config = {
            "server": "http://gw.dataimpulse.com:823",
            "username": f"ce2dd5be999d7e7e9a05__sessid.{SESSION_ID}",
            "password": "b93d4b8e9a554c41"
        }
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
            proxy=proxy_config
        )
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
            proxy=proxy_config
        )
        await ctx.add_cookies(cookies)
        await ctx.add_init_script("delete navigator.__proto__.webdriver;")
        page = await ctx.new_page()
        # Desactivamos interceptación por completo para comportarnos 100% como un navegador real
        # await page.route("**/*", lambda r: (
        #     r.abort() if r.request.resource_type in ["image", "font", "media", "stylesheet"]
        #     else r.continue_()
        # ))

        while True:
            stamps = fetch_missing_stamps(offset=0)  # Always from top (resolved ones drop out)
            if not stamps:
                print("✅ All missing images resolved!")
                break

            print(f"\n📋 {len(stamps)} stamps remaining | A:{resolved_a} B:{resolved_b} 🔒:{restricted} ❌:{failed}")

            for stamp in stamps:
                source_url = stamp.get("sourceUrl", "")
                if not source_url or already_done(source_url):
                    continue

                print(f"🕵️ Resolving: {source_url.split('/stamp/')[-1][:50]}...")

                # --- Strategy A: CDN Interpolation ---
                print("  🔍 Strategy A: Fetching series neighbours...")
                neighbours = fetch_series_neighbours(source_url)
                print(f"  🔍 Strategy A: Found {len(neighbours)} neighbours. Trying interpolation...")
                cdn_url = await try_cdn_interpolation(source_url, neighbours)
                if cdn_url:
                    if update_d1(source_url, cdn_url):
                        print(f"  🎯 [A] Resolved: {source_url.split('/stamp/')[1][:45]}")
                        print(f"       → {cdn_url}")
                        resolved_a += 1
                        mark_done(source_url, "ok_cdn")
                        continue

                # --- Strategy B: Page scrape ---
                print("  ⏳ Strategy A failed. Sleeping 20s before page crawl...")
                await asyncio.sleep(20.0)
                try:
                    resp = None
                    for attempt in range(3):
                        try:
                            print(f"  🌐 Strategy B: Navigating to page via Playwright (attempt {attempt+1})...")
                            resp = await page.goto(source_url, wait_until="domcontentloaded", timeout=45000)
                            break
                        except Exception as e:
                            print(f"  ⚠️  Navigation attempt {attempt+1} failed: {e}")
                            if attempt < 2:
                                await asyncio.sleep(5.0)
                            else:
                                raise e

                    print(f"  🌐 Strategy B: Page loaded (status: {resp.status if resp else 0}). Waiting for network idle...")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=8000)
                    except Exception:
                        pass
                    await asyncio.sleep(2.0)
                    html = await page.content()
                    status = resp.status if resp else 0

                    if status != 200 or len(html) < 3000 or "Anubis" in html:
                        print(f"  ⚠️  Blocked/Challenged: {source_url.split('/stamp/')[1][:40]}")
                        failed += 1
                        mark_done(source_url, "blocked")
                        continue

                    img_url = extract_image_from_html(html)
                    if img_url:
                        if update_d1(source_url, img_url):
                            print(f"  ✅ [B] Resolved: {source_url.split('/stamp/')[1][:45]}")
                            print(f"       → {img_url}")
                            resolved_b += 1
                            mark_done(source_url, "ok_page")
                    else:
                        print(f"  🔒 Restricted: {source_url.split('/stamp/')[1][:40]}")
                        restricted += 1
                        mark_done(source_url, "restricted")

                except Exception as e:
                    print(f"  ❌ Playwright Exception: {e}")
                    failed += 1

        await browser.close()

    print(f"\n🎉 Done!")
    print(f"   CDN interpolation: {resolved_a}")
    print(f"   Page scrape:       {resolved_b}")
    print(f"   Restricted:        {restricted}")
    print(f"   Failed/blocked:    {failed}")
    print(f"   Checkpoint DB:     {done_count()}")


if __name__ == "__main__":
    asyncio.run(resolve_images())
