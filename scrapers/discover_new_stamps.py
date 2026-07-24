#!/usr/bin/env python3
import asyncio
import sqlite3
import random
import time
import sys
import os
import json
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DB = os.path.abspath(os.path.join(SCRIPT_DIR, "../crawler_progress.db"))

# --- PROXY CONFIGURATION (NEW CREDENTIALS) ---
USE_PROXY = True
PROXY_BASE = "gw.dataimpulse.com:823"
PROXY_USER = "ce2dd5be999d7e7e9a05"
PROXY_PASS = "b93d4b8e9a554c41"

# Target countries to discover new stamps for
TARGET_COUNTRIES = [
    ("225", "United_States_of_America", "United States"),
    ("191", "Sierra_Leone", "Sierra Leone"),
    ("90", "Guinea", "Guinea"),
    ("41", "Central_African_Republic", "Central African Republic"),
]

TARGET_YEARS = list(range(2000, 2026))

def init_db():
    conn = sqlite3.connect(LOCAL_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS queue (
            url TEXT PRIMARY KEY,
            status TEXT DEFAULT 'pending',
            retries INTEGER DEFAULT 0,
            updated_at INTEGER
        )
    """)
    conn.commit()
    conn.close()

def enqueue_urls(urls):
    if not urls:
        return 0
    conn = sqlite3.connect(LOCAL_DB)
    cursor = conn.cursor()
    inserted = 0
    try:
        cursor.executemany(
            "INSERT OR IGNORE INTO queue (url, status, retries, updated_at) VALUES (?, 'pending', 0, ?)",
            [(url, int(time.time())) for url in urls]
        )
        inserted = cursor.rowcount
        conn.commit()
    except Exception as e:
        print(f"❌ Error inserting into SQLite: {e}")
    finally:
        conn.close()
    return inserted

async def main():
    init_db()
    
    countries = TARGET_COUNTRIES
    years = TARGET_YEARS
    
    if len(sys.argv) >= 3:
        countries = [(sys.argv[1], sys.argv[2], sys.argv[2].replace("_", " "))]
        if len(sys.argv) >= 5:
            years = list(range(int(sys.argv[3]), int(sys.argv[4]) + 1))
            
    print(f"🚀 Starting Discovery for {len(countries)} countries across years: {years[0]}-{years[-1]}")
    
    async with async_playwright() as p:
        browser = None
        context = None
        page = None
        consecutive_errors = 0
        
        async def init_browser():
            nonlocal browser, context, page
            if page:
                await page.close()
            if context:
                await context.close()
            if browser:
                await browser.close()
                
            session_id = f"discovery_{random.randint(100000, 999999)}"
            print(f"🌐 Launching fresh browser with Session ID: {session_id}")
            
            browser_args = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
            }
            
            proxy_config = None
            if USE_PROXY:
                proxy_config = {
                    "server": f"http://{PROXY_BASE}",
                    "username": f"{PROXY_USER}__sessid.{session_id}",
                    "password": PROXY_PASS
                }
                browser_args["proxy"] = proxy_config
                
            browser = await p.chromium.launch(**browser_args)
            
            context_args = {
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "viewport": {"width": 1280, "height": 720},
                "locale": "en-US",
            }
            if proxy_config:
                context_args["proxy"] = proxy_config
                
            context = await browser.new_context(**context_args)
            
            cookie_path = os.path.join(SCRIPT_DIR, "colnect_cookies_crawler.json")
            if os.path.exists(cookie_path):
                try:
                    with open(cookie_path, "r") as f:
                        cookies = json.load(f)
                        await context.add_cookies(cookies)
                    print("🍪 Loaded cookies from colnect_cookies_crawler.json")
                except Exception as e:
                    print(f"⚠️ Error loading cookies: {e}")
                    
            page = await context.new_page()
            
        await init_browser()
        
        for c_id, c_slug, c_name in countries:
            print(f"\n🌍 Processing {c_name} (ID: {c_id})...")
            
            shuffled_years = list(years)
            random.shuffle(shuffled_years)
            
            for year in shuffled_years:
                base_url = f"https://colnect.com/en/stamps/list/country/{c_id}-{c_slug}/year/{year}"
                page_num = 1
                
                while True:
                    url = base_url if page_num == 1 else f"{base_url}/page/{page_num}"
                    print(f"  📄 Year {year} | Page {page_num} -> Loading {url}...")
                    
                    await asyncio.sleep(random.uniform(3.0, 5.0))
                    
                    try:
                        response = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
                        await asyncio.sleep(2.0)
                        
                        html = await page.content()
                        status = response.status if response else 0
                        
                        if status != 200 or "Anubis" in html or len(html) < 4000:
                            print(f"  ⚠️ Block or challenge detected (Status: {status}). Skipping year segment.")
                            consecutive_errors += 1
                            if consecutive_errors >= 3:
                                print("⚠️ 3 consecutive blocks detected. Re-launching with a new IP session...")
                                await init_browser()
                                consecutive_errors = 0
                            break
                            
                        consecutive_errors = 0 # reset on success
                        soup = BeautifulSoup(html, "html.parser")
                        items = soup.select("div.pl-it")
                        
                        if not items:
                            print(f"  ℹ️ No stamps found on this page. Moving to next year/country.")
                            break
                            
                        discovered_urls = []
                        for item in items:
                            link = item.select_one("h2.item_header a")
                            if link and link.get("href"):
                                href = link["href"]
                                stamp_url = "https://colnect.com" + href if href.startswith("/") else href
                                discovered_urls.append(stamp_url)
                                
                        if not discovered_urls:
                            break
                            
                        inserted = enqueue_urls(discovered_urls)
                        print(f"  ✅ Discovered {len(discovered_urls)} URLs (Enqueued {inserted} new, {len(discovered_urls)-inserted} duplicates skipped)")
                        
                        pagination = soup.select_one("div.navigation_page")
                        next_page_exists = False
                        if pagination:
                            next_links = pagination.select("a")
                            for nl in next_links:
                                if f"page/{page_num + 1}" in nl.get("href", ""):
                                    next_page_exists = True
                                    break
                                    
                        if not next_page_exists and len(discovered_urls) < 30:
                            break
                            
                        page_num += 1
                        
                    except Exception as e:
                        print(f"  ❌ Error loading page: {e}")
                        consecutive_errors += 1
                        if consecutive_errors >= 3:
                            print("⚠️ 3 consecutive errors detected. Re-launching with a new IP session...")
                            await init_browser()
                            consecutive_errors = 0
                        break
                        
        if page:
            await page.close()
        if context:
            await context.close()
        if browser:
            await browser.close()
        print("\n🎉 Discovery complete!")

if __name__ == "__main__":
    asyncio.run(main())
