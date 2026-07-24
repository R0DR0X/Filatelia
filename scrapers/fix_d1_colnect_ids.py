#!/usr/bin/env python3
import requests
import uuid
import time

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"
NAMESPACE_PHILATELY = uuid.UUID('12345678-1234-5678-1234-567812345678')

def run_query(sql, params=[]):
    r = requests.post(API_URL, json={"sql": sql, "params": params}, timeout=30)
    if r.status_code != 200:
        raise Exception(f"API Error {r.status_code}: {r.text}")
    res = r.json()
    if not res.get("success"):
        raise Exception(f"Query failed: {res.get('error')}")
    return res.get("results", [])

def main():
    print("📡 Fetching all Colnect stamps from D1...")
    stamps = run_query("SELECT id, sourceUrl, perforation FROM Stamp WHERE source = 'colnect'")
    print(f"✅ Found {len(stamps)} Colnect stamps.")

    # Group by sourceUrl
    url_groups = {}
    for s in stamps:
        url = s.get("sourceUrl")
        if url:
            url_groups.setdefault(url, []).append(s)

    print(f"📊 Total unique URLs: {len(url_groups)}")

    to_delete = []
    to_update = []  # list of tuples: (new_id, old_id)

    for url, group in url_groups.items():
        deterministic_id = str(uuid.uuid5(NAMESPACE_PHILATELY, url))
        
        if len(group) > 1:
            # We have duplicates!
            # Let's find the best one: preferably one where perforation is not null
            best = None
            for s in group:
                if s.get("perforation") is not None:
                    best = s
                    break
            if not best:
                best = group[0]
            
            # Keep the best one, delete the rest
            for s in group:
                if s["id"] != best["id"]:
                    to_delete.append(s["id"])
            
            # Update the best one's ID if needed
            if best["id"] != deterministic_id:
                to_update.append((deterministic_id, best["id"]))
        else:
            # Only one record, check if ID matches deterministic ID
            s = group[0]
            if s["id"] != deterministic_id:
                to_update.append((deterministic_id, s["id"]))

    print(f"🗑️ Stamps to delete: {len(to_delete)}")
    print(f"🔄 Stamps to update ID: {len(to_update)}")

    # Execute deletions in batches of 50
    batch_size = 50
    if to_delete:
        print("Executing deletions...")
        for i in range(0, len(to_delete), batch_size):
            batch = to_delete[i:i+batch_size]
            placeholders = ",".join(["?"] * len(batch))
            sql = f"DELETE FROM Stamp WHERE id IN ({placeholders})"
            run_query(sql, batch)
            print(f"  Deleted {i + len(batch)} / {len(to_delete)} stamps...")
            time.sleep(0.1)

    # Execute ID updates
    if to_update:
        print("Executing ID updates...")
        for idx, (new_id, old_id) in enumerate(to_update):
            sql = "UPDATE Stamp SET id = ? WHERE id = ?"
            try:
                run_query(sql, [new_id, old_id])
            except Exception as e:
                # If conflict, we can delete the old one instead to clean up
                print(f"  ⚠️ Error updating {old_id} to {new_id}: {e}")
                print(f"  🗑️ Deleting conflicting old_id {old_id} instead...")
                run_query("DELETE FROM Stamp WHERE id = ?", [old_id])
            
            if (idx + 1) % 500 == 0 or (idx + 1) == len(to_update):
                print(f"  Updated {idx + 1} / {len(to_update)} stamp IDs...")
                time.sleep(0.1)

    print("🎉 Done fixing Colnect stamp IDs!")

if __name__ == "__main__":
    main()
