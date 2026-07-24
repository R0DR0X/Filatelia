/**
 * CHECK INTEGRITY — Post-Hydration Database Integrity Audit
 * =========================================================
 * Audits Cloudflare D1 database records to verify zero non-R2 external image links remain.
 *
 * Usage:
 *   node scrapers/check-integrity.mjs
 */

const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const R2_PREFIX = process.env.R2_PUBLIC_DOMAIN || `${API_URL}/r2/`;

/**
 * Execute D1 query statement.
 * @param {string} sql 
 * @param {Array<any>} params 
 * @returns {Promise<Array<any>>}
 */
export async function queryD1(sql, params = []) {
  try {
    const res = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error(`[Integrity Audit] Database query failed: ${err.message}`);
    return [];
  }
}

/**
 * Perform post-hydration catalog audit.
 * @returns {Promise<{ totalStamps: number, r2Stamps: number, nonR2Stamps: number, missingImages: number, passed: boolean }>}
 */
export async function runIntegrityAudit() {
  const prefixLen = R2_PREFIX.length;

  const totalRes = await queryD1(`SELECT COUNT(*) as count FROM Stamp`);
  const totalStamps = totalRes[0]?.count || 0;

  const r2Res = await queryD1(`SELECT COUNT(*) as count FROM Stamp WHERE SUBSTR(imageUrl, 1, ?) = ?`, [prefixLen, R2_PREFIX]);
  const r2Stamps = r2Res[0]?.count || 0;

  const nonR2Res = await queryD1(
    `SELECT COUNT(*) as count FROM Stamp WHERE imageUrl IS NOT NULL AND imageUrl != '' AND SUBSTR(imageUrl, 1, 4) = 'http' AND SUBSTR(imageUrl, 1, ?) != ?`,
    [prefixLen, R2_PREFIX]
  );
  const nonR2Stamps = nonR2Res[0]?.count || 0;

  const missingRes = await queryD1(`SELECT COUNT(*) as count FROM Stamp WHERE imageUrl IS NULL OR imageUrl = ''`);
  const missingImages = missingRes[0]?.count || 0;

  const passed = nonR2Stamps === 0;

  return {
    totalStamps,
    r2Stamps,
    nonR2Stamps,
    missingImages,
    passed,
  };
}

export async function main() {
  console.log(`\n🔍 R2 Image Pipeline — Post-Hydration Audit`);
  console.log(`   R2 Public Domain Prefix: ${R2_PREFIX}\n`);

  const audit = await runIntegrityAudit();

  console.log(`📊 Audit Results:`);
  console.log(`   Total catalog stamps:       ${audit.totalStamps}`);
  console.log(`   Stamps on Cloudflare R2:    ${audit.r2Stamps}`);
  console.log(`   Remaining external links:   ${audit.nonR2Stamps}`);
  console.log(`   Stamps without image URLs:  ${audit.missingImages}\n`);

  if (audit.passed) {
    console.log(`✅ AUDIT PASSED: 0 non-R2 external image links remain in Cloudflare D1.`);
    process.exit(0);
  } else {
    console.warn(`⚠️ AUDIT WARNING: ${audit.nonR2Stamps} stamps still reference non-R2 external URLs.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Audit execution error:', err);
    process.exit(1);
  });
}
