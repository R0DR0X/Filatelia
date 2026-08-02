import { describe, it, expect, vi, afterEach } from "vitest";
import { signSession, verifySession, SESSION_TTL_SECONDS } from "../src/lib/session";

// Dev-only fallback secret used by session.ts outside production. Not a real
// secret — mirrors the literal already visible at the top of the source file
// so these tests can forge tokens independently of signSession's own logic.
const DEV_FALLBACK_SECRET = "dev-secret-only-change-in-prod";

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signWithDevSecret(payload: Record<string, any>): Promise<string> {
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })).buffer as ArrayBuffer);
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const dataToSign = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(DEV_FALLBACK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  return `${dataToSign}.${base64UrlEncode(signatureBuffer)}`;
}

describe("session exp issuance (30-day sliding lifetime)", () => {
  it("signs a token whose exp is exactly SESSION_TTL_SECONDS (30 days) after iat", async () => {
    const token = await signSession({ id: "usr_1" });
    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(SESSION_TTL_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
  });

  it("rejects a token whose exp is already in the past", async () => {
    const token = await signSession({ id: "usr_1" }, { ttlSeconds: -10 });
    const payload = await verifySession(token);
    expect(payload).toBeNull();
  });

  it("rejects a validly-signed token that has no exp claim at all", async () => {
    const forged = await signWithDevSecret({ id: "usr_1", iat: Math.floor(Date.now() / 1000) });
    const payload = await verifySession(forged);
    expect(payload).toBeNull();
  });

  it("rejects a validly-signed, non-expired token that has no id claim", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const forged = await signWithDevSecret({ email: "no-id@example.com", iat, exp: iat + SESSION_TTL_SECONDS });
    const payload = await verifySession(forged);
    expect(payload).toBeNull();
  });

  it("ignores a caller-supplied exp/iat and always issues its own", async () => {
    const token = await signSession({ id: "usr_1", exp: 1, iat: 1 });
    const payload = await verifySession(token);
    expect(payload).not.toBeNull();
    expect(payload.exp).toBeGreaterThan(1);
  });
});

describe("session verification rejects invalid signatures", () => {
  it("rejects a validly-signed token whose payload segment was mutated after signing (tampered cookie)", async () => {
    const token = await signSession({ id: "usr_1" });
    const [headerB64, payloadB64, signatureB64] = token.split(".");

    const decodedPayload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    const tamperedPayload = { ...decodedPayload, id: "usr_attacker" };
    const tamperedPayloadB64 = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(tamperedPayload)).buffer as ArrayBuffer
    );
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;

    const payload = await verifySession(tamperedToken);
    expect(payload).toBeNull();
  });

  it("rejects a cookie signed with a different APP_SECRET than the one currently configured", async () => {
    const originalSecret = process.env.APP_SECRET;
    process.env.APP_SECRET = "old-rotated-secret";
    let tokenSignedWithOldSecret: string;
    try {
      tokenSignedWithOldSecret = await signSession({ id: "usr_1" });
    } finally {
      if (originalSecret !== undefined) {
        process.env.APP_SECRET = originalSecret;
      } else {
        delete process.env.APP_SECRET;
      }
    }

    process.env.APP_SECRET = "new-current-secret";
    try {
      const payload = await verifySession(tokenSignedWithOldSecret);
      expect(payload).toBeNull();
    } finally {
      if (originalSecret !== undefined) {
        process.env.APP_SECRET = originalSecret;
      } else {
        delete process.env.APP_SECRET;
      }
    }
  });
});

describe("APP_SECRET fail-fast in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws instead of signing when NODE_ENV=production and APP_SECRET is unset", async () => {
    const originalSecret = process.env.APP_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.APP_SECRET;
    try {
      await expect(signSession({ id: "usr_1" })).rejects.toThrow();
    } finally {
      if (originalSecret !== undefined) process.env.APP_SECRET = originalSecret;
    }
  });
});
