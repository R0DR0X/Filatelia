#!/usr/bin/env python3
"""
Auto-refresh Colnect cookies using Playwright & DataImpulse proxy (User B).
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

from scraper_env import require_env

SCRIPT_DIR = Path(__file__).parent
COOKIES_PATH_1 = SCRIPT_DIR / "colnect_cookies.json"
COOKIES_PATH_2 = SCRIPT_DIR.parent / "colnect_cookies.json"

USERNAME = require_env("COLNECT_USERNAME", "Colnect account email/username")
PASSWORD = require_env("COLNECT_PASSWORD", "Colnect account password")

# User B is active (User A has 407 TRAFFIC_EXHAUSTED)
PROXY_CONFIG = {
    "server": f"http://{require_env('DATAIMPULSE_HOST', 'DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)')}",
    "username": require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)"),
    "password": require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
}

async def refresh():
    print("🌐 Iniciando navegador con Proxy User B para renovar cookies de Colnect...")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
            proxy=PROXY_CONFIG
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
            locale="en-US",
            timezone_id="America/New_York"
        )
        page = await context.new_page()

        print("🔑 Navegando a https://colnect.com/en/account/login ...")
        await page.goto("https://colnect.com/en/account/login", wait_until="domcontentloaded", timeout=60000)

        # Esperar a que se resuelva Anubis si aparece
        for i in range(30):
            cur_url = page.url
            try:
                html = await page.content()
            except Exception:
                await asyncio.sleep(1)
                continue
            if "pass-challenge" not in cur_url and "anubis" not in cur_url and len(html) > 2000:
                print("✅ Anubis resuelto/no presente.")
                break
            await asyncio.sleep(1)

        has_user = await page.query_selector("#signin_username")
        if has_user:
            print("📝 Llenando datos de inicio de sesión...")
            await page.fill("#signin_username", USERNAME)
            await page.fill("#signin_password", PASSWORD)
            await page.click("#signin_btn")
            await asyncio.sleep(8)

        cookies = await context.cookies()
        if cookies:
            print(f"🎉 Obtenidas {len(cookies)} cookies válidas.")
            with open(COOKIES_PATH_1, "w", encoding="utf-8") as f:
                json.dump(cookies, f, indent=2)
            with open(COOKIES_PATH_2, "w", encoding="utf-8") as f:
                json.dump(cookies, f, indent=2)
            print(f"💾 Guardadas en {COOKIES_PATH_1}")
        else:
            print("❌ No se obtuvieron cookies.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(refresh())
