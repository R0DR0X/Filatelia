import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { login, register, logout, getMe } from "../src/lib/auth";

// `src/lib/auth.ts` is the browser-side identity client. Since the E1
// migration it must:
//  - never read or write localStorage (`fp_token`/`fp_user` or any other
//    identity cache) — the httpOnly `fp_session` cookie is the sole source
//    of truth;
//  - never call the Worker (`*.workers.dev`) directly — it only calls the
//    Next routes under `/api/auth/*`.

const AUTH_LIB_SOURCE = readFileSync(
  resolve(__dirname, "../src/lib/auth.ts"),
  "utf-8"
);

describe("lib/auth.ts source contract", () => {
  it("never references localStorage", () => {
    expect(AUTH_LIB_SOURCE).not.toMatch(/localStorage/);
  });

  it("never references the Worker's workers.dev origin", () => {
    expect(AUTH_LIB_SOURCE).not.toMatch(/workers\.dev/);
  });
});

describe("lib/auth.ts calls the Next routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login() posts to the same-origin /api/auth/login route with credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, user: { id: "usr_1", name: "Ana", email: "ana@example.com" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await login("ana@example.com", "s3cret-pass");

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body)).toEqual({ email: "ana@example.com", password: "s3cret-pass" });
  });

  it("register() posts to the same-origin /api/auth/register route with credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, user: { id: "usr_1", name: "Carla", email: "carla@example.com" } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await register("Carla", "carla@example.com", "s3cret-pass");

    expect(result.success).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/auth/register");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
  });

  it("logout() posts to the same-origin /api/auth/logout route with credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchSpy);

    await logout();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
  });

  it("getMe() reads the same-origin /api/auth/me route with credentials and no Authorization header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, user: { id: "usr_1", name: "Ana", email: "ana@example.com", role: "collector" } }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getMe();

    expect(result.status).toBe("authenticated");
    expect(result.user).toEqual({ id: "usr_1", name: "Ana", email: "ana@example.com", role: "collector" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/auth/me");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers || {})["Authorization"]).toBeUndefined();
  });
});

// `getMe()` must let callers tell an authoritative "you are not logged in"
// (HTTP 401) apart from "the call did not answer" (network error, 5xx,
// timeout). Collapsing both to `null` made the Navbar paint a logged-out
// nav for a still-authenticated admin on any transient failure.
describe("getMe() identity result contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports `anonymous` when the server answers 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: "Unauthenticated" }), { status: 401 }))
    );

    expect(await getMe()).toEqual({ status: "anonymous", user: null });
  });

  it("reports `unavailable` when the request rejects (offline / network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    expect(await getMe()).toEqual({ status: "unavailable", user: null });
  });

  it("reports `unavailable` on a 500 instead of claiming the visitor is anonymous", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 500 }))
    );

    expect(await getMe()).toEqual({ status: "unavailable", user: null });
  });

  it("reports `unavailable` on a 504 upstream timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 504 })));

    expect(await getMe()).toEqual({ status: "unavailable", user: null });
  });

  it("reports `unavailable` when a 200 body is not usable JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 200 })));

    expect(await getMe()).toEqual({ status: "unavailable", user: null });
  });

  it("reports `anonymous` when a 200 body says the session is not authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }))
    );

    expect(await getMe()).toEqual({ status: "anonymous", user: null });
  });
});
