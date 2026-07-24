const APP_SECRET = process.env.APP_SECRET || 'dev-secret-only-change-in-prod';

async function getSecretKey() {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function base64UrlEncode(arrayBuffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function signSession(payload: any): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  
  const dataToSign = `${headerB64}.${payloadB64}`;
  const key = await getSecretKey();
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(dataToSign)
  );
  const signatureB64 = base64UrlEncode(signatureBuffer);
  
  return `${dataToSign}.${signatureB64}`;
}

export async function verifySession(token: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const dataToVerify = `${headerB64}.${payloadB64}`;
    
    const signatureBuffer = base64UrlDecode(signatureB64);
    const key = await getSecretKey();
    const enc = new TextEncoder();
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      enc.encode(dataToVerify)
    );
    
    if (!isValid) return null;
    
    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    return JSON.parse(payloadStr);
  } catch (error) {
    return null;
  }
}
