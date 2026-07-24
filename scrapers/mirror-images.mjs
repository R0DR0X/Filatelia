/**
 * MIRROR IMAGES — External Images → Cloudflare R2 Ingestion Engine
 * =================================================================
 * Ingests external stamp images, resizes 300px WebP thumbnails via Sharp,
 * uploads to Cloudflare R2 dual buckets (stamps-images & stamps-thumbs),
 * and tracks resumable state in scrapers/checkpoints/r2-pipeline.json.
 *
 * Usage:
 *   node scrapers/mirror-images.mjs [--country=PE] [--limit=1000] [--concurrency=10] [--dry-run] [--resume]
 */

import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { processThumbnail } from './lib/image-processor.mjs';
import { uploadToR2, formatR2Key, getPublicUrl } from './lib/r2-client.mjs';
import {
  loadCheckpoint,
  saveCheckpoint,
  isCompleted,
  markCompleted,
  markFailed,
} from './lib/checkpoint-manager.mjs';

const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const R2_PREFIX = process.env.R2_PUBLIC_DOMAIN || `${API_URL}/r2/`;
const CHECKPOINT_PATH = './scrapers/checkpoints/r2-pipeline.json';
const FETCH_TIMEOUT_MS = 10000;

/**
 * Parse and strictly validate/sanitize CLI arguments.
 * @param {string[]} argv 
 * @returns {{ country: string|null, limit: number, concurrency: number, dryRun: boolean, resume: boolean }}
 */
export function parseAndValidateArgs(argv = process.argv.slice(2)) {
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

  let country = null;
  if (args.country && typeof args.country === 'string') {
    // Sanitize country code to prevent injection attacks (allow only alphanumeric)
    const sanitized = args.country.trim().replace(/[^a-zA-Z0-9]/g, '');
    country = sanitized.length > 0 ? sanitized.toUpperCase() : null;
  }

  const limit = args.limit ? Math.max(1, parseInt(String(args.limit), 10) || 5000) : 5000;
  const concurrency = args.concurrency ? Math.min(50, Math.max(1, parseInt(String(args.concurrency), 10) || 10)) : 10;
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true' || args.dryRun === true;
  const resume = args.resume !== false && args.resume !== 'false';

  return { country, limit, concurrency, dryRun, resume };
}

/**
 * Infer extension from URL or content-type header.
 * @param {string} url 
 * @param {string} [contentType] 
 * @returns {string}
 */
