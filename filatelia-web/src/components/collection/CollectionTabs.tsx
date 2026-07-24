"use client";

import { useState } from "react";
import { UserCollectionItem, ListType, ConditionGrade } from "@/types/collection";
import { Trash2, Edit2, Check, Bookmark, RefreshCw, Archive, Sparkles } from "lucide-react";

interface CollectionTabsProps {
  items: UserCollectionItem[];
  onUpdateCondition?: (id: number, condition: ConditionGrade, notes?: string) => Promise<void>;
  onDeleteItem?: (id: number) => Promise<void>;
  activeTab?: ListType;
  onTabChange?: (tab: ListType) => void;
}

export function CollectionTabs({
  items,
  onUpdateCondition,
  onDeleteItem,
  activeTab = "collection",
  onTabChange,
}: CollectionTabsProps) {
  const [currentTab, setCurrentTab] = useState<ListType>(activeTab);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCondition, setEditCondition] = useState<ConditionGrade>("MNH");
  const [editNotes, setEditNotes] = useState<string>("");
  const [filterCondition, setFilterCondition] = useState<string>("all");

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
  };

  const saveEdit = async (id: number) => {
    if (onUpdateCondition) {
      await onUpdateCondition(id, editCondition, editNotes);
    }
    setEditingId(null);
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
                <div>
                  <h4 className="text-white font-serif font-semibold text-sm">
                    {item.stampTitle || `Sello ID ${item.stampId}`}
                  </h4>
                  {item.stampCatalogNumber && (
                    <span className="text-[10px] font-mono text-zinc-500">{item.stampCatalogNumber}</span>
                  )}
                </div>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getConditionColor(
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
                      onClick={() => saveEdit(item.id)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded flex items-center gap-1"
                    >
                      <Check size={10} /> Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-400 text-xs italic">{item.notes || "Sin notas adicionales"}</p>
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
                      onClick={() => onDeleteItem(item.id)}
                      className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
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
