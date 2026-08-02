import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

export const runtime = 'edge';

export async function POST(_request: NextRequest) {
  // Credential-based login is not implemented in this app boundary: the only
  // real authentication method wired into filatelia-web is Google OAuth
  // (see /api/auth/google). A previous version of this route accepted ANY
  // password without verification, gated only by NODE_ENV !== "development"
  // — an insecure bypass reachable via env misconfiguration. Rather than
  // reintroduce a credential check against an unverified schema, this route
  // now always returns 501 so no environment can silently authenticate a
  // user without a password check.
  return NextResponse.json(
    {
      success: false,
      error: "Credential login is not supported. Use Google OAuth via /api/auth/google.",
    },
    { status: 501 }
  );
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get("fp_session")?.value;

  if (!sessionCookie) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const user = await verifySession(sessionCookie);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  
  return NextResponse.json({ authenticated: true, user });
}
