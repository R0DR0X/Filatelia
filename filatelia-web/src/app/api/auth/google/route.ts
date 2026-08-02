import { NextRequest, NextResponse } from "next/server";
import { generateOAuthState, verifyOAuthState, getGoogleAuthUrl, exchangeCodeForToken, getGoogleUserProfile } from "@/lib/auth-google";
import { signSession, SESSION_TTL_SECONDS } from "@/lib/session";
import { upsertGoogleUser, GoogleEmailUnverifiedError } from "@/lib/db/users";

export const runtime = 'edge';

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

    // Upsert by email: a returning email reuses its D1 row and resolved role
    // (e.g. the admin account); a first-time email creates a new row. This
    // replaces the previous ephemeral, unpersisted identity.
    //
    // `verified_email` is forwarded because email is the account key here: an
    // unverified Google email must not adopt or create a row. See
    // upsertGoogleUser for the full pre-hijacking rationale.
    const dbUser = await upsertGoogleUser({
      email: googleUser.email,
      name: googleUser.name,
      verifiedEmail: googleUser.verified_email === true,
    });

    const userPayload = {
      id: dbUser.id,
      name: dbUser.name || googleUser.name,
      email: dbUser.email,
      picture: googleUser.picture,
      role: dbUser.role,
    };

    const response = NextResponse.redirect(new URL("/perfil", request.url));

    // Set secure fp_session cookie
    const signedToken = await signSession(userPayload);
    response.cookies.set("fp_session", signedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    // Clear state cookie
    response.cookies.delete("oauth_state");

    return response;
  } catch (error: any) {
    if (error instanceof GoogleEmailUnverifiedError) {
      return NextResponse.json(
        { error: "Google no ha verificado este correo electrónico." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message || "Authentication failed" }, { status: 500 });
  }
}
