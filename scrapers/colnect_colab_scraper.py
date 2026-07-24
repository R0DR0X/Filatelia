#!/usr/bin/env python3
"""
🌍 Colnect Stamp Scraper - Versión Auto-Curable y Dinámica para Google Colab

Copiá y pegá este código completo en UNA SOLA celda de Colab y ejecutala.
Se auto-instala todo. No necesitás hacer nada más.
"""

# --- AUTO-INSTALACIÓN DE DEPENDENCIAS ---
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
subprocess.run([sys.executable, "-m", "playwright", "install-deps", "chromium"],
               capture_output=True)
print("🌐 Descargando navegador Chromium...")
subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
               capture_output=True)
print("✅ Dependencias listas.\n")

import asyncio
import random
import re
import os
import json
import requests
import math
from bs4 import BeautifulSoup
import nest_asyncio

# Permitir loops asíncronos anidados en Jupyter/Colab
try:
    nest_asyncio.apply()
except Exception:
    pass

from playwright.async_api import async_playwright

# --- CONFIGURACIÓN ---
API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/import-stamp"
PROGRESS_FILE = "colnect_colab_progress.json"
BATCH_SIZE = 20
DELAY_MIN = 3.0  # Retardo mínimo entre páginas (en segundos)
DELAY_MAX = 7.0  # Retardo máximo entre páginas (en segundos)
CONCURRENT_COUNTRIES = 6  # Países en paralelo (reducido para liberar CPU y resolver retos PoW de Anubis)

# --- PROXY PREMIUM (Opcional - ej: DataImpulse) ---
# Dejar vacíos si se quiere usar proxies públicos gratuitos.
PREMIUM_PROXY_SERVER = "gw.dataimpulse.com:823"
PREMIUM_PROXY_USER = "bafe165ec82f735291ea"
PREMIUM_PROXY_PASS = "cba7f2ea0d940de4"

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

# --- PROXIES ---
async def get_proxy_list():
    try:
        url = "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all"
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(None, lambda: requests.get(url, timeout=5))
        if res.status_code == 200:
            proxies = [p.strip() for p in res.text.split('\n') if p.strip()]
            return proxies
    except Exception as e:
        print(f"  ⚠️ Error obteniendo lista de proxies: {e}")
    return []

# --- CHECKPOINTS ---
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

# --- SUBIR A CLOUDFLARE ---
def _post_batch(stamps):
    headers = {'Content-Type': 'application/json'}
    payload = {'stamps': stamps}
    return requests.post(API_URL, headers=headers, json=payload, timeout=20)

async def send_batch(stamps):
    try:
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(None, _post_batch, stamps)
        if res.status_code == 200:
            result = res.json()
            if result.get("success"):
                print(f"  📦 Lote subido: +{result.get('inserted', 0)} insertados a D1, {len(result.get('errors', []))} errores.")
                return True
        print(f"  ❌ Error subiendo lote: HTTP {res.status_code}")
    except Exception as e:
        print(f"  ❌ Excepción enviando lote: {e}")
    return False

# --- CATÁLOGO DE PAÍSES ---
# Top 40 países embebidos como fallback (~490k sellos). El script intenta
# descargar la lista completa de 423 países al inicio via requests.
_TOP40 = [
    ("225","United_States_of_America","United States",30982),
    ("90","Guinea","Guinea",26681),("191","Sierra_Leone","Sierra Leone",22113),
    ("41","Central_African_Republic","Central African Republic",20693),
    ("212","Togo","Togo",17889),("91","Guinea-Bissau","Guinea-Bissau",17842),
    ("98","Hungary","Hungary",17782),("939","France_Personalized_Stamps","France PS",17095),
    ("108","Japan","Japan",16537),("74","France","France",16457),
    ("177","Romania","Romania",16293),("121","Liberia","Liberia",15031),
    ("59","Djibouti","Djibouti",14345),("156","Niger","Niger",14316),
    ("21","Belgium","Belgium",14272),("81","Germany_Federal_Republic","Germany FR",14004),
    ("442","China","China",13861),("178","Russia","Russia",13853),
    ("106","Italy","Italy",12929),("199","Spain","Spain",12729),
    ("53","Cuba","Cuba",12494),("13","Australia","Australia",12406),
    ("224","United_Kingdom_of_Great_Britain_Northern_Ireland","United Kingdom",11789),
    ("38","Canada","Canada",11462),("30","Brazil","Brazil",11396),
    ("157","Nigeria","Nigeria",11312),("155","New_Zealand","New Zealand",10766),
    ("169","Peru","Peru",10653),("10","Argentina","Argentina",10283),
    ("105","Israel","Israel",9920),("139","Mexico","Mexico",9608),
    ("47","Colombia","Colombia",8967),("43","Chile","Chile",8540),
    ("227","Uruguay","Uruguay",7844),("230","Venezuela","Venezuela",7322),
    ("26","Bolivia","Bolivia",6915),("63","Ecuador","Ecuador",6504),
    ("168","Paraguay","Paraguay",6201),("248","Abkhazia","Abkhazia",1728),
    ("456","Abu_Dhabi","Abu Dhabi",104),
]

