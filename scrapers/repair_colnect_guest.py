import asyncio
import os
import json
import requests
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

from scraper_env import require_env

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"

# Configuración del pool de proxies residenciales
PROXY_CONFIG = {
    "server": f"http://{require_env('DATAIMPULSE_HOST', 'DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)')}",
    "username": require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)"),
    "password": require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
}

# Concurrencia de trabajadores
CONCURRENT_WORKERS = 5

async def fetch_broken_stamps():
    sql = """
        SELECT id, sourceUrl, nameEn 
        FROM Stamp 
        WHERE source = 'colnect' 
          AND (imageUrl LIKE 'data:image%' OR imageUrl IS NULL OR imageUrl LIKE '%none_logged_image%')
          AND sourceUrl LIKE 'https://colnect.com%'
        ORDER BY year DESC
    """
    try:
        res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=30)
        if res.status_code == 200:
            result = res.json()
            if result.get("success"):
                return result.get("results", [])
    except Exception as e:
        print(f"❌ Error consultando estampillas defectuosas: {e}")
    return []

async def update_stamp_image(stamp_id, image_url):
    sql = """
        UPDATE Stamp 
        SET imageUrl = ? 
        WHERE id = ?
    """
    try:
        # Reemplazar /t/ por /b/ si viene como thumbnail para tener la versión grande
        if "/t/" in image_url:
            image_url = image_url.replace("/t/", "/b/")
        elif "/f/" in image_url:
            image_url = image_url.replace("/f/", "/b/")
            
        if not image_url.startswith("http"):
            image_url = "https:" + image_url
            
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(
            None,
            lambda: requests.post(API_URL, json={"sql": sql, "params": [image_url, stamp_id]}, timeout=15)
        )
        if res.status_code == 200:
            return res.json().get("success", False)
    except Exception:
        pass
    return False

async def worker(worker_id, queue):
    browser_args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.launch(
                headless=True, 
                args=browser_args, 
                proxy=PROXY_CONFIG
            )
            # Contexto limpio como Guest
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 720}
            )
            await context.add_init_script("delete navigator.__proto__.webdriver;")
            page = await context.new_page()
            
            TRACKING_DOMAINS = [
                "googlesyndication.com", 
                "google-analytics.com", 
                "googletagmanager.com", 
                "doubleclick.net"
            ]
            
            async def optimizacion_red(route):
                req = route.request
                url = req.url
                if req.resource_type in ["image", "stylesheet", "font", "media"]:
                    await route.abort()
                    return
                if any(d in url for d in TRACKING_DOMAINS):
                    await route.fulfill(
                        status=200,
                        content_type="application/javascript",
                        body="console.log('Tracker neutralizado');"
                    )
                    return
                await route.continue_()
                
            await page.route("**/*", optimizacion_red)
        except Exception as e:
            print(f"❌ Worker {worker_id} falló al iniciar navegador: {e}")
            return

        print(f"🚀 Worker {worker_id} listo y procesando...")
        
        while not queue.empty():
            stamp = await queue.get()
            stamp_id = stamp.get("id")
            source_url = stamp.get("sourceUrl")
            name = stamp.get("nameEn")
            
            print(f"🌐 Worker {worker_id} -> Procesando: {name} ({source_url})")
            
            try:
                # Navegar a la página de detalle
                response = await page.goto(source_url, wait_until="domcontentloaded", timeout=40000)
                
                # Esperar 8 segundos para resolver el reto Anubis de Cloudflare
                await asyncio.sleep(8.5)
                
                html = await page.content()
                status_code = response.status if response else 0
                
                print(f"  [DEBUG Worker {worker_id}] Status: {status_code}, HTML len: {len(html)}")
                
                if status_code != 200 or len(html) < 2000:
                    print(f"  ❌ Worker {worker_id} -> Bloqueo/Error detectado (Status: {status_code}, HTML: {len(html)}). Reencolando...")
                    await queue.put(stamp)
                    queue.task_done()
                    await asyncio.sleep(4.0)
                    continue
                
                soup = BeautifulSoup(html, "html.parser")
                
                # Buscar la imagen real del sello en la página de detalle
                real_img_url = None
                for img in soup.find_all("img"):
                    src = img.get("src") or img.get("data-src")
                    if src and "i.colnect.net" in src and "none_logged_image" not in src:
                        # Filtrar banderas, logos o imágenes genéricas
                        if any(p in src for p in ["/f/", "/b/", "/t/"]) and not "/flags/" in src and not "/images/" in src:
                            real_img_url = src
                            break
                
                if real_img_url:
                    success = await update_stamp_image(stamp_id, real_img_url)
                    if success:
                        print(f"  ✅ Worker {worker_id} -> REPARADO: '{name}' -> {real_img_url}")
                    else:
                        print(f"  ⚠️ Worker {worker_id} -> Error actualizando D1 para: '{name}'")
                else:
                    # Si no encontramos la imagen, podría ser que no tiene o que nos bloqueó
                    title = soup.title.string if soup.title else ""
                    if "Anubis" in title or "PoW" in title or soup.find(string="Anubis"):
                        print(f"  ❌ Worker {worker_id} -> Bloqueo Anubis detectado, reencolando...")
                        await queue.put(stamp)
                    else:
                        print(f"  ℹ️ Worker {worker_id} -> No se encontró imagen real en detalle para: '{name}'")
                        
            except Exception as e:
                print(f"  ⚠️ Worker {worker_id} -> Error procesando estampilla: {e}")
                # En caso de timeout o caída de red, la devolvemos a la cola para reintento
                await queue.put(stamp)
                
            queue.task_done()
            
            # Delay de cortesía con jitter gaussiano por IP
            import random
            delay = max(0.5, random.gauss(2.0, 0.5))
            await asyncio.sleep(delay)
            
        await browser.close()

async def main():
    print("=========================================================")
    print("🚀 Iniciando Pipeline de Reparación Guest sin Cuentas")
    print("=========================================================")
    
    stamps = await fetch_broken_stamps()
    if not stamps:
        print("✅ No hay estampillas rotas por reparar.")
        return
        
    print(f"📦 Encontradas {len(stamps)} estampillas con imágenes defectuosas.")
    
    queue = asyncio.Queue()
    for s in stamps:
        await queue.put(s)
        
    # Lanzar los workers concurrentes
    workers = [worker(i, queue) for i in range(CONCURRENT_WORKERS)]
    await asyncio.gather(*workers)
    
    print("✨ Proceso terminado.")

if __name__ == "__main__":
    asyncio.run(main())
