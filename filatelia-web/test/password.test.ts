import { describe, it, expect } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { hashPassword, verifyPassword } from "../src/lib/password";

function toHex(buf: Buffer): string {
  return buf.toString("hex");
}

describe("password hashing (PBKDF2-SHA256, 100000 iterations, saltHex:hashHex)", () => {
  it("accepts a hash produced by an independent PBKDF2-SHA256/100000/32-byte implementation (prod format compatibility)", async () => {
    const password = "correct horse battery staple";
    const saltHex = "0123456789abcdef0123456789abcdef"; // 16 bytes -> 32 hex chars
    const hashHex = toHex(pbkdf2Sync(password, Buffer.from(saltHex, "hex"), 100000, 32, "sha256"));
    const stored = `${saltHex}:${hashHex}`;

    expect(stored.length).toBe(97);
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
  });

  it("rejects the wrong password against that same prod-format hash", async () => {
    const password = "correct horse battery staple";
    const saltHex = "0123456789abcdef0123456789abcdef";
    const hashHex = toHex(pbkdf2Sync(password, Buffer.from(saltHex, "hex"), 100000, 32, "sha256"));
    const stored = `${saltHex}:${hashHex}`;

    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });

  it("rejects a malformed stored hash without throwing", async () => {
    await expect(verifyPassword("anything", "not-a-valid-format")).resolves.toBe(false);
  });

  it("hashPassword round-trips through verifyPassword and produces the 97-char salt:hash hex format", async () => {
    const password = "another-test-password";
    const stored = await hashPassword(password);

    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    await expect(verifyPassword(password, stored)).resolves.toBe(true);
    await expect(verifyPassword("not-the-password", stored)).resolves.toBe(false);
  });

  it("produces a different salt on each call", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.split(":")[0]).not.toBe(b.split(":")[0]);
  });
});
