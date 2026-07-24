/**
 * R2 CLIENT — Cloudflare R2 S3 Upload Module with Exponential Backoff
 * ===================================================================
 * Uploads original stamp images and WebP thumbnails to Cloudflare R2 dual buckets.
 * Implements exponential backoff retries (3 attempts: 500ms, 1500ms, 4500ms).
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const RETRY_DELAYS_MS = [500, 1500, 4500];

let customS3Client = null;

/**
 * Override internal S3 client (used for unit/integration testing mocks).
 * @param {object|null} client 
 */
export function setS3Client(client) {
  customS3Client = client;
}

/**
 * Get S3 Client instance.
 * @returns {S3Client|object}
 */
export function getS3Client() {
  if (customS3Client) return customS3Client;

  const endpoint = process.env.R2_ENDPOINT ||
    (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);

  return new S3Client({
    region: 'auto',
    endpoint: endpoint || 'https://dummy.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || 'dummy_access_key',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'dummy_secret_key',
    },
  });
}

/**
 * Format R2 storage key according to project convention.
 * @param {'stamp'|'thumb'} type 
 * @param {string|number} stampId 
 * @param {string} [ext='jpg'] 
 * @returns {string} e.g. "stamps/1001.jpg" or "thumbs/1001.webp"
 */
export function formatR2Key(type, stampId, ext = 'jpg') {
  const sanitizedExt = (ext || 'jpg').toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg');
  if (type === 'thumb') {
    return `thumbs/${stampId}.webp`;
  }
  return `stamps/${stampId}.${sanitizedExt}`;
}

/**
 * Construct public R2 CDN URL.
 * @param {string} key 
 * @param {string} [customDomain] 
 * @returns {string}
 */
export function getPublicUrl(key, customDomain) {
  const domain = (customDomain || process.env.R2_PUBLIC_DOMAIN || 'https://cdn.filatelia.app').replace(/\/$/, '');
  const cleanKey = key.replace(/^\//, '');
  return `${domain}/${cleanKey}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload object to Cloudflare R2 bucket with retry backoff logic.
 * @param {object} options
 * @param {'stamps-images'|'stamps-thumbs'|string} options.bucket
 * @param {string} options.key
 * @param {Buffer} options.buffer
 * @param {string} [options.contentType='image/jpeg']
 * @param {string} [options.cacheControl='public, max-age=31536000, immutable']
 * @param {string} [options.publicDomain]
 * @returns {Promise<{
 *   success: boolean,
 *   publicUrl: string,
 *   key: string,
 *   etag?: string,
 *   error?: string
 * }>}
 */
export async function uploadToR2({
  bucket,
  key,
  buffer,
  contentType = 'image/jpeg',
  cacheControl = 'public, max-age=31536000, immutable',
  publicDomain,
}) {
  if (!bucket || !key || !buffer) {
    throw new Error('Missing required upload parameters: bucket, key, or buffer');
  }

  const s3 = getS3Client();
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: cacheControl,
      });

      const response = await s3.send(command);
      const publicUrl = getPublicUrl(key, publicDomain);

      return {
        success: true,
        publicUrl,
        key,
        etag: response?.ETag || 'mock-etag',
      };
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  return {
    success: false,
    publicUrl: getPublicUrl(key, publicDomain),
    key,
    error: lastError ? lastError.message : 'Upload failed after retries',
  };
}