FULL_LIST_URL = "https://raw.githubusercontent.com/rodrigopianto/filatelia-data/main/colnect_countries.json"

def get_all_countries():
    """Try downloading the full 423-country list, fall back to embedded top 40."""
    # Intentar descargar lista completa
    try:
        res = requests.get(FULL_LIST_URL, timeout=10)
        if res.status_code == 200:
            data = res.json()
            for c in data:
                if 'sc' in c:
                    c['stamps_count'] = c.pop('sc')
            print(f"✅ Lista completa descargada: {len(data)} países.")
            return data
    except Exception:
        pass
    # Fallback: usar top 40 embebidos
    print("⚠️ No se pudo descargar lista completa. Usando top 40 países embebidos (~490k sellos).")
    return [{"id":t[0],"name":t[1],"display":t[2],"stamps_count":t[3]} for t in _TOP40]

# --- PARSE HTML STAMPS ---
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
            
            series = ""
            catalog_codes_text = ""
            themes = []
            colors = ""
            denomination_text = ""
            description = ""
            
            dts = item.select('dt')
            for dt in dts:
                label = dt.get_text().strip().lower()
                dd = dt.find_next_sibling('dd')
                if not dd:
                    continue
                
                if 'series:' in label:
                    series = dd.get_text().strip()
                elif 'catalog codes:' in label:
                    catalog_codes_text = dd.get_text().strip()
                elif 'themes:' in label:
                    themes = [a.get_text().strip() for a in dd.select('a')]
                elif 'colors:' in label:
                    colors = dd.get_text().strip()
                elif 'face value:' in label:
                    denomination_text = dd.get_text().strip()
                elif 'description:' in label:
                    description = dd.get_text().strip()
            
            img = item.select_one('div.item_thumb img')
            image_url = None
            if img:
                # Priorizar data-src para saltar los spacers 1x1 de lazy-loading
                data_src = img.get('data-src')
                src = img.get('src')
                
                candidate = data_src if (data_src and not data_src.startswith('data:')) else src
                if candidate and not candidate.startswith('data:'):
                    image_url = candidate
                    if image_url.startswith('//'):
                        image_url = "https:" + image_url
                    
                    # Convertir a alta calidad (/t/ -> /b/ y /items/thumb/ -> /items/full/)
                    if "/t/" in image_url:
                        image_url = image_url.replace("/t/", "/b/", 1)
                    elif "/items/thumb/" in image_url:
                        image_url = image_url.replace("/items/thumb/", "/items/full/", 1)
            
            # Extraer año
            year = None
            year_match = re.search(r'\b(18\d{2}|19\d{2}|20\d{2})\b', f"{series} {name}")
            if year_match:
                year = int(year_match.group(1))
            
            # Extraer códigos
            scott_match = re.search(r'Sn:([A-Za-z0-9\s#\-+]+)(,|$)', catalog_codes_text)
            scott_number = scott_match.group(1).strip() if scott_match else None
            
            michel_match = re.search(r'Mi:([A-Za-z0-9\s#\-+]+)(,|$)', catalog_codes_text)
            michel_number = michel_match.group(1).strip() if michel_match else None
            
            yvert_match = re.search(r'Yt:([A-Za-z0-9\s#\-+]+)(,|$)', catalog_codes_text)
            yvert_number = yvert_match.group(1).strip() if yvert_match else None
            
            denomination = None
            if denomination_text:
                denom_match = re.match(r'^([\d.,]+)', denomination_text)
                if denom_match:
                    denomination = float(denom_match.group(1).replace(',', '.'))
            
            if len(name) > 3:
                results.append({
                    "nameEn": name,
                    "nameEs": name,
                    "countryCode": country_name[:3].upper(), # Código rápido de referencia
                    "year": year,
                    "denomination": denomination,
                    "imageUrl": image_url,
                    "scottNumber": scott_number,
                    "michelNumber": michel_number,
                    "yvertNumber": yvert_number,
                    "source": "colnect",
                    "sourceUrl": source_url,
                    "theme": ", ".join(themes) if themes else None,
                    "color": colors if colors else None,
                    "descriptionEs": description if description else None,
                    "groupTitleEs": f"{country_name} — Emisiones {year if year else 'Sin Año'}",
                    "catalogName": f"{country_name} (Colnect)"
                })
        except Exception:
            pass
            
    return results

