import { describe, it, expect, vi, afterEach } from "vitest";
import { signSession, verifySession, SESSION_TTL_SECONDS, ABSOLUTE_SESSION_TTL_SECONDS } from "../src/lib/session";

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

describe("session absolute lifetime cap (origIat survives sliding renewal)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes a 90-day absolute cap, distinct from the 30-day sliding TTL", () => {
    expect(ABSOLUTE_SESSION_TTL_SECONDS).toBe(60 * 60 * 24 * 90);
  });

  it("keeps renewing a token repeatedly renewed well inside the absolute cap", async () => {
    vi.useFakeTimers();
    const start = Date.parse("2024-01-01T00:00:00Z");
    vi.setSystemTime(start);

    let token = await signSession({ id: "usr_1" });

    // Simulate middleware's sliding renewal every 20 days (well under the
    // 30-day exp) for 80 days total — still under the 90-day absolute cap.
    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(start + i * 20 * 24 * 60 * 60 * 1000);
      const payload = await verifySession(token);
      expect(payload).not.toBeNull();
      token = await signSession(payload);
    }

    const finalPayload = await verifySession(token);
    expect(finalPayload).not.toBeNull();
  });

  it("rejects a repeatedly-renewed token once the total elapsed time exceeds the absolute cap, even though each renewal kept exp fresh", async () => {
    vi.useFakeTimers();
    const start = Date.parse("2024-01-01T00:00:00Z");
    vi.setSystemTime(start);

    let token = await signSession({ id: "usr_1" });

    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(start + i * 20 * 24 * 60 * 60 * 1000);
      const payload = await verifySession(token);
      expect(payload).not.toBeNull();
      token = await signSession(payload);
    }

    // Day 100: exp from the last renewal (day 80 + 30) is still in the
    // future, but total elapsed time since the ORIGINAL issuance (day 0) is
    // 100 days > the 90-day absolute cap.
    vi.setSystemTime(start + 100 * 24 * 60 * 60 * 1000);
    const payload = await verifySession(token);
    expect(payload).toBeNull();
  });

  it("cannot be extended by a caller passing a future origIat directly into signSession", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2024-01-01T00:00:00Z");
    vi.setSystemTime(now);

    const nowSeconds = Math.floor(now / 1000);
    const forgedFutureOrigIat = nowSeconds + 60 * 60 * 24 * 365; // 1 year in the future

    const token = await signSession({ id: "usr_1", origIat: forgedFutureOrigIat });
    const payload = await verifySession(token);

    expect(payload).not.toBeNull();
    // The forged future value must never be honored: origIat must be
    // stamped from the server clock (now), not accepted verbatim.
    expect(payload.origIat).toBeLessThanOrEqual(nowSeconds);
  });

  it("grandfathers a legacy token signed before this change (no origIat claim) — no cap is enforced until it is next renewed", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const legacyToken = await signWithDevSecret({ id: "usr_1", iat, exp: iat + SESSION_TTL_SECONDS });

    const payload = await verifySession(legacyToken);
    expect(payload).not.toBeNull();
    expect(payload.origIat).toBeUndefined();

    // Once renewed, the token is no longer legacy: it gets an origIat and is
    // capped going forward from that point.
    const renewed = await signSession(payload);
    const renewedPayload = await verifySession(renewed);
    expect(renewedPayload).not.toBeNull();
    expect(typeof renewedPayload.origIat).toBe("number");
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
