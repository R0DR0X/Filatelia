#!/usr/bin/env python3
"""
Colnect CDN Pattern Image Resolver (v4 — Full Memory Map)  [DEPRECATED]
=======================================================================
DEPRECATED — do not use for image recovery. This script never reads an image
URL: it guesses one, interpolating a CDN (folder, index) from stamps whose
Colnect id happens to be numerically close, then brute-forcing candidate URLs
until one returns 200. Stamps with no close neighbour have nothing to
interpolate from, so the approach is exhausted by construction — its last
production run recovered 4 images out of ~3,400. The supported path is now
`scrapers/enqueue_missing_images.py` followed by
`python3 scrapers/colnect_global_scraper_v3.py detail`, which reads the real
image URL out of the stamp detail page.

Precarga TODOS los sellos de Colnect con imagen en memoria RAM
como un mapa {colnect_id → (folder, idx)}, permitiendo búsqueda
O(log n) del vecino más cercano por proximidad numérica de ID,
sin importar el país.

Esto resuelve el problema de GUI/SIE/PE que tienen IDs de Colnect
muy dispersos y sin vecinos próximos dentro del mismo país.
"""

import asyncio
import bisect
import httpx
import os
import requests
import re
import sys
import time

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Referer": "https://colnect.com/"
}

# --- DataImpulse residential proxy (colnect.net/colnect.com block Google Cloud IPs) ---
# Reuses the same DataImpulse gateway pattern as scrapers/image_resolver.py and
# scrapers/colnect_swarm_crawler.py, overridable via env vars (no env-var loading
# mechanism existed anywhere in scrapers/ prior to this change; the defaults below
# match the credentials already hardcoded in the sibling scripts).
DATAIMPULSE_USER = os.environ.get("DATAIMPULSE_USER", "ce2dd5be999d7e7e9a05")
DATAIMPULSE_PASS = os.environ.get("DATAIMPULSE_PASS", "b93d4b8e9a554c41")
DATAIMPULSE_HOST = os.environ.get("DATAIMPULSE_HOST", "gw.dataimpulse.com:823")
PROXY_SESSION_ID = "fix_colnect_pattern_urls"
PROXY_URL = f"http://{DATAIMPULSE_USER}__sessid.{PROXY_SESSION_ID}:{DATAIMPULSE_PASS}@{DATAIMPULSE_HOST}"

# ─── Helpers ─────────────────────────────────────────────────────────────────

def extract_colnect_id(url):
    m = re.search(r"/stamp/(\d+)-", url or "")
    return int(m.group(1)) if m else None

def parse_cdn(url):
    m = re.search(r"/b/(\d+)/(\d+)/", url or "")
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None

# ─── Global Map Builder ───────────────────────────────────────────────────────

def build_global_id_map():
    """
    Carga TODOS los sellos de Colnect que tienen imagen CDN en un dict
    {colnect_id: (folder, idx)}.  También devuelve la lista ordenada de IDs
    para búsqueda binaria (bisect).
    """
    print("🗺️  Cargando mapa global de IDs Colnect → CDN...", flush=True)
    all_data = {}
    offset = 0
    page_size = 2000
    max_pages = 50  # hard cap para evitar loops infinitos
    page_count = 0
    while page_count < max_pages:
        sql = f"""
            SELECT sourceUrl, imageUrl FROM Stamp
            WHERE imageUrl LIKE '%i.colnect.net/b/%'
              AND source = 'colnect'
            LIMIT {page_size} OFFSET {offset}
        """
        try:
            res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=20)
            rows = res.json().get("results", []) if res.ok else []
        except Exception as e:
            print(f"\n  ⚠️  Error al cargar página {page_count}: {e}", flush=True)
            break
        if not rows:
            break
        for row in rows:
            cid = extract_colnect_id(row.get("sourceUrl"))
            folder, idx = parse_cdn(row.get("imageUrl"))
            if cid and folder and idx:
                all_data[cid] = (folder, idx)
        offset += page_size
        page_count += 1
        print(f"  Cargados {len(all_data):,} sellos (pág {page_count})...", flush=True)
        if len(rows) < page_size:
            break

    sorted_ids = sorted(all_data.keys())
    print(f"  ✅ Mapa global listo: {len(all_data):,} sellos con imagen indexados.", flush=True)
    return all_data, sorted_ids


# ─── Core Resolver ────────────────────────────────────────────────────────────

def find_top_neighbors(target_id, sorted_ids, id_map, n=5, max_diff=1500):
    """Usa búsqueda binaria para encontrar los N vecinos más cercanos."""
    pos = bisect.bisect_left(sorted_ids, target_id)
    candidates = []
    for delta in range(-n * 3, n * 3 + 1):
        idx = pos + delta
        if 0 <= idx < len(sorted_ids):
            cid = sorted_ids[idx]
            diff = abs(cid - target_id)
            if diff <= max_diff and cid != target_id:
                candidates.append((diff, cid))
    candidates.sort()
    return [(cid, id_map[cid]) for _, cid in candidates[:n]]


