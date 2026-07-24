import { NextResponse } from 'next/server';

const WORKER_API_URL = process.env.WORKER_API_URL || process.env.NEXT_PUBLIC_WORKER_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';

export async function POST(request: Request) {
  try {
    let body: any = {};

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const imageFile = formData.get('image') as File | null;
      const queryStr = formData.get('query') as string | null;
      const topK = formData.get('topK') ? Number(formData.get('topK')) : 10;

      if (!imageFile && !queryStr) {
        return NextResponse.json({ error: 'Either text query or image payload is required' }, { status: 400 });
      }

      let base64Image: string | undefined;
      if (imageFile) {
        const arrayBuffer = await imageFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        base64Image = buffer.toString('base64');
      }

      body = {
        image: base64Image,
        query: queryStr || undefined,
        topK,
      };
    } else {
      body = await request.json().catch(() => ({}));
    }

    if (!body.image && !body.query) {
      return NextResponse.json({ error: 'Either text query or image payload is required' }, { status: 400 });
    }

    // Forward request to Hono Worker API /query endpoint
    const response = await fetch(`${WORKER_API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Info': 'filatelia-web-proxy',
      },
      body: JSON.stringify({
        image: body.image,
        query: body.query,
        topK: body.topK || 10,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Worker API responded with status ${response.status}: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Error in /api/identify proxy route:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error forwarding identification request' },
      { status: 500 }
    );
  }
}
