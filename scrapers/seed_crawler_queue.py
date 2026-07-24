#!/usr/bin/env python3
import sqlite3
import requests
import time

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"
LOCAL_DB = "crawler_progress.db"

def init_db():
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

def main():
    init_db()
    print("🔍 Fetching pending URLs from Cloudflare D1 database...")
    
    offset = 0
    limit = 10000
    urls = []
    
    while True:
        sql = f"SELECT sourceUrl FROM Stamp WHERE source = 'colnect' AND perforation IS NULL LIMIT {limit} OFFSET {offset}"
        try:
            res = requests.post(API_URL, json={"sql": sql, "params": []}, timeout=30)
            if res.status_code != 200:
                print(f"❌ API Error: {res.status_code} - {res.text}")
                break
                
            results = res.json().get("results", [])
            if not results:
                break
                
            for row in results:
                url = row.get("sourceUrl")
                if url:
                    urls.append(url)
                    
            print(f"  Fetched {len(urls)} URLs so far...")
            offset += limit
            if len(results) < limit:
                break
        except Exception as e:
            print(f"❌ Exception querying D1: {e}")
            break
            
    print(f"✅ Found {len(urls)} stamps pending detail enrichment.")
    
    if not urls:
        print("ℹ️ No URLs need enrichment.")
        return
        
    print(f"💾 Inserting URLs into local SQLite database ({LOCAL_DB})...")
    conn = sqlite3.connect(LOCAL_DB)
    cursor = conn.cursor()
    
    inserted = 0
    ignored = 0
    
    # Insert in batches
    batch_size = 1000
    for i in range(0, len(urls), batch_size):
        batch = urls[i:i+batch_size]
        try:
            # We use INSERT OR IGNORE so we don't overwrite already crawled or existing URLs in queue
            cursor.executemany(
                "INSERT OR IGNORE INTO queue (url, status, retries, updated_at) VALUES (?, 'pending', 0, ?)",
                [(url, int(time.time())) for url in batch]
            )
            inserted += cursor.rowcount
            ignored += (len(batch) - cursor.rowcount)
        except Exception as e:
            print(f"❌ Error inserting batch: {e}")
            
    conn.commit()
    conn.close()
    
    print(f"🎉 SQLite Queue updated: {inserted} new URLs inserted, {ignored} duplicates ignored.")

if __name__ == "__main__":
    main()
