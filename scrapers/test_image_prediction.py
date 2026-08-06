import asyncio
from playwright.async_api import async_playwright

from scraper_env import require_env

TEST_URLS = [
    "https://i.colnect.net/b/20059/758/T-34_Tank.jpg",
    "https://i.colnect.net/t/20059/758/T-34_Tank.jpg",
    "https://i.colnect.net/f/20059/758/T-34_Tank.jpg",
    "https://i.colnect.net/items/full/20059/758/T-34_Tank.jpg"
]

PROXY_CONFIG = {
    "server": f"http://{require_env('DATAIMPULSE_HOST', 'DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)')}",
    "username": require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)"),
    "password": require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
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
        
        for url in TEST_URLS:
            print(f"📡 Navegando directamente a la imagen en CDN: {url}...")
            try:
                response = await page.goto(url, timeout=30000)
                status = response.status if response else 0
                print(f"  Response Status: {status}")
                if status == 200:
                    print(f"✅ ¡IMAGEN VÁLIDA ENCONTRADA EN CDN!")
            except Exception as e:
                print(f"  Error: {e}")
                
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
