// Client-side fetch with a hard upper bound, mirroring the pattern the
// admin proxy already established server-side (WORKER_FETCH_TIMEOUT_MS +
// AbortController in src/app/api/admin/[...path]/route.ts).
//
// WHY: a browser `fetch()` has no default timeout. A response that never
// arrives — a stalled edge invocation, a dead connection a laptop resumed
// from sleep — leaves the calling component's `loading` flag true forever,
// so the user sees a spinner with no error, no retry and no explanation.
// Bounding the wait converts that into an ordinary, recoverable failure the
// UI can name in Spanish.

/**
 * 15s, the same budget the admin proxy gives its server-to-server hop. Every
 * call these pages make is a single indexed D1 read behind an edge function:
 * far below this in the healthy case, so a request that passes 15s is
 * stalled, not slow.
 */
export const CLIENT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Runs `fetch` under an AbortController that fires after `timeoutMs`.
 * Rejects with an AbortError on timeout — callers treat it exactly like any
 * other network failure.
 *
 * `options.fetchImpl` exists so this is unit-testable without a DOM or a
 * live network (this repo's vitest config runs `environment: 'node'`).
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? CLIENT_FETCH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
