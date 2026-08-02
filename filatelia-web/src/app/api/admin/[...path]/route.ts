import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";
import { resolveUserRole } from "@/lib/db/users";

// Session-gated proxy in front of the Worker's `/admin/*` routes. The
// browser never talks to the Worker directly for admin actions and never
// holds a Worker-shaped credential: this route verifies the httpOnly
// `fp_session` cookie, re-resolves the role from D1, and — only then —
// forwards the request server-to-server to the Worker with a service
// token (`X-Admin-Token`) that never reaches the client.
//
// Status code convention (kept consistent across this route): no session
// cookie, or a cookie that fails verification (missing/expired/invalid
// signature) -> 401 Unauthenticated. A valid session whose resolved role is
// not "admin" -> 403 Forbidden.
//
// AUTHORITY: `payload.role` on the session token is NEVER trusted for this
// decision. It is baked in at login/last-renewal and can be up to
// SESSION_TTL_SECONDS (30 days) stale under sliding renewal — a revoked
// admin (their UserRole row deleted) would otherwise keep admin access, and
// every renewal would extend that. This route always calls
// `resolveUserRole(payload.id)` and gates on the live D1 result instead.
// This is the actual admin-action surface and its traffic is tiny, so one
// extra D1 read per admin request is the right trade. `src/middleware.ts`'s
// claim check is only a cheap pre-filter, not the authority — see its
// comment. If the D1 read itself throws (binding missing, database
// unreachable) or exceeds ROLE_RESOLUTION_TIMEOUT_MS, this route fails
// CLOSED with 500 and never forwards to the Worker; it never falls back to
// the token claim.
export const runtime = "edge";

const WORKER_API_URL =
  process.env.WORKER_API_URL ||
  process.env.NEXT_PUBLIC_WORKER_API_URL ||
  "https://filatelia-api.rodrigopianto2005.workers.dev";

// Upper bound for the server-to-server hop. A cold-starting or hung Worker
// must never hold an edge invocation open indefinitely; 15s leaves room for
// a cold start plus a slow D1 query while staying well under the platform's
// own request budget. On timeout we answer 504 so the admin UI can tell an
// upstream stall apart from a generic proxy failure.
const WORKER_FETCH_TIMEOUT_MS = 15_000;

// Same rationale as the Worker hop above, applied to the authoritative D1
// role lookup: a slow dependency must never hold an edge invocation open
// indefinitely. This is a single indexed lookup on UserRole/Role (one row,
// primary-key-shaped predicate), so it is either fast or unhealthy — 3s is
// two orders of magnitude above its expected latency yet far below the 15s
// Worker budget, and leaves the rest of that budget for the hop itself when
// the lookup is merely sluggish. A timeout is treated exactly like a D1
// error: fail CLOSED with 500, never forward to the Worker, never fall back
// to the token claim.
const ROLE_RESOLUTION_TIMEOUT_MS = 3_000;

/** Marks "D1 is slow/hung" so it can be logged apart from "D1 is broken". */
class RoleResolutionTimeoutError extends Error {
  constructor() {
    super(`Role resolution exceeded ${ROLE_RESOLUTION_TIMEOUT_MS}ms`);
    this.name = "RoleResolutionTimeoutError";
  }
}

// A pending D1 query cannot be aborted from here (the binding takes no
// signal), so the bound is enforced on the wait, not on the query: the
// orphaned promise is simply no longer awaited.
async function resolveUserRoleBounded(userId: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveUserRole(userId),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RoleResolutionTimeoutError()), ROLE_RESOLUTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Path segments arrive already percent-decoded from Next. Anything that is
// not a plain segment (empty, `.`, `..`, or containing a separator) is
// rejected outright: WHATWG `new URL()` resolves dot-segments, which would
// let a caller escape the `/admin/*` surface this route promises to gate.
function isSafeSegment(segment: string): boolean {
  if (!segment || segment === "." || segment === "..") return false;
  return !segment.includes("/") && !segment.includes("\\");
}

// Server-side only. Client-visible bodies stay opaque; these lines exist so
// an operator can tell an ordinary permission denial apart from a
// misconfiguration. Never log the session cookie or the service token.
const LOG_PREFIX = "[admin-proxy]";

