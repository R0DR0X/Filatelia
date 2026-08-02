"use client";

import { useState } from "react";
import { X, Gavel, AlertCircle, CheckCircle2, Loader2, ArrowUpRight } from "lucide-react";
import { Auction } from "@/types/auction";
import CountdownTimer from "./CountdownTimer";

interface BidModalProps {
  auction: Auction | null;
  isOpen: boolean;
  onClose: () => void;
  onBidSuccess: () => void;
}

export default function BidModal({ auction, isOpen, onClose, onBidSuccess }: BidModalProps) {
  if (!isOpen || !auction) return null;

  const minRequired = auction.currentHighestBid > 0 
    ? Math.round((auction.currentHighestBid + auction.minIncrement) * 100) / 100
    : Math.round(auction.startingPrice * 100) / 100;

  const [bidAmount, setBidAmount] = useState<number>(minRequired);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleQuickAdd = (increment: number) => {
    const nextVal = Math.round((bidAmount + increment) * 100) / 100;
    setBidAmount(nextVal);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const rounded = Math.round(bidAmount * 100) / 100;
    if (rounded < minRequired) {
      setErrorMsg(`La puja mínima requerida es S/. ${minRequired.toFixed(2)}`);
      return;
    }

    setLoading(true);

    try {
      // Identity is not read here at all: `/api/bids` derives the bidder
      // solely from the verified `fp_session` cookie (sent automatically by
      // `credentials: "same-origin"`), never from caller-supplied headers.
      const res = await fetch("/api/bids", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auctionId: auction.id,
          amount: rounded,
          expectedCurrentHighestBid: auction.currentHighestBid,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 401) {
          setErrorMsg("Debes iniciar sesión para realizar una puja.");
        } else if (res.status === 409) {
          setErrorMsg("¡Conflicto de puja! Otro usuario acaba de realizar una oferta mayor. Intenta nuevamente.");
        } else {
          setErrorMsg(data.error || "Ocurrió un error al procesar tu puja.");
        }
        setLoading(false);
        return;
      }

      setSuccessMsg(`¡Puja registrada con éxito por S/. ${rounded.toFixed(2)}!`);
      setTimeout(() => {
        onBidSuccess();
        onClose();
        setSuccessMsg(null);
      }, 1200);
    } catch (err: any) {
      setErrorMsg("Error de conexión con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-white/10 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-zinc-950/50">
          <div className="flex items-center gap-2 text-emerald-400 font-serif font-semibold text-lg">
            <Gavel size={20} />
            <span>Realizar Oferta de Puja</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Auction Summary */}
          <div className="flex gap-4 items-center bg-black/40 border border-white/5 p-4 rounded-xl">
            {auction.imageUrl && (
              <img
                src={auction.imageUrl}
                alt={auction.title}
                className="w-16 h-16 object-cover rounded-lg border border-white/10"
              />
            )}
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-white line-clamp-1">{auction.title}</h4>
              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-zinc-400">Oferta Actual:</span>
                <span className="text-emerald-400 font-bold font-serif">S/. {auction.currentHighestBid.toFixed(2)}</span>
              </div>
              <div className="mt-1">
                <CountdownTimer endTime={auction.endTime} status={auction.status} compact />
              </div>
            </div>
          </div>

          {/* Messages */}
          {errorMsg && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-400 text-xs font-medium">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3 text-emerald-400 text-xs font-medium">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Tu Oferta (Mínima: S/. {minRequired.toFixed(2)})
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-serif font-bold text-lg">
                  S/.
                </span>
                <input
                  type="number"
                  step="0.01"
                  min={minRequired}
                  value={bidAmount}
                  onChange={(e) => {
                    setBidAmount(parseFloat(e.target.value) || 0);
                    setErrorMsg(null);
                  }}
                  className="w-full bg-black/80 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 text-xl font-serif font-bold text-white focus:border-emerald-500 outline-none transition-all"
                  required
                />
              </div>
            </div>

            {/* Quick Increment Buttons */}
            <div>
              <span className="text-[11px] text-zinc-500 font-medium block mb-2">Aumentar rápidamente:</span>
              <div className="grid grid-cols-3 gap-2">
                {[5, 10, 25].map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => handleQuickAdd(inc)}
                    className="py-2 px-3 bg-zinc-800/80 hover:bg-zinc-800 border border-white/10 hover:border-emerald-500/40 rounded-xl text-xs font-bold text-zinc-300 hover:text-emerald-400 flex items-center justify-center gap-1 transition-all"
                  >
                    +S/. {inc} <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading || !!successMsg}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 mt-4"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Procesando Puja...
                </>
              ) : (
                <>
                  <Gavel size={16} /> Confirmar Puja de S/. {bidAmount.toFixed(2)}
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
