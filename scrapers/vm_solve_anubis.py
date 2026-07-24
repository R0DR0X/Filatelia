#!/usr/bin/env python3
"""
Colnect Anubis Challenge Solver & Autologin for VM
==================================================
Runs a headless Chromium browser, navigates to Colnect, bypasses the
Anubis proof-of-work JS challenge, performs an autologin with credentials,
and saves the resulting session cookies for a given session ID.
"""

import asyncio
import json
import os
import sys
import time
from playwright.async_api import async_playwright

TARGET_URL  = "https://colnect.com/en/stamps"
MAX_WAIT_S  = 120

# Member Credentials
MEMBER_USER = "sinnombre31415@gmail.com"
MEMBER_PASS = "a3GRQ2HSyKsM7EjkT16pnUFXm5Bgcd"

async def solve_for_session(sessid, output_path):
    proxy_config = {
        "server":   "http://gw.dataimpulse.com:823",
        "username": f"bafe165ec82f735291ea__sessid.{sessid}",
        "password": "cba7f2ea0d940de4"
    }
    
    print(f"\n==================================================")
    print(f"🔑 Solving & Logging in for session: {sessid}")
    print(f"   Output: {output_path}")
    print(f"==================================================")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
            proxy=proxy_config,
        )
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 720},
            locale="en-US",
        )
        await context.add_init_script("delete navigator.__proto__.webdriver;")

        page = await context.new_page()

        print(f"🌐 Navigating to {TARGET_URL} via proxy to trigger Anubis...")
        try:
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print(f"⚠️ Initial navigation warning: {e}")

        # Poll until Anubis challenge is resolved
        print("⏳ Waiting for Anubis challenge to resolve...")
        resolved = False
        for i in range(MAX_WAIT_S):
            cookies = await context.cookies()
            anubis_auth = next((c for c in cookies if c["name"] == "techaro.lol-anubis-auth"), None)
            anubis_ver  = next((c for c in cookies if c["name"] == "techaro.lol-anubis-cookie-verification"), None)

            if anubis_auth and anubis_ver:
                print(f"✅ Challenge resolved after ~{i}s!")
                resolved = True
                break

            await asyncio.sleep(1)

        if not resolved:
            print("❌ Timed out waiting for Anubis challenge.")
            await browser.close()
            return False

        # Now go to Login Page
        login_url = "https://colnect.com/en/account/login"
        print(f"🌐 Navigating to Login: {login_url}")
        try:
            await page.goto(login_url, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(5)
        except Exception as e:
            print(f"❌ Navigation to login failed: {e}")
            await browser.close()
            return False

        print("👤 Filling credentials form...")
        await page.fill("#signin_username", MEMBER_USER)
        await page.fill("#signin_password", MEMBER_PASS)
        
        print("🔑 Submitting login form...")
        await page.click("#signin_btn")
        
        print("⏳ Waiting for login redirection...")
        await asyncio.sleep(12)

        # Check if we logged in via cnv2user2 cookie
        all_cookies = await context.cookies()
        logged_in = any(c['name'] == 'cnv2user2' for c in all_cookies)
        
        if logged_in:
            print("🎉 Login successful! Member session (cnv2user2) detected.")
        else:
            print("❌ Error: Login could not be verified.")
            await browser.close()
            return False

        # Extend expiry of Anubis cookies (+7 days from now)
        future_expiry = int(time.time()) + (7 * 24 * 3600)
        for c in all_cookies:
            if "anubis" in c["name"]:
                c["expires"] = float(future_expiry)

        # Save cookies
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(all_cookies, f, indent=2, ensure_ascii=False)

        print(f"💾 Saved {len(all_cookies)} cookies → {output_path}")

        # Verify details loading on a stamp page
        test_stamp_url = "https://colnect.com/en/stamps/stamp/437923-Lama_Lama_glama_and_Flutist-Air_Mail_Stamps_of_1937_Country_Motives-Peru"
        print(f"🔍 Verifying details extraction on: {test_stamp_url.split('/')[-1]}")
        try:
            await page.goto(test_stamp_url, wait_until="load", timeout=60000)
            await asyncio.sleep(5)
            html = await page.content()
            if "Login to see complete" not in html and "perforation" in html.lower():
                print("✅ Access to full details confirmed!")
            else:
                print("⚠️ Metadata is still obscured. Please inspect manual logs.")
        except Exception as e:
            print(f"⚠️ Verification page navigation failed: {e}")

        await browser.close()
        return True

async def main():
    # If arguments are passed, solve for specific session
    if len(sys.argv) >= 3:
        sessid = sys.argv[1]
        out_path = sys.argv[2]
        ok = await solve_for_session(sessid, out_path)
        sys.exit(0 if ok else 1)
    else:
        # Solve for both default sessions
        ok1 = await solve_for_session("crawler_session_vm", "scrapers/colnect_cookies_crawler.json")
        ok2 = await solve_for_session("images_session_vm", "scrapers/colnect_cookies_images.json")
        sys.exit(0 if (ok1 and ok2) else 1)

if __name__ == "__main__":
    asyncio.run(main())
