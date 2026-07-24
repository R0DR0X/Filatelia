import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseAndValidateArgs, extFromUrl, processStampItem } from '../scrapers/mirror-images.mjs';
import { createInitialState } from '../scrapers/lib/checkpoint-manager.mjs';

test('mirror-images: parses and sanitizes CLI arguments', () => {
  const options = parseAndValidateArgs([
    '--country=PE',
    '--limit=500',
    '--concurrency=15',
    '--dry-run',
  ]);

  assert.equal(options.country, 'PE');
  assert.equal(options.limit, 500);
  assert.equal(options.concurrency, 15);
  assert.equal(options.dryRun, true);
  assert.equal(options.resume, true);
});

test('mirror-images: sanitizes malicious country argument to prevent SQL injection', () => {
  const options = parseAndValidateArgs([
    "--country=PE' OR 1=1--",
  ]);

  assert.equal(options.country, 'PEOR11');
});

test('mirror-images: extracts file extension accurately', () => {
  assert.equal(extFromUrl('https://example.com/stamp.png?v=1'), 'png');
  assert.equal(extFromUrl('https://example.com/stamp.JPEG'), 'jpg');
  assert.equal(extFromUrl('https://example.com/stamp.webp'), 'webp');
  assert.equal(extFromUrl('https://example.com/stamp', 'image/png'), 'png');
});

test('mirror-images: handles dry-run processing cleanly without making network uploads', async () => {
  const checkpointState = createInitialState();
  const stamp = {
    id: 999,
    imageUrl: 'https://example.com/stamps/999.jpg',
    imageThumbUrl: 'https://example.com/stamps/999-thumb.jpg',
  };

  // Create valid JPEG buffer for test image
  const validJpegBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .jpeg()
    .toBuffer();

  // Mock downloadExternalImage for unit test isolation
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('999.jpg')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/jpeg']]),
        arrayBuffer: async () => validJpegBuffer.buffer.slice(validJpegBuffer.byteOffset, validJpegBuffer.byteOffset + validJpegBuffer.byteLength),
      };
    }
    return originalFetch(url);
  };

  try {
    const result = await processStampItem(stamp, { dryRun: true }, checkpointState);

    assert.equal(result.status, 'completed');
    assert.equal(result.dryRun, true);
    assert.ok(result.r2ImageUrl.includes('stamps/999.jpg'));
    assert.equal(checkpointState.items['999'].status, 'completed');
  } finally {
    global.fetch = originalFetch;
  }
});
