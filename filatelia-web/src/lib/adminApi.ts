// Shared call shape for every admin client (dashboard, stamps, groups,
// catalogs, users, analytics, import). All of them used to call the
// Worker's `*.workers.dev` origin directly with a `fp_token` bearer read
// from localStorage. After the E1 migration they call this same-origin
// helper instead, which forwards to the session-gated Next proxy at
// `/api/admin/[...path]` (see that route for the server-side auth check and
// the service-token hop to the Worker). The browser never holds an
// Authorization header for admin calls — the `fp_session` cookie (sent via
// `credentials: "same-origin"`) is the only credential involved client-side.
//
// Failure design (single place, on purpose): a non-ok response REJECTS with
// an `AdminApiError` instead of resolving. Rationale:
//  - callers that already do `const data = await (await adminFetch(...)).json()`
//    keep working unchanged on the happy path — an ok Response is returned
//    verbatim;
//  - no client can accidentally treat a 401 (expired session), 403, 400
//    (invalid path), 500 ("Admin proxy is not configured") or 504 (upstream
//    timeout) as a successful save, because the failure arrives on the same
//    channel as a dropped connection: the rejected promise;
//  - so every mutating handler needs exactly one `try/catch/finally`, and
//    the spinner reset lives in `finally` for both failure kinds.
// A rejected `fetch` (network drop) is left to propagate as-is; use
// `adminErrorMessage()` to turn either failure kind into Spanish UI copy.

export class AdminApiError extends Error {
  readonly status: number;
  /** Raw server-side detail (English, for logs) — not shown to the admin. */
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.detail = detail;
  }
}

const CONNECTION_ERROR_MESSAGE = "Error de conexión. Revisa tu red e inténtalo de nuevo.";

function messageForStatus(status: number): string {
  if (status === 401) return "Tu sesión expiró. Vuelve a iniciar sesión para continuar.";
  if (status === 403) return "No tienes permisos de administrador para esta acción.";
  if (status === 400) return "La solicitud no es válida. Revisa los datos e inténtalo de nuevo.";
  if (status === 404) return "El recurso ya no existe. Actualiza la página.";
  if (status === 504) return "El servidor tardó demasiado en responder. Inténtalo de nuevo.";
  if (status >= 500) return "Error del servidor. Inténtalo de nuevo en unos momentos.";
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/** Spanish, user-facing copy for any failure thrown by `adminFetch`. */
export function adminErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  return CONNECTION_ERROR_MESSAGE;
}

async function readErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const data = await res.clone().json();
    return typeof data?.error === "string" ? data.error : undefined;
  } catch {
    return undefined;
  }
}

export async function adminFetch(subpath: string, init: RequestInit = {}): Promise<Response> {
  // Defensively strip any Authorization header a caller might still pass:
  // this call shape never carries a bearer credential, by design.
  const headers = new Headers(init.headers);
  headers.delete("Authorization");

  const res = await fetch(`/api/admin/${subpath}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (!res.ok) {
    throw new AdminApiError(res.status, messageForStatus(res.status), await readErrorDetail(res));
  }

  return res;
}
