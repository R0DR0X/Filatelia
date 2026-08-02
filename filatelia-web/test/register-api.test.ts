import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/auth/register/route";
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
                return null;
              }
              return null;
            },
            async run() {
              if (/INSERT INTO User/i.test(sql)) {
                users.push({ id: params[0], name: params[1], email: params[2], password: params[3] });
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

function registerRequest(body: any) {
  return new NextRequest("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("creates a User row and issues an fp_session cookie for a new email", async () => {
    const users: any[] = [];
    setMockD1(createMockD1(users));

    const response = await POST(registerRequest({ name: "Carla", email: "carla@example.com", password: "s3cret-pass" }));
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(users.some((u) => u.email === "carla@example.com")).toBe(true);

    const cookie = response.cookies.get("fp_session")?.value;
    expect(cookie).toBeTruthy();
    const payload = await verifySession(cookie as string);
    expect(payload).not.toBeNull();
    expect(payload.role).toBe("collector");
  });

  it("returns 409 and creates no row for a duplicate email", async () => {
    const users = [{ id: "usr_existing", name: "Carla", email: "carla@example.com", password: "irrelevant:hash" }];
    setMockD1(createMockD1(users));

    const response = await POST(registerRequest({ name: "Carla 2", email: "carla@example.com", password: "another-pass" }));
    expect(response.status).toBe(409);
    expect(users.length).toBe(1);
  });
});
