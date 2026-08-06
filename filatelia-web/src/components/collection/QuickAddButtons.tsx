"use client";

import { useState } from "react";
import { ListType } from "@/types/collection";
import { Check, Bookmark, RefreshCw, Archive, Loader2 } from "lucide-react";
import {
  QUICK_ADD_ORDER,
  QuickAddListType,
  quickAddSpec,
  toggleMembership,
} from "@/lib/quickAdd";

interface QuickAddButtonsProps {
  stampId: string;
  activeLists?: QuickAddListType[];
  onToggle?: (stampId: string, listType: ListType) => Promise<void>;
}

const ICONS: Record<QuickAddListType, typeof Archive> = {
  collection: Archive,
  wishlist: Bookmark,
  trade: RefreshCw,
};

// Active colours, one per list, so the state reads at a glance now that the
// buttons carry no text.
const ACTIVE_STYLES: Record<QuickAddListType, string> = {
  collection: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  wishlist: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  trade: "bg-blue-500/20 text-blue-300 border-blue-500/40",
};

/**
 * The three quick-add toggles on a catalogue card.
 *
 * LAYOUT CONTRACT: a fixed 3-column grid, icon-only, `min-w-0` on every cell.
 *
 * This replaced a `flex` row of buttons labelled with text that changed on
 * click ("+ Colección" → "En Colección"). Three of those need ~280px. The
 * cards they sit in are a 3-to-8 column grid — roughly 125px wide on desktop
 * and 79px on a phone. Flex items do not shrink below their content, and the
 * card clips with overflow-hidden, so the second and third buttons were cut
 * off; and because the labels resized on toggle, the clipping moved as you
 * used it.
 *
 * The grid is what fixes it: each button is exactly one third of whatever the
 * card is, so the layout cannot depend on the text or on the toggle state.
 * `min-w-0` is required — a grid track's default `min-width: auto` would let
 * the icon push the column wider again.
 *
 * The words did not disappear, they moved to `aria-label`/`title`, which is
 * now the only thing naming each control. They are unit tested in
 * test/quick-add.test.ts for that reason.
 */
export function QuickAddButtons({ stampId, activeLists = [], onToggle }: QuickAddButtonsProps) {
  const [lists, setLists] = useState<QuickAddListType[]>(activeLists);
  const [loadingType, setLoadingType] = useState<QuickAddListType | null>(null);

  const handleToggle = async (listType: QuickAddListType, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setLoadingType(listType);
    try {
      if (onToggle) {
        await onToggle(stampId, listType);
      } else {
        const method = lists.includes(listType) ? "DELETE" : "POST";
        const res = await fetch("/api/collection", {
          method,
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ stampId, listType, condition: "MNH" }),
        });
        // A failed write used to update the button anyway, so the card claimed
        // a membership the server had rejected until the next reload.
        if (!res.ok) return;
      }

      setLists((prev) => toggleMembership(prev, listType));
    } catch (err) {
      console.error("Failed to toggle collection item:", err);
    } finally {
      setLoadingType(null);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-1">
      {QUICK_ADD_ORDER.map((listType) => {
        const isActive = lists.includes(listType);
        const isLoading = loadingType === listType;
        const { label } = quickAddSpec(listType, isActive);
        const Icon = ICONS[listType];

        return (
          <button
            key={listType}
            type="button"
            onClick={(e) => handleToggle(listType, e)}
            disabled={isLoading}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            className={`min-w-0 h-7 flex items-center justify-center rounded border transition-colors disabled:opacity-50 ${
              isActive
                ? ACTIVE_STYLES[listType]
                : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border-white/10"
            }`}
          >
            {isLoading ? (
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
