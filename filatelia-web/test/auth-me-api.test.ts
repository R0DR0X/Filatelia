import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/auth/me/route";
import { signSession } from "../src/lib/session";

// GET /api/auth/me replaces the Worker's `/auth/me`: it verifies the
// `fp_session` cookie and returns the current D1-backed identity. This did
// not exist before the E1 migration — every browser identity read now goes
// through it instead of a bearer token against the Worker.

// See test/db-users.test.ts for why process.env.DB must be replaced wholesale
// instead of assigned as a single key (Node stringifies process.env values).
function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}

function createMockD1(users: any[]) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first() {
              if (/FROM User WHERE id/i.test(sql)) {
                return users.find((u) => u.id === params[0]) || null;
              }
              if (/FROM UserRole/i.test(sql)) {
                const user = users.find((u) => u.id === params[0]);
                return user?.role ? { name: user.role } : null;
              }
              return null;
            },
            async run() {
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

function meRequest(cookie?: string) {
  return new NextRequest("http://localhost:3000/api/auth/me", {
    headers: cookie ? { Cookie: `fp_session=${cookie}` } : {},
  });
}

describe("GET /api/auth/me", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("returns the D1-backed user for a valid session", async () => {
    setMockD1(
      createMockD1([{ id: "usr_1", name: "Ana", email: "ana@example.com", role: "admin" }])
    );
    const token = await signSession({ id: "usr_1" });

    const response = await GET(meRequest(token));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual({
      success: true,
      user: { id: "usr_1", name: "Ana", email: "ana@example.com", role: "admin" },
    });
  });

  it("returns 401 when there is no session cookie", async () => {
    const response = await GET(meRequest());
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it("returns 401 for an expired session", async () => {
    const token = await signSession({ id: "usr_1" }, { ttlSeconds: -10 });
    const response = await GET(meRequest(token));
    expect(response.status).toBe(401);
  });

  it("returns 401 for a malformed/invalid session token", async () => {
    const response = await GET(meRequest("not-a-valid-token"));
    expect(response.status).toBe(401);
  });

  it("returns 401 when the session is valid but the user row no longer exists", async () => {
    setMockD1(createMockD1([]));
    const token = await signSession({ id: "usr_ghost" });

    const response = await GET(meRequest(token));
    expect(response.status).toBe(401);
  });
});
