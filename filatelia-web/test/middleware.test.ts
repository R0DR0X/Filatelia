import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { signSession, verifySession } from "../src/lib/session";

function protectedRequest(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { Cookie: `fp_session=${cookie}` } : {},
  });
}

describe("middleware sliding session renewal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reissues fp_session with a strictly later exp when time has advanced (sliding renewal)", async () => {
    const token = await signSession({ id: "usr_1", role: "collector" });
    const originalPayload = await verifySession(token);

    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000); // 1 minute later

    const response = await middleware(protectedRequest("/perfil", token));

    const renewedCookie = response.cookies.get("fp_session")?.value;
    expect(renewedCookie).toBeTruthy();

    const renewedPayload = await verifySession(renewedCookie as string);
    expect(renewedPayload).not.toBeNull();
    expect(renewedPayload.id).toBe("usr_1");
    expect(renewedPayload.exp).toBeGreaterThan(originalPayload.exp);
  });

  it("does not renew and redirects to login when the session is expired", async () => {
    const expiredToken = await signSession({ id: "usr_1", role: "collector" }, { ttlSeconds: -10 });

    const response = await middleware(protectedRequest("/perfil", expiredToken));

    expect(response.status).toBe(307);
    expect(response.cookies.get("fp_session")).toBeUndefined();
  });
});

describe("middleware admin role gate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a valid non-admin session on an /admin path", async () => {
    const token = await signSession({ id: "usr_1", role: "collector" });

    const response = await middleware(protectedRequest("/admin/dashboard", token));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("allows a valid admin session on an /admin path", async () => {
    const token = await signSession({ id: "usr_admin", role: "admin" });

    const response = await middleware(protectedRequest("/admin/dashboard", token));

    expect(response.status).not.toBe(307);
    const renewedCookie = response.cookies.get("fp_session")?.value;
    expect(renewedCookie).toBeTruthy();
    const renewedPayload = await verifySession(renewedCookie as string);
    expect(renewedPayload).not.toBeNull();
    expect(renewedPayload.role).toBe("admin");
  });
});