async function requireAdminSession(request: NextRequest): Promise<NextResponse | null> {
  const sessionCookie = request.cookies.get("fp_session")?.value;
  if (!sessionCookie) {
    console.warn(`${LOG_PREFIX} rejected: no session cookie present`);
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const payload = await verifySession(sessionCookie);
  if (!payload) {
    console.warn(`${LOG_PREFIX} rejected: no session — cookie failed verification (missing/expired/invalid signature)`);
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let liveRole: string;
  try {
    liveRole = await resolveUserRoleBounded(payload.id);
  } catch (err) {
    // Fail closed: never fall back to the (untrusted) token claim when the
    // authoritative D1 read fails or stalls. The two cases share the client
    // -visible body but are logged apart, so an operator can tell "D1 is
    // slow" from "D1 is broken" (and both from a plain non-admin denial).
    if (err instanceof RoleResolutionTimeoutError) {
      console.error(
        `${LOG_PREFIX} rejected: role resolution from D1 timed out after ${ROLE_RESOLUTION_TIMEOUT_MS}ms (D1 reachable but slow)`
      );
      return NextResponse.json({ error: "Failed to resolve admin role" }, { status: 500 });
    }
    console.error(`${LOG_PREFIX} rejected: failed to resolve role from D1`, err);
    return NextResponse.json({ error: "Failed to resolve admin role" }, { status: 500 });
  }

  if (liveRole !== "admin") {
    console.warn(`${LOG_PREFIX} rejected: valid session with non-admin role`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

async function forward(
  request: NextRequest,
  path: string[]
): Promise<NextResponse> {
  const authError = await requireAdminSession(request);
  if (authError) return authError;

  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken) {
    // Fail closed: never call the Worker's admin surface without a service
    // token, even for an already-authorized admin session.
    console.error(`${LOG_PREFIX} rejected: ADMIN_API_TOKEN is not set in this environment`);
    return NextResponse.json({ error: "Admin proxy is not configured" }, { status: 500 });
  }

  if (!Array.isArray(path) || path.length === 0 || !path.every(isSafeSegment)) {
    return NextResponse.json({ error: "Invalid admin path" }, { status: 400 });
  }

  const targetUrl = new URL(`/admin/${path.join("/")}`, WORKER_API_URL);
  targetUrl.search = new URL(request.url).search;

  // Belt-and-braces containment check: whatever the segment filter let
  // through, the resolved URL must still live under the Worker's `/admin/`.
  const adminPrefix = new URL("/admin/", WORKER_API_URL).toString();
  if (!targetUrl.toString().startsWith(adminPrefix)) {
    return NextResponse.json({ error: "Invalid admin path" }, { status: 400 });
  }

  // Only the service token is forwarded. The client's cookie and any
  // Authorization header are deliberately dropped so a caller cannot
  // smuggle credentials through the proxy to the Worker.
  const forwardedHeaders = new Headers({ "X-Admin-Token": adminToken });

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_FETCH_TIMEOUT_MS);

  try {
    let body: string | undefined;
    if (hasBody) {
      const text = await request.text();
      if (text) {
        body = text;
        forwardedHeaders.set("Content-Type", request.headers.get("content-type") || "application/json");
      }
    }

    const workerResponse = await fetch(targetUrl.toString(), {
      method,
      headers: forwardedHeaders,
      body,
      signal: controller.signal,
    });

    const responseText = await workerResponse.text();
    const contentType = workerResponse.headers.get("content-type") || "application/json";

    // We only reach this point for an already-verified admin session that was
    // forwarded WITH a service token, and the Worker's admin surface is
    // token-only — so a 403 here cannot be a role decision. It is the
    // signature of an ADMIN_API_TOKEN skew between this environment and the
    // Worker secret. Logged loudly because the client-visible body is
    // deliberately identical to a legitimate denial.
    if (workerResponse.status === 403) {
      console.error(
        `${LOG_PREFIX} worker returned 403 despite a forwarded service token — probable ADMIN_API_TOKEN token mismatch between Pages env and Worker secret (path: /admin/${path.join("/")})`
      );
    }

    return new NextResponse(responseText, {
      status: workerResponse.status,
      headers: { "content-type": contentType },
    });
  } catch (err: any) {
    console.error("Error in /api/admin proxy route:", err);
    if (err?.name === "AbortError") {
      return NextResponse.json(
        { error: "Upstream admin API timed out" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: err?.message || "Internal Server Error forwarding admin request" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeout);
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}
