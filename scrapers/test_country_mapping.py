#!/usr/bin/env python3
"""
Standalone regression checks for the Colnect scraper.

Guards the data-loss bug where every scraped stamp was rejected by D1:
  - countryId used to be Colnect's numeric id (FK violation on Country.id)
  - countryCode used to be a 3-letter truncation of the country slug
    (wrong codes, plus collisions such as Guinea / Guinea-Bissau -> "GUI")

Also guards the 40-hour silent hang: Chromium died, every Playwright await
blocked forever, and neither the workers nor the phase ever noticed. The
watchdog decision logic is pure so it can be exercised without a browser.

Run:  python3 scrapers/test_country_mapping.py
Exits non-zero if any assertion fails.
"""

import asyncio
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import colnect_global_scraper_v3 as scraper  # noqa: E402
from colnect_global_scraper_v3 import (  # noqa: E402
    COUNTRY_ISO_MAP,
    ISO_MAP_FILE,
    NEVER_REPORTED,
    SILENT_FOREVER,
    country_meta,
    country_payload_fields,
    drain_queue_with_watchdog,
    parse_detail_page,
    parse_listing_page,
    should_abort,
    stalled_workers,
)

PASSED = 0
FAILED = 0


def check(label, condition, detail=""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        print(f"  FAIL  {label}{(' — ' + detail) if detail else ''}")


LISTING_HTML = """
<html><body>
  <div class="pl-it">
    <h2 class="item_header"><a href="/en/stamps/stamp/12345-Test_Stamp">Test Stamp</a></h2>
    <div class="i_d"><div>Catalog codes: Sn:123, Mi:456</div></div>
    <div class="item_price">1.50</div>
  </div>
</body></html>
"""


def test_map_file_present():
    print("\nTEST 1: generated ISO map is loaded")
    check("colnect_iso_map.json exists", ISO_MAP_FILE.exists(), str(ISO_MAP_FILE))
    check("map is non-empty", len(COUNTRY_ISO_MAP) > 0)
    with open(ISO_MAP_FILE, encoding="utf-8") as f:
        raw = json.load(f)
    check("every entry has iso2/nameEn/nameEs keys",
          all({"iso2", "nameEn", "nameEs"} <= set(v) for v in raw.values()))


def test_guinea_collision():
    print("\nTEST 2: Guinea (90) and Guinea-Bissau (91) no longer collide")
    gn = country_meta("90")[0]
    gw = country_meta("91")[0]
    check("Guinea resolves to a code", gn is not None, repr(gn))
    check("Guinea-Bissau resolves to a code", gw is not None, repr(gw))
    check("codes differ", gn != gw, f"{gn} vs {gw}")
    check("Guinea == GN", gn == "GN", repr(gn))
    check("Guinea-Bissau == GW", gw == "GW", repr(gw))


def test_known_countries():
    print("\nTEST 3: known countries resolve to real ISO2 codes")
    expected = {
        "225": "US",   # United States of America (was "UNI")
        "177": "RO",   # Romania (was "ROM")
        "156": "NE",   # Niger (was "NIG")
        "157": "NG",   # Nigeria (was "NIG" — collided with Niger)
        "121": "LR",   # Liberia (was "LIB")
        "41":  "CF",   # Central African Republic (was "CAR")
        "74":  "FR",   # France
    }
    for cid, iso2 in expected.items():
        actual = country_meta(cid)[0]
        check(f"colnect id {cid} -> {iso2}", actual == iso2, repr(actual))


def test_no_three_letter_codes():
    print("\nTEST 4: truncation fallback is gone (no 3-letter codes anywhere)")
    offenders = [
        (cid, entry["iso2"])
        for cid, entry in COUNTRY_ISO_MAP.items()
        if entry.get("iso2") and len(entry["iso2"]) != 2
    ]
    check("no iso2 value has a length other than 2", not offenders, str(offenders[:5]))
    non_alpha = [
        (cid, entry["iso2"])
        for cid, entry in COUNTRY_ISO_MAP.items()
        if entry.get("iso2") and not entry["iso2"].isalpha()
    ]
    check("every iso2 value is alphabetic", not non_alpha, str(non_alpha[:5]))
    check("every iso2 value is uppercase",
          all(e["iso2"].isupper() for e in COUNTRY_ISO_MAP.values() if e.get("iso2")))


def test_payload_fields_known_country():
    print("\nTEST 5: payload for a known country carries a valid FK")
    fields = country_payload_fields("177")  # Romania
    check("countryCode == RO", fields["countryCode"] == "RO", repr(fields["countryCode"]))
    check("countryId == country-ro", fields["countryId"] == "country-ro", repr(fields["countryId"]))
    check("countryId matches countryCode",
          fields["countryId"] == f"country-{fields['countryCode'].lower()}")
    check("countryNameEn present", bool(fields["countryNameEn"]), repr(fields["countryNameEn"]))
    check("countryNameEs present", bool(fields["countryNameEs"]), repr(fields["countryNameEs"]))
    check("countryId is never the raw colnect id", fields["countryId"] != "177")


def test_payload_fields_unresolvable():
    print("\nTEST 6: unresolvable entity yields None, not a fabricated value")
    # 939 = "France: Personalized Stamps" — a philatelic entity, not a country.
    fields = country_payload_fields("939")
    check("countryCode is None", fields["countryCode"] is None, repr(fields["countryCode"]))
    check("countryId is None", fields["countryId"] is None, repr(fields["countryId"]))
    check("countryNameEn is None", fields["countryNameEn"] is None)
    check("countryNameEs is None", fields["countryNameEs"] is None)

    unknown = country_payload_fields("999999")
    check("unknown colnect id yields None countryId", unknown["countryId"] is None)
    check("unknown colnect id yields None countryCode", unknown["countryCode"] is None)


def test_listing_payload():
    print("\nTEST 7: parse_listing_page emits corrected country fields")
    stamps, _ = parse_listing_page(LISTING_HTML, "225", "UNI")  # stale broken code passed in
    check("one stamp parsed", len(stamps) == 1, str(len(stamps)))
    if not stamps:
        return
    s = stamps[0]
    check("countryCode == US (stale arg ignored)", s["countryCode"] == "US", repr(s["countryCode"]))
    check("countryId == country-us", s["countryId"] == "country-us", repr(s["countryId"]))
    check("colnect numeric id kept separately", s["colnectCountryId"] == "225", repr(s.get("colnectCountryId")))
    check("countryNameEn present", bool(s["countryNameEn"]))
    check("countryNameEs present", bool(s["countryNameEs"]))


def test_detail_payload_upgrades_legacy_rows():
    print("\nTEST 8: legacy queued rows get corrected codes at send time")
    # Legacy checkpoint row: numeric id under "countryId", broken 3-letter code.
    legacy_basic = {"id": "abc", "countryId": "91", "countryCode": "GUI", "nameEn": "Legacy"}
    stamp = parse_detail_page("<html><body></body></html>",
                              "https://colnect.com/en/stamps/stamp/1-x",
                              legacy_basic)
    check("legacy countryCode corrected to GW", stamp["countryCode"] == "GW", repr(stamp["countryCode"]))
    check("legacy countryId corrected to country-gw",
          stamp["countryId"] == "country-gw", repr(stamp["countryId"]))
    check("legacy stored 'GUI' is not propagated", stamp["countryCode"] != "GUI")

    # Modern row plus the checkpoint's numeric country_id column.
    modern = {"id": "def", "colnectCountryId": "225", "countryId": "country-us", "countryCode": "US"}
    stamp2 = parse_detail_page("<html><body></body></html>",
                               "https://colnect.com/en/stamps/stamp/2-y",
                               modern, "225")
    check("modern row keeps country-us", stamp2["countryId"] == "country-us", repr(stamp2["countryId"]))
    check("countryId is never the raw colnect id", stamp2["countryId"] != "225")

    # Unresolvable entity must not fabricate a FK.
    stamp3 = parse_detail_page("<html><body></body></html>",
                               "https://colnect.com/en/stamps/stamp/3-z",
                               {"countryId": "939"})
    check("unresolvable detail row -> countryId None", stamp3["countryId"] is None, repr(stamp3["countryId"]))
    check("unresolvable detail row -> countryCode None", stamp3["countryCode"] is None)


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def send_with_response(stamps, payload):
    """Run send_batch_sync against a canned D1 response."""
    original = scraper.requests
    scraper.requests = types.SimpleNamespace(post=lambda *a, **k: FakeResponse(payload))
    try:
        return scraper.send_batch_sync(stamps)
    finally:
        scraper.requests = original


def partition(stamps, failed):
    """Mirror of the call-site loop: (marked done, marked for retry)."""
    done = [s["sourceUrl"] for s in stamps if s.get("sourceUrl") not in failed]
    retry = [s["sourceUrl"] for s in stamps if s.get("sourceUrl") in failed]
    return done, retry


BATCH = [
    {"id": "id-1", "sourceUrl": "https://colnect.com/en/stamps/stamp/1-a"},
    {"id": "id-2", "sourceUrl": "https://colnect.com/en/stamps/stamp/2-b"},
    {"id": "id-3", "sourceUrl": "https://colnect.com/en/stamps/stamp/3-c"},
]


def test_partial_batch_failure():
    print("\nTEST 9: only the failing stamps are retried")
    failed = send_with_response(BATCH, {
        "success": True, "inserted": 2, "updated": 0, "skipped": 0,
        "errors": ["id-2: FOREIGN KEY constraint failed"],
        "failedIds": ["id-2"],
    })
    check("returns a set, not a bool", isinstance(failed, set), repr(failed))
    check("only the failing sourceUrl is reported",
          failed == {BATCH[1]["sourceUrl"]}, repr(failed))
    done, retry = partition(BATCH, failed)
    check("two stamps marked done", len(done) == 2, str(done))
    check("one stamp marked for retry", retry == [BATCH[1]["sourceUrl"]], str(retry))

    ok = send_with_response(BATCH, {
        "success": True, "inserted": 3, "updated": 0, "skipped": 0, "errors": [],
    })
    check("clean batch reports no failures", ok == set(), repr(ok))
    check("clean batch marks everything done", len(partition(BATCH, ok)[1]) == 0)


def test_failed_ids_fallback():
    print("\nTEST 10: version skew falls back to whole-batch failure")
    all_urls = {s["sourceUrl"] for s in BATCH}

    missing = send_with_response(BATCH, {
        "success": True, "inserted": 2, "updated": 0, "skipped": 0,
        "errors": ["id-2: boom"],
    })
    check("missing failedIds -> whole batch failed", missing == all_urls, repr(missing))

    unusable = send_with_response(BATCH, {
        "success": True, "inserted": 2, "updated": 0, "skipped": 0,
        "errors": ["id-2: boom"], "failedIds": "id-2",
    })
    check("non-list failedIds -> whole batch failed", unusable == all_urls, repr(unusable))

    unknown = send_with_response(BATCH, {
        "success": True, "inserted": 2, "updated": 0, "skipped": 0,
        "errors": ["?: boom"], "failedIds": ["id-unknown"],
    })
    check("unmatched failedIds -> whole batch failed", unknown == all_urls, repr(unknown))

    nothing = send_with_response(BATCH, {
        "success": True, "inserted": 0, "updated": 0, "skipped": 3, "errors": [],
    })
    check("nothing persisted -> whole batch failed", nothing == all_urls, repr(nothing))
    check("no stamp is marked done on fallback", partition(BATCH, missing)[0] == [])


WORKER_SOURCE = (
    Path(__file__).resolve().parents[1] / "workers" / "filatelia-api" / "src" / "index.ts"
)


def test_worker_country_validation_guards():
    # The worker has no JS test runner, so this is a source-level guard against
    # the /import-stamp Country-squatting regression being reintroduced.
    print("\nTEST 11: worker validates country payloads server-side")
    check("worker source found", WORKER_SOURCE.exists(), str(WORKER_SOURCE))
    if not WORKER_SOURCE.exists():
        return
    src = WORKER_SOURCE.read_text(encoding="utf-8")
    check("country id is derived from the code, never taken from the caller",
          "`country-${code.toLowerCase()}`" in src)
    check("country code is validated with a strict ISO2 pattern",
          "/^[A-Z]{2}$/" in src)
    check("a mismatched caller countryId rejects the country block",
          "if (claimedId && claimedId !== derivedId) return null;" in src)
    check("country names are length-bounded",
          "COUNTRY_NAME_MAX_LENGTH" in src)
    check("the stamp binds the validated country id, not the caller's",
          "stamp._countryId" in src and "groupId, stamp.countryId || null" not in src)
    check("a rejected country yields NULL instead of dropping the stamp",
          "stamp._countryId = country ? country.id : null;" in src)
    check("the response exposes failedIds for per-stamp retry",
          "failedIds: [] as string[]" in src and "results.failedIds.push(" in src)


THRESHOLD = 180.0
NOW = 10_000.0  # arbitrary time.monotonic() reading; only deltas matter


def test_watchdog_decision_logic():
    # Pure regression guard for the 40h hang: nothing ever noticed that every
    # worker had stopped making progress.
    print("\nTEST 12: watchdog stall detection (pure logic)")

    fresh = {0: NOW - 1.0, 1: NOW - 5.0, 2: NOW - 179.9}
    check("no stalled worker when every heartbeat is fresh",
          stalled_workers(fresh, NOW, THRESHOLD) == [], repr(stalled_workers(fresh, NOW, THRESHOLD)))
    check("no abort when every heartbeat is fresh",
          should_abort(fresh, NOW, THRESHOLD) is False)

    partial = {0: NOW - 1.0, 1: NOW - 300.0, 2: NOW - 600.0}
    stalled_ids = [wid for wid, _ in stalled_workers(partial, NOW, THRESHOLD)]
    check("identifies exactly the stalled workers",
          sorted(stalled_ids) == [1, 2], str(stalled_ids))
    check("worker 0 is not reported as stalled", 0 not in stalled_ids)
    check("longest silence is reported first", stalled_ids[0] == 2, str(stalled_ids))
    check("silence duration is reported",
          dict(stalled_workers(partial, NOW, THRESHOLD))[1] == 300.0)
    check("no abort while at least one worker is alive",
          should_abort(partial, NOW, THRESHOLD) is False)

    all_dead = {0: NOW - 181.0, 1: NOW - 400.0, 2: NOW - 3600.0}
    check("all workers stalled -> abort",
          should_abort(all_dead, NOW, THRESHOLD) is True)
    check("all workers stalled -> all reported",
          len(stalled_workers(all_dead, NOW, THRESHOLD)) == 3)

    # Boundary: silence exactly equal to the threshold counts as STALLED.
    at_threshold = {0: NOW - THRESHOLD}
    check("silence exactly == threshold counts as stalled",
          [wid for wid, _ in stalled_workers(at_threshold, NOW, THRESHOLD)] == [0])
    check("silence exactly == threshold aborts",
          should_abort(at_threshold, NOW, THRESHOLD) is True)
    just_under = {0: NOW - (THRESHOLD - 0.001)}
    check("silence just under the threshold does not abort",
          should_abort(just_under, NOW, THRESHOLD) is False)

    # A worker that never reported (or declared itself dead) is never "fresh".
    never = {0: NEVER_REPORTED}
    check("worker without heartbeat is stalled",
          [wid for wid, _ in stalled_workers(never, NOW, THRESHOLD)] == [0])
    check("worker without heartbeat has infinite silence",
          dict(stalled_workers(never, NOW, THRESHOLD))[0] == SILENT_FOREVER)
    check("worker without heartbeat aborts",
          should_abort(never, NOW, THRESHOLD) is True)
    mixed = {0: NOW - 1.0, 1: NEVER_REPORTED}
    check("never-reported worker is stalled even next to a fresh one",
          [wid for wid, _ in stalled_workers(mixed, NOW, THRESHOLD)] == [1])
    check("never-reported worker alone does not abort the batch",
          should_abort(mixed, NOW, THRESHOLD) is False)

    # No active worker means nothing to supervise, not "everything is stuck".
    check("empty heartbeat map never aborts", should_abort({}, NOW, THRESHOLD) is False)
    check("empty heartbeat map has no stalled workers", stalled_workers({}, NOW, THRESHOLD) == [])


async def _drain(worker_bodies, threshold, interval, exit_grace, items=1):
    """Run drain_queue_with_watchdog against fake workers (no browser)."""
    queue = asyncio.Queue()
    for i in range(items):
        await queue.put({"n": i})
    heartbeats = {}
    workers = [
        asyncio.create_task(body(wid, queue, heartbeats))
        for wid, body in enumerate(worker_bodies)
    ]
    return await drain_queue_with_watchdog(
        "TEST", queue, workers, heartbeats,
        threshold=threshold, interval=interval, exit_grace=exit_grace,
    )


def test_phase_never_blocks_forever():
    # queue.join() alone was the top-level hang: this proves the phase unblocks.
    print("\nTEST 13: the phase aborts instead of hanging on queue.join()")

    async def wedged_worker(wid, queue, heartbeats):
        heartbeats[wid] = scraper.time.monotonic()
        queue.get_nowait()          # item taken, task_done() never called
        await asyncio.sleep(3600)   # simulates a blocked Playwright await

    async def healthy_worker(wid, queue, heartbeats):
        heartbeats[wid] = scraper.time.monotonic()
        while True:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            heartbeats[wid] = scraper.time.monotonic()
            queue.task_done()
        heartbeats.pop(wid, None)

    aborted = asyncio.run(_drain([wedged_worker, wedged_worker],
                                 threshold=0.05, interval=0.02, exit_grace=0.05,
                                 items=2))
    check("total stall aborts the batch instead of hanging", aborted is True)

    ok = asyncio.run(_drain([healthy_worker, healthy_worker],
                            threshold=5.0, interval=0.02, exit_grace=0.5,
                            items=6))
    check("clean drain is not reported as an abort", ok is False)

    async def dying_worker(wid, queue, heartbeats):
        heartbeats[wid] = scraper.time.monotonic()
        queue.get_nowait()  # dies holding an un-acked item
        heartbeats[wid] = scraper.NEVER_REPORTED

    lost = asyncio.run(_drain([dying_worker, healthy_worker],
                              threshold=30.0, interval=0.02, exit_grace=0.1,
                              items=4))
    check("workers exiting without draining the queue aborts the batch", lost is True)


def main():
    print("=" * 66)
    print("Colnect country mapping regression checks")
    print("=" * 66)
    test_map_file_present()
    test_guinea_collision()
    test_known_countries()
    test_no_three_letter_codes()
    test_payload_fields_known_country()
    test_payload_fields_unresolvable()
    test_listing_payload()
    test_detail_payload_upgrades_legacy_rows()
    test_partial_batch_failure()
    test_failed_ids_fallback()
    test_worker_country_validation_guards()
    test_watchdog_decision_logic()
    test_phase_never_blocks_forever()

    print("\n" + "=" * 66)
    total = PASSED + FAILED
    print(f"RESULT: {PASSED}/{total} passed, {FAILED} failed")
    print("=" * 66)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
