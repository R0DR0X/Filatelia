"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Bookmark, RefreshCw, Archive, Loader2, LogIn } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import {
  executeCollectionAction,
  planCollectionAction,
} from "@/lib/collectionControl";
import { QUICK_ADD_ORDER, QuickAddListType, quickAddSpec } from "@/lib/quickAdd";
import { useCollectionIndex } from "./CollectionIndexProvider";

interface QuickAddButtonsProps {
  stampId: string;
}

const ICONS: Record<QuickAddListType, typeof Archive> = {
  collection: Archive,
  wishlist: Bookmark,
  trade: RefreshCw,
};

// One colour per list, so state reads at a glance now that the buttons carry
// no text.
const ACTIVE_STYLES: Record<QuickAddListType, string> = {
  collection: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  wishlist: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  trade: "bg-blue-500/20 text-blue-300 border-blue-500/40",
};

const CELL = "min-w-0 h-7 flex items-center justify-center rounded border transition-colors";
const IDLE = "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border-white/10";

/**
 * The quick-add control on a catalogue card.
 *
 * LAYOUT CONTRACT: a fixed 3-column grid, icon-only, `min-w-0` on every cell.
 * The cards are 79-125px wide, and three text-labelled buttons need ~280px.
 * Sizing from the grid rather than from the text is what keeps the layout
 * stable — the previous version's labels changed width on toggle, so the
 * overflow moved as you clicked.
 *
 * DATA MODEL: single-select, matching the detail page. A stamp is in at most
 * ONE list. This used to toggle each list independently, which contradicted
 * the four-state control on the ficha: a stamp added here to both Colección
 * and Deseos showed up there as only one of them, and switching there deleted
 * only one of the two memberships, silently orphaning the other. Both
 * surfaces now go through the same tested `planCollectionAction` /
 * `executeCollectionAction`, so a switch is a delete-then-create in both.
 *
 * Clicking the list a stamp is already in removes it — the compact equivalent
 * of the ficha's "Quitar".
 */
export function QuickAddButtons({ stampId }: QuickAddButtonsProps) {
  const pathname = usePathname();
  const { identity, loading, failed, itemFor, recordItem, recordRemoval } = useCollectionIndex();
  const [pending, setPending] = useState<QuickAddListType | null>(null);
  const [error, setError] = useState(false);

  const current = itemFor(stampId);

  const handleToggle = async (listType: QuickAddListType, e: React.MouseEvent) => {
    // The card is wrapped in a Link to the stamp; without this a click on a
    // button would also navigate away mid-write.
    e.preventDefault();
    e.stopPropagation();

    setPending(listType);
    setError(false);

    // Clicking the list you are already in means "take it out".
    const target = current?.listType === listType ? "none" : listType;
    const action = planCollectionAction(current, stampId, target, current?.quantity ?? 1);
    const result = await executeCollectionAction(action, (input, init) =>
      fetchWithTimeout(input, init)
    );
    setPending(null);

    if (!result.success) {
      // A rejected write must not leave the button lit. The previous version
      // updated regardless of the response, so the card claimed a membership
      // the server had refused until the next reload.
      if (result.clearedPrevious) recordRemoval(stampId);
      setError(true);
      return;
    }

    if (action.kind === "remove") {
      recordRemoval(stampId);
    } else if (result.item) {
      recordItem(result.item);
    }
  };

  // Until the page knows who you are, render the shape of the control without
  // asserting any state — claiming "not in any list" here would be a lie to a
  // logged-in visitor, and it is the lie that invites a click that overwrites
  // a real membership.
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1" aria-hidden="true">
        {QUICK_ADD_ORDER.map((listType) => (
          <div key={listType} className={`${CELL} bg-zinc-800/40 border-white/5 animate-pulse`} />
        ))}
      </div>
    );
  }

  if (identity.status !== "authenticated") {
    return (
      <Link
        href={`/login?from=${encodeURIComponent(pathname || "/catalogo")}`}
        onClick={(e) => e.stopPropagation()}
        className="h-7 flex items-center justify-center gap-1 rounded border border-white/10 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 text-[9px] font-bold transition-colors"
        title="Inicia sesión para guardar sellos en tus listas"
      >
        <LogIn size={10} /> Inicia sesión
      </Link>
    );
  }

  // The read failed, so the real state is unknown. Saying "not in any list"
  // would invite a click that silently overwrites a membership the server
  // still holds.
  if (failed) {
    return (
      <p className="h-7 flex items-center justify-center text-[9px] text-zinc-600 text-center">
        Estado no disponible
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1">
      {QUICK_ADD_ORDER.map((listType) => {
        const isActive = current?.listType === listType;
        const isPending = pending === listType;
        const { label } = quickAddSpec(listType, isActive);
        const Icon = ICONS[listType];

        return (
          <button
            key={listType}
            type="button"
            onClick={(e) => handleToggle(listType, e)}
            disabled={pending !== null}
            title={error ? "No se pudo guardar. Inténtalo de nuevo." : label}
            aria-label={label}
            aria-pressed={isActive}
            className={`${CELL} disabled:opacity-50 ${
              isActive ? ACTIVE_STYLES[listType] : IDLE
            } ${error ? "border-red-500/40" : ""}`}
          >
            {isPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : isActive ? (
              <Check size={11} />
            ) : (
              <Icon size={11} />
            )}
          </button>
        );
      })}
    </div>
  );
}
