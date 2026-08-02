import asyncio
import json
from playwright.async_api import async_playwright

from scraper_env import require_env

async def main():
    # Fail fast on missing credentials before any network activity.
    colnect_user = require_env("COLNECT_USERNAME", "Colnect account email/username")
    colnect_pass = require_env("COLNECT_PASSWORD", "Colnect account password")

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
        
        # Load existing cookies to bypass Anubis
        try:
            with open("/home/rodrigo/filatelia/scrapers/colnect_cookies.json", "r") as f:
                cookies = json.load(f)
            await ctx.add_cookies(cookies)
        except:
            pass

        page = await ctx.new_page()
        
        # Go to login
        print("Navigating to login page...")
        await page.goto("https://colnect.com/en/account/login", wait_until="load", timeout=60000)
        await page.wait_for_timeout(5000)
        
        print("Taking screenshot before filling...")
        await page.screenshot(path="/home/rodrigo/filatelia/scrapers/login_step1.png")
        
        # Check if fields exist
        has_user = await page.query_selector("#signin_username")
        has_pass = await page.query_selector("#signin_password")
        print(f"Has username field: {has_user is not None}, Has password field: {has_pass is not None}")
        
        if has_user and has_pass:
            await page.fill("#signin_username", colnect_user)
            await page.fill("#signin_password", colnect_pass)
            await page.screenshot(path="/home/rodrigo/filatelia/scrapers/login_step2.png")
            
            print("Clicking signin button...")
            await page.click("#signin_btn")
            await page.wait_for_timeout(8000)
            
            print("Taking screenshot after submit...")
            await page.screenshot(path="/home/rodrigo/filatelia/scrapers/login_step3.png")
            
            cookies = await ctx.cookies()
            print("Cookies after submit:")
            for c in cookies:
                print(f"  {c['name']}: {c['value'][:20]}...")
        else:
            print("Could not find input fields. Maybe blocked or layout is different.")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
