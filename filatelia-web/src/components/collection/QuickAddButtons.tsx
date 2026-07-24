"use client";

import { useState } from "react";
import { ListType } from "@/types/collection";
import { Plus, Check, Bookmark, RefreshCw, Archive } from "lucide-react";

interface QuickAddButtonsProps {
  stampId: string;
  activeLists?: ListType[];
  onToggle?: (stampId: string, listType: ListType) => Promise<void>;
}

export function QuickAddButtons({ stampId, activeLists = [], onToggle }: QuickAddButtonsProps) {
  const [lists, setLists] = useState<ListType[]>(activeLists);
  const [loadingType, setLoadingType] = useState<ListType | null>(null);

  const handleToggle = async (listType: ListType, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setLoadingType(listType);
    try {
      if (onToggle) {
        await onToggle(stampId, listType);
      } else {
        // Fallback default fetch API call
        const method = lists.includes(listType) ? "DELETE" : "POST";
        await fetch("/api/collection", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stampId, listType, condition: "MNH" }),
        });
      }

      setLists((prev) =>
        prev.includes(listType) ? prev.filter((l) => l !== listType) : [...prev, listType]
      );
    } catch (err) {
      console.error("Failed to toggle collection item:", err);
    } finally {
      setLoadingType(null);
    }
  };

  const isCollection = lists.includes("collection");
  const isWishlist = lists.includes("wishlist");
  const isTrade = lists.includes("trade");

  return (
    <div className="flex items-center gap-1">
      {/* Colección */}
      <button
        onClick={(e) => handleToggle("collection", e)}
        disabled={loadingType === "collection"}
        title={isCollection ? "En Colección" : "Agregar a Colección"}
        className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
          isCollection
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
            : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border border-white/10"
        }`}
      >
        {isCollection ? <Check size={10} className="text-emerald-400" /> : <Archive size={10} />}
        <span>{isCollection ? "En Colección" : "+ Colección"}</span>
      </button>

      {/* Deseos */}
      <button
        onClick={(e) => handleToggle("wishlist", e)}
        disabled={loadingType === "wishlist"}
        title={isWishlist ? "En Deseos" : "Agregar a Deseos"}
        className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
          isWishlist
            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
            : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border border-white/10"
        }`}
      >
        {isWishlist ? <Check size={10} className="text-amber-400" /> : <Bookmark size={10} />}
        <span>{isWishlist ? "En Deseos" : "+ Deseos"}</span>
      </button>

      {/* Intercambio */}
      <button
        onClick={(e) => handleToggle("trade", e)}
        disabled={loadingType === "trade"}
        title={isTrade ? "En Intercambio" : "Agregar a Intercambio"}
        className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
          isTrade
            ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
            : "bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 border border-white/10"
        }`}
      >
        {isTrade ? <Check size={10} className="text-blue-400" /> : <RefreshCw size={10} />}
        <span>{isTrade ? "En Canje" : "+ Canje"}</span>
      </button>
    </div>
  );
}
