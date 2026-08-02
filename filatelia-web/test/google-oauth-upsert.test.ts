import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { verifySession } from "../src/lib/session";
import { hashPassword } from "../src/lib/password";
import { POST as LOGIN } from "../src/app/api/auth/login/route";
import * as authGoogle from "../src/lib/auth-google";

// See test/db-users.test.ts for why process.env.DB must be replaced wholesale
// instead of assigned as a single key (Node stringifies process.env values).
function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}

function createMockD1(users: any[], roleByUserId: Record<string, string> = {}) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first() {
              if (/FROM User WHERE email/i.test(sql)) {
                return users.find((u) => u.email === params[0]) || null;
              }
              if (/FROM UserRole/i.test(sql)) {
                const roleName = roleByUserId[params[0]];
                return roleName ? { name: roleName } : null;
              }
              return null;
            },
            async run() {
              if (/INSERT INTO User/i.test(sql)) {
                users.push({ id: params[0], name: params[1], email: params[2], password: null });
              }
              if (/UPDATE User SET password = NULL/i.test(sql)) {
                const user = users.find((u) => u.id === params[0]);
                if (user) user.password = null;
              }
              return { success: true };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function callbackRequest(code: string, state: string) {
  return new NextRequest(`http://localhost:3000/api/auth/google?code=${code}&state=${state}`, {
    headers: { Cookie: `oauth_state=${state}` },
  });
}

describe("GET /api/auth/google (OAuth callback upserts D1 User)", () => {
  afterEach(() => {
    clearMockD1();
    vi.restoreAllMocks();
  });

  it("reuses the existing row and role for a returning Google email", async () => {
    const users = [{ id: "usr_existing_admin", name: "Admin User", email: "admin@example.com" }];
    setMockD1(createMockD1(users, { usr_existing_admin: "admin" }));

    vi.spyOn(authGoogle, "exchangeCodeForToken").mockResolvedValue({
      access_token: "fake-access-token",
      token_type: "bearer",
      expires_in: 3600,
    });
    vi.spyOn(authGoogle, "getGoogleUserProfile").mockResolvedValue({
      id: "google-123",
      email: "admin@example.com",
      verified_email: true,
      name: "Admin User",
    });

    const { GET } = await import("../src/app/api/auth/google/route");
    const response = await GET(callbackRequest("auth-code", "valid-state"));

    expect(response.status).toBe(307);
    const cookie = response.cookies.get("fp_session")?.value;
    expect(cookie).toBeTruthy();
    const payload = await verifySession(cookie as string);
    expect(payload.id).toBe("usr_existing_admin");
    expect(payload.role).toBe("admin");
    expect(users.length).toBe(1);
  });

  it("creates a new User row for a first-time Google email", async () => {
    const users: any[] = [];
    setMockD1(createMockD1(users));

    vi.spyOn(authGoogle, "exchangeCodeForToken").mockResolvedValue({
      access_token: "fake-access-token",
      token_type: "bearer",
      expires_in: 3600,
    });
    vi.spyOn(authGoogle, "getGoogleUserProfile").mockResolvedValue({
      id: "google-456",
      email: "first-timer@example.com",
      verified_email: true,
      name: "First Timer",
    });

    const { GET } = await import("../src/app/api/auth/google/route");
    const response = await GET(callbackRequest("auth-code", "valid-state"));

    expect(response.status).toBe(307);
    expect(users.some((u) => u.email === "first-timer@example.com")).toBe(true);
    const cookie = response.cookies.get("fp_session")?.value;
    const payload = await verifySession(cookie as string);
    expect(payload.role).toBe("collector");
    expect(users.find((u) => u.email === "first-timer@example.com").password).toBeNull();
  });
});

// Account pre-hijacking: registration is open and proves no email ownership, so
// an attacker can pre-register `victim@example.com` with a password of their
// choosing before the victim ever signs in with Google.
describe("GET /api/auth/google account pre-hijacking defences", () => {
  afterEach(() => {
    clearMockD1();
    vi.restoreAllMocks();
  });

  function mockGoogle(email: string, name: string, verified: boolean) {
    vi.spyOn(authGoogle, "exchangeCodeForToken").mockResolvedValue({
      access_token: "fake-access-token",
      token_type: "bearer",
      expires_in: 3600,
    });
    vi.spyOn(authGoogle, "getGoogleUserProfile").mockResolvedValue({
      id: "google-profile-id",
      email,
      verified_email: verified,
      name,
    });
  }

  async function runCallback() {
    const { GET } = await import("../src/app/api/auth/google/route");
    return GET(callbackRequest("auth-code", "valid-state"));
  }

  function victimRow(password: string | null) {
    return [{ id: "usr_victim", name: "Victim", email: "victim@example.com", password }];
  }

  it("creates no user and issues no session when Google reports the email as unverified", async () => {
    const users: any[] = [];
    setMockD1(createMockD1(users));
    mockGoogle("unverified@example.com", "Unverified Person", false);

    const response = await runCallback();

    expect(response.status).not.toBe(307);
    expect(response.cookies.get("fp_session")).toBeUndefined();
    expect(users.length).toBe(0);
  });

  it("does not adopt an existing row when Google reports the email as unverified", async () => {
    const users = victimRow("salt:hash");
    setMockD1(createMockD1(users, { usr_victim: "admin" }));
    mockGoogle("victim@example.com", "Attacker", false);

    const response = await runCallback();

    expect(response.status).not.toBe(307);
    expect(response.cookies.get("fp_session")).toBeUndefined();
    expect(users[0].password).toBe("salt:hash");
  });

  it("reuses the existing row and role but clears its unverified password on a verified link", async () => {
    const users = victimRow(await hashPassword("attacker-password"));
    setMockD1(createMockD1(users, { usr_victim: "admin" }));
    mockGoogle("victim@example.com", "Victim", true);

    const response = await runCallback();

    expect(response.status).toBe(307);
    const payload = await verifySession(response.cookies.get("fp_session")?.value as string);
    expect(payload.id).toBe("usr_victim");
    expect(payload.role).toBe("admin");
    expect(users.length).toBe(1);
    expect(users[0].password).toBeNull();
  });

  it("kills the pre-registered password: credential login then fails with the generic 401", async () => {
    const password = "attacker-password";
    setMockD1(createMockD1(victimRow(await hashPassword(password)), { usr_victim: "admin" }));
    mockGoogle("victim@example.com", "Victim", true);
    await runCallback();

    const loginResponse = await LOGIN(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "victim@example.com", password }),
      })
    );

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.cookies.get("fp_session")).toBeUndefined();
    expect((await loginResponse.json()).error).toBe("Invalid credentials");
  });
});