# --- CARGAR COOKIES DE SESIÓN ---
async def load_session_cookies(context, c_slug):
    if os.path.exists("colnect_cookies.json"):
        try:
            with open("colnect_cookies.json", "r") as f:
                cookies = json.load(f)
                # Formatear cookies para playwright si es necesario
                for c in cookies:
                    if "domain" not in c:
                        c["domain"] = ".colnect.com"
                    if "path" not in c:
                        c["path"] = "/"
                await context.add_cookies(cookies)
                print(f"  🔑 [{c_slug}] Cookies de sesión cargadas desde colnect_cookies.json")
        except Exception as e:
            print(f"  ⚠️ [{c_slug}] Error al cargar cookies: {e}")

# --- SCRAPE SINGLE COUNTRY ---
async def scrape_country(playwright, country, proxy_list):
    c_id = country['id']
    c_slug = country['name']
    c_display = country['display']
    
    progress = load_progress()
    
    # Cargar checkpoint o iniciar
    checkpoint = progress["checkpoints"].get(c_id, {
        "page": 1, "inserted": 0, "errors": 0, "year_urls": None, "year_idx": 0
    })
    page_num = checkpoint.get("page", 1)
    total_inserted = checkpoint.get("inserted", 0)
    total_errors = checkpoint.get("errors", 0)
    year_urls = checkpoint.get("year_urls", None)
    if not year_urls: # Normalizar [] o None a None
        year_urls = None
    year_idx = checkpoint.get("year_idx", 0)
    
    print(f"\n🌍 [{c_display}] Iniciando extracción. Acumulados: {total_inserted}")
    
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
    
    # 1. Bucle principal de navegación
    has_more = True
    while has_more:
        if year_urls:
            # Modo Años: Scrapeamos el año actual
            if year_idx >= len(year_urls):
                has_more = False
                break
            year_url = year_urls[year_idx]
            current_url = year_url if page_num == 1 else f"{year_url}/page/{page_num}"
            print(f"  📄 [{c_slug}] Año {year_idx+1}/{len(year_urls)} - Pág {page_num}: {current_url}")
        else:
            # Modo Directo: Sin años
            if page_num == 1:
                current_url = base_url
            else:
                current_url = f"{base_url}/page/{page_num}"
            print(f"  📄 [{c_slug}] Directo - Pág {page_num}: {current_url}")
            
        page = await context.new_page()
        # Bloquear imágenes, fuentes y multimedia para ahorrar el 95% del consumo de datos de red
        await page.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "font", "media"] else route.continue_())
        try:
            await page.goto(current_url, wait_until="domcontentloaded", timeout=60000)
            
            # Esperar a que la página se cargue y se resuelva cualquier reto de Anubis/redirección
            page_loaded = False
            is_years_page = False
            for i in range(60):
                current_url_loop = page.url
                print(f"  [DEBUG {c_slug}] Seg {i} - URL actual: {current_url_loop}")
                if "pass-challenge" in current_url_loop or "anubis" in current_url_loop:
                    await asyncio.sleep(1.0)
                    continue
                
                try:
                    # Si ya estamos en modo años, solo esperamos las estampillas (div.pl-it)
                    if year_urls:
                        has_stamps = await page.query_selector("div.pl-it")
                        if has_stamps:
                            page_loaded = True
                            break
                    else:
                        # Si no sabemos, detectamos si es lista de sellos o índice de años
                        url_after_goto = page.url
                        if "/years/country/" in url_after_goto:
                            print(f"  🔍 [{c_slug}] Detectado /years/country/ en URL: {url_after_goto}")
                            is_years_page = True
                            page_loaded = True
                            break
                        
                        has_stamps = await page.query_selector("div.pl-it")
                        if has_stamps:
                            print(f"  🔍 [{c_slug}] Detectadas estampillas en página principal")
                            page_loaded = True
                            break
                            
                        year_links = await page.query_selector_all("a[href*='/year/']")
                        if len(year_links) > 0:
                            print(f"  🔍 [{c_slug}] Detectados {len(year_links)} enlaces de años en el HTML")
                            is_years_page = True
                            page_loaded = True
                            break
                except Exception as ex:
                    if i % 10 == 0:
                        print(f"  🔍 [{c_slug}] Excepción temporal en chequeo (navegando): {ex}")
                    pass
                
                await asyncio.sleep(1.0)
                
            if not page_loaded:
                raise Exception("Timeout esperando estampillas o índice de años (Anubis no resuelto o página vacía)")
            
            # Detección dinámica de redirección a índice de años
            if not year_urls:
                if is_years_page:
                    print(f"  🗂️ [{c_slug}] Redirección a años detectada dinámicamente. Extrayendo enlaces...")
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
                        print(f"  🔍 [{c_slug}] Se encontraron {len(year_urls)} años para procesar. Pasando a modo años...")
                        await page.close()
                        
                        # Guardar checkpoint y reiniciar iteración del bucle
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
                    
                # Guardar el estado detectado en checkpoint
                progress = load_progress()
                progress["checkpoints"][c_id] = {
                    "page": page_num, "inserted": total_inserted, "errors": total_errors,
                    "year_urls": year_urls, "year_idx": year_idx
                }
                save_progress(progress)
            
            # Scroll
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
            print(f"  ✨ [{c_slug}] Encontrados {len(stamps)} sellos.")
            
            consecutive_errors = 0
            
            # Chequear si hay página siguiente
            next_page_num = page_num + 1
            next_elem = await page.query_selector(f"a.pager_page[data-page='{next_page_num}']")
            next_page_url = await next_elem.get_attribute("href") if next_elem else None
            
            await page.close()
            
            # Subir lote
            for stamp in stamps:
                batch.append(stamp)
                if len(batch) >= BATCH_SIZE:
                    success = await send_batch(batch)
                    if success:
                        total_inserted += len(batch)
                    batch = []
            
            # Avanzar de página o de año
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
            
            # Descanso
            if PREMIUM_PROXY_SERVER:
                # Con proxy premium rotatorio no hace falta el descanso largo de 60s
                await asyncio.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
            else:
                if page_num % 5 == 0:
                    print(f"  ⏳ [{c_slug}] Descanso preventivo de 60 segundos...")
                    await asyncio.sleep(60)
                else:
                    await asyncio.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
                
        except Exception as e:
            consecutive_errors += 1
            total_errors += 1
            print(f"  ❌ [{c_slug}] Error en página/año (Intento {consecutive_errors}/15): {e}")
            try:
                screenshot_path = f"error_{c_slug}_page_{page_num}_intento_{consecutive_errors}.png"
                await page.screenshot(path=screenshot_path)
                print(f"  📸 [{c_slug}] Captura de pantalla de error guardada en: {screenshot_path}")
            except Exception as se:
                print(f"  ⚠️ [{c_slug}] No se pudo tomar captura de pantalla de error: {se}")
            try:
                await page.close()
            except Exception:
                pass
                
            if consecutive_errors >= 15:
                print(f"  ⚠️ [{c_slug}] Demasiados errores consecutivos. Esperando pool de proxies...")
                await asyncio.sleep(45)
                if len(proxy_list) < 5:
                    proxy_list = await get_proxy_list()
                consecutive_errors = 0
                
            # Rotar navegador y proxy
            try:
                await context.close()
                await browser.close()
            except Exception:
                pass
                
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
            await asyncio.sleep(5)
            
    # Subir remanentes
    if batch:
        success = await send_batch(batch)
        if success:
            total_inserted += len(batch)
            
    try:
        await context.close()
        await browser.close()
    except Exception:
        pass
        
    # Marcar país como completado
    progress = load_progress()
    progress["completed_countries"].append(c_id)
    if c_id in progress["checkpoints"]:
        del progress["checkpoints"][c_id]
    save_progress(progress)
    print(f"🏆 [{c_display}] Extracción finalizada. Total insertados en esta sesión: {total_inserted}")

