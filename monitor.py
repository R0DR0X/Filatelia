#!/usr/bin/env python3
"""
📊 Monitor Remoto en Vivo para la VM Escorpia (GCP)
===================================================
Muestra en tiempo real desde tu PC la actividad que está ocurriendo en la VM:
1. Motor 1 (Scraper Global v3.1 en VM):
   - Páginas completadas vs pendientes en la VM
   - Velocidad real calculada en vivo (sellos / segundo)
   - Total sellos descubiertos en la base de la VM
2. Motor 2 (Resolver de Imágenes v4 en D1):
   - Total sellos en Cloudflare D1
   - Porcentaje de cobertura de imágenes HD
"""

import os
import subprocess
import time
import requests

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"


def get_vm_sqlite_stats():
    cmd = (
        'gcloud compute ssh instance-20260705-205256 --zone=us-central1-a --command="'
        'cd ~/filatelia_scraper && python3 -c \\\''
        'import sqlite3, json\n'
        'conn = sqlite3.connect("colnect_v3_progress.db")\n'
        'c = conn.cursor()\n'
        'c.execute("SELECT status, COUNT(*) FROM listing_pages GROUP BY status")\n'
        'lp = dict(c.fetchall())\n'
        'c.execute("SELECT COUNT(*), SUM(stamps_found) FROM listing_pages WHERE status = \\\'done\\\'")\n'
        'row = c.fetchone()\n'
        'c.execute("SELECT COUNT(*) FROM stamp_queue WHERE status = \\\'pending\\\'")\n'
        'q_pending = c.fetchone()[0] or 0\n'
        'print(json.dumps({\n'
        '  "done_pages": row[0] or 0,\n'
        '  "pending_pages": lp.get("pending", 0),\n'
        '  "empty_pages": lp.get("empty", 0),\n'
        '  "error_pages": lp.get("error", 0),\n'
        '  "total_stamps": row[1] or 0,\n'
        '  "queue_pending": q_pending\n'
        '}))\n'
        '\\\'"'
    )
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            import json
            # find last json line
            lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip().startswith("{")]
            if lines:
                return json.loads(lines[-1])
    except Exception:
        pass
    return None


def get_d1_stats():
    try:
        sql = """
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN imageUrl IS NOT NULL AND imageUrl != '' AND imageUrl NOT LIKE '%none_logged_image%' THEN 1 ELSE 0 END) as con_imagen
            FROM Stamp
            WHERE source = 'colnect'
        """
        r = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=8)
        if r.status_code == 200:
            res = r.json().get("results", [{}])[0]
            tot = res.get("total", 0)
            img = res.get("con_imagen", 0)
            return {
                "total_d1": tot,
                "con_imagen": img,
                "sin_imagen": tot - img,
                "pct_imagen": (img / tot * 100) if tot > 0 else 0
            }
    except Exception:
        pass
    return None


def main():
    print("🚀 Conectando monitor a la VM Escorpia en GCP...\n")

    prev_stamps = None
    prev_time = None

    while True:
        s_stats = get_vm_sqlite_stats()
        d_stats = get_d1_stats()
        now = time.time()

        os.system("clear" if os.name == "posix" else "cls")

        print("=" * 65)
        print(" ☁️  FILATELIA VM ESCORPIA (GCP) — MONITOR EN VIVO")
        print("=" * 65)

        if s_stats:
            rate_str = "calculando..."
            if prev_stamps is not None and prev_time is not None:
                elapsed = now - prev_time
                delta_stamps = s_stats["total_stamps"] - prev_stamps
                if elapsed > 0 and delta_stamps >= 0:
                    rate = delta_stamps / elapsed
                    rate_str = f"{rate:.2f} sellos/seg"

            prev_stamps = s_stats["total_stamps"]
            prev_time = now

            print("\n🕷  MOTOR 1 en VM: Scraper Global v3.1")
            print(f"   ├─ Páginas completadas:  {s_stats['done_pages']:,}")
            print(f"   ├─ Páginas pendientes:   {s_stats['pending_pages']:,}")
            print(f"   ├─ Sellos descubiertos:  {s_stats['total_stamps']:,}")
            print(f"   └─ ⚡ VELOCIDAD EN VIVO:  {rate_str}")
        else:
            print("\n🕷  MOTOR 1: Conectando con la VM Escorpia...")

        if d_stats:
            print("\n🖼   MOTOR 2 en D1: Resolver de Imágenes v4")
            print(f"   ├─ Total sellos en D1:    {d_stats['total_d1']:,}")
            print(f"   ├─ Sellos con imagen HD:  {d_stats['con_imagen']:,} ({d_stats['pct_imagen']:.1f}%)")
            print(f"   └─ Sellos sin imagen:     {d_stats['sin_imagen']:,}")

        print("\n" + "=" * 65)
        print(" 🕒 Consultando la VM cada 5 segundos... (Ctrl+C para salir)")
        print("=" * 65)

        time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 Monitor cerrado.")
