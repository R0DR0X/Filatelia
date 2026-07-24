import asyncio
import json
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

LIST_URL = "https://colnect.com/en/stamps/list/country/90-Guinea/series/436562-Battle_of_Stalingrad_2023"
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
        
        # Cargar cookies y extender fecha de expiración
        with open("colnect_cookies.json", "r") as f:
            cookies = json.load(f)
            
        import time
        future_expiry = int(time.time() + 180 * 24 * 3600) # Expiración del JWT (180 días)
        for cookie in cookies:
            if "anubis" in cookie["name"]:
                cookie["expires"] = future_expiry
                
        await context.add_cookies(cookies)
        page = await context.new_page()
        
        print(f"🌐 Navegando a la lista de la serie: {LIST_URL}...")
        response = await page.goto(LIST_URL, wait_until="domcontentloaded", timeout=60000)
        
        # Esperar estabilización
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
            print(f"⚠️ Error obteniendo HTML directamente: {e}")
            await asyncio.sleep(5.0)
            html = await page.content()
            
        with open("scrapers/temp_series_list.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("💾 HTML guardado en scrapers/temp_series_list.html")
            
        soup = BeautifulSoup(html, "html.parser")
        
        print("\n--- RESULTADO DE LA LISTA ---")
        print(f"Final URL: {page.url}")
        print(f"Page Title: {soup.title.string if soup.title else 'Sin título'}")
        print(f"HTML Length: {len(html)}")
        
        # Encontrar todas las tablas o divs con clase pl-it o similar
        print(f"Total divs: {len(soup.find_all('div'))}")
        print(f"Total tables: {len(soup.find_all('table'))}")
        
        # Buscar el stamp id 1395426
        items = soup.select("div.pl-it, div.item_box, tr.pl-it, .pl-it, [id^='item_']")
        print(f"Total items en la lista: {len(items)}")
        
        for item in items:
            link_el = item.select_one("a[href*='/stamp/']")
            if link_el:
                href = link_el.get("href")
                if "1395426" in href:
                    print(f"🎉 ¡Sello T-34 Tank encontrado en la lista!")
                    print(f"🔗 Link: {href}")
                    # Buscar la imagen
                    img_el = item.select_one("img")
                    if img_el:
                        src = img_el.get("src") or img_el.get("data-src")
                        print(f"📷 Thumbnail original: {src}")
                        # Intentar convertir en HD
                        if src:
                            if src.startswith("//"):
                                src = "https:" + src
                            hd_src = src
                            if "/t/" in src:
                                hd_src = src.replace("/t/", "/b/", 1)
                            elif "/items/thumb/" in src:
                                hd_src = src.replace("/items/thumb/", "/items/full/", 1)
                            print(f"🚀 URL HD reconstruida: {hd_src}")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
