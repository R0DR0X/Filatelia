"""Interactive probe: fetch one live Colnect detail page and dump what the
selectors find.

This used to live at `scrapers/test_parse.py`, where its name promised a test
suite and it delivered a network script — `pytest` would have collected it and
tried to drive a real browser through the paid proxy. The parsing tests
PENDIENTES.md E2.4 asks for now own that filename; this kept its behaviour and
got an honest one.

IT SPENDS PROXY BANDWIDTH. The Colnect detail phase (E2) is blocked precisely
because there are no GB left on the DataImpulse proxy, so run this only when
you specifically need to see how a live page is structured. To check the
parser, run the offline suite instead:

    python -m pytest scrapers/test_parse.py
"""

import asyncio
import json
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

from scraper_env import require_env

async def main():
    async with async_playwright() as pw:
        proxy_config = {
            "server": f"http://{require_env('DATAIMPULSE_HOST', 'DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)')}",
            "username": f"{require_env('DATAIMPULSE_USER', 'DataImpulse proxy username (dashboard.dataimpulse.com)')}__sessid.images_session_vm",
            "password": require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
        }
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
            proxy=proxy_config
        )
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        # Load cookies
        try:
            with open("/home/rodrigo/filatelia/scrapers/colnect_cookies.json", "r") as f:
                cookies = json.load(f)
            await ctx.add_cookies(cookies)
            print("Loaded cookies successfully.")
        except Exception as e:
            print(f"Error loading cookies: {e}")

        page = await ctx.new_page()
        url = "https://colnect.com/en/stamps/stamp/437923-Lama_Lama_glama_and_Flutist-Air_Mail_Stamps_of_1937_Country_Motives-Peru"
        print(f"Navigating to {url}...")
        try:
            await page.goto(url, wait_until="load", timeout=60000)
        except Exception as e:
            print(f"Page goto warning/error: {e}")
            
        print("Waiting 10s for page rendering and stability...")
        await page.wait_for_timeout(10000)
        
        try:
            html = await page.content()
            title = await page.title()
            print(f"Page title: {title}")
            print(f"HTML size: {len(html)}")
        except Exception as e:
            print(f"Failed to get page content: {e}")
            await browser.close()
            return

        soup = BeautifulSoup(html, "html.parser")
        info = {}
        # Try finding details
        dls = soup.select(".i_d dl, #item_full_details dl, .item_info dl")
        print(f"Found {len(dls)} dl elements")
        for dl in dls:
            dts = dl.find_all("dt")
            dds = dl.find_all("dd")
            for dt, dd in zip(dts, dds):
                label = dt.get_text().strip().lower()
                value = dd.get_text().strip()
                print(f"  DL Row -> {label}: {value}")
                info[label] = value

        rows = soup.select("table.item_info_table tr, .stamp_details tr, .info_table tr, tr[class*='item']")
        print(f"Found {len(rows)} tr elements")
        for row in rows:
            label_el = row.select_one("td.label, th, td:first-child")
            value_el = row.select_one("td.value, td:last-child")
            if label_el and value_el:
                label = label_el.get_text().strip().lower()
                value = value_el.get_text().strip()
                print(f"  TR Row -> {label}: {value}")
                info[label] = value

        print("Parsed info dictionary:")
        print(info)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
