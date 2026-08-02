import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

// Session-gated proxy in front of the Worker's `/admin/*` routes. The
// browser never talks to the Worker directly for admin actions and never
// holds a Worker-shaped credential: this route verifies the httpOnly
// `fp_session` cookie, checks `role === "admin"`, and — only then —
// forwards the request server-to-server to the Worker with a service
// token (`X-Admin-Token`) that never reaches the client.
//
// Status code convention (kept consistent across this route): no session
// cookie, or a cookie that fails verification (missing/expired/invalid
// signature) -> 401 Unauthenticated. A valid session whose role is not
// "admin" -> 403 Forbidden.
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

  if (payload.role !== "admin") {
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