export function extFromUrl(url, contentType) {
  if (contentType) {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
  }
  const match = (url || '').match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return (match?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
}

/**
 * Fetch pending stamp records from D1 database API.
 * @param {string|null} country 
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<Array<{ id: number|string, imageUrl: string, imageThumbUrl?: string, countryCode?: string, year?: number }>>}
 */
export async function fetchStampsToMirror(country, limit, offset = 0) {
  const countryCond = country ? 'AND countryCode = ?' : '';
  const params = country
    ? [R2_PREFIX.length, R2_PREFIX, country, limit, offset]
    : [R2_PREFIX.length, R2_PREFIX, limit, offset];

  const sql = `
    SELECT id, wnsNumber, nameEn, countryCode, year, imageUrl, imageThumbUrl
    FROM Stamp
    WHERE imageUrl IS NOT NULL
      AND imageUrl != ''
      AND SUBSTR(imageUrl, 1, 4) = 'http'
      AND SUBSTR(imageUrl, 1, ?) != ?
      ${countryCond}
    ORDER BY id ASC
    LIMIT ? OFFSET ?
  `;

  try {
    const res = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) throw new Error(`Query failed with status ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error(`[Mirror] Failed to fetch stamps from D1 API: ${err.message}`);
    return [];
  }
}

/**
 * Download external image buffer with timeout & error handling boundaries.
 * @param {string} url 
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
export async function downloadExternalImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    };

    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 429) {
      throw new Error(`HTTP 429 Rate Limited`);
    }

    if (!res.ok) {
      throw new Error(`HTTP Download error ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (contentType.includes('text/html')) {
      throw new Error(`Corrupted response: returned HTML page instead of image buffer`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return { buffer, contentType };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Process single stamp item: download, resize, upload to R2, update checkpoint.
 * @param {object} stamp 
 * @param {object} options 
 * @param {object} checkpointState 
 */
export async function processStampItem(stamp, options, checkpointState) {
  const { dryRun } = options;

  if (isCompleted(checkpointState, stamp.id)) {
    return { status: 'skipped', id: stamp.id };
  }

  try {
    // 1. Download raw image
    const { buffer: rawBuffer, contentType } = await downloadExternalImage(stamp.imageUrl);

    // 2. Process thumbnail with Sharp
    const thumbResult = await processThumbnail(rawBuffer);
    if (thumbResult.status === 'corrupt_buffer') {
      markFailed(checkpointState, stamp.id, thumbResult.error || 'Corrupt image buffer', 'corrupt_buffer');
      return { status: 'corrupt_buffer', id: stamp.id, error: thumbResult.error };
    }

    const ext = extFromUrl(stamp.imageUrl, contentType);
    const imageKey = formatR2Key('stamp', stamp.id, ext);
    const thumbKey = formatR2Key('thumb', stamp.id);

    if (dryRun) {
      const mockImgUrl = getPublicUrl(imageKey);
      const mockThumbUrl = getPublicUrl(thumbKey);
      markCompleted(checkpointState, stamp.id, { dryRun: true, r2ImageUrl: mockImgUrl, r2ThumbUrl: mockThumbUrl });
      return { status: 'completed', id: stamp.id, dryRun: true, r2ImageUrl: mockImgUrl, r2ThumbUrl: mockThumbUrl };
    }

    // 3. Upload raw image to stamps-images bucket
    const imgUpload = await uploadToR2({
      bucket: 'stamps-images',
      key: imageKey,
      buffer: rawBuffer,
      contentType,
    });

    if (!imgUpload.success) {
      markFailed(checkpointState, stamp.id, imgUpload.error || 'Failed uploading raw image to R2');
      return { status: 'failed', id: stamp.id, error: imgUpload.error };
    }

    // 4. Upload thumbnail to stamps-thumbs bucket
    const thumbUpload = await uploadToR2({
      bucket: 'stamps-thumbs',
      key: thumbKey,
      buffer: thumbResult.thumbBuffer,
      contentType: 'image/webp',
    });

    if (!thumbUpload.success) {
      markFailed(checkpointState, stamp.id, thumbUpload.error || 'Failed uploading thumbnail to R2');
      return { status: 'failed', id: stamp.id, error: thumbUpload.error };
    }

    // 5. Update checkpoint as completed
    markCompleted(checkpointState, stamp.id, {
      r2ImageUrl: imgUpload.publicUrl,
      r2ThumbUrl: thumbUpload.publicUrl,
      width: thumbResult.width,
      height: thumbResult.height,
    });

    return {
      status: 'completed',
      id: stamp.id,
      r2ImageUrl: imgUpload.publicUrl,
      r2ThumbUrl: thumbUpload.publicUrl,
    };
  } catch (err) {
    const isCorrupt = err.message.includes('Corrupted response') || err.message.includes('text/html');
    const statusType = isCorrupt ? 'corrupt_buffer' : 'failed';
    markFailed(checkpointState, stamp.id, err.message, statusType);
    return { status: statusType, id: stamp.id, error: err.message };
  }
}

/**
 * Main ingestion workflow runner.
 */
export async function main() {
  const options = parseAndValidateArgs();
  console.log(`\n🚀 R2 Image Pipeline — Ingestion Engine`);
  console.log(`   Country filter: ${options.country || 'ALL'}`);
  console.log(`   Limit:          ${options.limit}`);
  console.log(`   Concurrency:    ${options.concurrency}`);
  console.log(`   Dry run:        ${options.dryRun}`);
  console.log(`   Resume:         ${options.resume}\n`);

  const checkpoint = loadCheckpoint(CHECKPOINT_PATH);
  const limit = pLimit(options.concurrency);

  let processedCount = 0;
  let offset = checkpoint.offset || 0;

  while (processedCount < options.limit) {
    const batchSize = Math.min(50, options.limit - processedCount);
    const stamps = await fetchStampsToMirror(options.country, batchSize, offset);

    if (!stamps || stamps.length === 0) {
      console.log('✅ No more pending stamps found to mirror.');
      break;
    }

    const tasks = stamps.map((stamp) =>
      limit(async () => {
        const result = await processStampItem(stamp, options, checkpoint);
        processedCount++;
        return result;
      })
    );

    await Promise.all(tasks);
    offset += stamps.length;
    checkpoint.offset = offset;
    saveCheckpoint(CHECKPOINT_PATH, checkpoint);
    console.log(`[Batch Progress] Processed ${processedCount}/${options.limit} stamps...`);
  }

  console.log(`\n✅ Ingestion finished: ${checkpoint.mirrored} mirrored, ${checkpoint.errors} errors.`);
}

// Execute main if run directly from command line
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal pipeline execution error:', err);
    process.exit(1);
  });
}
