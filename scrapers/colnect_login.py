import asyncio
import os
import json
import sys
from playwright.async_api import async_playwright

from scraper_env import require_env

async def run_login():
    # Pedir credenciales por consola de forma segura
    username = input("👤 Ingresá tu usuario o email de Colnect: ").strip()
    password = input("🔑 Ingresá tu contraseña de Colnect: ").strip()
    
    if not username or not password:
        print("❌ El usuario y la contraseña son requeridos.")
        return

    browser_args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"]
    proxy_config = {
        "server": f"http://{require_env('DATAIMPULSE_HOST', 'DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)')}",
        "username": require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)"),
        "password": require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
    }

    print("\n🌐 Iniciando navegador con Proxy Premium...")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=browser_args, proxy=proxy_config)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport={"width": 1280, "height": 720},
            locale="en-US",
            timezone_id="America/New_York"
        )
        page = await context.new_page()

        print("Navegando a la página de login...")
        await page.goto("https://colnect.com/en/account/login", wait_until="domcontentloaded", timeout=60000)
        
        # Espera de cortesía para Anubis
        await asyncio.sleep(5)
        
        print("Completando formulario...")
        await page.fill("#signin_username", username)
        await page.fill("#signin_password", password)
        
        print("Enviando formulario...")
        await page.click("#signin_btn")
        
        # Esperamos que procese la redirección después de loguear
        print("Esperando redirección de sesión...")
        await asyncio.sleep(8)
        
        # Verificar si logueamos exitosamente (buscando cookie de sesión)
        cookies = await context.cookies()
        logged_in = any(c['name'] == 'c_member' for c in cookies)
        
        if logged_in:
            with open("colnect_cookies.json", "w") as f:
                json.dump(cookies, f, indent=2)
            print("🎉 ¡Login exitoso! Las cookies se guardaron en 'colnect_cookies.json'.")
        else:
            print("❌ Error: No se pudo verificar la sesión. Revisá si tus credenciales son correctas.")
            
        await browser.close()

if __name__ == "__main__":
    try:
        asyncio.run(run_login())
    except KeyboardInterrupt:
        print("\nProceso cancelado.")
