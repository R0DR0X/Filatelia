import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "../src/lib/session";
import { GET as collectionGet } from "../src/app/api/collection/route";
import { GET as matchGet } from "../src/app/api/match/route";

// Non-Regression of Existing Consumers: /api/collection and /api/match must
// keep authenticating via fp_session + payload.id exactly as before, now
// that signSession/verifySession issue and enforce exp (Phase 1) and the
// credential/OAuth routes exist (Phase 2). This exercises a session token
// produced by the same signSession() the new login/register/google routes
// use, against the two pre-existing consumers.
describe("session non-regression: /api/collection and /api/match", () => {
  it("/api/collection rejects requests with no fp_session cookie (unchanged behavior)", async () => {
    const request = new NextRequest("http://localhost:3000/api/collection");
    const response = await collectionGet(request);
    expect(response.status).toBe(401);
  });

  it("/api/collection resolves the authenticated user via payload.id from a freshly signed session", async () => {
    const token = await signSession({ id: "usr_regression_check" });
    const request = new NextRequest("http://localhost:3000/api/collection", {
      headers: { Cookie: `fp_session=${token}` },
    });
    const response = await collectionGet(request);
    // Reaches the D1-backed handler (fails only because no D1 binding exists
    // in this test env) rather than being rejected at the auth layer.
    expect(response.status).not.toBe(401);
  });

  it("/api/match rejects requests with no fp_session cookie (unchanged behavior)", async () => {
    const request = new NextRequest("http://localhost:3000/api/match");
    const response = await matchGet(request);
    expect(response.status).toBe(401);
  });

  it("/api/match resolves the authenticated user via payload.id from a freshly signed session", async () => {
    const token = await signSession({ id: "usr_regression_check" });
    const request = new NextRequest("http://localhost:3000/api/match", {
      headers: { Cookie: `fp_session=${token}` },
    });
    const response = await matchGet(request);
    expect(response.status).not.toBe(401);
  });
});
