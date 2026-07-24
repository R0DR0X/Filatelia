"use client";

import Image from "next/image";
import { Gavel, TrendingUp, Users } from "lucide-react";
import { Auction } from "@/types/auction";
import CountdownTimer from "./CountdownTimer";

interface AuctionCardProps {
  auction: Auction;
  onBidClick: (auction: Auction) => void;
}

export default function AuctionCard({ auction, onBidClick }: AuctionCardProps) {
  const isEnded = auction.status === "ended" || auction.status === "cancelled";
  const minRequired = auction.currentHighestBid > 0 
    ? (auction.currentHighestBid + auction.minIncrement) 
    : auction.startingPrice;

  return (
    <div className="bg-zinc-900/80 border border-white/10 rounded-2xl overflow-hidden shadow-xl hover:border-emerald-500/40 transition-all flex flex-col group">
      {/* Image Container */}
      <div className="relative h-56 w-full bg-zinc-950 overflow-hidden">
        {auction.imageUrl ? (
          <img
            src={auction.imageUrl}
            alt={auction.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600">
            <Gavel size={48} />
          </div>
        )}
        
        {/* Status Badge overlay */}
        <div className="absolute top-3 left-3 z-10">
          <CountdownTimer endTime={auction.endTime} status={auction.status} compact />
        </div>

        {/* Total Bids Tag */}
        <div className="absolute top-3 right-3 z-10 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10 flex items-center gap-1.5 text-[11px] text-zinc-300 font-medium">
          <Users size={12} className="text-emerald-400" />
          <span>{auction.totalBids} pujas</span>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-400/80">Lote Filatélico</span>
          <h3 className="text-lg font-serif text-white font-semibold line-clamp-2 mt-0.5 group-hover:text-emerald-300 transition-colors">
            {auction.title}
          </h3>
          {auction.description && (
            <p className="text-xs text-zinc-400 line-clamp-2 mt-2 font-sans">
              {auction.description}
            </p>
          )}
        </div>

        {/* Bidding Summary Box */}
        <div className="bg-black/50 border border-white/5 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
              <TrendingUp size={14} className="text-emerald-400" /> Oferta Actual
            </span>
            <span className="text-xl font-serif font-bold text-emerald-400">
              S/. {auction.currentHighestBid.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 border-t border-white/5 pt-2">
            <span>Último postor: {auction.currentHighestBidderName || "Sin pujas"}</span>
            <span>Mínima siguiente: S/. {minRequired.toFixed(2)}</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => onBidClick(auction)}
          disabled={isEnded}
          className={`w-full py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
            isEnded
              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/5"
              : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40 border border-emerald-400/30 active:scale-[0.99]"
          }`}
        >
          <Gavel size={16} />
          {isEnded ? "Subasta Finalizada" : "Pujar Ahora"}
        </button>
      </div>
    </div>
  );
}
