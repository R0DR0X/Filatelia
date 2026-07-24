export interface GoogleOAuthTokens {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export interface GoogleUserProfile {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Generates a random crypto-safe state token for OAuth CSRF protection.
 */
export function generateOAuthState(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((byte) => chars[byte % chars.length])
    .join('');
}

/**
 * Validates whether the received OAuth state matches the expected state.
 */
export function verifyOAuthState(receivedState: string, expectedState: string): boolean {
  if (!receivedState || !expectedState) return false;
  if (receivedState.length !== expectedState.length) return false;
  let mismatch = 0;
  for (let i = 0; i < receivedState.length; i++) {
    mismatch |= receivedState.charCodeAt(i) ^ expectedState.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Generates Google OAuth 2.0 authorization URL.
 */
export function getGoogleAuthUrl(state: string, redirectUri: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID env var is required');
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: redirectUri,
    client_id: clientId,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    state: state,
  };

  const qs = new URLSearchParams(options);
  return `${rootUrl}?${qs.toString()}`;
}

/**
 * Exchanges Google OAuth code for tokens.
 */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<GoogleOAuthTokens> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID env var is required');
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET env var is required');
  const url = 'https://oauth2.googleapis.com/token';

  const values = {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values).toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to exchange authorization code: ${errorText}`);
  }

  return res.json();
}

/**
 * Fetches Google User Profile using an access token.
 */
export async function getGoogleUserProfile(accessToken: string): Promise<GoogleUserProfile> {
  const res = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?alt=json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error('Failed to fetch Google user profile');
  }

  return res.json();
}
