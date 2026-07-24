import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

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

  return NextResponse.next();
}

