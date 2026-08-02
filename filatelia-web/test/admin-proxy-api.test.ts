import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/admin/[...path]/route";
import { signSession } from "../src/lib/session";

// `/api/admin/[...path]` is a session-gated proxy in front of the Worker's
// `/admin/*` routes: it verifies `fp_session`, requires `role === "admin"`,
// then forwards server-to-server with a service token the client never
// sees. Convention adopted here (documented in the route itself too): no or
// invalid session -> 401 Unauthenticated; valid session but wrong role ->
// 403 Forbidden.

function setAdminToken(value: string | undefined) {
  if (value === undefined) {
    const { ADMIN_API_TOKEN, ...rest } = process.env as any;
    process.env = rest;
  } else {
    process.env = Object.assign({}, process.env, { ADMIN_API_TOKEN: value });
  }
}

function requestWithCookie(
  url: string,
  cookie: string | undefined,
  init: { method?: string; body?: any } = {}
) {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = `fp_session=${cookie}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: init.method || "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function params(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe("GET/POST /api/admin/[...path] proxy", () => {
  afterEach(() => {
    setAdminToken(undefined);
    vi.unstubAllGlobals();
  });

  it("rejects with 401 when there is no session cookie", async () => {
    setAdminToken("service-secret-token");
    const req = requestWithCookie("http://localhost:3000/api/admin/stamps", undefined);

    const res = await GET(req, params(["stamps"]));

    expect(res.status).toBe(401);
  });

  it("rejects with 403 when the session is valid but role is not admin", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "u@example.com", role: "collector" });
    const req = requestWithCookie("http://localhost:3000/api/admin/stamps", cookie);

    const res = await GET(req, params(["stamps"]));

    expect(res.status).toBe(403);
  });

  it("fails closed with 500 when ADMIN_API_TOKEN is missing, even for a valid admin session", async () => {
    setAdminToken(undefined);
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const req = requestWithCookie("http://localhost:3000/api/admin/stamps", cookie);

    const res = await GET(req, params(["stamps"]));

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards an authorized GET request with the service token, method, path and query, without the client's cookie", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const req = requestWithCookie(
      "http://localhost:3000/api/admin/stamps?search=peru&page=2",
      cookie
    );

    const res = await GET(req, params(["stamps"]));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [forwardedUrl, forwardedInit] = fetchSpy.mock.calls[0];
    expect(String(forwardedUrl)).toBe(
      "https://filatelia-api.rodrigopianto2005.workers.dev/admin/stamps?search=peru&page=2"
    );
    expect(forwardedInit.method).toBe("GET");

    const forwardedHeaders = new Headers(forwardedInit.headers);
    expect(forwardedHeaders.get("X-Admin-Token")).toBe("service-secret-token");
    expect(forwardedHeaders.get("cookie")).toBeNull();
    expect(forwardedHeaders.get("authorization")).toBeNull();
  });

  it("forwards an authorized POST request preserving the JSON body", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const req = requestWithCookie("http://localhost:3000/api/admin/group", cookie, {
      method: "POST",
      body: { name: "Peru" },
    });

    const res = await POST(req, params(["group"]));

    expect(res.status).toBe(201);

    const [forwardedUrl, forwardedInit] = fetchSpy.mock.calls[0];
    expect(String(forwardedUrl)).toBe("https://filatelia-api.rodrigopianto2005.workers.dev/admin/group");
    expect(forwardedInit.method).toBe("POST");
    expect(forwardedInit.body).toBe(JSON.stringify({ name: "Peru" }));
  });

  it("returns a JSON 500 instead of throwing when the Worker is unreachable", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const req = requestWithCookie("http://localhost:3000/api/admin/stamps", cookie);

    const res = await GET(req, params(["stamps"]));

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("bounds the forwarded fetch with an abort signal and answers 504 on timeout", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const fetchSpy = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchSpy);
    const req = requestWithCookie("http://localhost:3000/api/admin/stamps", cookie);

    const res = await GET(req, params(["stamps"]));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBeTruthy();

    const [, forwardedInit] = fetchSpy.mock.calls[0];
    expect(forwardedInit.signal).toBeDefined();
  });

  it("rejects a traversal path segment with 400 and never calls the Worker", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const req = requestWithCookie("http://localhost:3000/api/admin/../upload-image", cookie);

    const res = await GET(req, params(["..", "upload-image"]));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects empty, dot and separator-bearing path segments with 400", async () => {
    setAdminToken("service-secret-token");
    const cookie = await signSession({ id: "usr_1", email: "admin@example.com", role: "admin" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    for (const path of [[""], ["."], ["a/b"], ["a\\b"], []]) {
      const req = requestWithCookie("http://localhost:3000/api/admin/x", cookie);
      const res = await GET(req, params(path));
      expect(res.status).toBe(400);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
