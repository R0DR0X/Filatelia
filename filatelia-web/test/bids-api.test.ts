import { test } from "node:test";
import assert from "node:assert";
import { POST } from "../src/app/api/bids/route";
import { NextRequest } from "next/server";
import { resetAuctionsStore } from "../src/lib/db/auctions";
import { signSession } from "../src/lib/session";

function bidRequest(init: { headers?: Record<string, string>; body?: any }) {
  return new NextRequest("http://localhost:3000/api/bids", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    body: JSON.stringify(init.body ?? { auctionId: "auc-01", amount: 999 }),
  });
}

test("test_bids_bearer_token_impersonation_rejected: Authorization Bearer with an arbitrary usr_ id does not authenticate", async () => {
  resetAuctionsStore();

  const request = bidRequest({
    headers: { Authorization: "Bearer usr_victim" },
  });

  const response = await POST(request);
  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.code, "UNAUTHORIZED");
});

test("test_bids_unsigned_cookie_rejected: an arbitrary unsigned fp_session cookie does not authenticate", async () => {
  resetAuctionsStore();

  const request = bidRequest({
    headers: { Cookie: "fp_session=usr_victim" },
  });

  const response = await POST(request);
  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.code, "UNAUTHORIZED");
});

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signWithAttackerSecret(payload: any): Promise<string> {
  // Forges a token with the same JWT-like structure as signSession, but using a
  // secret the attacker made up instead of the server's real APP_SECRET. The
  // module under test caches its secret at import time, so this signs
  // independently rather than mutating process.env after the module has loaded.
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })).buffer as ArrayBuffer);
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const dataToSign = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("attacker-controlled-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
  return `${dataToSign}.${base64UrlEncode(signatureBuffer)}`;
}

test("test_bids_wrong_secret_signature_rejected: a session signed with a different secret does not authenticate", async () => {
  resetAuctionsStore();

  const forgedToken = await signWithAttackerSecret({ id: "usr_victim", name: "Attacker" });

  const request = bidRequest({
    headers: { Cookie: "fp_session=" + forgedToken },
  });

  const response = await POST(request);
  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.code, "UNAUTHORIZED");
});

test("test_bids_tampered_payload_rejected: a session with a tampered payload does not authenticate", async () => {
  resetAuctionsStore();

  const validToken = await signSession({ id: "usr_legit", name: "Legit User" });
  const [headerB64, , signatureB64] = validToken.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ id: "usr_victim", name: "Attacker" }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tamperedToken = `${headerB64}.${tamperedPayload}.${signatureB64}`;

  const request = bidRequest({
    headers: { Cookie: "fp_session=" + tamperedToken },
  });

  const response = await POST(request);
  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.code, "UNAUTHORIZED");
});

test("test_bids_no_credentials_rejected: no Authorization header and no cookie does not authenticate", async () => {
  resetAuctionsStore();

  const request = bidRequest({});

  const response = await POST(request);
  assert.strictEqual(response.status, 401);
  const data = await response.json();
  assert.strictEqual(data.code, "UNAUTHORIZED");
});

test("test_bids_valid_session_authenticates_and_attributes_bid: a genuinely signed session authenticates and attributes the bid to the verified id", async () => {
  resetAuctionsStore();

  const token = await signSession({ id: "usr_real_bidder", name: "Real Bidder" });

  const request = bidRequest({
    headers: { Cookie: "fp_session=" + token },
    body: { auctionId: "auc-01", amount: 999 },
  });

  const response = await POST(request);
  assert.strictEqual(response.status, 201);
  const data = await response.json();
  assert.ok(data.success);
  assert.strictEqual(data.bid.bidderId, "usr_real_bidder");
  assert.strictEqual(data.updatedAuction.currentHighestBidderId, "usr_real_bidder");
});
