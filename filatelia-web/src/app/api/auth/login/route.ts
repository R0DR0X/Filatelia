import { NextRequest, NextResponse } from "next/server";
import { verifySession, signSession, SESSION_TTL_SECONDS } from "@/lib/session";
import { findUserByEmail } from "@/lib/db/users";
import { verifyPassword } from "@/lib/password";

export const runtime = 'edge';

// Fixed dummy hash (same PBKDF2-SHA256/100000/32-byte shape as a real stored
// hash) run against unknown-email attempts so the work done for "unknown
// email" and "wrong password" stays close in shape, keeping the 401 response
// generic and not trivially distinguishable by which branch returned it.
const DUMMY_HASH =
  "0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const GENERIC_LOGIN_ERROR = "Invalid credentials";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ success: false, error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    const user = await findUserByEmail(email);

    if (!user || !user.password) {
      await verifyPassword(password, DUMMY_HASH);
      return NextResponse.json({ success: false, error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json({ success: false, error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    const token = await signSession({ id: user.id, email: user.email, name: user.name, role: user.role });
    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    response.cookies.set("fp_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ success: false, error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }
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
