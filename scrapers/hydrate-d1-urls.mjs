/**
 * HYDRATE D1 URLS — Database R2 CDN Link Hydration CLI
 * ====================================================
 * Reads mirrored stamp URLs from scrapers/checkpoints/r2-pipeline.json
 * and executes parameterized batch updates (50 statements per batch) on Cloudflare D1.
 * Supports batch rollback handling and sample HTTP HEAD link verification.
 *
 * Usage:
 *   node scrapers/hydrate-d1-urls.mjs [--batch-size=50] [--dry-run] [--verify-sample=100]
 */

import fs from 'fs';
import { loadCheckpoint, saveCheckpoint } from './lib/checkpoint-manager.mjs';

const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const CHECKPOINT_PATH = './scrapers/checkpoints/r2-pipeline.json';

/**
 * Parse CLI options for hydration script.
 * @param {string[]} argv 
 * @returns {{ batchSize: number, dryRun: boolean, verifySample: number }}
 */
export function parseHydrateArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx === -1) {
        args[arg.slice(2)] = true;
      } else {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        args[key] = val;
      }
    }
  }

  const batchSize = args['batch-size'] ? Math.max(1, parseInt(String(args['batch-size']), 10) || 50) : 50;
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true' || args.dryRun === true;
  const verifySample = args['verify-sample'] ? Math.max(0, parseInt(String(args['verify-sample']), 10) || 0) : 0;

  return { batchSize, dryRun, verifySample };
}

/**
 * Execute atomic batch SQL statements via D1 API endpoint.
 * Wraps all statements in batch transaction. If any statement fails, rolls back batch.
 * @param {Array<{ sql: string, params: Array<any> }>} statements 
 * @returns {Promise<{ success: boolean, results?: Array<any>, error?: string }>}
 */
export async function executeD1Batch(statements) {
  if (!statements || statements.length === 0) {
    return { success: true, results: [] };
  }

  try {
    const res = await fetch(`${API_URL}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statements }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json();
    return { success: true, results: data.results || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Verify HTTP HEAD response status for a sample set of R2 URLs.
 * @param {string[]} urls 
 * @returns {Promise<{ total: number, valid: number, invalid: number, details: Array<{ url: string, status: number|string }> }>}
 */
export async function verifySampleUrls(urls) {
  let valid = 0;
  let invalid = 0;
  const details = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        valid++;
        details.push({ url, status: res.status });
      } else {
        invalid++;
        details.push({ url, status: res.status });
      }
    } catch (err) {
      invalid++;
      details.push({ url, status: err.message });
    }
  }

  return { total: urls.length, valid, invalid, details };
}

/**
 * Main D1 Hydration runner.
 */
export async function main() {
  const options = parseHydrateArgs();
  console.log(`\n💧 R2 Image Pipeline — D1 URL Hydration Engine`);
  console.log(`   Batch size:    ${options.batchSize}`);
  console.log(`   Dry run:       ${options.dryRun}`);
  console.log(`   Verify sample: ${options.verifySample}\n`);

  const checkpoint = loadCheckpoint(CHECKPOINT_PATH);
  const itemsToHydrate = [];

  for (const [id, item] of Object.entries(checkpoint.items || {})) {
    if (item.status === 'completed' && item.r2ImageUrl && !item.hydrated) {
      itemsToHydrate.push({ id, ...item });
    }
  }

  if (itemsToHydrate.length === 0) {
    console.log('✅ No unhydrated items found in checkpoint.');
    return;
  }

  console.log(`Found ${itemsToHydrate.length} mirrored items ready for D1 hydration.`);

  let totalHydrated = 0;
  let totalBatches = 0;
  let totalErrors = 0;

  for (let i = 0; i < itemsToHydrate.length; i += options.batchSize) {
    const chunk = itemsToHydrate.slice(i, i + options.batchSize);
    totalBatches++;

    const statements = chunk.map((item) => ({
      sql: `UPDATE Stamp SET imageUrl = ?, imageThumbUrl = ?, updatedAt = datetime('now') WHERE id = ?`,
      params: [item.r2ImageUrl, item.r2ThumbUrl || item.r2ImageUrl, item.id],
    }));

    if (options.dryRun) {
      console.log(`[DRY RUN] Batch #${totalBatches} with ${chunk.length} statements prepared.`);
      totalHydrated += chunk.length;
      continue;
    }

    const batchResult = await executeD1Batch(statements);

    if (batchResult.success) {
      for (const item of chunk) {
        if (checkpoint.items[item.id]) {
          checkpoint.items[item.id].hydrated = true;
          checkpoint.items[item.id].hydratedAt = new Date().toISOString();
        }
      }
      totalHydrated += chunk.length;
      console.log(`✅ Batch #${totalBatches} (${chunk.length} stamps) successfully hydrated in D1.`);
    } else {
      totalErrors++;
      console.error(`❌ Batch #${totalBatches} execution failed and rolled back atomically: ${batchResult.error}`);
      for (const item of chunk) {
        if (checkpoint.items[item.id]) {
          checkpoint.items[item.id].hydrationError = batchResult.error;
        }
      }
    }

    saveCheckpoint(CHECKPOINT_PATH, checkpoint);
  }

  console.log(`\n🎉 Hydration summary: ${totalHydrated} stamps hydrated across ${totalBatches} batches (${totalErrors} batch failures).`);

  if (options.verifySample > 0 && itemsToHydrate.length > 0) {
    console.log(`\n🔍 Verifying HTTP HEAD status on sample of ${options.verifySample} hydrated URLs...`);
    const sampleUrls = itemsToHydrate
      .slice(0, options.verifySample)
      .map((item) => item.r2ImageUrl)
      .filter(Boolean);
    const verification = await verifySampleUrls(sampleUrls);
    console.log(`Verification complete: ${verification.valid}/${verification.total} valid 200 OK responses.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal D1 hydration error:', err);
    process.exit(1);
  });
}
