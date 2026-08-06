#!/usr/bin/env python3
"""
🌍 Colnect Stamp Image Repair Scraper - Versión con Checkpoints y Autocuración
"""

import subprocess, sys

def _install(pkg):
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])

for _pkg in ["playwright", "beautifulsoup4", "nest_asyncio", "requests"]:
    try:
        __import__(_pkg.replace("-", "_").split("[")[0])
    except ImportError:
        print(f"📦 Instalando {_pkg}...")
        _install(_pkg)

# Instalar el navegador Chromium y sus dependencias del sistema operativo
print("🌐 Instalando dependencias del sistema para Chromium...")
subprocess.run([sys.executable, "-m", "playwright", "install-deps", "chromium"], capture_output=True)
print("🌐 Descargando navegador Chromium...")
subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], capture_output=True)
print("✅ Dependencias listas.\n")

import asyncio
import random
import re
import os
import json
import requests
from bs4 import BeautifulSoup
import nest_asyncio

try:
    nest_asyncio.apply()
except Exception:
    pass

from playwright.async_api import async_playwright

# --- CONFIGURACIÓN ---
API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"
PROGRESS_FILE = "repair_colnect_progress.json"
BATCH_SIZE = 20
DELAY_MIN = 3.0
DELAY_MAX = 7.0
CONCURRENT_COUNTRIES = 3

# --- PROXY PREMIUM ---
# Leído del entorno; dejar sin definir para deshabilitar el proxy premium
# (ver el guard `if PREMIUM_PROXY_SERVER:` más abajo).
PREMIUM_PROXY_SERVER = os.environ.get("DATAIMPULSE_HOST", "")
PREMIUM_PROXY_USER = os.environ.get("DATAIMPULSE_USER", "")
PREMIUM_PROXY_PASS = os.environ.get("DATAIMPULSE_PASS", "")

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

# Mapeo de códigos ISO de D1 a IDs y Nombres en Colnect (soporta múltiples países por código)
COUNTRY_MAP = {
    "PE": [("169", "Peru", "Peru")],
    "FRA": [("74", "France", "France")],
    "GUI": [("90", "Guinea", "Guinea"), ("91", "Guinea-Bissau", "Guinea-Bissau")],
    "UNI": [("225", "United_States_of_America", "United States")],
    "US": [("225", "United_States_of_America", "United States")],
    "TOG": [("212", "Togo", "Togo")],
    "NIG": [("156", "Niger", "Niger")],
    "BEL": [("21", "Belgium", "Belgium")],
    "ROM": [("177", "Romania", "Romania")],
    "HUN": [("98", "Hungary", "Hungary")],
    "LIB": [("121", "Liberia", "Liberia")],
    "BR": [("30", "Brazil", "Brazil")],
    "BRA": [("30", "Brazil", "Brazil")],
    "DJI": [("59", "Djibouti", "Djibouti")],
    "JAP": [("108", "Japan", "Japan")],
    "JP": [("108", "Japan", "Japan")],
    "ITA": [("106", "Italy", "Italy")],
    "IT": [("106", "Italy", "Italy")],
    "AUS": [("13", "Australia", "Australia")],
    "AU": [("13", "Australia", "Australia")],
    "RUS": [("178", "Russia", "Russia")],
    "GER": [("81", "Germany_Federal_Republic", "Germany FR")],
    "DE": [("81", "Germany_Federal_Republic", "Germany FR")],
    "CUB": [("53", "Cuba", "Cuba")],
    "SPA": [("199", "Spain", "Spain")],
    "ES": [("199", "Spain", "Spain")],
    "CHI": [("43", "Chile", "Chile")],
    "CL": [("43", "Chile", "Chile")],
    "PY": [("168", "Paraguay", "Paraguay")],
    "UY": [("227", "Uruguay", "Uruguay")],
    "ABU": [("456", "Abu_Dhabi", "Abu Dhabi")],
    "CO": [("47", "Colombia", "Colombia")],
    "GB": [("224", "United_Kingdom_of_Great_Britain_Northern_Ireland", "United Kingdom")],
    "CA": [("38", "Canada", "Canada")],
    "CAN": [("38", "Canada", "Canada")],
    "BO": [("26", "Bolivia", "Bolivia")],
    "SIE": [("191", "Sierra_Leone", "Sierra Leone")],
    "CN": [("442", "China", "China")],
}

