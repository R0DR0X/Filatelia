"use client";

import { useState } from "react";
import Image from "next/image";
import { UserCollectionItem, ListType, ConditionGrade } from "@/types/collection";
import { collectionFailureMessage, listSupportsQuantity } from "@/lib/collectionControl";
import type { CollectionActionResult } from "@/lib/collectionControl";
import { Trash2, Edit2, Check, Bookmark, RefreshCw, Archive, Sparkles, EyeOff, Stamp as StampIcon, AlertCircle } from "lucide-react";

// Quantity is only a meaningful field for the "collection" list (how many
// copies you own) — mirrors the same decision made for the four-state
// widget on the sello detail page (see src/lib/collectionControl.ts, which
// owns the `listSupportsQuantity` predicate both surfaces gate on).
// Wishlist/trade/ignore rows are membership-only: they never expose a
// quantity editor here, and never display a quantity either.
//
// The two callbacks return the write's RESULT rather than `Promise<void>`:
// with `void` this component had no way to tell a save that landed from one
// that 401'd, so it closed the editor either way and a failed save looked
// exactly like a successful one that reverted. A result lets it keep the
// editor (and the user's input) open and say what went wrong, in Spanish.
interface CollectionTabsProps {
  items: UserCollectionItem[];
  onUpdateItem?: (
    id: number,
    updates: { condition: ConditionGrade; quantity?: number; notes?: string }
  ) => Promise<CollectionActionResult>;
  onDeleteItem?: (id: number) => Promise<CollectionActionResult>;
  activeTab?: ListType;
  onTabChange?: (tab: ListType) => void;
}

