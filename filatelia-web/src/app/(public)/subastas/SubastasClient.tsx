"use client";

import { useState, useEffect, useCallback } from "react";
import { Gavel, RefreshCw, Sparkles, ShieldCheck } from "lucide-react";
import { Auction } from "@/types/auction";
import AuctionCard from "@/components/auctions/AuctionCard";
import BidModal from "@/components/auctions/BidModal";
import AuctionFilterSort from "@/components/auctions/AuctionFilterSort";

export default function SubastasClient() {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");
  const [sortBy, setSortBy] = useState("ending_soon");
  const [selectedAuction, setSelectedAuction] = useState<Auction | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchAuctions = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      const query = new URLSearchParams();
      if (statusFilter !== "all") query.set("status", statusFilter);
      if (sortBy) query.set("sortBy", sortBy);

      const res = await fetch(`/api/auctions?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.auctions)) {
          setAuctions(data.auctions);
        }
      }
    } catch (err) {
      console.error("Failed to fetch auctions", err);
    } finally {
      setLoading(false);
      if (showRefreshing) {
        setTimeout(() => setIsRefreshing(false), 500);
      }
    }
  }, [statusFilter, sortBy]);

  // Initial fetch and 3000ms polling loop
  useEffect(() => {
    fetchAuctions();
    const interval = setInterval(() => {
      fetchAuctions(false);
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchAuctions]);

  const handleOpenBidModal = (auction: Auction) => {
    setSelectedAuction(auction);
    setIsModalOpen(true);
  };

  const handleBidSuccess = () => {
    fetchAuctions(true);
  };

  const totalActive = auctions.filter(a => a.status === "active").length;

  return (
    <div className="min-h-screen bg-black py-10 px-4 max-w-7xl mx-auto space-y-8">
      {/* Header section */}
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="w-16 h-16 bg-emerald-950/60 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-950/50">
          <Gavel size={32} />
        </div>
        <h1 className="text-4xl md:text-5xl font-serif text-white font-bold">
          Subastas Filatélicas <span className="text-emerald-400">en Vivo</span>
        </h1>
        <p className="text-zinc-400 max-w-2xl text-sm leading-relaxed font-sans">
          Participa en tiempo real por piezas numismáticas y filatélicas históricas con autenticidad garantizada y sistema de ofertas atómicas de alta precisión.
        </p>

        {/* Live indicator & Polling status */}
        <div className="flex items-center gap-3 pt-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-xs font-bold text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            En Vivo • Actualización 3000ms
          </div>

          <button
            onClick={() => fetchAuctions(true)}
            className="p-1.5 bg-zinc-900 border border-white/10 rounded-full text-zinc-400 hover:text-white transition-colors"
            title="Actualizar datos"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin text-emerald-400" : ""} />
          </button>
        </div>
      </div>

      {/* Filter and Sorting bar */}
      <AuctionFilterSort
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        sortBy={sortBy}
        setSortBy={setSortBy}
        totalActive={totalActive}
      />

      {/* Grid of Auctions */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-zinc-900/50 border border-white/5 rounded-2xl h-[400px] animate-pulse" />
          ))}
        </div>
      ) : auctions.length === 0 ? (
        <div className="bg-zinc-900/40 border border-white/10 rounded-2xl p-12 text-center space-y-4">
          <Gavel size={48} className="mx-auto text-zinc-600" />
          <h3 className="text-xl font-serif text-white font-semibold">No se encontraron subastas</h3>
          <p className="text-zinc-400 text-sm">No hay lotes que coincidan con los filtros seleccionados en este momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {auctions.map((auction) => (
            <AuctionCard
              key={auction.id}
              auction={auction}
              onBidClick={handleOpenBidModal}
            />
          ))}
        </div>
      )}

      {/* Guarantee Footer banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-8 border-t border-white/5">
        <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-xl flex items-center gap-3">
          <ShieldCheck size={24} className="text-emerald-400 shrink-0" />
          <div>
            <h4 className="text-xs font-bold text-white">Certificado de Autenticidad</h4>
            <p className="text-[11px] text-zinc-400">Garantía filatélica oficial de cada pieza</p>
          </div>
        </div>
        <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-xl flex items-center gap-3">
          <Sparkles size={24} className="text-amber-400 shrink-0" />
          <div>
            <h4 className="text-xs font-bold text-white">Transacciones Atómicas</h4>
            <p className="text-[11px] text-zinc-400">Protección OCC ante concurrencia en milisegundos</p>
          </div>
        </div>
        <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-xl flex items-center gap-3">
          <Gavel size={24} className="text-emerald-400 shrink-0" />
          <div>
            <h4 className="text-xs font-bold text-white">Cierre Automatizado</h4>
            <p className="text-[11px] text-zinc-400">Liquidación y adjudicación inmediata al finalizar</p>
          </div>
        </div>
      </div>

      {/* Bid Modal */}
      <BidModal
        auction={selectedAuction}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onBidSuccess={handleBidSuccess}
      />
    </div>
  );
}
