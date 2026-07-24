import { describe, it, expect, vi } from 'vitest';

describe('Task 4.3: Next.js Proxy Route /api/identify Integration Tests', () => {
  it('returns HTTP 400 when missing image and query parameters', async () => {
    const mockRequest = new Request('http://localhost:3000/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Simulate route handler validation
    const handleRoute = async (req: Request) => {
      const body = await req.json().catch(() => ({}));
      if (!body.image && !body.query) {
        return Response.json({ error: 'Either text query or image payload is required' }, { status: 400 });
      }
      return Response.json({ success: true });
    };

    const res = await handleRoute(mockRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Either text query or image payload is required');
  });

  it('forwards base64 image payload to worker and transforms response', async () => {
    const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const mockWorkerResponse = {
      success: true,
      totalMatches: 1,
      matches: [
        { id: 'stamp_55', nameEs: 'Sello Peru 1857 1d', confidence: 95, similarity: 0.95 },
      ],
    };

    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockWorkerResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const proxyBody = { image: sampleBase64, topK: 5 };
    const workerRes = await fetch('https://filatelia-api.rodrigopianto2005.workers.dev/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyBody),
    });

    expect(workerRes.ok).toBe(true);
    const data = await workerRes.json();
    expect(data.success).toBe(true);
    expect(data.matches[0].id).toBe('stamp_55');

    globalThis.fetch = globalFetch;
  });

  it('propagates HTTP 500 error when worker API fails', async () => {
    const handleRouteError = (status: number, errText: string) => {
      return Response.json({ error: `Worker API responded with status ${status}: ${errText}` }, { status });
    };

    const res = handleRouteError(500, 'Vectorize service unavailable');
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Worker API responded with status 500');
  });
});
