import asyncio
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

LISTING_URL = "https://colnect.com/en/stamps/list/country/90-Guinea/year/2023"
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
        
        print(f"🌐 Navegando a la página de listado: {LISTING_URL}...")
        await page.goto(LISTING_URL, wait_until="domcontentloaded", timeout=50000)
        
        # Espera para resolver retos si los hay
        await asyncio.sleep(5.0)
        
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        
        print("\n--- BUSCANDO EL SELLO T-34 TANK (ID 1395426) ---")
        items = soup.select("div.pl-it, div.item_box")
        found = False
        
        for item in items:
            link_el = item.select_one("a[href*='/stamp/']")
            if link_el:
                href = link_el.get("href")
                if "1395426" in href:
                    found = True
                    print(f"✅ Sello encontrado en el listado!")
                    print(f"🔗 Link: {href}")
                    
                    # Buscar la imagen dentro de este contenedor de item
                    img_el = item.select_one("img")
                    if img_el:
                        src = img_el.get("src") or img_el.get("data-src")
                        print(f"📷 Img src en listado: {src}")
                    else:
                        print("❌ No se encontró etiqueta <img> dentro del contenedor del item.")
                    break
                    
        if not found:
            print("❌ El sello 1395426 no se encontró en esta página de listado.")
            # Imprimir las primeras 5 imágenes de la lista para ver si tienen placeholders o reales
            print("\nPrimeras imágenes de la lista:")
            for img in soup.find_all("img")[:10]:
                src = img.get("src") or img.get("data-src")
                if src and "i.colnect.net" in src:
                    print(f"📷 Img src genérica: {src}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