async def get_proxy_list():
    try:
        url = "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all"
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(None, lambda: requests.get(url, timeout=5))
        if res.status_code == 200:
            return [p.strip() for p in res.text.split('\n') if p.strip()]
    except Exception as e:
        print(f"  ⚠️ Error obteniendo lista de proxies: {e}")
    return []

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"completed_countries": [], "checkpoints": {}}

def save_progress(progress):
    try:
        with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
            json.dump(progress, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"⚠️ Error guardando progreso: {e}")

async def run_update_async(sql, params):
    try:
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(
            None,
            lambda: requests.post(API_URL, json={"sql": sql, "params": params}, timeout=20)
        )
        if res.status_code == 200:
            return res.json().get("success", False)
    except Exception:
        pass
    return False

async def send_batch(stamps):
    tasks = []
    for stamp in stamps:
        image_url = stamp.get("imageUrl")
        source_url = stamp.get("sourceUrl")
        
        # Validar que no sea base64 transparente ni placeholder
        if image_url and not image_url.startswith("data:") and "none_logged_image" not in image_url:
            sql = """
                UPDATE Stamp 
                SET imageUrl = ? 
                WHERE sourceUrl = ? 
                  AND (imageUrl LIKE 'data:image%' OR imageUrl IS NULL OR imageUrl LIKE '%none_logged_image%')
            """
            tasks.append(run_update_async(sql, [image_url, source_url]))
            
    if tasks:
        results = await asyncio.gather(*tasks)
        success_count = sum(1 for r in results if r)
        print(f"  🔧 Reparadas: +{success_count} imágenes en D1 (de {len(stamps)} analizados).")
    return True

def get_all_countries():
    sql = """
        SELECT countryCode, COUNT(*) as bad_count 
        FROM Stamp 
        WHERE source = 'colnect' 
          AND (imageUrl LIKE 'data:image%' OR imageUrl IS NULL OR imageUrl LIKE '%none_logged_image%') 
        GROUP BY countryCode 
        ORDER BY bad_count DESC
    """
    print("🔍 Consultando base de datos para detectar imágenes defectuosas...")
    try:
        res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=30)
        if res.status_code == 200:
            result = res.json()
            if result.get("success"):
                rows = result.get("results", [])
                countries_to_repair = []
                for row in rows:
                    code = row.get("countryCode")
                    bad_count = row.get("bad_count", 0)
                    if code in COUNTRY_MAP:
                        for c_info in COUNTRY_MAP[code]:
                            countries_to_repair.append({
                                "id": c_info[0],
                                "name": c_info[1],
                                "display": c_info[2],
                                "stamps_count": bad_count
                            })
                print(f"✅ Se detectaron {len(countries_to_repair)} países con imágenes para reparar.")
                return countries_to_repair
    except Exception as e:
        print(f"❌ Error al consultar países para reparación: {e}")
    return []

def parse_html_stamps(html_content, country_name, country_id):
    soup = BeautifulSoup(html_content, 'html.parser')
    items = soup.select('div.pl-it')
    results = []
    
    for item in items:
        try:
            link = item.select_one('h2.item_header a')
            if not link:
                continue
            
            source_url = "https://colnect.com" + link['href'] if link['href'].startswith('/') else link['href']
            name = link.get_text().strip()
            
            img = item.select_one('div.item_thumb img')
            image_url = None
            if img:
                data_src = img.get('data-src')
                src = img.get('src')
                candidate = data_src if (data_src and not data_src.startswith('data:')) else src
                if candidate and not candidate.startswith('data:'):
                    image_url = candidate
                    if image_url.startswith('//'):
                        image_url = "https:" + image_url
                    
                    # Convertir a alta calidad
                    if "/t/" in image_url:
                        image_url = image_url.replace("/t/", "/b/", 1)
                    elif "/items/thumb/" in image_url:
                        image_url = image_url.replace("/items/thumb/", "/items/full/", 1)
            
            if len(name) > 3:
                results.append({
                    "nameEn": name,
                    "imageUrl": image_url,
                    "sourceUrl": source_url
                })
        except Exception:
            pass
            
    return results

async def load_session_cookies(context, c_slug):
    if os.path.exists("colnect_cookies.json"):
        try:
            with open("colnect_cookies.json", "r") as f:
                cookies = json.load(f)
                for c in cookies:
                    if "domain" not in c:
                        c["domain"] = ".colnect.com"
                    if "path" not in c:
                        c["path"] = "/"
                await context.add_cookies(cookies)
                print(f"  🔑 [{c_slug}] Cookies de sesión cargadas desde colnect_cookies.json")
        except Exception as e:
            print(f"  ⚠️ [{c_slug}] Error al inyectar cookies: {e}")

