import { test } from "node:test";
import assert from "node:assert";
import { generateOAuthState, verifyOAuthState, getGoogleAuthUrl } from "../src/lib/auth-google";

test("generateOAuthState creates a 32-character random string", () => {
  const state1 = generateOAuthState();
  const state2 = generateOAuthState();
  assert.strictEqual(typeof state1, "string");
  assert.strictEqual(state1.length, 32);
  assert.notStrictEqual(state1, state2);
});

test("verifyOAuthState succeeds for matching state tokens", () => {
  const state = generateOAuthState();
  assert.strictEqual(verifyOAuthState(state, state), true);
});

test("test_oauth_invalid_state_rejected: verifyOAuthState rejects mismatched or empty states", () => {
  const state1 = generateOAuthState();
  const state2 = generateOAuthState();
  assert.strictEqual(verifyOAuthState(state1, state2), false);
  assert.strictEqual(verifyOAuthState(state1, ""), false);
  assert.strictEqual(verifyOAuthState("", state1), false);
});

test("getGoogleAuthUrl generates valid authorization URL containing state and redirectUri", () => {
  const oldClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "mock_client_id";

  const state = "test_state_123456789012345678901234567890";
  const redirectUri = "http://localhost:3000/api/auth/google";
  const url = getGoogleAuthUrl(state, redirectUri);
  
  assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
  assert.ok(url.includes(`state=${state}`));
  assert.ok(url.includes(`redirect_uri=${encodeURIComponent(redirectUri)}`));

  process.env.GOOGLE_CLIENT_ID = oldClientId;
});
