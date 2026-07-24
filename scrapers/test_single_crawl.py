import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as pw:
        proxy_config = {
            "server": "http://gw.dataimpulse.com:823",
            "username": "bafe165ec82f735291ea__sessid.crawler_session_vm",
            "password": "cba7f2ea0d940de4"
        }
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
            proxy=proxy_config
        )
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
            locale="en-US"
        )
        
        # Load crawler cookies
        try:
            with open("/home/rodrigo/filatelia/scrapers/colnect_cookies_crawler.json", "r") as f:
                cookies = json.load(f)
            await ctx.add_cookies(cookies)
            print("Loaded cookies successfully.")
        except Exception as e:
            print(f"Error loading cookies: {e}")

        page = await ctx.new_page()
        
        url = "https://colnect.com/en/stamps/stamp/1024069-Coat_of_Arms-Coats_Of_Arms-Peru"
        print(f"Navigating to: {url}")
        try:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            print(f"Status response: {resp.status if resp else 'No response'}")
            await asyncio.sleep(4)
            await page.screenshot(path="/home/rodrigo/filatelia/scrapers/crawl_test_result.png")
            print("Screenshot saved to crawl_test_result.png")
            html = await page.content()
            print(f"HTML size: {len(html)}")
            if "perforation" in html.lower():
                print("Success! Perforation found in page source.")
            else:
                print("Failed to find perforation in page source.")
        except Exception as e:
            print(f"Exception during navigation: {e}")
            await page.screenshot(path="/home/rodrigo/filatelia/scrapers/crawl_test_error.png")
            print("Error screenshot saved.")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
