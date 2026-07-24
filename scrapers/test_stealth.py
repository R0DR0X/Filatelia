import asyncio
import os
import json
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

TEST_URL = "https://colnect.com/en/stamps/stamp/1395426-T-34_Tank-Battle_of_Stalingrad_2023-Guinea"
PROXY_CONFIG = {
    "server": "http://gw.dataimpulse.com:823",
    "username": "bafe165ec82f735291ea",
    "password": "cba7f2ea0d940de4"
}

STEALTH_JS = """
// Evasión de WebDriver
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

// Mock de Chrome Runtime
window.chrome = {
    runtime: {},
    loadTimes: function() {},
    csi: function() {},
    app: {}
};

// Idiomas y Plataforma
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

// Plugins falsos (típicos de navegadores reales)
Object.defineProperty(navigator, 'plugins', {
    get: () => [
        { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' }
    ]
});

// Evasión de WebGL (para evitar fingerprinting básico de hardware de VM)
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(parameter) {
    // UNMASKED_VENDOR_WEBGL
    if (parameter === 37445) return 'Google Inc. (Intel)';
    // UNMASKED_RENDERER_WEBGL
    if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
    return getParameter(parameter);
};
"""

async def run_test(use_proxy, test_name):
    print(f"\n🚀 Iniciando Prueba: {test_name} (Proxy: {use_proxy})")
    async with async_playwright() as playwright:
        browser_args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
        
        launch_kwargs = {"args": browser_args, "headless": True}
        if use_proxy:
            launch_kwargs["proxy"] = PROXY_CONFIG
            
        browser = await playwright.chromium.launch(**launch_kwargs)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720}
        )
        
        # Inyectar script de stealth completo
        await context.add_init_script(STEALTH_JS)
        
        page = await context.new_page()
        
        # Bloquear trackers molestos
        TRACKING_DOMAINS = ["googlesyndication.com", "google-analytics.com", "googletagmanager.com", "doubleclick.net"]
        async def interceptor(route):
            url = route.request.url
            if any(d in url for d in TRACKING_DOMAINS):
                await route.fulfill(status=200, body="console.log('mock');")
            else:
                await route.continue_()
        await page.route("**/*", interceptor)
        
        print(f"🌐 Navegando a {TEST_URL}...")
        try:
            response = await page.goto(TEST_URL, wait_until="domcontentloaded", timeout=45000)
            
            # Esperar a que la página se estabilice
            for _ in range(15):
                if "pass-challenge" in page.url or "anubis" in page.url:
                    await asyncio.sleep(1.0)
                else:
                    break
            await asyncio.sleep(5.0)
            
            html = await page.content()
            soup = BeautifulSoup(html, "html.parser")
            
            found = False
            for img in soup.find_all("img"):
                src = img.get("src") or img.get("data-src")
                if src and "i.colnect.net" in src:
                    print(f"  📷 [{test_name}] Img src encontrada: {src}")
                    found = True
            
            if not found:
                print(f"  ❌ [{test_name}] No se encontraron imágenes de i.colnect.net en el DOM.")
                
        except Exception as e:
            print(f"  ❌ [{test_name}] Error navegando: {e}")
            
        await browser.close()

async def main():
    # 1. Prueba 1: Con Proxy y Stealth
    await run_test(use_proxy=True, test_name="CON PROXY + STEALTH")
    
    # 2. Prueba 2: Sin Proxy (IP local VPS) y Stealth
    await run_test(use_proxy=False, test_name="SIN PROXY (IP LOCAL VPS) + STEALTH")

if __name__ == "__main__":
    asyncio.run(main())
