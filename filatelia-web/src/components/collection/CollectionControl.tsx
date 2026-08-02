"use client";

// Four-state "what is this stamp's status for me" control, used on the
// sello detail page (src/app/(public)/sello/[id]/SelloDetailClient.tsx).
// All the state-transition and endpoint-selection logic lives in
// src/lib/collectionControl.ts (unit tested there, no DOM required) — this
// component is thin: it resolves identity, fetches the caller's current
// item for this stamp, and renders/dispatches.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Bookmark, RefreshCw, EyeOff, Loader2, Minus, Plus, X, LogIn } from "lucide-react";
import { getMe } from "@/lib/auth";
import { ListType, UserCollectionItem } from "@/types/collection";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  CollectionTarget,
  displayQuantityFor,
  executeCollectionAction,
  findItemForStamp,
  planCollectionAction,
} from "@/lib/collectionControl";
import {
  Identity,
  IDENTITY_UNAVAILABLE_HINT,
  IDENTITY_UNAVAILABLE_TITLE,
  identityFromMeResult,
} from "@/lib/identityState";

// Every call this widget makes goes through the bounded fetch: an
// unanswered request would otherwise leave the control disabled behind a
// spinner with no error and no way back.
const boundedFetch: typeof fetch = (input, init) => fetchWithTimeout(input, init);

// While `/api/auth/me` hasn't answered yet, the widget must not assert "you
// are logged out" (which would flash for an authenticated visitor) nor render
// as if logged in. The `Identity` union — including the inconclusive
// `unavailable` state this widget must render rather than sit on its skeleton
// forever — lives in src/lib/identityState.ts.

const STATES: { value: ListType; label: string; icon: typeof Archive }[] = [
  { value: "collection", label: "Colección", icon: Archive },
  { value: "wishlist", label: "Deseos", icon: Bookmark },
  { value: "trade", label: "Intercambio", icon: RefreshCw },
  { value: "ignore", label: "Ignorar", icon: EyeOff },
];

