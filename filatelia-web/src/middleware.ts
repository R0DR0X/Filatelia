import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/admin/:path*", "/perfil"],
};

const JWT_SECRET = process.env.JWT_SECRET || "filatelia-secret-key-change-in-prod";

async function verifyJwtPayload(token: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(JWT_SECRET);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const dataToVerify = encoder.encode(`${headerB64}.${payloadB64}`);

    // Decode base64url signature to binary Uint8Array
    let sigB64 = signatureB64.replace(/-/g, "+").replace(/_/g, "/");
    while (sigB64.length % 4 !== 0) {
      sigB64 += "=";
    }
    const binarySig = atob(sigB64);
    const sigBytes = new Uint8Array(binarySig.length);
    for (let i = 0; i < binarySig.length; i++) {
      sigBytes[i] = binarySig.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      sigBytes,
      dataToVerify
    );

    if (!isValid) return null;

    // Decode base64url payload
    let base64Payload = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    while (base64Payload.length % 4 !== 0) {
      base64Payload += "=";
    }
    const jsonPayload = atob(base64Payload);
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get("fp_session")?.value;
  if (!cookie) {
    return NextResponse.redirect(
      new URL(`/login?from=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
    );
  }

  const payload = await verifyJwtPayload(cookie);
  if (!payload) {
    return NextResponse.redirect(
      new URL(`/login?from=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
    );
  }

  if (req.nextUrl.pathname.startsWith("/admin")) {
    if (payload.role !== "admin") {
      return NextResponse.redirect(
        new URL(`/login?from=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
      );
    }
  }

  return NextResponse.next();
}

