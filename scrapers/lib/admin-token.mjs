/**
 * ADMIN TOKEN — Fail-fast guard for the Worker's authenticated import endpoint
 * ==============================================================================
 * `POST /import-stamp` (and its `/admin/import-stamp` alias) is now guarded by
 * `requireAdmin` on the Worker (see workers/filatelia-api/src/index.ts): a
 * caller must present `X-Admin-Token` matching the Worker's `ADMIN_API_TOKEN`
 * secret, or every write is rejected with 403.
 *
 * Scrapers can run for hours before hitting their first `/import-stamp` call
 * (SPARQL queries, page crawls, etc.), so checking the token lazily at
 * `sendBatch()` time would let a whole unattended crawl run to completion and
 * discover every single write failed only at the very end. `requireAdminToken()`
 * is meant to be called once at startup instead, so a missing token fails
 * immediately with a clear message.
 */

/**
 * Reads `ADMIN_API_TOKEN` from the environment or exits the process with a
 * clear error. Call this once at scraper startup, before any long-running
 * crawl work, so a missing token is never discovered only after the crawl
 * has already finished.
 * @returns {string} the admin API token
 */
export function requireAdminToken() {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    console.error(
      '\n❌ ADMIN_API_TOKEN no está definido.\n' +
        '   POST /import-stamp ahora requiere autenticación (X-Admin-Token).\n' +
        '   Exporta la variable antes de correr el scraper, por ejemplo:\n' +
        '     export ADMIN_API_TOKEN="<token>"\n' +
        '   (mismo valor que el secreto ADMIN_API_TOKEN del Worker — ver scrapers/README.md)\n'
    );
    process.exit(1);
  }
  return token;
}

/**
 * Builds the header object to merge into a `fetch()` call to `/import-stamp`.
 * @param {string} token
 * @returns {{ 'X-Admin-Token': string }}
 */
export function adminTokenHeader(token) {
  return { 'X-Admin-Token': token };
}