export default function CollectionControl({ stampId }: { stampId: string }) {
  const pathname = usePathname();
  const [identity, setIdentity] = useState<Identity>({ status: "unknown" });
  const [loadingItem, setLoadingItem] = useState(false);
  const [currentItem, setCurrentItem] = useState<UserCollectionItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Bumped by the "Reintentar" button to re-run the load effect.
  const [reloadKey, setReloadKey] = useState(0);
  // Bumped by the retry offered when the identity probe is inconclusive.
  const [identityKey, setIdentityKey] = useState(0);

  useEffect(() => {
    let active = true;
    setIdentity({ status: "unknown" });
    // Every outcome is assigned, including `unavailable`. Returning early on
    // an inconclusive probe (an offline browser, a 5xx from /api/auth/me, a
    // non-JSON 200) left this widget in `unknown` forever, i.e. rendering
    // nothing but its skeleton, with no error and no way to retry.
    getMe().then((result) => {
      if (active) setIdentity(identityFromMeResult(result));
    });
    return () => {
      active = false;
    };
  }, [identityKey]);

  useEffect(() => {
    if (identity.status !== "authenticated") return;
    setLoadingItem(true);
    setLoadError(false);
    // Bounded: without a timeout an unanswered read leaves every button
    // disabled (`loadingItem`) forever.
    fetchWithTimeout("/api/collection", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.items)) {
          const item = findItemForStamp(data.items, stampId);
          setCurrentItem(item);
          setQuantity(displayQuantityFor(item));
        } else {
          setLoadError(true);
        }
      })
      .catch(() => {
        // The control cannot know the user's current status for this stamp.
        // Say so and offer a retry instead of rendering "no status yet",
        // which would invite an add that silently overwrites a real one.
        setLoadError(true);
      })
      .finally(() => setLoadingItem(false));
  }, [identity.status, stampId, reloadKey]);

  async function applyTarget(target: CollectionTarget, requestedQuantity: number) {
    setSaving(true);
    setError(null);
    const action = planCollectionAction(currentItem, stampId, target, requestedQuantity);
    const result = await executeCollectionAction(action, boundedFetch);
    setSaving(false);

    if (!result.success) {
      if (result.clearedPrevious) {
        // A switch got half-applied: the old membership is gone server-side
        // and the new one was never created. Match the server rather than
        // keep the old list lit up, and let the (Spanish) message from
        // executeCollectionAction explain it.
        setCurrentItem(null);
        setQuantity(1);
      } else {
        // Nothing changed server-side, so the display must go back to the
        // count the server still holds. Leaving the stepper on the value the
        // click produced showed 4 while the server had 3, and made the next
        // "+" plan an update to 5 — silently skipping a value.
        setQuantity(displayQuantityFor(currentItem));
      }
      if (result.code === "unauthenticated") {
        // The cookie died mid-session: demote to anonymous so the widget
        // switches to the login prompt instead of silently failing again
        // on every subsequent click.
        setIdentity({ status: "anonymous" });
      }
      setError(result.error || "No se pudo actualizar tu colección.");
      return;
    }

    if (action.kind === "remove") {
      setCurrentItem(null);
      setQuantity(1);
    } else if (result.item) {
      setCurrentItem(result.item);
      setQuantity(displayQuantityFor(result.item));
    }
  }

  if (identity.status === "unknown") {
    return (
      <div
        role="status"
        aria-label="Verificando sesión"
        className="h-12 bg-zinc-800/80 border border-white/5 rounded-xl animate-pulse"
      />
    );
  }

  // The probe never gave an authoritative answer. Show something actionable
  // instead of the skeleton: prompting "inicia sesión" here would be a lie to
  // an authenticated visitor, and staying on the skeleton is the permanent-
  // loading failure this state exists to prevent.
  if (identity.status === "unavailable") {
    return (
      <div className="bg-zinc-900/50 border border-red-500/20 rounded-xl p-4 text-sm text-zinc-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <span>
          {IDENTITY_UNAVAILABLE_TITLE}. {IDENTITY_UNAVAILABLE_HINT}.
        </span>
        <button
          type="button"
          onClick={() => setIdentityKey((key) => key + 1)}
          className="px-4 py-2 bg-zinc-800 border border-white/10 text-white text-xs font-bold rounded-lg hover:border-moss-green/40 transition-colors whitespace-nowrap"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (identity.status === "anonymous") {
    return (
      <div className="bg-zinc-900/50 border border-white/10 rounded-xl p-4 text-sm text-zinc-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <span>Inicia sesión para añadir este sello a tu colección, deseos o intercambios.</span>
        <Link
          href={`/login?from=${encodeURIComponent(pathname || `/sello/${stampId}`)}`}
          className="flex items-center gap-2 px-4 py-2 bg-moss-green hover:bg-moss-green-dark text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
        >
          <LogIn size={14} /> Iniciar sesión
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-zinc-900/50 border border-red-500/20 rounded-xl p-4 text-sm text-zinc-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <span>No se pudo cargar el estado de este sello en tu colección.</span>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="px-4 py-2 bg-zinc-800 border border-white/10 text-white text-xs font-bold rounded-lg hover:border-moss-green/40 transition-colors whitespace-nowrap"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {STATES.map(({ value, label, icon: Icon }) => {
          const active = currentItem?.listType === value;
          return (
            <button
              key={value}
              type="button"
              disabled={saving || loadingItem}
              onClick={() => applyTarget(value, quantity)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? "bg-moss-green text-white"
                  : "bg-zinc-900 border border-white/10 text-zinc-300 hover:border-moss-green/40 hover:text-white"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          );
        })}

        {currentItem && (
          <button
            type="button"
            disabled={saving}
            onClick={() => applyTarget("none", quantity)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
          >
            <X size={14} /> Quitar
          </button>
        )}

        {saving && <Loader2 size={16} className="text-moss-green animate-spin self-center" />}
      </div>

      {/* The displayed count is never bumped optimistically: it only ever
          changes to a value the server confirmed (or back to the stored one
          after a failure), so it cannot claim 4 while the server holds 3. */}
      {currentItem?.listType === "collection" && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Cantidad:</span>
          <button
            type="button"
            disabled={saving || quantity <= 1}
            onClick={() => applyTarget("collection", Math.max(1, quantity - 1))}
            className="w-7 h-7 flex items-center justify-center bg-zinc-900 border border-white/10 rounded-lg text-white disabled:opacity-40"
          >
            <Minus size={12} />
          </button>
          <span className="w-8 text-center font-mono text-white">{quantity}</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => applyTarget("collection", quantity + 1)}
            className="w-7 h-7 flex items-center justify-center bg-zinc-900 border border-white/10 rounded-lg text-white disabled:opacity-40"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
