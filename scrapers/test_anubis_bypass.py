import asyncio
import json
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
        
        # Cargar cookies y extender fecha de expiración
        with open("colnect_cookies.json", "r") as f:
            cookies = json.load(f)
            
        import time
        future_expiry = int(time.time() + 180 * 24 * 3600) # Expiración del JWT (180 días)
        for cookie in cookies:
            if "anubis" in cookie["name"]:
                cookie["expires"] = future_expiry
                print(f"🔄 Extendida expiración de {cookie['name']} a {future_expiry}")
                
        await context.add_cookies(cookies)
        page = await context.new_page()
        
        print(f"🌐 Navegando a {TEST_URL}...")
        response = await page.goto(TEST_URL, wait_until="domcontentloaded", timeout=60000)
        
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
            print(f"⚠️ Error obteniendo HTML directamente, esperando 5s extra: {e}")
            await asyncio.sleep(5.0)
            html = await page.content()
        with open("scrapers/temp_anubis_bypass.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("💾 HTML guardado en scrapers/temp_anubis_bypass.html")
        
        soup = BeautifulSoup(html, "html.parser")
        
        print("\n--- RESULTADO DE LA NAVEGACIÓN ---")
        print(f"Final URL: {page.url}")
        print(f"Page Title: {soup.title.string if soup.title else 'Sin título'}")
        print(f"HTML Length: {len(html)}")
        
        # Encontrar todas las tablas
        tables = soup.find_all("table")
        print(f"Total tables found: {len(tables)}")
        
        info = {}
        # 1. Intentar parsear tablas tracionales
        rows = soup.select("table.item_info_table tr, .stamp_details tr, .info_table tr")
        print(f"Filas de tabla encontradas: {len(rows)}")
        for row in rows:
            label_el = row.select_one("td.label, th")
            value_el = row.select_one("td.value, td:last-child")
            if label_el and value_el:
                info[label_el.get_text().strip().lower()] = value_el.get_text().strip()
                
        # 2. Intentar parsear Description Lists (dl/dt/dd) - nuevo layout
        dls = soup.select(".i_d dl, #item_full_details dl")
        print(f"Listas de descripción (dl) encontradas: {len(dls)}")
        for dl in dls:
            dts = dl.find_all("dt")
            dds = dl.find_all("dd")
            for dt, dd in zip(dts, dds):
                label = dt.get_text().strip().lower()
                value = dd.get_text().strip()
                info[label] = value
                
        print("\n--- DETALLES PARSEADOS ---")
        for k, v in info.items():
            print(f"🔹 {k}: {v}")
            
        # Buscar imágenes en el DOM
        print("\n--- IMÁGENES EN EL DOM ---")
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src")
            print(f"📷 Img: {src}")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
