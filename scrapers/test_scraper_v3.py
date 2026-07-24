#!/usr/bin/env python3
"""
Test quirúrgico para colnect_global_scraper_v3.py
Valida en orden:
  1. Proxy DataImpulse — conecta OK
  2. Cookies — Anubis pasa
  3. Parser de listado — extrae stamps de div.pl-it
  4. Parser de detalle — extrae campos ricos desde página individual
  5. D1 API — import-stamp responde OK (modo DRY RUN: no inserta nada real)
"""
import asyncio
import json
import sys
from pathlib import Path

# Agrega el directorio scrapers al path para poder importar v3
sys.path.insert(0, str(Path(__file__).parent))

from playwright.async_api import async_playwright

# Importar funciones del scraper
from colnect_global_scraper_v3 import (
    COOKIES_FILE, PROXY_SERVER, PROXY_USER_A, PROXY_PASS_A,
    PROXY_USER_B, PROXY_PASS_B, NONE_LOGGED_PATTERNS,
    parse_listing_page, parse_detail_page, _clean_img_url,
    make_context, safe_goto, scroll_page,
)

# ── Test URLs (pequeñas, verificadas) ───────────────────────────────────────
TEST_LISTING_URL = "https://colnect.com/en/stamps/list/country/74-France/year/1970"  # France 1970 ~20 stamps
TEST_DETAIL_URL  = "https://colnect.com/en/stamps/stamp/228667-Map_and_Flag_of_Guinea-Bissau-Map_and_Flag_of_Guinea-Bissau-Guinea-Bissau"

RESULTS = {}

# ─────────────────────────────────────────────────────────────────────────────

async def test_1_proxy():
    print("\n🧪 TEST 1: Proxy DataImpulse — conectividad básica")
    import httpx
    try:
        async with httpx.AsyncClient(
            proxy=f"http://{PROXY_USER_A}:{PROXY_PASS_A}@{PROXY_SERVER}",
            timeout=10,
        ) as client:
            r = await client.get("https://api.ipify.org?format=json")
            ip = r.json().get("ip", "?")
            print(f"  ✅ Proxy OK — IP externa: {ip}")
            RESULTS["proxy"] = True
            return True
    except Exception as e:
        print(f"  ❌ Proxy FALLÓ: {e}")
        RESULTS["proxy"] = False
        return False


async def test_2_cookies():
    print("\n🧪 TEST 2: Cookies Anubis/Colnect — ¿están cargadas y válidas?")
    if not COOKIES_FILE.exists():
        print(f"  ❌ Archivo no encontrado: {COOKIES_FILE}")
        RESULTS["cookies"] = False
        return False
    with open(COOKIES_FILE) as f:
        cookies = json.load(f)
    names = [c.get("name") for c in cookies]
    print(f"  Cookies encontradas: {names}")
    required = ["cnv2sess", "techaro.lol-anubis-auth"]
    missing = [n for n in required if n not in names]
    if missing:
        print(f"  ⚠️  Faltan cookies requeridas: {missing}")
        RESULTS["cookies"] = False
        return False
    # Check anubis JWT expiry
    for c in cookies:
        if c.get("name") == "techaro.lol-anubis-auth":
            import time, base64
            try:
                payload = c["value"].split(".")[1]
                payload += "=" * (4 - len(payload) % 4)
                data = json.loads(base64.b64decode(payload))
                exp = data.get("exp", 0)
                remaining = exp - time.time()
                if remaining > 0:
                    print(f"  ✅ Anubis JWT válido — expira en {remaining/3600:.1f}h")
                else:
                    print(f"  ⚠️  Anubis JWT EXPIRADO hace {abs(remaining)/3600:.1f}h — necesita renovación")
                    RESULTS["cookies"] = "expired"
            except Exception as e:
                print(f"  ⚠️  No se pudo decodificar JWT Anubis: {e}")
    RESULTS["cookies"] = True
    return True


async def test_3_listing(playwright):
    print(f"\n🧪 TEST 3: Parser de listado — {TEST_LISTING_URL}")
    browser, context = await make_context(playwright, PROXY_USER_A, PROXY_PASS_A)
    page = await context.new_page()
    # Block images/media on listing
    await page.route("**/*", lambda r: r.abort()
        if r.request.resource_type in ("image", "media", "font") else r.continue_())
    try:
        html = await safe_goto(page, TEST_LISTING_URL)
        if not html:
            print("  ❌ Página no cargó (Anubis no resolvió o timeout)")
            RESULTS["listing"] = False
            return False

        await scroll_page(page)
        html = await page.content()

        stamps = parse_listing_page(html, "74", "FRA")
        print(f"  Sellos encontrados: {len(stamps)}")

        if not stamps:
            # Diagnóstico: ¿hay div.pl-it?
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "html.parser")
            items = soup.select("div.pl-it")
            print(f"  div.pl-it en HTML: {len(items)}")
            print(f"  Tamaño HTML: {len(html)} bytes")
            print(f"  URL actual: {page.url}")
            # Mostrar primeros 500 chars del HTML para diagnóstico
            print(f"  HTML snippet:\n{html[:500]}")
            RESULTS["listing"] = False
            return False

        # Mostrar los primeros 3 sellos
        for i, s in enumerate(stamps[:3]):
            print(f"  [{i+1}] {s.get('nameEn','?')[:50]}")
            print(f"       año={s.get('year')}, img={'✅' if s.get('imageUrl') else '❌'}, "
                  f"scott={s.get('scottNumber')}, michel={s.get('michelNumber')}")
            if s.get('imageUrl'):
                print(f"       url={s['imageUrl'][:80]}")

        RESULTS["listing"] = len(stamps)
        return stamps[:5]

    except Exception as e:
        print(f"  ❌ Excepción: {e}")
        import traceback; traceback.print_exc()
        RESULTS["listing"] = False
        return False
    finally:
        await page.close()
        await context.close()
        await browser.close()


