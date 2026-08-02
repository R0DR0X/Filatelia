import asyncio
import re
import requests
import httpx

from scraper_env import require_env

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"

def get_stamp_id_from_url(source_url: str) -> int | None:
    m = re.search(r"/stamp/(\d+)-", source_url)
    return int(m.group(1)) if m else None

def parse_cdn_path(image_url: str):
    m = re.search(r"/([bf])/(\d+)/(\d+)/", image_url)
    if m:
        return m.group(1), int(m.group(2)), int(m.group(3))
    return None, None, None

async def main():
    # Fail fast on missing credentials before any network activity.
    dataimpulse_user = require_env("DATAIMPULSE_USER", "DataImpulse proxy username (dashboard.dataimpulse.com)")
    dataimpulse_pass = require_env("DATAIMPULSE_PASS", "DataImpulse proxy password (dashboard.dataimpulse.com)")
    dataimpulse_host = require_env("DATAIMPULSE_HOST", "DataImpulse proxy gateway host:port (dashboard.dataimpulse.com)")

    # Let's test a stamp we know exists and should have neighbors.
    # Japan 224556
    source_url = "https://colnect.com/en/stamps/stamp/224556-Completion_of_Ozaki_Memorial_Hall-Japan"
    target_id = get_stamp_id_from_url(source_url)
    print("Target ID:", target_id)
    
    parts = source_url.split("/stamp/")[-1].split("-")
    country = parts[-1]
    print("Country:", country)
    
    # Query neighbours
    sql = f"""
        SELECT sourceUrl, imageUrl FROM Stamp
        WHERE source = 'colnect'
          AND sourceUrl LIKE '%-{country}'
          AND (imageUrl LIKE '%i.colnect.net/b/%' OR imageUrl LIKE '%i.colnect.net/f/%')
          AND imageUrl NOT LIKE '%none_logged_image%'
          AND imageUrl NOT LIKE '%none-stamps%'
        LIMIT 1000
    """
    res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=20)
    neighbours = res.json().get("results", [])
    print(f"Neighbours count: {len(neighbours)}")
    
    id_to_cdn = {}
    for n in neighbours:
        nid = get_stamp_id_from_url(n.get("sourceUrl", ""))
        ctype, folder, idx = parse_cdn_path(n.get("imageUrl", ""))
        if nid and ctype and folder and idx:
            id_to_cdn[nid] = (ctype, folder, idx)
            
    if not id_to_cdn:
        print("No id_to_cdn map buildable.")
        return
        
    sorted_ids = sorted(id_to_cdn.keys(), key=lambda x: abs(x - target_id))
    closest_ids = sorted_ids[:5]
    
    print("Closest IDs and CDN paths:")
    for nid in closest_ids:
        print(f"  ID: {nid}, CDN: {id_to_cdn[nid]}, Diff: {target_id - nid}")
        
    # Generate candidates
    candidates = set()
    for nid in closest_ids:
        ctype, folder, idx = id_to_cdn[nid]
        id_diff = target_id - nid
        base_idx = idx + id_diff
        for d in range(-15, 16):
            cand_idx = base_idx + d
            if cand_idx > 0:
                candidates.add((ctype, folder, cand_idx))
                
    print("Generated candidates count:", len(candidates))
    
    name_slug = "image"
    if len(parts) >= 3:
        name_slug = parts[1].replace("_", "-").replace(" ", "-")
    print("Generated slug:", name_slug)
    
    proxy_url = f"http://{dataimpulse_user}:{dataimpulse_pass}@{dataimpulse_host}"
    semaphore = asyncio.Semaphore(8) # Limit to 8 concurrent requests
    
    async def check_url(ctype, folder, idx, client):
        url = f"https://i.colnect.net/{ctype}/{folder}/{idx}/{name_slug}.jpg"
        async with semaphore:
            try:
                # Use streaming GET request to check headers without downloading content
                async with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5.0) as r:
                    print(f"  CHECK {url} -> {r.status_code}")
                    if r.status_code == 200:
                        return url
            except Exception as e:
                print(f"  ERROR {url} -> {e}")
            return None
        
    async with httpx.AsyncClient(proxy=proxy_url, timeout=6.0, follow_redirects=True) as client:
        tasks = [check_url(ctype, folder, idx, client) for ctype, folder, idx in list(candidates)]
        results = await asyncio.gather(*tasks)
        valid = [r for r in results if r is not None]
        print("Valid results:", valid)

if __name__ == '__main__':
    asyncio.run(main())
