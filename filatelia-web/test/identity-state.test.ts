import { describe, test, expect } from "vitest";
import { identityFromMeResult } from "../src/lib/identityState";

describe("identityFromMeResult", () => {
  test("an authenticated probe carries the user through", () => {
    const user = { id: "usr_1", name: "Ana", email: "ana@example.com" };
    expect(identityFromMeResult({ status: "authenticated", user })).toEqual({
      status: "authenticated",
      user,
    });
  });

  test("an authoritative 401 becomes the anonymous state", () => {
    expect(identityFromMeResult({ status: "anonymous", user: null })).toEqual({ status: "anonymous" });
  });

  // The bug this pins down: surfaces used to `return` on an inconclusive
  // probe without ever leaving the "unknown" state, so an offline browser,
  // a 5xx from /api/auth/me or a non-JSON 200 left the page rendering its
  // spinner forever with no error and no retry.
  test("an inconclusive probe becomes its own actionable state, never 'unknown'", () => {
    const identity = identityFromMeResult({ status: "unavailable", user: null });
    expect(identity).toEqual({ status: "unavailable" });
    expect(identity.status).not.toBe("unknown");
  });
});
