"use client";

import { ArrowUpDown, Flame, Clock, Calendar } from "lucide-react";

interface AuctionFilterSortProps {
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  sortBy: string;
  setSortBy: (sort: string) => void;
  totalActive: number;
}

export default function AuctionFilterSort({
  statusFilter,
  setStatusFilter,
  sortBy,
  setSortBy,
  totalActive,
}: AuctionFilterSortProps) {
  const tabs = [
    { id: "active", label: "En Vivo", count: totalActive },
    { id: "all", label: "Todas" },
    { id: "ended", label: "Finalizadas" },
  ];

  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-zinc-900/60 border border-white/10 p-3 rounded-2xl backdrop-blur-md">
      {/* Tabs */}
      <div className="flex items-center gap-1.5 bg-black/60 p-1 rounded-xl border border-white/5">
        {tabs.map((tab) => {
          const isActive = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                isActive
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    isActive ? "bg-white/20 text-white" : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sorting Selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
          <ArrowUpDown size={14} className="text-emerald-400" /> Ordenar por:
        </span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-black/60 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-medium focus:border-emerald-500 outline-none transition-all"
        >
          <option value="ending_soon">Próximas a Finalizar</option>
          <option value="highest_bid">Mayor Oferta Actual</option>
          <option value="newest">Más Recientes</option>
        </select>
      </div>
    </div>
  );
}
