import { NextRequest, NextResponse } from "next/server";
import { signSession, verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not implemented in production" }, { status: 501 });
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email) {
      return NextResponse.json({ success: false, error: "Email is required" }, { status: 400 });
    }

    // Default user for testing/auth flow
    const user = {
      id: `usr_${Buffer.from(email).toString('hex').slice(0, 10)}`,
      name: email.split('@')[0],
      email,
      role: "collector",
    };

    const response = NextResponse.json({ success: true, user });
    const signedToken = await signSession(user);
    response.cookies.set("fp_session", signedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