export function CollectionTabs({
  items,
  onUpdateItem,
  onDeleteItem,
  activeTab = "collection",
  onTabChange,
}: CollectionTabsProps) {
  const [currentTab, setCurrentTab] = useState<ListType>(activeTab);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCondition, setEditCondition] = useState<ConditionGrade>("MNH");
  const [editNotes, setEditNotes] = useState<string>("");
  const [editQuantity, setEditQuantity] = useState<number>(1);
  const [filterCondition, setFilterCondition] = useState<string>("all");
  // Failure copy scoped to the row it belongs to: a card whose delete 401'd
  // must say so on that card, not blame an unrelated one.
  const [itemError, setItemError] = useState<{ id: number; message: string } | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const handleSelectTab = (tab: ListType) => {
    setCurrentTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  const filteredItems = items
    .filter((i) => i.listType === currentTab)
    .filter((i) => filterCondition === "all" || i.condition === filterCondition);

  const startEdit = (item: UserCollectionItem) => {
    setEditingId(item.id);
    setEditCondition(item.condition);
    setEditNotes(item.notes || "");
    setEditQuantity(item.quantity);
    setItemError(null);
  };

  const saveEdit = async (item: UserCollectionItem) => {
    if (!onUpdateItem) {
      setEditingId(null);
      return;
    }

    setPendingId(item.id);
    setItemError(null);
    const result = await onUpdateItem(item.id, {
      condition: editCondition,
      notes: editNotes,
      quantity: listSupportsQuantity(item.listType)
        ? Math.max(1, Math.floor(editQuantity) || 1)
        : undefined,
    });
    setPendingId(null);

    const message = collectionFailureMessage(result);
    if (message) {
      // The save did NOT land. Closing the editor here would show the user
      // their old values back with no explanation — indistinguishable from a
      // successful save that reverted — and throw away what they typed.
      setItemError({ id: item.id, message });
      return;
    }

    setEditingId(null);
  };

  const deleteItem = async (item: UserCollectionItem) => {
    if (!onDeleteItem) return;

    setPendingId(item.id);
    setItemError(null);
    const result = await onDeleteItem(item.id);
    setPendingId(null);

    const message = collectionFailureMessage(result);
    if (message) setItemError({ id: item.id, message });
  };

  const getConditionColor = (grade: ConditionGrade) => {
    switch (grade) {
      case "MNH":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "MH":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "Used":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "FDC":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      default:
        return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSelectTab("collection")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              currentTab === "collection"
                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Archive size={14} /> Colección ({items.filter((i) => i.listType === "collection").length})
          </button>

          <button
            onClick={() => handleSelectTab("wishlist")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              currentTab === "wishlist"
                ? "bg-amber-950/60 text-amber-400 border border-amber-500/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Bookmark size={14} /> Deseos ({items.filter((i) => i.listType === "wishlist").length})
          </button>

          <button
            onClick={() => handleSelectTab("trade")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              currentTab === "trade"
                ? "bg-blue-950/60 text-blue-400 border border-blue-500/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <RefreshCw size={14} /> Intercambio ({items.filter((i) => i.listType === "trade").length})
          </button>

          <button
            onClick={() => handleSelectTab("ignore")}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              currentTab === "ignore"
                ? "bg-zinc-800 text-zinc-300 border border-white/20"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <EyeOff size={14} /> Ignorados ({items.filter((i) => i.listType === "ignore").length})
          </button>
        </div>

        {/* Condition Grade Filter */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 font-medium">Estado:</span>
          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            className="bg-zinc-900 border border-white/10 text-zinc-300 rounded-lg px-2.5 py-1 focus:outline-none focus:border-emerald-500/50 text-xs"
          >
            <option value="all">Todos</option>
            <option value="MNH">MNH (Mint Never Hinged)</option>
            <option value="MH">MH (Mint Hinged)</option>
            <option value="Used">Used (Usado)</option>
            <option value="FDC">FDC (First Day Cover)</option>
          </select>
        </div>
      </div>

      {/* Item List / Cards */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl bg-zinc-900/30">
          <Sparkles className="mx-auto text-zinc-600 mb-2" size={24} />
          <p className="text-zinc-400 text-sm font-medium">No hay sellos en esta lista</p>
          <p className="text-zinc-600 text-xs mt-1">Explora el catálogo para agregar sellos a tu inventario</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="bg-zinc-900/60 border border-white/10 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-white/20 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-zinc-800 border border-white/5 flex items-center justify-center">
                    {item.stampImage ? (
                      <Image
                        src={item.stampImage}
                        alt={item.stampTitle || item.stampId}
                        fill
                        className="object-contain p-1"
                        sizes="48px"
                        unoptimized
                      />
                    ) : (
                      <StampIcon size={18} className="text-zinc-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-white font-serif font-semibold text-sm truncate">
                      {item.stampTitle || `Sello ID ${item.stampId}`}
                    </h4>
                    {item.stampCatalogNumber && (
                      <span className="text-[10px] font-mono text-zinc-500">{item.stampCatalogNumber}</span>
                    )}
                    {listSupportsQuantity(item.listType) && (
                      <div className="text-[10px] text-zinc-500 mt-0.5">Cantidad: {item.quantity}</div>
                    )}
                  </div>
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border shrink-0 ${getConditionColor(
                    item.condition
                  )}`}
                >
                  {item.condition}
                </span>
              </div>

              {/* Editing Form or Notes Display */}
              {editingId === item.id ? (
                <div className="bg-black/50 border border-white/10 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-zinc-400 font-bold uppercase">Estado:</label>
                    <select
                      value={editCondition}
                      onChange={(e) => setEditCondition(e.target.value as ConditionGrade)}
                      className="bg-zinc-800 border border-white/10 text-xs text-white rounded px-2 py-1"
                    >
                      <option value="MNH">MNH</option>
                      <option value="MH">MH</option>
                      <option value="Used">Used</option>
                      <option value="FDC">FDC</option>
                    </select>
                  </div>

                  {listSupportsQuantity(item.listType) && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-zinc-400 font-bold uppercase">Cantidad:</label>
                      <input
                        type="number"
                        min={1}
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(Number(e.target.value))}
                        className="w-16 bg-zinc-800 border border-white/10 text-xs text-white rounded px-2 py-1"
                      />
                    </div>
                  )}

                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notas o detalles..."
                    className="w-full bg-zinc-800 border border-white/10 text-xs text-white rounded px-2.5 py-1 focus:outline-none"
                  />

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 text-[10px] text-zinc-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => saveEdit(item)}
                      disabled={pendingId === item.id}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Check size={10} /> {pendingId === item.id ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-400 text-xs italic">{item.notes || "Sin notas adicionales"}</p>
              )}

              {itemError?.id === item.id && (
                <p role="alert" className="flex items-start gap-1.5 text-[11px] text-red-400">
                  <AlertCircle size={12} className="shrink-0 mt-px" />
                  <span>{itemError.message}</span>
                </p>
              )}

              {/* Controls */}
              <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs text-zinc-500">
                <span className="text-[10px] font-mono">Agregado: {new Date(item.createdAt).toLocaleDateString()}</span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded transition-colors"
                    title="Editar estado/notas"
                  >
                    <Edit2 size={13} />
                  </button>
                  {onDeleteItem && (
                    <button
                      onClick={() => deleteItem(item)}
                      disabled={pendingId === item.id}
                      className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Eliminar de lista"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