# --- MAIN RUNNER ---
async def main():
    print("=========================================================")
    print("🚀 Iniciando Motor de Extracción Colnect para Google Colab")
    print("=========================================================")
    
    proxy_list = await get_proxy_list()
    print(f"📡 Pool de proxies inicializado: {len(proxy_list)} disponibles")
    
    progress = load_progress()
    all_countries = get_all_countries()
    print(f"📋 Catálogo embebido: {len(all_countries)} países/regiones cargados.")
    
    # Filtrar países ya completados
    countries_to_scrape = [c for c in all_countries if c['id'] not in progress["completed_countries"]]
    total_stamps = sum(c['stamps_count'] for c in countries_to_scrape)
    
    print(f"\n📊 Resumen de Tareas:")
    print(f"   - Países completados previamente: {len(progress['completed_countries'])}")
    print(f"   - Países pendientes: {len(countries_to_scrape)}")
    print(f"   - Sellos estimados a extraer: {total_stamps:,}")
    
    if not countries_to_scrape:
        print("🎉 ¡Todos los países del catálogo mundial han sido completados!")
        return
        
    print(f"\n🚀 Iniciando descargas continuas con semáforo de {CONCURRENT_COUNTRIES} países concurrentes...")
    
    # Semáforo para mantener exactamente N países activos a la vez
    semaphore = asyncio.Semaphore(CONCURRENT_COUNTRIES)
    
    async def worker(country, p):
        async with semaphore:
            # Compartir la lista de proxies actual
            await scrape_country(p, country, proxy_list)
            
    async with async_playwright() as p:
        tasks = [worker(c, p) for c in countries_to_scrape]
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(main())
