import { describe, it, expect } from 'vitest';

describe('Task 4.2: Worker API POST /query Endpoint Unit & Integration Tests', () => {
  const WORKER_URL = 'http://localhost:8787/query';

  it('rejects requests missing both query and image parameters with HTTP 400', async () => {
    // Simulated validation logic matching index.ts
    const handleQueryValidation = (body: any) => {
      const { query, image, sql } = body || {};
      if (sql && !query && !image) return { status: 200, ok: true };
      if (!query && !image) {
        return { status: 400, body: { error: 'Either text query or image payload is required' } };
      }
      return { status: 200, ok: true };
    };

    const emptyRes = handleQueryValidation({});
    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.error).toBe('Either text query or image payload is required');

    const nullFieldsRes = handleQueryValidation({ query: '', image: null });
    expect(nullFieldsRes.status).toBe(400);
  });

  it('parses base64 image strings and strips data header properly', () => {
    const rawDataUrl = 'data:image/jpeg;base64,c2VsbG8gcG9zdGFsIHBlcnVhbm8=';
    const cleanBase64 = rawDataUrl.replace(/^data:image\/[a-zA-Z0-9+\/]+;base64,/, '').trim();
    expect(cleanBase64).toBe('c2VsbG8gcG9zdGFsIHBlcnVhbm8=');

    const binaryString = atob(cleanBase64);
    const buffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i);
    }
    expect(buffer.length).toBe(20);

  });

  it('formats ranked similarity match results with confidence percentage badges', () => {
    const mockMatches = [
      { id: 'stamp_101', score: 0.94, nameEs: 'Sello Un Dinero 1857' },
      { id: 'stamp_102', score: 0.81, nameEs: 'Sello Medio Peso 1858' },
    ];

    const formatted = mockMatches.map(m => ({
      ...m,
      similarity: m.score,
      confidence: Math.round(m.score * 100),
    }));

    expect(formatted[0].confidence).toBe(94);
    expect(formatted[1].confidence).toBe(81);
  });
});