async def resolve_stamp(stamp, id_map, sorted_ids, client):
    target_id = extract_colnect_id(stamp.get("sourceUrl"))
    if not target_id:
        return None

    neighbors = find_top_neighbors(target_id, sorted_ids, id_map, n=6, max_diff=1500)
    if not neighbors:
        return None

    for neighbor_id, (folder, base_idx) in neighbors:
        diff = target_id - neighbor_id
        predicted_idx = base_idx + diff

        # Rango adaptativo según la distancia al vecino
        abs_diff = abs(diff)
        if abs_diff <= 10:
            search_range = 5
        elif abs_diff <= 50:
            search_range = 8
        elif abs_diff <= 200:
            search_range = 12
        else:
            search_range = 18

        candidates = [predicted_idx + d for d in range(-search_range, search_range + 1)
                      if predicted_idx + d > 0]

        for cand_idx in candidates:
            url = f"https://i.colnect.net/b/{folder}/{cand_idx}/image.jpg"
            try:
                r = await client.get(url, timeout=6.0)
                if r.status_code == 200 and len(r.content) > 1000:
                    return url
            except Exception:
                pass

    return None


# ─── Batch Processor ──────────────────────────────────────────────────────────

async def process_batch(stamps, id_map, sorted_ids, batch_num):
    resolved = 0
    updates = []

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, proxy=PROXY_URL) as client:
        sem = asyncio.Semaphore(10)

        async def worker(s):
            nonlocal resolved
            async with sem:
                url = await resolve_stamp(s, id_map, sorted_ids, client)
                if url:
                    resolved += 1
                    updates.append((url, s["id"]))
                    name = (s.get("nameEs") or s.get("nameEn") or s["id"])[:45]
                    print(f"  ✅ [{resolved}] {name} ({s.get('countryCode')}) → {url}")

        await asyncio.gather(*[worker(s) for s in stamps])

    if updates:
        print(f"  💾 Guardando {len(updates)} en D1...", flush=True)
        for img_url, stamp_id in updates:
            sql = "UPDATE Stamp SET imageUrl = ? WHERE id = ?"
            requests.post(API_URL, json={"sql": sql, "params": [img_url, stamp_id]}, timeout=30)
        print(f"  ✅ Lote {batch_num} guardado.", flush=True)

    return resolved


# ─── Fetchers ─────────────────────────────────────────────────────────────────

def fetch_null_image_stamps(limit=300):
    sql = f"""
        SELECT id, nameEs, nameEn, countryCode, year, sourceUrl
        FROM Stamp
        WHERE (imageUrl IS NULL OR imageUrl = '' OR imageUrl LIKE '%none_logged_image%' OR imageUrl LIKE '%pass-challenge%')
          AND source = 'colnect'
        LIMIT {limit}
    """
    try:
        res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=30)
        if res.ok:
            data = res.json()
            return data.get("results", [])
    except Exception as e:
        print(f"  ⚠️  Error fetch_null_image_stamps: {e}", flush=True)
    return []


# ─── Main Loop ────────────────────────────────────────────────────────────────

async def main():
    sub_batch_size = 300
    max_empty_batches = 3

    # Precargar mapa global UNA sola vez
    id_map, sorted_ids = build_global_id_map()

    print(f"\n🚀 Iniciando recuperación masiva v4 (lotes de {sub_batch_size})...\n", flush=True)

    total_resolved = 0
    batch_num = 0
    consecutive_zero = 0

    while True:
        stamps = fetch_null_image_stamps(limit=sub_batch_size)
        if not stamps:
            print("\n✨ ¡No quedan sellos de Colnect sin imagen! Proceso completado.", flush=True)
            break

        batch_num += 1
        print(f"\n📦 LOTE {batch_num} — {len(stamps)} sellos...")

        resolved = await process_batch(stamps, id_map, sorted_ids, batch_num)
        total_resolved += resolved

        # Actualizar mapa con los nuevos vecinos resueltos
        # (para mejorar resoluciones futuras de IDs cercanos)
        for s in stamps:
            pass  # Ya fueron procesados, D1 los excluirá en la próxima query

        print(f"  📊 Acumulado: {total_resolved} recuperadas | Lote: {resolved}/{len(stamps)}")

        if resolved == 0:
            consecutive_zero += 1
            print(f"  ⚠️  Sin resoluciones en este lote ({consecutive_zero}/{max_empty_batches}).")
            if consecutive_zero >= max_empty_batches:
                print(f"\n🛑 Límite alcanzado. Los sellos restantes no tienen vecinos CDN en el rango.")
                break
        else:
            consecutive_zero = 0

        time.sleep(1.5)

    print(f"\n🎉 Total recuperado en esta sesión: {total_resolved} imágenes.")

if __name__ == "__main__":
    asyncio.run(main())
