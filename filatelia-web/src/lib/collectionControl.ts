// Pure state-transition + API-call logic for the four-state collection
// control (colección / deseos / intercambio / ignorar) shown on the sello
// detail page (SelloDetailClient.tsx) and reusable anywhere else a single
// "what is this stamp's status for me" widget is needed.
//
// This module is deliberately UI-free so it can be unit tested without a
// DOM/jsdom harness (this repo's vitest config runs `environment: 'node'`
// and never renders .tsx components — see test/collection-control.test.ts).
import { ConditionGrade, ListType, UserCollectionItem } from "@/types/collection";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

// ---------------------------------------------------------------------------
// Pure planning: given the caller's current item (if any) for a stamp and the
// state the user just picked, decide the single HTTP action to take. No I/O
// happens here — this is what makes it testable without mocking fetch.
// ---------------------------------------------------------------------------

/** "none" is not a `ListType` value — it represents "clear my status for this stamp". */
export type CollectionTarget = ListType | "none";

export type CollectionAction =
  | { kind: "none" }
  | { kind: "create"; stampId: string; listType: ListType; quantity: number }
  | { kind: "update"; id: number; quantity: number }
  | { kind: "switch"; deleteId: number; stampId: string; listType: ListType; quantity: number }
  | { kind: "remove"; id: number };

// Quantity is a meaningful, user-editable concept only for the "collection"
// list (how many copies of this stamp you own). The other three lists
// (wishlist/trade/ignore) are membership-only lists — "how many do you wish
// for" or "how many do you want to ignore" has no meaning — so their
// quantity is always pinned to 1 regardless of what the caller passes in.
// This keeps the API payload uniform (quantity is always a positive
// integer, matching the server's own `quantity >= 1` contract) without ever
// exposing a stepper control in the UI for lists where it would be
// meaningless.
/**
 * Single source of truth for "does a quantity mean anything on this list?".
 * Every surface that shows or edits a quantity — the stepper in
 * CollectionControl.tsx and both the read-only display and the editor in
 * components/collection/CollectionTabs.tsx — gates on this, so a wishlist /
 * trade / ignore row can never show a meaningless "Cantidad: 1".
 */
export function listSupportsQuantity(listType: ListType): boolean {
  return listType === "collection";
}

/**
 * The quantity a surface should DISPLAY for a membership. Derived from the
 * item the server last confirmed, never from an optimistic local value: a
 * stepper that keeps showing 4 after a failed write while the server still
 * holds 3 makes the next "+" plan an update to 5 and silently skip a value.
 */
export function displayQuantityFor(item: UserCollectionItem | null): number {
  if (!item || !listSupportsQuantity(item.listType)) return 1;
  return item.quantity;
}

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const floored = Math.floor(value);
  return floored < 1 ? 1 : floored;
}

/** Finds the caller's existing item for a given stamp, if any. A stamp is
 * expected to appear in at most one list at a time from this widget's point
 * of view (it always switches rather than accumulating memberships), but the
 * lookup tolerates several matches defensively and returns the first one. */
export function findItemForStamp(
  items: UserCollectionItem[],
  stampId: string
): UserCollectionItem | null {
  return items.find((item) => item.stampId === stampId) ?? null;
}

export function planCollectionAction(
  current: UserCollectionItem | null,
  stampId: string,
  target: CollectionTarget,
  requestedQuantity: number
): CollectionAction {
  if (target === "none") {
    return current ? { kind: "remove", id: current.id } : { kind: "none" };
  }

  const quantity = listSupportsQuantity(target) ? clampQuantity(requestedQuantity) : 1;

  if (!current) {
    return { kind: "create", stampId, listType: target, quantity };
  }

  if (current.listType === target) {
    if (current.quantity === quantity) return { kind: "none" };
    return { kind: "update", id: current.id, quantity };
  }

  // Switching from one list to another: the backend has no "move" verb and
  // the unique constraint is per (user, stamp, list_type), so a plain POST
  // for the new list would leave the stamp in BOTH lists at once. This
  // widget models a single-select control, so a switch is a delete of the
  // old membership followed by a create of the new one.
  return { kind: "switch", deleteId: current.id, stampId, listType: target, quantity };
}

