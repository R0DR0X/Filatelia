"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, Loader2, AlertCircle, Archive } from "lucide-react";
import { getMe } from "@/lib/auth";
import { CollectionTabs } from "@/components/collection/CollectionTabs";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { deleteCollectionItemById, updateCollectionItemFields } from "@/lib/collectionControl";
import type { CollectionActionResult } from "@/lib/collectionControl";
import {
  Identity,
  IDENTITY_UNAVAILABLE_HINT,
  IDENTITY_UNAVAILABLE_TITLE,
  identityFromMeResult,
} from "@/lib/identityState";
import { ConditionGrade, UserCollectionItem } from "@/types/collection";

// `/colecciones` is intentionally NOT in src/middleware.ts's matcher (it
// only guards `/admin/:path*` and `/perfil`) — extending the matcher was
// explicitly out of scope for this page. Instead this client component
// self-checks identity with getMe(), the same pattern Navbar.tsx and
// PerfilClient.tsx already use, and renders a friendly Spanish prompt for an
// anonymous visitor instead of losing their place with a hard redirect.
// The `Identity` union (including the inconclusive `unavailable` state this
// page must render) lives in src/lib/identityState.ts.

export default function ColeccionesClient() {
  const [identity, setIdentity] = useState<Identity>({ status: "unknown" });
  const [items, setItems] = useState<UserCollectionItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
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
    // non-JSON 200) left this page in `unknown` forever, i.e. rendering only
    // its spinner, with no error and no way to retry.
    getMe().then((result) => {
      if (active) setIdentity(identityFromMeResult(result));
    });
    return () => {
      active = false;
    };
  }, [identityKey]);

  useEffect(() => {
    if (identity.status !== "authenticated") return;
    setLoadingItems(true);
    setLoadError(false);
    // Bounded: a response that never arrives must end as an error state with
    // a retry, never as a permanent spinner.
    fetchWithTimeout("/api/collection", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch collection");
        return res.json();
      })
      .then((data) => {
        if (data.success && Array.isArray(data.items)) {
          setItems(data.items);
        } else {
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoadingItems(false));
  }, [identity.status, reloadKey]);

  // Shared with /perfil through src/lib/collectionControl.ts (already
  // bounded by fetchWithTimeout): both pages render the same CollectionTabs,
  // so the request itself must have exactly one definition. Only the local
  // state merge is page-specific.
  // Both handlers hand the result back to CollectionTabs, which owns the
  // Spanish failure copy and decides whether to keep the editor open. A
  // swallowed failure here is what let a 401'd delete leave the card on
  // screen with nothing but a console message.
  const handleUpdateItem = async (
    id: number,
    updates: { condition: ConditionGrade; quantity?: number; notes?: string }
  ): Promise<CollectionActionResult> => {
    const result = await updateCollectionItemFields(id, updates);
    if (result.success && result.item) {
      const updated = result.item;
      // Merged, not replaced: the server enriches the PUT response with the
      // Stamp display columns (see updateCollectionItem in
      // src/lib/db/collection.ts), and merging keeps that true even if a
      // response ever arrives without one of them.
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updated } : item)));
    }
    return result;
  };

  const handleDeleteItem = async (id: number): Promise<CollectionActionResult> => {
    const result = await deleteCollectionItemById(id);
    if (result.success) {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }
    return result;
  };

  if (identity.status === "unknown") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 size={32} className="text-emerald-400 animate-spin" />
      </div>
    );
  }

  // The probe never gave an authoritative answer. Say so and offer a retry:
  // asserting "inicia sesión" here would be a lie to an authenticated
  // visitor, and staying on the spinner is the permanent-loading failure
  // this state exists to prevent.
  if (identity.status === "unavailable") {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertCircle size={40} className="text-red-400" />
        <p className="text-zinc-300 font-medium">{IDENTITY_UNAVAILABLE_TITLE}</p>
        <p className="text-zinc-500 text-sm max-w-sm">{IDENTITY_UNAVAILABLE_HINT}</p>
        <button
          type="button"
          onClick={() => setIdentityKey((key) => key + 1)}
          className="px-6 py-3 bg-zinc-900 border border-white/10 rounded-xl text-sm font-bold text-zinc-200 hover:border-moss-green/40 hover:text-white transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (identity.status === "anonymous") {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 px-4 text-center">
        <Archive size={40} className="text-zinc-700" />
        <p className="text-zinc-300 font-medium">Inicia sesión para ver tu colección</p>
        <p className="text-zinc-500 text-sm max-w-sm">
          Guarda tus sellos, tu lista de deseos y tus propuestas de intercambio en una cuenta.
        </p>
        <Link
          href="/login?from=/colecciones"
          className="flex items-center gap-2 px-6 py-3 bg-moss-green hover:bg-moss-green-dark text-white text-sm font-bold rounded-xl transition-colors"
        >
          <LogIn size={16} /> Iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif text-white font-semibold">Mi Colección</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Sellos que posees, deseas, quieres intercambiar o has decidido ignorar.
          </p>
        </div>

        {loadingItems ? (
          <div className="flex justify-center py-16">
            <Loader2 size={28} className="text-emerald-400 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl bg-zinc-900/30">
            <AlertCircle className="mx-auto text-red-400 mb-2" size={24} />
            <p className="text-zinc-400 text-sm font-medium">No se pudo cargar tu colección</p>
            <p className="text-zinc-600 text-xs mt-1">Revisa tu conexión e inténtalo de nuevo</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-4 px-5 py-2 bg-zinc-900 border border-white/10 rounded-xl text-xs font-bold text-zinc-200 hover:border-moss-green/40 hover:text-white transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <CollectionTabs items={items} onUpdateItem={handleUpdateItem} onDeleteItem={handleDeleteItem} />
        )}
      </div>
    </div>
  );
}