async def scrape_country(playwright, country, proxy_list):
    c_id = country['id']
    c_slug = country['name']
    c_display = country['display']
    
    progress = load_progress()
    checkpoint = progress["checkpoints"].get(c_id, {
        "page": 1, "inserted": 0, "errors": 0, "year_urls": None, "year_idx": 0
    })
    page_num = checkpoint.get("page", 1)
    total_inserted = checkpoint.get("inserted", 0)
    total_errors = checkpoint.get("errors", 0)
    year_urls = checkpoint.get("year_urls", None)
    year_idx = checkpoint.get("year_idx", 0)
    
    print(f"\n🌍 [{c_display}] Reparando imágenes. Procesadas hasta ahora: {total_inserted}")
    base_url = f"https://colnect.com/en/stamps/list/country/{c_id}-{c_slug}"
    
    consecutive_errors = 0
    browser_args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
    
    if PREMIUM_PROXY_SERVER:
        srv = PREMIUM_PROXY_SERVER if PREMIUM_PROXY_SERVER.startswith("http") else f"http://{PREMIUM_PROXY_SERVER}"
        proxy_config = {
            "server": srv,
            "username": PREMIUM_PROXY_USER,
            "password": PREMIUM_PROXY_PASS
        }
    else:
        current_proxy = random.choice(proxy_list) if proxy_list else None
        proxy_config = {"server": f"http://{current_proxy}"} if current_proxy else None
        
    browser = await playwright.chromium.launch(headless=True, args=browser_args, proxy=proxy_config)
    context = await browser.new_context(
        user_agent=random.choice(USER_AGENTS),
        viewport={"width": 1280, "height": 720},
        locale="en-US",
        timezone_id="America/New_York"
    )
    await context.add_init_script("delete navigator.__proto__.webdriver;")
    await load_session_cookies(context, c_slug)
    
    batch = []
    has_more = True
    
    while has_more:
        if year_urls:
            if year_idx >= len(year_urls):
                has_more = False
                break
            year_url = year_urls[year_idx]
            current_url = year_url if page_num == 1 else f"{year_url}/page/{page_num}"
            print(f"  📄 [{c_slug}] Reparación Año {year_idx+1}/{len(year_urls)} - Pág {page_num}: {current_url}")
        else:
            if page_num == 1:
                current_url = base_url
            else:
                current_url = f"{base_url}/page/{page_num}"
            print(f"  📄 [{c_slug}] Reparación Directa - Pág {page_num}: {current_url}")
            
        page = await context.new_page()
        await page.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "font", "media"] else route.continue_())
        
        try:
            await page.goto(current_url, wait_until="domcontentloaded", timeout=60000)
            
            page_loaded = False
            is_years_page = False
            for i in range(60):
                current_url_loop = page.url
                if "pass-challenge" in current_url_loop or "anubis" in current_url_loop:
                    await asyncio.sleep(1.0)
                    continue
                
                try:
                    if year_urls:
                        has_stamps = await page.query_selector("div.pl-it")
                        if has_stamps:
                            page_loaded = True
                            break
                    else:
                        url_after_goto = page.url
                        if "/years/country/" in url_after_goto:
                            is_years_page = True
                            page_loaded = True
                            break
                        
                        has_stamps = await page.query_selector("div.pl-it")
                        if has_stamps:
                            page_loaded = True
                            break
                            
                        year_links = await page.query_selector_all("a[href*='/year/']")
                        if len(year_links) > 0:
                            is_years_page = True
                            page_loaded = True
                            break
                except Exception:
                    pass
                await asyncio.sleep(1.0)
                
            if not page_loaded:
                raise Exception("Timeout esperando estampillas o índice de años")
            
            if not year_urls:
                if is_years_page:
                    print(f"  🗂️ [{c_slug}] Redirección a índice de años detectada. Obteniendo enlaces de años...")
                    html = await page.content()
                    soup = BeautifulSoup(html, 'html.parser')
                    links = soup.select("a[href*='/year/']")
                    found_urls = []
                    for l in links:
                        href = l.get('href')
                        if href:
                            full_u = "https://colnect.com" + href if href.startswith('/') else href
                            if full_u not in found_urls:
                                found_urls.append(full_u)
                    
                    if found_urls:
                        year_urls = found_urls
                        year_idx = 0
                        page_num = 1
                        print(f"  🔍 [{c_slug}] Encontrados {len(year_urls)} años para procesar. Iniciando...")
                        await page.close()
                        
                        progress = load_progress()
                        progress["checkpoints"][c_id] = {
                            "page": page_num, "inserted": total_inserted, "errors": total_errors,
                            "year_urls": year_urls, "year_idx": year_idx
                        }
                        save_progress(progress)
                        continue
                    else:
                        year_urls = []
                else:
                    year_urls = []
                    
                progress = load_progress()
                progress["checkpoints"][c_id] = {
                    "page": page_num, "inserted": total_inserted, "errors": total_errors,
                    "year_urls": year_urls, "year_idx": year_idx
                }
                save_progress(progress)
            
            # Scroll para forzar la carga de lazy loading
            await page.evaluate("""
                async () => {
                    await new Promise((resolve) => {
                        let y = 0;
                        const timer = setInterval(() => {
                            window.scrollBy(0, 250);
                            y += 250;
                            if (y >= document.body.scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 80);
                    });
                }
            """)
            await asyncio.sleep(2.5)
            
            html = await page.content()
            stamps = parse_html_stamps(html, c_display, c_id)
            print(f"  ✨ [{c_slug}] Extrayendo {len(stamps)} estampillas de la página.")
            
            consecutive_errors = 0
            
            # Chequear si hay página siguiente
            next_page_num = page_num + 1
            next_elem = await page.query_selector(f"a.pager_page[data-page='{next_page_num}']")
            next_page_url = await next_elem.get_attribute("href") if next_elem else None
            await page.close()
            
            for stamp in stamps:
                batch.append(stamp)
                if len(batch) >= BATCH_SIZE:
                    await send_batch(batch)
                    total_inserted += len(batch)
                    batch = []
            
            if next_page_url:
                page_num += 1
            else:
                if year_urls:
                    year_idx += 1
                    page_num = 1
                    print(f"  ➡️ [{c_slug}] Año completado. Avanzando a año {year_idx+1}/{len(year_urls)}")
                else:
                    has_more = False
                    
            progress = load_progress()
            progress["checkpoints"][c_id] = {
                "page": page_num, "inserted": total_inserted, "errors": total_errors,
                "year_urls": year_urls, "year_idx": year_idx
            }
            save_progress(progress)
            
            await asyncio.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
            
        except Exception as e:
            consecutive_errors += 1
            total_errors += 1
            print(f"  ❌ [{c_slug}] Error en página/año (Intento {consecutive_errors}/15): {e}")
            try:
                await page.close()
            except Exception:
                pass
            if consecutive_errors >= 15:
                print(f"  💥 [{c_slug}] Demasiados errores consecutivos. Saltando de país.")
                break
            await asyncio.sleep(10)
            
    if batch:
        await send_batch(batch)
        total_inserted += len(batch)
        
    try:
        await context.close()
        await browser.close()
    except Exception:
        pass
        
    progress = load_progress()
    progress["completed_countries"].append(c_id)
    if c_id in progress["checkpoints"]:
        del progress["checkpoints"][c_id]
    save_progress(progress)
    print(f"🏆 [{c_display}] Reparación de país finalizada. Total actualizadas: {total_inserted}")

async def main():
    print("=========================================================")
    print("🚀 Iniciando Motor de Reparación de Imágenes de Colnect")
    print("=========================================================")
    
    proxy_list = await get_proxy_list()
    
    progress = load_progress()
    countries_to_repair = get_all_countries()
    
    # Filtrar completados en esta sesión de reparación
    pending_countries = [c for c in countries_to_repair if c['id'] not in progress["completed_countries"]]
    
    print(f"\n📊 Resumen de Tareas de Reparación:")
    print(f"   - Países reparados previamente: {len(progress['completed_countries'])}")
    print(f"   - Países pendientes: {len(pending_countries)}")
    
    if not pending_countries:
        print("🎉 ¡Todas las imágenes del catálogo han sido reparadas con éxito!")
        return
        
    print(f"\n🚀 Iniciando descargas continuas con semáforo de {CONCURRENT_COUNTRIES} países concurrentes...")
    semaphore = asyncio.Semaphore(CONCURRENT_COUNTRIES)
    
    async def worker(country, p):
        async with semaphore:
            await scrape_country(p, country, proxy_list)
            
    async with async_playwright() as p:
        tasks = [worker(c, p) for c in pending_countries]
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(main())
