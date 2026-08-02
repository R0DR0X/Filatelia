import { describe, it, expect, afterEach } from "vitest";
import { resolveUserRole, findUserByEmail, createUser, upsertGoogleUser } from "../src/lib/db/users";

// Node's `process.env` coerces every assigned value to a string, so
// `process.env.DB = mockObject` silently becomes the string
// "[object Object]" and loses the mock's `prepare` method. The edge runtime
// this code actually runs under (see src/lib/db/collection.ts's comment)
// provides a plain-object `process.env` shim without that coercion, so
// production is unaffected — but tests must bypass Node's real env object by
// replacing `process.env` wholesale instead of assigning one key.
function setMockD1(mock: any) {
  process.env = Object.assign({}, process.env, { DB: mock });
}
function clearMockD1() {
  const { DB, ...rest } = process.env as any;
  process.env = rest;
}

// Minimal fake D1 binding: supports exactly the prepare().bind().first()/run()
// shape this module needs against the real User/Role/UserRole schema
// (workers/filatelia-api/schema.sql). No `role` column on User — role always
// comes from a separate UserRole/Role lookup, matching production.
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
              if (/FROM User WHERE id/i.test(sql)) {
                return users.find((u) => u.id === params[0]) || null;
              }
              if (/FROM UserRole/i.test(sql)) {
                const roleName = roleByUserId[params[0]];
                return roleName ? { name: roleName } : null;
              }
              return null;
            },
            async run() {
              if (/INSERT INTO User/i.test(sql)) {
                users.push({
                  id: params[0],
                  name: params[1] ?? null,
                  email: params[2] ?? null,
                  password: params[3] ?? null,
                });
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

describe("db/users role resolution (UserRole/Role join, never a User.role column)", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("resolves 'admin' when a matching UserRole/Role row exists", async () => {
    setMockD1(createMockD1([], { usr_admin: "admin" }));
    const role = await resolveUserRole("usr_admin");
    expect(role).toBe("admin");
  });

  it("defaults to 'collector' when the user has no UserRole row", async () => {
    setMockD1(createMockD1([], {}));
    const role = await resolveUserRole("usr_no_role");
    expect(role).toBe("collector");
  });
});

describe("db/users findUserByEmail / createUser", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("returns null when no User row matches the email", async () => {
    setMockD1(createMockD1([]));
    const user = await findUserByEmail("nobody@example.com");
    expect(user).toBeNull();
  });

  it("returns the resolved role alongside the User row when found", async () => {
    setMockD1(
      createMockD1(
        [{ id: "usr_1", name: "Ana", email: "ana@example.com", password: "salt:hash" }],
        { usr_1: "admin" }
      )
    );
    const user = await findUserByEmail("ana@example.com");
    expect(user).not.toBeNull();
    expect(user!.id).toBe("usr_1");
    expect(user!.role).toBe("admin");
  });

  it("createUser inserts a new row that findUserByEmail can then find, defaulting to collector", async () => {
    const users: any[] = [];
    setMockD1(createMockD1(users));

    const created = await createUser({ name: "Beto", email: "beto@example.com", passwordHash: "salt:hash" });
    expect(created.role).toBe("collector");
    expect(created.id).toMatch(/^usr_/);

    const found = await findUserByEmail("beto@example.com");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });
});

describe("db/users upsertGoogleUser", () => {
  afterEach(() => {
    clearMockD1();
  });

  it("reuses the existing row and role for a returning email", async () => {
    setMockD1(
      createMockD1(
        [{ id: "usr_existing", name: "Admin User", email: "admin@example.com", password: "salt:hash" }],
        { usr_existing: "admin" }
      )
    );

    const result = await upsertGoogleUser({
      email: "admin@example.com",
      name: "Admin User",
      verifiedEmail: true,
    });
    expect(result.id).toBe("usr_existing");
    expect(result.role).toBe("admin");
    // The pre-existing password is untrusted (registration never proved email
    // ownership), so linking clears it.
    expect(result.password).toBeNull();
  });

  it("creates a new row for a first-time Google email, defaulting to collector", async () => {
    const users: any[] = [];
    setMockD1(createMockD1(users));

    const result = await upsertGoogleUser({
      email: "new@example.com",
      name: "New Person",
      verifiedEmail: true,
    });
    expect(result.role).toBe("collector");
    expect(users.some((u) => u.email === "new@example.com")).toBe(true);
  });
});
