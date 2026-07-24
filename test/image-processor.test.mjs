import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processThumbnail } from '../scrapers/lib/image-processor.mjs';

test('image-processor: resizes large image to 300px max-width WebP', async () => {
  // Create a 2400x1600 raw test image buffer using Sharp
  const rawImageBuffer = await sharp({
    create: {
      width: 2400,
      height: 1600,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();

  const result = await processThumbnail(rawImageBuffer);

  assert.equal(result.status, 'success');
  assert.equal(result.format, 'webp');
  assert.ok(result.width <= 300, `Expected width <= 300, got ${result.width}`);
  assert.equal(result.width, 300);
  assert.equal(result.height, 200); // aspect ratio preserved 2400:1600 -> 300:200

  // Verify WebP magic bytes (RIFF .... WEBP)
  const headerRiff = result.thumbBuffer.subarray(0, 4).toString('utf-8');
  const headerWebp = result.thumbBuffer.subarray(8, 12).toString('utf-8');
  assert.equal(headerRiff, 'RIFF');
  assert.equal(headerWebp, 'WEBP');

  // Verify size < 50KB
  assert.ok(result.sizeBytes < 50 * 1024, `Size ${result.sizeBytes} bytes exceeds 50KB`);
});

test('image-processor: does not enlarge smaller image (withoutEnlargement)', async () => {
  const smallImageBuffer = await sharp({
    create: {
      width: 200,
      height: 150,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .png()
    .toBuffer();

  const result = await processThumbnail(smallImageBuffer);

  assert.equal(result.status, 'success');
  assert.equal(result.width, 200);
  assert.equal(result.height, 150);
});

test('image-processor: catches corrupt HTML / invalid buffer gracefully', async () => {
  const corruptBuffer = Buffer.from('<html><body>500 Internal Server Error</body></html>');
  const result = await processThumbnail(corruptBuffer);

  assert.equal(result.status, 'corrupt_buffer');
  assert.ok(result.error);
});
