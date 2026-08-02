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
    // NOT THE AUTHORITY. This is a cheap, D1-free pre-filter on the
    // possibly-stale `role` claim baked into the token (up to
    // SESSION_TTL_SECONDS old under sliding renewal) — it exists only to
    // bounce an obviously non-admin visitor before rendering the admin UI
    // shell. It deliberately does NOT read D1: this middleware runs on
    // every `/admin/:path*` and `/perfil` request under next-on-pages, and
    // D1 binding availability from Next middleware in that runtime is not
    // something to assume. The actual admin ACTIONS all go through
    // `/api/admin/[...path]`, which re-resolves the role from D1
    // (`resolveUserRole`) on every request and is the real authorization
    // gate — see that route's comment. A revoked admin can still land on
    // the `/admin` page shell until this claim expires or is refreshed, but
    // every write/read they attempt through the proxy is checked live.
    if (payload.role !== "admin") {
      return NextResponse.redirect(
        new URL(`/login?from=${encodeURIComponent(req.nextUrl.pathname)}`, req.url)
      );
    }
  }

  const response = NextResponse.next();

  // Sliding renewal within an absolute ceiling: every authenticated request
  // that reaches a protected route reissues fp_session with a fresh 30-day
  // exp, so an active user is not logged out for mere inactivity inside that
  // window. Renewal is NOT unbounded, though: `signSession` preserves the
  // original issuance time as `origIat`, and `verifySession` rejects the
  // token once it is older than ABSOLUTE_SESSION_TTL_SECONDS (90 days) no
  // matter how fresh `exp` is — a continuously active user IS forced to log
  // in again at that point. Contract: 30-day sliding window, 90-day absolute
  // cap (see src/lib/session.ts for the cap's rationale).
  const renewedToken = await signSession(payload);
  response.cookies.set("fp_session", renewedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

