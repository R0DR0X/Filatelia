import { NextRequest, NextResponse } from "next/server";
import { generateOAuthState, verifyOAuthState, getGoogleAuthUrl, exchangeCodeForToken, getGoogleUserProfile } from "@/lib/auth-google";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const action = searchParams.get("action");

  const redirectUri = `${new URL(request.url).origin}/api/auth/google`;

  // Step 1: Initiate Google OAuth Flow
  if (action === "login" || !code) {
    const newState = generateOAuthState();
    const googleUrl = getGoogleAuthUrl(newState, redirectUri);
    const response = NextResponse.redirect(googleUrl);
    response.cookies.set("oauth_state", newState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600, // 10 minutes
    });
    return response;
  }

  // Step 2: Handle OAuth Callback
  const expectedState = request.cookies.get("oauth_state")?.value || "";

  if (!state || !verifyOAuthState(state, expectedState)) {
    return NextResponse.json({ error: "Invalid state parameter" }, { status: 400 });
  }

  try {
    const tokenData = await exchangeCodeForToken(code, redirectUri);
    const googleUser = await getGoogleUserProfile(tokenData.access_token);

    const userPayload = {
      id: `usr_${googleUser.id}`,
      name: googleUser.name,
      email: googleUser.email,
      picture: googleUser.picture,
      role: "collector",
    };

    const response = NextResponse.redirect(new URL("/perfil", request.url));
    
    // Set secure fp_session cookie
    const { signSession } = await import("@/lib/session");
    const signedToken = await signSession(userPayload);
    response.cookies.set("fp_session", signedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    // Clear state cookie
    response.cookies.delete("oauth_state");

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Authentication failed" }, { status: 500 });
  }
}
