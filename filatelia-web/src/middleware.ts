import { NextRequest, NextResponse } from "next/server";
import { verifySession, signSession, SESSION_TTL_SECONDS } from "@/lib/session";

export const config = {
  matcher: ["/admin/:path*", "/perfil"],
};

export async function middleware(req: NextRequest) {
  const cookie = req.cookies.get("fp_session")?.value;
  if (!cookie) {
    return NextResponse.redirect(
      new URL(`/login?from=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
    );
  }

  const payload = await verifySession(cookie);
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

  const response = NextResponse.next();

  // Sliding renewal: every authenticated request that reaches a protected
  // route reissues fp_session with a fresh 30-day exp, so an active user
  // never gets logged out mid-session (product decision: 30-day sliding
  // lifetime, not a fixed 7-day absolute expiry).
  const renewedToken = await signSession(payload);
  response.cookies.set("fp_session", renewedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

