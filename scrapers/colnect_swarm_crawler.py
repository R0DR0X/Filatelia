import asyncio
import sqlite3
import random
import time
import requests
import uuid
import sys
import os
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

# Configuración General
API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/import-stamp"
USE_PROXY = True  # Activado para enrutar el tráfico por el proxy residencial
PROXY_BASE = "http://gw.dataimpulse.com:823"
PROXY_USER = "ce2dd5be999d7e7e9a05"
PROXY_PASS = "b93d4b8e9a554c41"
PROXY_SESSION = f"crawler_session_{random.randint(100000, 999999)}"

NUM_BROWSERS = 1          # Instancia única para simular comportamiento humano
CONTEXTS_PER_BROWSER = 1  # Contexto único (sin concurrencia cruzada de IPs)
BATCH_SIZE = 1            # Enviar registros de a uno para monitoreo en tiempo real
LOCAL_DB = "crawler_progress.db"

NAMESPACE_PHILATELY = uuid.UUID('12345678-1234-5678-1234-567812345678')

# Dominios de trackers a neutralizar
TRACKING_DOMAINS = [
    "googlesyndication.com", 
    "google-analytics.com", 
    "googletagmanager.com", 
    "doubleclick.net"
]

# Inicialización de base de datos SQLite local para la VPS
def init_local_db():
    conn = sqlite3.connect(LOCAL_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS queue (
            url TEXT PRIMARY KEY,
            status TEXT DEFAULT 'pending',
            retries INTEGER DEFAULT 0,
            updated_at INTEGER
        )
    """)
    conn.commit()
    conn.close()

def update_local_status(url, status, retries=None):
    conn = sqlite3.connect(LOCAL_DB)
    if retries is not None:
        conn.execute(
            "UPDATE queue SET status = ?, retries = ?, updated_at = ? WHERE url = ?",
            (status, retries, int(time.time()), url)
        )
    else:
        conn.execute(
            "UPDATE queue SET status = ?, updated_at = ? WHERE url = ?",
            (status, int(time.time()), url)
        )
    conn.commit()
    conn.close()

# Interceptor de Red para optimización extrema y bypass de anti-adblock
async def setup_network_interception(page):
    async def interceptor(route):
        req = route.request
        url = req.url
        # No bloqueamos recursos para no levantar alarmas en Anubis/Cloudflare
        if any(d in url for d in TRACKING_DOMAINS):
            await route.fulfill(
                status=200,
                content_type="application/javascript",
                body="console.log('Tracker neutralizado');"
            )
            return
        await route.continue_()
    
    await page.route("**/*", interceptor)

# Flusher asíncrono para enviar los lotes procesados a Cloudflare D1
async def d1_batch_flusher(d1_queue):
    batch = []
    while True:
        try:
            # Espera datos de la cola para agruparlos
            item = await asyncio.wait_for(d1_queue.get(), timeout=3.0)
            batch.append(item)
            
            if len(batch) >= BATCH_SIZE:
                await send_batch_to_d1(batch)
                batch = []
            d1_queue.task_done()
        except asyncio.TimeoutError:
            # Si no entran registros nuevos en 3 segundos, vaciamos lo acumulado
            if batch:
                await send_batch_to_d1(batch)
                batch = []

async def send_batch_to_d1(batch_data):
    loop = asyncio.get_running_loop()
    print(f"📦 Enviando lote de {len(batch_data)} registros a Cloudflare D1...")
    try:
        def post():
            headers = {"Content-Type": "application/json"}
            return requests.post(API_URL, headers=headers, json={"stamps": batch_data}, timeout=20)
            
        res = await loop.run_in_executor(None, post)
        if res.status_code == 200:
            result = res.json()
            if result.get("success") or "inserted" in result:
                print(f"  ✅ Lote subido con éxito: {result.get('inserted', 0)} insertados, {result.get('updated', 0)} actualizados.")
                return True
        print(f"  ❌ Error subiendo lote: HTTP {res.status_code} - {res.text}")
    except Exception as e:
        print(f"  ❌ Excepción enviando lote a D1: {e}")
    return False

# Worker de extracción unitario
async def crawler_worker(worker_id, browser, url_queue, d1_queue):
    loop = asyncio.get_running_loop()
    
    # Cada contexto recibe una IP estática aleatoria para evitar reuso de IPs muertas/bloqueadas
    proxy_config = None
    if USE_PROXY:
        proxy_config = {
            "server": PROXY_BASE,
            "username": f"{PROXY_USER}__sessid.{PROXY_SESSION}",
            "password": PROXY_PASS
        }
        print(f"🐝 Worker {worker_id} -> Usando Session ID Proxy: {PROXY_SESSION}")
    
    # Cargar cookies de sesión
    cookies = []
    try:
        import json
        cookie_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "colnect_cookies_crawler.json")
        with open(cookie_path, "r") as f:
            cookies = json.load(f)
    except Exception as e:
        print(f"⚠️ Error cargando colnect_cookies_crawler.json: {e}")
    
    context_args = {
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "viewport": {"width": 1280, "height": 720},
        "locale": "en-US",
    }
    if proxy_config:
        context_args["proxy"] = proxy_config

    context = await browser.new_context(**context_args)
    if cookies:
        await context.add_cookies(cookies)
    await context.add_init_script("delete navigator.__proto__.webdriver;")
    
    page = await context.new_page()
    consecutive_errors = 0
    
    while True:
        url = await url_queue.get()
        print(f"🕵️ Worker {worker_id} -> Cargando URL: {url} (Errores consec.: {consecutive_errors})")
        
        # Jitter de 4 a 6 segundos para simular navegación humana real
        delay = random.uniform(4.0, 6.0)
        await asyncio.sleep(delay)
        
        try:
            await loop.run_in_executor(None, update_local_status, url, "processing")
            
            response = await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(4.5) # Espera resolución interna Anubis/carga completa
            
            html = await page.content()
            status = response.status if response else 0
            
            # Validación de bloqueo o reto no resuelto
            if status != 200 or len(html) < 4000 or "Anubis" in html:
                print(f"⚠️ Worker {worker_id} -> Bloqueo detectado en {url}. Reencolando...")
                await loop.run_in_executor(None, update_local_status, url, "pending")
                await url_queue.put(url)
                consecutive_errors += 1
            else:
                # Extracción y estructuración (BeautifulSoup)
                soup = BeautifulSoup(html, "html.parser")
                data = parse_stamp_detail(soup, url)
                
                if data:
                    # Rellenar identificadores automáticos y fuentes
                    data["id"] = str(uuid.uuid5(NAMESPACE_PHILATELY, url))
                    data["source"] = "colnect"
                    # Generar un countryCode tentativo basado en la URL si no viene definido
                    if not data.get("countryCode"):
                        parts = url.split("/stamp/")
                        if len(parts) > 1:
                            # ej. "1644556-Casa_Vilela_Lima-Architecture_in_Peru_2025-Peru"
                            slug_parts = parts[1].split("-")
                            data["countryCode"] = slug_parts[-1][:3].upper()
                    
                    # Generar un groupId estable
                    data["groupId"] = f"group-{(data.get('countryCode') or 'xx').lower()}-{data.get('year') or 'unknown'}"
                    
                    await d1_queue.put(data)
                    await loop.run_in_executor(None, update_local_status, url, "done")
                    consecutive_errors = 0 # reset on success
                else:
                    await loop.run_in_executor(None, update_local_status, url, "failed")
                    consecutive_errors += 1
                    
        except Exception as e:
            print(f"❌ Worker {worker_id} -> Error crítico en {url}: {e}")
            await loop.run_in_executor(None, update_local_status, url, "pending")
            await url_queue.put(url)
            consecutive_errors += 1
            
        url_queue.task_done()
        
        if consecutive_errors >= 5:
            print(f"🚨 Worker {worker_id} -> Demasiados errores consecutivos ({consecutive_errors}). Saliendo del proceso para forzar reinicio por systemd...")
            sys.exit(1)

def parse_stamp_detail(soup, url):
    try:
        info = {}
        # 1. Buscar todas las filas de la tabla de detalles
        rows = soup.select("table.item_info_table tr, .stamp_details tr, .info_table tr")
        for row in rows:
            label_el = row.select_one("td.label, th")
            value_el = row.select_one("td.value, td:last-child")
            if label_el and value_el:
                label = label_el.get_text().strip().lower()
                value = value_el.get_text().strip()
                if label and value:
                    info[label] = value
                    
        # 2. Buscar todas las listas de descripción (dl/dt/dd) para layouts nuevos
        dls = soup.select(".i_d dl, #item_full_details dl")
        for dl in dls:
            dts = dl.find_all("dt")
            dds = dl.find_all("dd")
            for dt, dd in zip(dts, dds):
                label = dt.get_text().strip().lower()
                value = dd.get_text().strip()
                if label and value:
                    info[label] = value

        # Buscar imágenes
        main_img = soup.select_one(".stamp_image img, #item_image img, .main-image img")
        back_img = soup.select_one(".stamp_back img, #back_image img")
        
        image_url = main_img.get("src") or main_img.get("data-src") if main_img else None
        image_back_url = back_img.get("src") or back_img.get("data-src") if back_img else None
        
        # Formatear la URL de la imagen principal para que sea de alta calidad si es posible
        if image_url:
            if image_url.startswith("//"):
                image_url = "https:" + image_url
            if "/t/" in image_url:
                image_url = image_url.replace("/t/", "/b/", 1)
            elif "/items/thumb/" in image_url:
                image_url = image_url.replace("/items/thumb/", "/items/full/", 1)
                
        if image_back_url:
            if image_back_url.startswith("//"):
                image_back_url = "https:" + image_back_url
            if "/t/" in image_back_url:
                image_back_url = image_back_url.replace("/t/", "/b/", 1)
            elif "/items/thumb/" in image_back_url:
                image_back_url = image_back_url.replace("/items/thumb/", "/items/full/", 1)

        # Parsear enteros y flotantes con control de errores
        def clean_int(val):
            if not val:
                return None
            try:
                import re
                nums = re.sub(r"\D", "", val)
                return int(nums) if nums else None
            except:
                return None

        def clean_float(val):
            if not val:
                return None
            try:
                import re
                nums = re.sub(r"[^\d.]", "", val.replace(",", "."))
                return float(nums) if nums else None
            except:
                return None

        # Mapeo de campos
        import re
        scott = info.get("scott") or info.get("scott #") or info.get("número scott") or info.get("catalog codes", "")
        scott_number = None
        if scott:
            scott_match = re.search(r"Sn:([A-Za-z0-9\s#\-+]+)(,|$)", scott)
            if scott_match:
                scott_number = scott_match.group(1).strip()
            elif not scott.startswith("Sn:"):
                scott_number = scott.strip()

        michel = info.get("michel") or info.get("michel #") or info.get("catalog codes", "")
        michel_number = None
        if michel:
            michel_match = re.search(r"Mi:([A-Za-z0-9\s#\-+]+)(,|$)", michel)
            if michel_match:
                michel_number = michel_match.group(1).strip()
            elif not michel.startswith("Mi:"):
                michel_number = michel.strip()

        yvert = info.get("yvert") or info.get("yvert & tellier") or info.get("catalog codes", "")
        yvert_number = None
        if yvert:
            yvert_match = re.search(r"Yt:([A-Za-z0-9\s#\-+]+)(,|$)", yvert)
            if yvert_match:
                yvert_number = yvert_match.group(1).strip()
            elif not yvert.startswith("Yt:"):
                yvert_number = yvert.strip()

        # Extraer año
        year_val = info.get("issue date") or info.get("fecha de emisión") or info.get("year")
        year = None
        if year_val:
            year_match = re.search(r"\b(18\d{2}|19\d{2}|20\d{2})\b", year_val)
            if year_match:
                year = int(year_match.group(1))

        # Nombre y descripción
        name_es = soup.title.string.split("-")[0].strip() if soup.title else "Sin Título"
        desc_el = soup.select_one(".item_description, .description")
        description = desc_el.get_text().strip() if desc_el else None

        # Denominación
        denom_val = info.get("face value") or info.get("valor facial")
        denomination = None
        currency = None
        if denom_val:
            denom_match = re.match(r"^([\d.,]+)", denom_val)
            if denom_match:
                denomination = float(denom_match.group(1).replace(",", "."))
            parts = denom_val.split("-")
            if len(parts) > 1:
                currency = parts[1].strip()

        return {
            "scottNumber": scott_number,
            "michelNumber": michel_number,
            "yvertNumber": yvert_number,
            "color": info.get("color") or info.get("colours") or info.get("colores"),
            "perforation": info.get("perforación") or info.get("perforation") or info.get("perf."),
            "printTechnique": info.get("técnica de impresión") or info.get("printing technique"),
            "paperType": info.get("papel") or info.get("paper"),
            "printer": info.get("imprenta") or info.get("printer"),
            "designer": info.get("diseñador") or info.get("designer"),
            "printRun": clean_int(info.get("tirada") or info.get("print run")),
            "conditionMintUsd": clean_float(info.get("nuevo (sin fijasellos)") or info.get("mint")),
            "conditionUsedUsd": clean_float(info.get("usado") or info.get("used")),
            "theme": info.get("tema") or info.get("topic") or info.get("subject"),
            "imageUrl": image_url,
            "imageBackUrl": image_back_url,
            "descriptionEs": description,
            "denomination": denomination,
            "currency": currency,
            "year": year,
            "nameEs": name_es,
            "nameEn": name_es,
            "sourceUrl": url
        }
    except Exception as e:
        print(f"Error parseando detalle: {e}")
        return None

# Orquestador del Enjambre
async def main():
    init_local_db()
    
    url_queue = asyncio.Queue()
    d1_queue = asyncio.Queue()
    
    # Cargar URLs pendientes desde SQLite local a la cola en memoria
    conn = sqlite3.connect(LOCAL_DB)
    cursor = conn.cursor()
    cursor.execute("SELECT url FROM queue WHERE status = 'pending'")
    rows = cursor.fetchall()
    for row in rows:
        await url_queue.put(row[0])
    conn.close()
    
    if url_queue.empty():
        print("ℹ️ La cola está vacía. Carga URLs en la base de datos sqlite local.")
        return
        
    print(f"🐝 Enjambre listo. Procesando {url_queue.qsize()} URLs...")
    
    # Lanzar el flusher D1 en segundo plano
    flusher_task = asyncio.create_task(d1_batch_flusher(d1_queue))
    
    # Configuración de proxy para el lanzamiento
    browser_args = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
    }
    if USE_PROXY:
        browser_args["proxy"] = {
            "server": PROXY_BASE,
            "username": f"{PROXY_USER}__sessid.{PROXY_SESSION}",
            "password": PROXY_PASS
        }

    async with async_playwright() as playwright:
        browsers = []
        workers = []
        worker_id = 0
        
        # Inicializar instancias de navegadores
        for i in range(NUM_BROWSERS):
            browser = await playwright.chromium.launch(**browser_args)
            browsers.append(browser)
            
            # Crear contextos/trabajadores dentro de cada instancia
            for _ in range(CONTEXTS_PER_BROWSER):
                workers.append(asyncio.create_task(
                    crawler_worker(worker_id, browser, url_queue, d1_queue)
                ))
                worker_id += 1
                
        # Espera que la cola termine de consumirse
        await url_queue.join()
        await d1_queue.join()
        
        # Cancelar flusher y cerrar navegadores
        flusher_task.cancel()
        for b in browsers:
            await b.close()

if __name__ == "__main__":
    asyncio.run(main())
