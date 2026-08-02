// Client-side auth helpers. Identity lives exclusively in the httpOnly
// `fp_session` cookie set by the Next `/api/auth/*` routes below — this
// module never reads or writes browser storage and never calls the Worker
// directly. `credentials: "same-origin"` carries the cookie on every call;
// no bearer token is ever kept in the browser.
//
// `getCachedUser()` was removed rather than kept as a browser-storage-backed
// stub: it was a synchronous read by contract, and `fp_session` is httpOnly
// (unreadable from client JS), so a synchronous, storage-free replacement is
// not possible. Its only caller (`Navbar.tsx`) now calls `getMe()` directly,
// the same pattern `PerfilClient.tsx` already used.

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    return await res.json();
  } catch {
    return { success: false, error: "Error de conexión" };
  }
}

export async function register(
  name: string,
  email: string,
  password: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name, email, password }),
    });
    return await res.json();
  } catch {
    return { success: false, error: "Error de conexión" };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // Best-effort: even if the request fails, the caller navigates away.
  }
}

// Result of an identity probe. `getMe()` deliberately does NOT collapse
// "the server says you are not authenticated" and "the call never answered"
// into the same `null`: a UI that treats a network drop, a 5xx or a timeout
// as "logged out" flips an authenticated visitor (and their admin links)
// to the anonymous state on a transient blip. Callers decide: `anonymous`
// is authoritative, `unavailable` means "keep whatever you knew before".
export type MeResult =
  | { status: "authenticated"; user: AuthUser }
  | { status: "anonymous"; user: null }
  | { status: "unavailable"; user: null };

const ANONYMOUS: MeResult = { status: "anonymous", user: null };
const UNAVAILABLE: MeResult = { status: "unavailable", user: null };

export async function getMe(): Promise<MeResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/me", { credentials: "same-origin" });
  } catch {
    // Offline, DNS failure, aborted request: nothing authoritative was said.
    return UNAVAILABLE;
  }

  // 401 is the only authoritative "not authenticated" answer this route
  // gives (see `src/app/api/auth/me/route.ts`). Every other failing status
  // (500, 502, 504, ...) is a server-side problem, not a logged-out visitor.
  if (res.status === 401) return ANONYMOUS;
  if (!res.ok) return UNAVAILABLE;

  try {
    const data = await res.json();
    if (data?.success && data.user) return { status: "authenticated", user: data.user };
    return ANONYMOUS;
  } catch {
    // A 200 whose body is not the JSON contract (proxy/captive-portal HTML)
    // says nothing about the session either.
    return UNAVAILABLE;
  }
}
