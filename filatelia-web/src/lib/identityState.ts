// Shared client-side identity state for surfaces that self-check the session
// with `getMe()` instead of relying on middleware.
//
// This module is deliberately UI-free so the mapping can be unit tested
// without a DOM/jsdom harness (this repo's vitest config runs
// `environment: 'node'` and never renders .tsx components — see
// test/identity-state.test.ts).
import type { AuthUser, MeResult } from "@/lib/auth";

/**
 * The four states such a surface can be in.
 *
 * `unavailable` exists because `getMe()` deliberately refuses to collapse
 * "the server says you are logged out" into "the probe never answered" (see
 * MeResult in src/lib/auth.ts). Surfaces that ignored the inconclusive case
 * stayed in `unknown` forever and rendered nothing but their spinner: one
 * flaky `/api/auth/me` was enough to leave a page permanently loading with no
 * error and no retry. `unavailable` is the state that must be rendered as
 * something the visitor can act on.
 */
export type Identity =
  | { status: "unknown" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "anonymous" }
  | { status: "unavailable" };

/**
 * Maps an identity probe to the state to render. Total by construction: every
 * `MeResult` produces a state other than `unknown`, so a surface that assigns
 * this result can never be left waiting on a probe that already answered.
 */
export function identityFromMeResult(result: MeResult): Exclude<Identity, { status: "unknown" }> {
  if (result.status === "authenticated") return { status: "authenticated", user: result.user };
  if (result.status === "anonymous") return { status: "anonymous" };
  return { status: "unavailable" };
}

/** Spanish copy for the inconclusive case, shared by every surface that shows it. */
export const IDENTITY_UNAVAILABLE_TITLE = "No pudimos verificar tu sesión";
export const IDENTITY_UNAVAILABLE_HINT = "Revisa tu conexión e inténtalo de nuevo";