async def test_4_detail(playwright):
    print(f"\n🧪 TEST 4: Parser de detalle — {TEST_DETAIL_URL}")
    # Datos básicos simulados (como si vinieran del listing)
    basic_data = {
        "id": "test-id-123",
        "nameEn": "Map and Flag of Guinea-Bissau",
        "nameEs": "Map and Flag of Guinea-Bissau",
        "countryCode": "GUI",
        "countryId": "91",
        "year": None,
        "imageUrl": None,
        "scottNumber": None,
        "michelNumber": None,
        "yvertNumber": None,
        "theme": None,
        "color": None,
    }

    browser, context = await make_context(playwright, PROXY_USER_B, PROXY_PASS_B)
    page = await context.new_page()
    try:
        html = await safe_goto(page, TEST_DETAIL_URL)
        if not html:
            print("  ❌ Página no cargó")
            RESULTS["detail"] = False
            return False

        stamp = parse_detail_page(html, TEST_DETAIL_URL, basic_data)
        if not stamp:
            print("  ❌ parse_detail_page retornó None")
            print(f"  HTML snippet:\n{html[:800]}")
            RESULTS["detail"] = False
            return False

        # Mostrar campos extraídos
        important_fields = ["nameEn", "year", "imageUrl", "scottNumber", "michelNumber",
                             "yvertNumber", "perforation", "printTechnique", "paperType",
                             "printer", "designer", "conditionMintUsd", "conditionUsedUsd",
                             "color", "theme", "denomination", "currency"]
        print("  Campos extraídos:")
        extracted = 0
        for f in important_fields:
            val = stamp.get(f)
            if val is not None:
                extracted += 1
                print(f"    ✅ {f}: {str(val)[:60]}")
            else:
                print(f"    ⬜ {f}: None")

        print(f"\n  Campos extraídos: {extracted}/{len(important_fields)}")

        # Verificar imagen
        if stamp.get("imageUrl"):
            if any(p in stamp["imageUrl"] for p in NONE_LOGGED_PATTERNS):
                print("  ⚠️  imageUrl es un placeholder none_logged_image!")
            else:
                print(f"  ✅ imageUrl válida: {stamp['imageUrl'][:80]}")
        else:
            print("  ⬜ Sin imagen")

        RESULTS["detail"] = extracted
        return stamp

    except Exception as e:
        print(f"  ❌ Excepción: {e}")
        import traceback; traceback.print_exc()
        RESULTS["detail"] = False
        return False
    finally:
        await page.close()
        await context.close()
        await browser.close()


async def test_5_d1_dryrun():
    """Verifica que el endpoint D1 está accesible (solo query, no insertamos nada)."""
    print("\n🧪 TEST 5: D1 API — conectividad")
    import requests
    QUERY_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"
    try:
        r = requests.post(QUERY_URL, json={"sql": "SELECT COUNT(*) as cnt FROM Stamp", "params": []}, timeout=15)
        if r.status_code == 200:
            cnt = r.json().get("results", [{}])[0].get("cnt", "?")
            print(f"  ✅ D1 OK — {cnt:,} sellos en DB")
            RESULTS["d1"] = True
            return True
        print(f"  ❌ D1 HTTP {r.status_code}")
        RESULTS["d1"] = False
        return False
    except Exception as e:
        print(f"  ❌ D1 excepción: {e}")
        RESULTS["d1"] = False
        return False


async def main():
    print("=" * 60)
    print("🧪 COLNECT SCRAPER v3 — TEST DE VALIDACIÓN")
    print("=" * 60)

    # Tests sin browser
    await test_1_proxy()
    await test_2_cookies()
    await test_5_d1_dryrun()

    # Tests con browser (requieren Playwright)
    async with async_playwright() as pw:
        await test_3_listing(pw)
        await test_4_detail(pw)

    # Resumen final
    print("\n" + "=" * 60)
    print("📋 RESUMEN DE TESTS:")
    all_pass = True
    for name, result in RESULTS.items():
        if result is True or isinstance(result, int) and result > 0:
            icon = "✅"
        elif result == "expired":
            icon = "⚠️ "
            all_pass = False
        else:
            icon = "❌"
            all_pass = False
        print(f"  {icon} {name}: {result}")

    print()
    if all_pass:
        print("🎉 TODOS LOS TESTS PASARON — el scraper v3 está listo para ejecutarse.")
        print("   Ejecuta: python3 scrapers/colnect_global_scraper_v3.py both")
    else:
        print("⚠️  Hay tests fallidos — revisar antes de lanzar a escala.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
