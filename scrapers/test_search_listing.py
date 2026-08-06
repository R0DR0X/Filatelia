import asyncio
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from scraper_env import require_env

SEARCH_URL = "https://colnect.com/en/stamps/list/item_name/T-34+Tank"
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
        
        print(f"🌐 Navegando a la página de búsqueda/listado: {SEARCH_URL}...")
        response = await page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=60000)
        print("⏳ Esperando resolución de redirecciones...")
        
        # Esperar hasta que se estabilice el URL
        for _ in range(25):
            current_url = page.url
            if "pass-challenge" in current_url or "anubis" in current_url:
                await asyncio.sleep(1.0)
            else:
                break
        await asyncio.sleep(5.0)
        
        try:
            html = await page.content()
        except Exception as e:
            print(f"⚠️ Error obteniendo HTML directamente, esperando 5s extra: {e}")
            await asyncio.sleep(5.0)
            html = await page.content()
            
        soup = BeautifulSoup(html, "html.parser")
        
        print("\n--- IMÁGENES ENCONTRADAS EN LA BÚSQUEDA ---")
        items = soup.select("div.pl-it, div.item_box, tr.pl-it")
        found = False
        
        for item in items:
            link_el = item.select_one("a[href*='/stamp/']")
            if link_el:
                href = link_el.get("href")
                if "1395426" in href:
                    found = True
                    print(f"✅ Sello T-34 Tank encontrado en el listado!")
                    print(f"🔗 Link: {href}")
                    
                    img_el = item.select_one("img")
                    if img_el:
                        src = img_el.get("src") or img_el.get("data-src")
                        print(f"📷 Img src en listado: {src}")
                    else:
                        print("❌ No se encontró etiqueta <img>.")
                    break
                    
        if not found:
            print(f"❌ El sello 1395426 no se encontró en la primera página de la búsqueda.")
            print(f"Final URL: {page.url}")
            print(f"Page Title: {soup.title.string if soup.title else 'Sin título'}")
            # Mostrar cualquier imagen de la página
            all_imgs = [img.get("src") or img.get("data-src") for img in soup.find_all("img")]
            print(f"Total images found on page: {len(all_imgs)}")
            for src in all_imgs[:10]:
                print(f"📷 Img src encontrada: {src}")
            if len(html) < 2000:
                print(f"HTML Content Snippet: {html[:500]}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
