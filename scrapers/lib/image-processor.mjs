/**
 * IMAGE PROCESSOR — Sharp-based image optimization & thumbnail generator
 * ======================================================================
 * Resizes raw image buffers into 300px max-width WebP thumbnails (quality 82).
 * Handles corrupted or non-image buffers gracefully by returning corrupt_buffer status.
 */

import sharp from 'sharp';

/**
 * Process a raw image buffer into a 300px WebP thumbnail.
 * @param {Buffer} inputBuffer 
 * @returns {Promise<{
 *   status: 'success' | 'corrupt_buffer',
 *   thumbBuffer?: Buffer,
 *   format?: string,
 *   width?: number,
 *   height?: number,
 *   sizeBytes?: number,
 *   error?: string
 * }>}
 */
export async function processThumbnail(inputBuffer) {
  if (!inputBuffer || !Buffer.isBuffer(inputBuffer)) {
    return {
      status: 'corrupt_buffer',
      error: 'Invalid or missing input buffer',
    };
  }

  try {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    if (!metadata || !metadata.format) {
      return {
        status: 'corrupt_buffer',
        error: 'Unrecognized or invalid image format',
      };
    }

    const thumbBuffer = await sharp(inputBuffer)
      .resize({
        width: 300,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, reductionEffort: 4 })
      .toBuffer();

    const resMetadata = await sharp(thumbBuffer).metadata();

    return {
      status: 'success',
      thumbBuffer,
      format: 'webp',
      width: resMetadata.width,
      height: resMetadata.height,
      sizeBytes: thumbBuffer.length,
    };
  } catch (err) {
    return {
      status: 'corrupt_buffer',
      error: err.message || 'Error parsing image buffer',
    };
  }
}
