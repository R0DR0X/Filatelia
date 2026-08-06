import asyncio
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from scraper_env import require_env

PROXY_CONFIG = {
    "server": f"http://{require_env('DATAIMPULSE_HOST', 'DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)')}",
    "username": require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)"),
    "password": require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
}

async def check_page(page, page_num):
    url = f"https://colnect.com/en/stamps/list/country/90-Guinea/year/2023/page/{page_num}"
    print(f"🌐 Navegando a: {url}...")
    try:
        response = await page.goto(url, wait_until="domcontentloaded", timeout=50000)
        
        # Esperar estabilización
        for _ in range(15):
            if "pass-challenge" in page.url or "anubis" in page.url:
                await asyncio.sleep(1.0)
            else:
                break
        await asyncio.sleep(3.0)
        
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        
        # Si redirige al login o block, abortamos
        if "login" in page.url or "Member Login" in (soup.title.string if soup.title else ""):
            print(f"❌ Redirigido a Login en página {page_num}!")
            return False, False
            
        items = soup.select("div.pl-it, div.item_box, tr.pl-it")
        print(f"  Info: Encontrados {len(items)} items en página {page_num}.")
        
        if len(items) == 0:
            return False, True # No hay más items (fin de páginas)
            
        for item in items:
            link_el = item.select_one("a[href*='/stamp/']")
            if link_el:
                href = link_el.get("href")
                if "1395426" in href:
                    print(f"🎉 ¡Sello T-34 Tank encontrado en página {page_num}!")
                    print(f"🔗 Link: {href}")
                    img_el = item.select_one("img")
                    if img_el:
                        src = img_el.get("src") or img_el.get("data-src")
                        print(f"📷 Img src encontrada: {src}")
                    return True, False
        return False, False
    except Exception as e:
        print(f"❌ Error en página {page_num}: {e}")
        return False, False

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
        
        # Probar páginas 1, 2, 3, 4, 5 de Guinea 2023
        for page_num in range(1, 8):
            found, is_end = await check_page(page, page_num)
            if found:
                break
            if is_end:
                print("🏁 Fin de las páginas de listado.")
                break
                
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