// ---------------------------------------------------------------------------
// Execution: turns a CollectionAction into the actual /api/collection call(s).
// ---------------------------------------------------------------------------

export type CollectionActionErrorCode =
  | "unauthenticated"
  | "validation"
  | "not_found"
  | "network"
  | "server";

export interface CollectionActionResult {
  success: boolean;
  item?: UserCollectionItem;
  error?: string;
  code?: CollectionActionErrorCode;
  /**
   * Set only on a partially applied `switch`: the DELETE of the old
   * membership succeeded but the POST creating the new one did not, so the
   * server now holds NO membership for this stamp. A caller that keeps
   * rendering the old list after this would be showing a state the server
   * does not have — it must clear its local item instead.
   */
  clearedPrevious?: boolean;
}

type FetchLike = typeof fetch;

const COLLECTION_ENDPOINT = "/api/collection";

// 401 mid-session (the httpOnly cookie expired, was revoked, or never
// existed) is surfaced with a distinct code so the caller can prompt a
// re-login instead of showing a generic error — the same "unauthenticated"
// treatment `getMe()` gives a 401 from `/api/auth/me` (see src/lib/auth.ts).
const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró. Inicia sesión de nuevo para continuar.";
const NETWORK_ERROR_MESSAGE = "Error de conexión. Verifica tu internet e inténtalo de nuevo.";
const UNKNOWN_ERROR_MESSAGE = "No se pudo actualizar tu colección. Inténtalo de nuevo.";
// A switch is a DELETE followed by a POST. When only the DELETE lands, the
// honest thing to say is that the stamp came out of the old list and never
// reached the new one — telling the user "no se pudo actualizar" would let
// them believe the old list still holds it.
const SWITCH_PARTIAL_MESSAGE =
  "Quitamos el sello de tu lista anterior, pero no pudimos añadirlo a la nueva: " +
  "ahora no está en ninguna lista. Vuelve a elegir una.";

/**
 * The one message a surface must show the user for a given result, or `null`
 * when there is nothing to say.
 *
 * Every failing path in this module already produces Spanish copy, but the
 * list pages used to drop it into `console.error`: a session that expired
 * mid-visit made the trash icon do nothing, silently, forever. This helper is
 * the shared contract — a failure ALWAYS yields a non-empty Spanish message,
 * even when the result carries none, so no caller can end up rendering an
 * empty error box or, worse, nothing at all.
 */
export function collectionFailureMessage(result: CollectionActionResult): string | null {
  if (result.success) return null;
  return result.error || UNKNOWN_ERROR_MESSAGE;
}

async function parseErrorResponse(res: Response): Promise<CollectionActionResult> {
  if (res.status === 401) {
    return { success: false, error: SESSION_EXPIRED_MESSAGE, code: "unauthenticated" };
  }

  let serverMessage: string | undefined;
  try {
    const body = await res.json();
    serverMessage = typeof body?.error === "string" ? body.error : undefined;
  } catch {
    // Non-JSON error body: fall back to the generic message below.
  }

  if (res.status === 400) {
    return { success: false, error: serverMessage || "Datos inválidos.", code: "validation" };
  }
  if (res.status === 404) {
    return { success: false, error: serverMessage || "El ítem ya no existe.", code: "not_found" };
  }
  return { success: false, error: serverMessage || UNKNOWN_ERROR_MESSAGE, code: "server" };
}

async function postCollectionItem(
  args: { stampId: string; listType: ListType; quantity: number },
  fetchImpl: FetchLike
): Promise<CollectionActionResult> {
  const res = await fetchImpl(COLLECTION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ stampId: args.stampId, listType: args.listType, quantity: args.quantity }),
  });
  if (!res.ok) return parseErrorResponse(res);
  const data = await res.json();
  return { success: true, item: data.item };
}

/** The editable fields of an existing membership. Every one is optional:
 * an omitted field is left untouched server-side (see updateCollectionItem
 * in src/lib/db/collection.ts), so `quantity: undefined` is "don't touch my
 * count", never "reset it to 1". */
export interface CollectionItemUpdate {
  condition?: ConditionGrade;
  quantity?: number;
  notes?: string;
}

// The list pages (/perfil and /colecciones) render the same data through
// the same CollectionTabs component, so they must not each hand-roll this
// request. `fetchWithTimeout` is the default because an unbounded browser
// fetch leaves those pages spinning forever; callers that need to inject a
// fake (tests, executeCollectionAction) pass their own.

