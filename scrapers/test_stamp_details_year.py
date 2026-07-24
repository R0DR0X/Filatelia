import asyncio
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

TEST_URL = "https://colnect.com/en/stamps/stamp/1395426-T-34_Tank-Battle_of_Stalingrad_2023-Guinea"
PROXY_CONFIG = {
    "server": "http://gw.dataimpulse.com:823",
    "username": "bafe165ec82f735291ea",
    "password": "cba7f2ea0d940de4"
}

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
            proxy=PROXY_CONFIG
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        
        print(f"🌐 Navegando a la página de detalle: {TEST_URL}...")
        await page.goto(TEST_URL, wait_until="domcontentloaded", timeout=50000)
        
        # Esperar estabilización
        for _ in range(15):
            if "pass-challenge" in page.url or "anubis" in page.url:
                await asyncio.sleep(1.0)
            else:
                break
        await asyncio.sleep(3.0)
        
        html = await page.content()
        with open("scrapers/temp_detail_page.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("💾 HTML guardado en scrapers/temp_detail_page.html")
        
        soup = BeautifulSoup(html, "html.parser")
        
        print("\n--- DIAGNÓSTICO ---")
        print(f"Final URL: {page.url}")
        print(f"Page Title: {soup.title.string if soup.title else 'Sin título'}")
        print(f"HTML Length: {len(html)}")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
