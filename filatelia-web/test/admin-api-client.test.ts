import { describe, it, expect, afterEach, vi } from "vitest";
import { adminFetch, AdminApiError, adminErrorMessage } from "../src/lib/adminApi";

// `adminFetch` is the single call-shape every admin client now shares: a
// same-origin request to `/api/admin/<subpath>` (the session-gated proxy in
// front of the Worker), with the browser's `fp_session` cookie carried via
// `credentials: "same-origin"` and never an `Authorization` header — the
// proxy itself owns the service-token hop to the Worker.

describe("adminFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the same-origin /api/admin/<subpath> route with same-origin credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await adminFetch("stamps");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/stamps");
    expect(init.credentials).toBe("same-origin");
  });

  it("preserves method, query string and JSON body from the caller", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    await adminFetch("stamps?search=peru&page=2", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Peru" }),
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/stamps?search=peru&page=2");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ name: "Peru" }));
  });

  it("never sends an Authorization header, even if the caller tries to pass one", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await adminFetch("stamps", { headers: { Authorization: "Bearer whatever" } });

    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
  });
});

// A failing admin call must never look like a successful one. `adminFetch`
// is the single place that turns a non-ok response into a typed, surfaceable
// `AdminApiError`, so no admin client can accidentally treat a 401/403/500/504
// as "saved".
describe("adminFetch failure surface", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the response untouched when it is ok, so callers can still read res.json()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, stamps: [] }), { status: 200 }))
    );

    const res = await adminFetch("stamps");

    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ success: true, stamps: [] });
  });

  it("throws an AdminApiError carrying the status on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unauthenticated" }), { status: 401 }))
    );

    const error = await adminFetch("stamp/1", { method: "PUT" }).catch((e) => e);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(401);
    expect(error.detail).toBe("Unauthenticated");
    expect(error.message).toMatch(/sesión/i);
  });

  it("throws an AdminApiError on 403 with a Spanish permissions message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
    );

    const error = await adminFetch("stamp/1", { method: "DELETE" }).catch((e) => e);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/permiso/i);
  });

  it("throws an AdminApiError on 500 (e.g. the proxy is not configured)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Admin proxy is not configured" }), { status: 500 }))
    );

    const error = await adminFetch("catalog/1", { method: "PUT" }).catch((e) => e);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(500);
    expect(error.detail).toBe("Admin proxy is not configured");
    expect(error.message).toMatch(/servidor/i);
  });

  it("throws an AdminApiError on 504 with an upstream-timeout message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 504 })));

    const error = await adminFetch("catalog/1", { method: "PUT" }).catch((e) => e);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(504);
    expect(error.message).toMatch(/tard/i);
  });

  it("lets a rejected fetch (network drop) propagate to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await adminFetch("catalog/1", { method: "PUT" }).catch((e) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(AdminApiError);
  });
});

describe("adminErrorMessage", () => {
  it("uses the Spanish message of an AdminApiError", () => {
    const error = new AdminApiError(403, "No tienes permisos de administrador para esta acción.", "Forbidden");
    expect(adminErrorMessage(error)).toBe("No tienes permisos de administrador para esta acción.");
  });

  it("maps an unknown/network failure to a Spanish connection message", () => {
    expect(adminErrorMessage(new TypeError("Failed to fetch"))).toMatch(/conexión/i);
  });
});
