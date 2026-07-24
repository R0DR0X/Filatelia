import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatR2Key,
  getPublicUrl,
  uploadToR2,
  setS3Client,
} from '../scrapers/lib/r2-client.mjs';

test('r2-client: formats R2 object keys correctly', () => {
  assert.equal(formatR2Key('stamp', 1001, 'jpg'), 'stamps/1001.jpg');
  assert.equal(formatR2Key('stamp', 'PE-202', 'PNG'), 'stamps/PE-202.png');
  assert.equal(formatR2Key('thumb', 1001), 'thumbs/1001.webp');
});

test('r2-client: constructs public CDN URLs', () => {
  assert.equal(getPublicUrl('stamps/1001.jpg', 'https://cdn.filatelia.app'), 'https://cdn.filatelia.app/stamps/1001.jpg');
  assert.equal(getPublicUrl('thumbs/1001.webp', 'https://cdn.filatelia.app/'), 'https://cdn.filatelia.app/thumbs/1001.webp');
});

test('r2-client: retries upload on transient HTTP 503 errors and succeeds', async () => {
  let attempts = 0;
  const mockS3Client = {
    send: async (command) => {
      attempts++;
      if (attempts < 3) {
        const error = new Error('Service Unavailable 503');
        error.$metadata = { httpStatusCode: 503 };
        throw error;
      }
      return { ETag: '"test-etag-123"' };
    },
  };

  setS3Client(mockS3Client);

  try {
    const result = await uploadToR2({
      bucket: 'stamps-images',
      key: 'stamps/1001.jpg',
      buffer: Buffer.from('test-image-data'),
      publicDomain: 'https://cdn.filatelia.app',
    });

    assert.equal(result.success, true);
    assert.equal(attempts, 3);
    assert.equal(result.publicUrl, 'https://cdn.filatelia.app/stamps/1001.jpg');
    assert.equal(result.etag, '"test-etag-123"');
  } finally {
    setS3Client(null);
  }
});

test('r2-client: fails after all exponential backoff retries are exhausted', async () => {
  let attempts = 0;
  const mockFailingS3 = {
    send: async () => {
      attempts++;
      throw new Error('Persistent 500 Internal Error');
    },
  };

  setS3Client(mockFailingS3);

  try {
    const result = await uploadToR2({
      bucket: 'stamps-images',
      key: 'stamps/failed.jpg',
      buffer: Buffer.from('failed-data'),
    });

    assert.equal(result.success, false);
    assert.equal(attempts, 3);
    assert.ok(result.error.includes('Persistent 500'));
  } finally {
    setS3Client(null);
  }
});