/**
 * PUT /api/collection — updates an existing membership. Fields the caller
 * did not supply are stripped from the body rather than sent as null, so
 * the server's "omitted means unchanged" contract is preserved end to end.
 */
export async function updateCollectionItemFields(
  id: number,
  updates: CollectionItemUpdate,
  fetchImpl: FetchLike = fetchWithTimeout
): Promise<CollectionActionResult> {
  const body: Record<string, unknown> = { id };
  if (updates.condition !== undefined) body.condition = updates.condition;
  if (updates.quantity !== undefined) body.quantity = updates.quantity;
  if (updates.notes !== undefined) body.notes = updates.notes;

  try {
    const res = await fetchImpl(COLLECTION_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (!res.ok) return parseErrorResponse(res);
    const data = await res.json();
    return { success: true, item: data.item };
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE, code: "network" };
  }
}

/**
 * DELETE /api/collection?id=… — removes a membership.
 *
 * NOTE for `executeCollectionAction`: it calls this with its own `fetchImpl`
 * and relies on a thrown fetch propagating so a half-applied `switch` can be
 * reported (`clearedPrevious`). Network failures are therefore NOT swallowed
 * here; standalone callers get the same rejection and handle it themselves —
 * `deleteCollectionItem` below is the wrapper that maps it to a result.
 */
async function requestCollectionItemDeletion(
  id: number,
  fetchImpl: FetchLike
): Promise<CollectionActionResult> {
  const res = await fetchImpl(`${COLLECTION_ENDPOINT}?id=${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) return parseErrorResponse(res);
  return { success: true };
}

/** DELETE /api/collection?id=… for the list pages: same request as the
 * widget's `remove` action, with network failures mapped to a result
 * instead of a rejection. */
export async function deleteCollectionItemById(
  id: number,
  fetchImpl: FetchLike = fetchWithTimeout
): Promise<CollectionActionResult> {
  try {
    return await requestCollectionItemDeletion(id, fetchImpl);
  } catch {
    return { success: false, error: NETWORK_ERROR_MESSAGE, code: "network" };
  }
}

export async function executeCollectionAction(
  action: CollectionAction,
  fetchImpl: FetchLike = fetch
): Promise<CollectionActionResult> {
  // Tracks the one irreversible half-step this function can take: a switch
  // whose DELETE already landed. If anything after that fails, the caller
  // has to be told, or its UI keeps asserting a membership the server no
  // longer has.
  let clearedPrevious = false;

  try {
    switch (action.kind) {
      case "none":
        return { success: true };
      case "create":
        return await postCollectionItem(action, fetchImpl);
      case "update":
        return await updateCollectionItemFields(action.id, { quantity: action.quantity }, fetchImpl);
      case "remove":
        return await requestCollectionItemDeletion(action.id, fetchImpl);
      case "switch": {
        // Delete first: if the delete itself fails (including a 401 mid-
        // session), the widget must not create a second, orphaned
        // membership for the new list — report the failure and let the
        // caller retry the whole switch. Nothing changed server-side, so
        // `clearedPrevious` stays false.
        const deleteResult = await requestCollectionItemDeletion(action.deleteId, fetchImpl);
        if (!deleteResult.success) return deleteResult;

        clearedPrevious = true;
        const createResult = await postCollectionItem(action, fetchImpl);
        if (!createResult.success) {
          // Keep the underlying `code` (a 401 must still demote the widget
          // to the login prompt) but replace the message: what happened is
          // not "the update failed", it is "you are now in no list".
          return { ...createResult, clearedPrevious: true, error: SWITCH_PARTIAL_MESSAGE };
        }
        return createResult;
      }
    }
  } catch {
    // fetch() itself threw: offline, DNS failure, aborted request — nothing
    // authoritative was said by the server about THIS call, but a switch
    // may already have removed the old membership before going offline.
    if (clearedPrevious) {
      return {
        success: false,
        error: SWITCH_PARTIAL_MESSAGE,
        code: "network",
        clearedPrevious: true,
      };
    }
    return { success: false, error: NETWORK_ERROR_MESSAGE, code: "network" };
  }
}
