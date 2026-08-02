import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// Real integration tests dispatched through the Worker's fetch handler
// (vitest-pool-workers `SELF` service binding), not a reimplementation of
// the validation logic. These exercise the actual route.

describe('POST /query', () => {
  it('rejects a request carrying a sql field with 401 and never executes it', async () => {
    const res = await SELF.fetch('http://worker/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // If this were ever executed, it would attempt to read every user row.
      body: JSON.stringify({ sql: 'SELECT * FROM User', params: [] }),
    });

    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.success).toBe(false);
  });

  it('rejects a sql field even when other arbitrary fields are also present', async () => {
    const res = await SELF.fetch('http://worker/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'DROP TABLE Stamp', params: [], topK: 5 }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects requests missing both query and image parameters with HTTP 400', async () => {
    const res = await SELF.fetch('http://worker/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toBe('Either text query or image payload is required');
  });
});
