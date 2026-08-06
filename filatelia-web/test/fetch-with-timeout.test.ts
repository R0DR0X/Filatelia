import { describe, test, expect, vi } from "vitest";
import { CLIENT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../src/lib/fetchWithTimeout";

// The client-side counterpart of the WORKER_FETCH_TIMEOUT_MS +
// AbortController pattern already used server-side in
// src/app/api/admin/[...path]/route.ts. Without it, a hanging response
// leaves a page spinning with no way out.

/** A fetch that never answers, but honours an abort signal. */
function hangingFetch(): typeof fetch {
  return ((_input: any, init: any) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      });
    })) as unknown as typeof fetch;
}

describe("fetchWithTimeout", () => {
  test("exposes a bounded default timeout", () => {
    expect(CLIENT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CLIENT_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  test("aborts a hanging request instead of waiting forever", async () => {
    await expect(
      fetchWithTimeout("/api/collection", {}, { timeoutMs: 10, fetchImpl: hangingFetch() })
    ).rejects.toThrow(/abort/i);
  });

  test("passes an AbortSignal to the underlying fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await fetchWithTimeout("/api/orders", { method: "GET" }, { fetchImpl: fetchImpl as any });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("returns a fast response untouched and preserves the caller's init", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const res = await fetchWithTimeout(
      "/api/collection",
      { method: "POST", credentials: "same-origin", body: "{}" },
      { fetchImpl: fetchImpl as any }
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: 1 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/collection");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe("{}");
  });

  test("does not abort a request that completed before the timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const res = await fetchWithTimeout("/api/match", {}, { timeoutMs: 5, fetchImpl: fetchImpl as any });
    expect(res.status).toBe(200);
    // Well past the timeout: the timer must already have been cleared, so
    // nothing throws late and the signal stays unaborted.
    await new Promise((r) => setTimeout(r, 20));
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.signal.aborted).toBe(false);
  });
});
