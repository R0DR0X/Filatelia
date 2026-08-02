import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/auth/login/route";
import { hashPassword } from "../src/lib/password";
import { verifySession } from "../src/lib/session";

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
              if (/FROM User WHERE email/i.test(sql)) {
                return users.find((u) => u.email === params[0]) || null;
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

function loginRequest(body: any) {
  return new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("issues an fp_session cookie with the user's id and resolved role on valid credentials", async () => {
    const password = "s3cret-pass";
    const passwordHash = await hashPassword(password);
    setMockD1(
      createMockD1([{ id: "usr_1", name: "Ana", email: "ana@example.com", password: passwordHash, role: "collector" }])
    );

    const response = await POST(loginRequest({ email: "ana@example.com", password }));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);

    const cookie = response.cookies.get("fp_session")?.value;
    expect(cookie).toBeTruthy();
    const payload = await verifySession(cookie as string);
    expect(payload).not.toBeNull();
    expect(payload.id).toBe("usr_1");
    expect(payload.role).toBe("collector");
  });

  it("returns 401 with no cookie when the password is wrong", async () => {
    const passwordHash = await hashPassword("s3cret-pass");
    setMockD1(
      createMockD1([{ id: "usr_1", name: "Ana", email: "ana@example.com", password: passwordHash, role: "collector" }])
    );

    const response = await POST(loginRequest({ email: "ana@example.com", password: "wrong-password" }));
    expect(response.status).toBe(401);
    expect(response.cookies.get("fp_session")).toBeUndefined();
  });

  it("returns 401 with a generic error, indistinguishable from wrong password, when the email is unknown", async () => {
    setMockD1(createMockD1([]));

    const response = await POST(loginRequest({ email: "nobody@example.com", password: "whatever" }));
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(typeof data.error).toBe("string");
    expect(response.cookies.get("fp_session")).toBeUndefined();
  });
});
