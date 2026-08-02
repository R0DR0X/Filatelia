import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";
import { findUserById } from "@/lib/db/users";

// Replaces the Worker's `/auth/me`. Verifies the httpOnly `fp_session`
// cookie and returns the current D1-backed identity, not the (possibly
// stale, up to 30 days old under sliding renewal) claims baked into the
// token — role/name changes made after issuance must be reflected here.
export const runtime = "edge";

const UNAUTHENTICATED = { success: false, error: "Unauthenticated" } as const;

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    return NextResponse.json(UNAUTHENTICATED, { status: 401 });
  }

  const payload = await verifySession(sessionCookie);
  if (!payload?.id) {
    return NextResponse.json(UNAUTHENTICATED, { status: 401 });
  }

  const user = await findUserById(payload.id);
  if (!user) {
    return NextResponse.json(UNAUTHENTICATED, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
