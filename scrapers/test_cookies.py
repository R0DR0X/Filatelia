import asyncio
import json
import os
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

TEST_URL = "https://colnect.com/en/stamps/stamp/1395426-T-34_Tank-Battle_of_Stalingrad_2023-Guinea"
COOKIES_FILE = "colnect_cookies.json"
PROXY_CONFIG = {
    "server": "http://gw.dataimpulse.com:823",
    "username": "bafe165ec82f735291ea",
    "password": "cba7f2ea0d940de4"
}

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
            proxy=PROXY_CONFIG
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        await context.add_init_script("delete navigator.__proto__.webdriver;")
        
        # Inyectar cookies de sesión guardadas
        if os.path.exists(COOKIES_FILE):
            with open(COOKIES_FILE, "r") as f:
                cookies = json.load(f)
                await context.add_cookies(cookies)
                print(f"🔑 Cookies inyectadas desde {COOKIES_FILE}")
        else:
            print("⚠️ No se encontró colnect_cookies.json")
            
        page = await context.new_page()
        
        # Bloquear trackers molestos pero permitir imágenes para testeo visual
        TRACKING_DOMAINS = ["googlesyndication.com", "google-analytics.com", "googletagmanager.com", "doubleclick.net"]
        async def interceptor(route):
            url = route.request.url
            if any(d in url for d in TRACKING_DOMAINS):
                await route.fulfill(status=200, body="console.log('mock');")
            else:
                await route.continue_()
        await page.route("**/*", interceptor)
        
        print(f"🌐 Navegando a {TEST_URL}...")
        response = await page.goto(TEST_URL, wait_until="domcontentloaded", timeout=50000)
        print(f"⏳ Esperando resolución de retos...")
        
        # Esperar hasta que Anubis termine de resolver
        for _ in range(30):
            current_url = page.url
            if "pass-challenge" in current_url or "anubis" in current_url:
                await asyncio.sleep(1.0)
            else:
                break
                
        await asyncio.sleep(5.0) # Espera de cortesía final
        
        try:
            html = await page.content()
        except Exception as e:
            print(f"⚠️ Error obteniendo HTML directamente, esperando 5s extra: {e}")
            await asyncio.sleep(5.0)
            html = await page.content()
            
        soup = BeautifulSoup(html, "html.parser")
        
        # Encontrar la imagen principal
        main_img = soup.select_one(".stamp_image img, #item_image img, .main-image img")
        
        # Mostrar imágenes encontradas
        print("\n--- IMÁGENES ENCONTRADAS ---")
        found = False
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src")
            if src and "i.colnect.net" in src:
                print(f"📷 Img src: {src}")
                found = True
        
        if not found:
            print("❌ No se encontró ninguna imagen de i.colnect.net en el DOM.")
            
        print("\n--- DETALLES DEL TITULO ---")
        print(f"Title: {soup.title.string if soup.title else 'Sin título'}")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
