#!/usr/bin/env python3
"""
🌍 Colnect Global Stamp Scraper (Version 2 - Optimized for 1.7M Stamps)
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
import uuid
from bs4 import BeautifulSoup
import nest_asyncio

try:
    nest_asyncio.apply()
except Exception:
    pass

from playwright.async_api import async_playwright

# --- CONFIGURACIÓN ---
API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/import-stamp"
PROGRESS_FILE = "colnect_global_progress.json"
BATCH_SIZE = 10  # Mantener en 10 para evitar timeouts de CPU de Cloudflare Workers
DELAY_MIN = 1.5  # Modo Turbo por defecto. Ajustar a 3.0-5.0 para modo seguro
DELAY_MAX = 3.5
# --- CONCURRENCIA DINÁMICA ---
MAX_CONCURRENCY = 15
MIN_CONCURRENCY = 3
current_concurrency = 15
success_count = 0
concurrency_lock = asyncio.Lock()

# --- PROXY PREMIUM ---
# Leído del entorno; dejar sin definir para deshabilitar el proxy premium
# (ver el guard `if PREMIUM_PROXY_SERVER:` más abajo).
PREMIUM_PROXY_SERVER = os.environ.get("DATAIMPULSE_HOST", "")
PREMIUM_PROXY_USER = os.environ.get("DATAIMPULSE_USER", "")
PREMIUM_PROXY_PASS = os.environ.get("DATAIMPULSE_PASS", "")

# Namespace para generación determinista de UUIDs v5
NAMESPACE_PHILATELY = uuid.UUID('12345678-1234-5678-1234-567812345678')

FAILED_FILE = "colnect_failed_stamps.json"
FAILED_LOCK = asyncio.Lock()

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

# Fallback Top 40 países embebidos
_TOP40_FALLBACK = [
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

def require_admin_token():
    """Reads ADMIN_API_TOKEN from the environment or stops with a clear error.

    POST /import-stamp requires X-Admin-Token now (see
    workers/filatelia-api/src/index.ts requireAdmin). Standalone Colab-style
    script, so the check lives inline instead of importing scrapers/scraper_env.py.
    """
    token = os.environ.get("ADMIN_API_TOKEN")
    if not token:
        raise SystemExit(
            "\n❌ ADMIN_API_TOKEN no está definido.\n"
            "   POST /import-stamp ahora requiere autenticación (X-Admin-Token).\n"
            "   Definilo antes de correr este script, por ejemplo:\n"
            "     export ADMIN_API_TOKEN=\"<token>\"\n"
            "   (mismo valor que el secreto ADMIN_API_TOKEN del Worker — ver scrapers/README.md)\n"
        )
    return token

ADMIN_API_TOKEN = require_admin_token()

def _post_batch(stamps):
    headers = {'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_API_TOKEN}
    payload = {'stamps': stamps}
    return requests.post(API_URL, headers=headers, json=payload, timeout=20)

async def send_batch(stamps):
    try:
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(None, _post_batch, stamps)
        if res.status_code == 200:
            result = res.json()
            if result.get("success"):
                print(f"  📦 Lote subido: +{result.get('inserted', 0)} insertados a D1 (Duplicados ignorados automáticamente).")
                return True
        print(f"  ❌ Error subiendo lote: HTTP {res.status_code}")
    except Exception as e:
        print(f"  ❌ Excepción enviando lote: {e}")
    return False

async def send_batch_with_retry(stamps, retries=3, delay=2.0):
    for attempt in range(retries):
        success = await send_batch(stamps)
        if success:
            return True
        if attempt < retries - 1:
            print(f"  🔄 Reintentando subida de lote (Intento {attempt+2}/{retries}) en {delay}s...")
            await asyncio.sleep(delay)
    return False

async def save_failed_stamps(stamps):
    async with FAILED_LOCK:
        existing = []
        if os.path.exists(FAILED_FILE):
            try:
                with open(FAILED_FILE, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
            except Exception:
                pass
        existing.extend(stamps)
        try:
            with open(FAILED_FILE, 'w', encoding='utf-8') as f:
                json.dump(existing, f, indent=2, ensure_ascii=False)
            print(f"  💾 Guardados {len(stamps)} registros fallidos localmente en {FAILED_FILE}")
        except Exception as e:
            print(f"  ⚠️ Error guardando fallidos localmente: {e}")

async def report_success():
    global current_concurrency, success_count
    async with concurrency_lock:
        success_count += 1
        if success_count >= 20:
            success_count = 0
            if current_concurrency < MAX_CONCURRENCY:
                current_concurrency += 1
                print(f"📈 [Sistema] Estabilidad detectada. Incrementando concurrencia activa a {current_concurrency}")

async def report_error():
    global current_concurrency, success_count
    async with concurrency_lock:
        success_count = 0  # Reiniciar racha de éxitos
        if current_concurrency > MIN_CONCURRENCY:
            current_concurrency -= 1
            print(f"📉 [Sistema] Alta tasa de errores detectada. Reduciendo concurrencia activa a {current_concurrency}")

async def db_validator():
    baseline = 0
    # Obtener baseline inicial
    try:
        res = requests.post(API_URL.replace("/import-stamp", "/query"), json={"sql": "SELECT COUNT(*) as cnt FROM Stamp", "params": []}, timeout=10)
        if res.status_code == 200:
            baseline = res.json().get("results", [{}])[0].get("cnt", 0)
            print(f"\n📊 [Validador DB] Conteo inicial en D1: {baseline:,} sellos.")
    except Exception as e:
        print(f"\n⚠️ [Validador DB] No se pudo obtener conteo inicial: {e}")
        
    last_count = baseline
    while True:
        await asyncio.sleep(120)  # Cada 2 minutos
        try:
            res = requests.post(API_URL.replace("/import-stamp", "/query"), json={"sql": "SELECT COUNT(*) as cnt FROM Stamp", "params": []}, timeout=10)
            if res.status_code == 200:
                current = res.json().get("results", [{}])[0].get("cnt", 0)
                delta = current - last_count
                total_delta = current - baseline
                print(f"\n📊 [Validador DB] Estado actual en D1: {current:,} sellos (+{delta} en los últimos 2 min, +{total_delta} total en esta sesión).")
                last_count = current
        except Exception as e:
            print(f"\n⚠️ [Validador DB] Error consultando conteo de BD: {e}")

def get_all_countries():
    # Intentar cargar desde el archivo local en el mismo directorio
    local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "colnect_countries_full.json")
    if os.path.exists(local_path):
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for c in data:
                    if 'sc' in c:
                        c['stamps_count'] = c.pop('sc')
                # Ordenar por cantidad de sellos descendente
                data.sort(key=lambda x: x.get('stamps_count', 0), reverse=True)
                print(f"✅ Cargados {len(data)} países desde el archivo local colnect_countries_full.json.")
                return data
        except Exception as e:
            print(f"⚠️ Error leyendo colnect_countries_full.json local: {e}")
            
    # Fallback si no existe
    print("⚠️ Archivo local colnect_countries_full.json no encontrado. Usando catálogo fallback top 40...")
    fallback = []
    for c in _TOP40_FALLBACK:
        fallback.append({
            "id": c[0],
            "name": c[1],
            "display": c[2],
            "stamps_count": c[3]
        })
    return fallback

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
            
            # Generar UUIDv5 determinista basado en la URL de origen
            stamp_id = str(uuid.uuid5(NAMESPACE_PHILATELY, source_url))
            
            # Metadata complementaria
            meta_div = item.select_one('div.i_d')
            series = ""
            catalog_codes_text = ""
            colors = None
            themes = []
            
            if meta_div:
                for row in meta_div.select('div'):
                    text = row.get_text().strip()
                    if ":" in text:
                        lbl, val = text.split(":", 1)
                        lbl = lbl.strip()
                        val = val.strip()
                        if lbl == "Series":
                            series = val
                        elif lbl == "Catalog codes":
                            catalog_codes_text = val
                        elif lbl == "Colors":
                            colors = val
                        elif lbl == "Themes":
                            themes = [t.strip() for t in val.split('|')]
            
            # Denominación
            denom_el = item.select_one('div.item_price')
            denomination_text = denom_el.get_text().strip() if denom_el else ""
            
            # Descripción
            desc_el = item.select_one('div.pl_desc')
            description = desc_el.get_text().strip() if desc_el else ""
            
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
            
            year = None
            year_match = re.search(r'\b(18\d{2}|19\d{2}|20\d{2})\b', f"{series} {name}")
            if year_match:
                year = int(year_match.group(1))
            
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
                    "id": stamp_id,  # ID Único Determinista
                    "nameEn": name,
                    "nameEs": name,
                    "countryCode": country_name[:3].upper(),
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
                    "catalogName": f"{country_name} (Colnect)",
                    "countryId": country_id
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
                print(f"  🔑 [{c_slug}] Cookies de sesión inyectadas exitosamente.")
        except Exception as e:
            print(f"  ⚠️ [{c_slug}] Error inyectando cookies: {e}")

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
    has_more = True
    
    while has_more:
        if year_urls:
            if year_idx >= len(year_urls):
                has_more = False
                break
            year_url = year_urls[year_idx]
            current_url = year_url if page_num == 1 else f"{year_url}/page/{page_num}"
            print(f"  📄 [{c_slug}] Año {year_idx+1}/{len(year_urls)} - Pág {page_num}: {current_url}")
        else:
            if page_num == 1:
                current_url = base_url
            else:
                current_url = f"{base_url}/page/{page_num}"
            print(f"  📄 [{c_slug}] Directo - Pág {page_num}: {current_url}")
            
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
            
            await report_success()
            
            if not year_urls:
                if is_years_page:
                    print(f"  🗂️ [{c_slug}] Redirección a índice de años detectada. Extrayendo URLs...")
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
            print(f"  ✨ [{c_slug}] Encontrados {len(stamps)} sellos en la página.")
            
            consecutive_errors = 0
            
            # Chequear si hay página siguiente
            next_page_num = page_num + 1
            next_elem = await page.query_selector(f"a.pager_page[data-page='{next_page_num}']")
            next_page_url = await next_elem.get_attribute("href") if next_elem else None
            await page.close()
            
            for stamp in stamps:
                batch.append(stamp)
                if len(batch) >= BATCH_SIZE:
                    success = await send_batch_with_retry(batch)
                    if success:
                         total_inserted += len(batch)
                    else:
                         await save_failed_stamps(batch)
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
            await report_error()
            try:
                await page.close()
            except Exception:
                pass
            if consecutive_errors >= 15:
                print(f"  💥 [{c_slug}] Demasiados errores consecutivos. Saltando país.")
                break
            await asyncio.sleep(10)
            
    if batch:
        success = await send_batch_with_retry(batch)
        if success:
            total_inserted += len(batch)
        else:
            await save_failed_stamps(batch)
        
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
    print(f"🏆 [{c_display}] Extracción de país finalizada. Total insertados/procesados: {total_inserted}")

async def main():
    print("=========================================================")
    print("🚀 Iniciando Motor de Extracción Global de Colnect (V2)")
    print("=========================================================")
    
    proxy_list = await get_proxy_list()
    
    progress = load_progress()
    
    async with async_playwright() as p:
        all_countries = get_all_countries()
        
        # Filtrar completados en sesiones anteriores
        countries_to_scrape = [c for c in all_countries if c['id'] not in progress["completed_countries"]]
        
        print(f"\n📊 Resumen de Tareas:")
        print(f"   - Países completados previamente: {len(progress['completed_countries'])}")
        print(f"   - Países pendientes: {len(countries_to_scrape)}")
        print(f"   - Sellos estimados a extraer: {sum(c['stamps_count'] for c in countries_to_scrape):,}")
        
        if not countries_to_scrape:
            print("🎉 ¡Todo el catálogo global de Colnect está completo!")
            return
            
        # Cola de países
        queue = asyncio.Queue()
        for c in countries_to_scrape:
            await queue.put(c)
            
        # Lanzar validador de BD en segundo plano
        db_task = asyncio.create_task(db_validator())
        
        # Función del worker dinámico
        async def worker(worker_id):
            global current_concurrency
            while not queue.empty():
                # Control dinámico de concurrencia: si el id es mayor a la activa, suspender
                while True:
                    async with concurrency_lock:
                        if worker_id < current_concurrency:
                            break
                    await asyncio.sleep(1.0)
                
                try:
                    country = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                
                try:
                    await scrape_country(p, country, proxy_list)
                except Exception as e:
                    print(f"💥 [Error Worker {worker_id}] Excepción grave en país: {e}")
                finally:
                    queue.task_done()
                    
        print(f"\n🚀 Iniciando descargas dinámicas con hasta {MAX_CONCURRENCY} workers concurrentes...")
        
        # Crear los workers
        workers = [asyncio.create_task(worker(i)) for i in range(MAX_CONCURRENCY)]
        
        # Esperar a que todos los elementos de la cola sean procesados
        await queue.join()
        
        # Cancelar validador al terminar
        db_task.cancel()

if __name__ == "__main__":
    asyncio.run(main())
