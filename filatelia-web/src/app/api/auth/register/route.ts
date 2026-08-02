import { NextRequest, NextResponse } from "next/server";
import { signSession, SESSION_TTL_SECONDS } from "@/lib/session";
import { findUserByEmail, createUser } from "@/lib/db/users";
import { hashPassword } from "@/lib/password";

export const runtime = 'edge';

// Registration is open to anyone — no invitation gating (product decision).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name : "";
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ success: false, error: "Email and password are required" }, { status: 400 });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json({ success: false, error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ name, email, passwordHash });

    const token = await signSession({ id: user.id, email: user.email, name: user.name, role: user.role });
    const response = NextResponse.json(
      { success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      { status: 201 }
    );
    response.cookies.set("fp_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error: any) {
    return NextResponse.json({ success: false, error: "Registration failed" }, { status: 500 });
  }
}
