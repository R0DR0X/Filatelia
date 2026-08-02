"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ShoppingCart, Stamp as StampIcon } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";

interface StampCardProps {
  id?: string;
  image?: string;
  title: string;
  scott?: string;
  price?: number;
  isForSale?: boolean;
}

export default function StampCard({ id, image, title, scott, price, isForSale = false }: StampCardProps) {
  const addItem = useCartStore((state) => state.addItem);
  const [imgError, setImgError] = useState(false);

  const isInvalidImage = !image || imgError || image.includes("login_error") || image.includes("colnect_login") || image.endsWith(".html");

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (price) {
      addItem({
        id: id || `${title}-${scott}`,
        title,
        price,
        // This card only ever renders a `Stamp.marketPriceUsd` value (see
        // callers), which is USD by its own column name — hardcoded here
        // for the same reason src/lib/db/orders.ts hardcodes it server-side.
        currency: "USD",
        scott: scott || "N/A",
        image: isInvalidImage ? undefined : image,
        quantity: 1,
      });
    }
  };

  const cardContent = (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className="stamp-card group flex flex-col h-full bg-zinc-900 border border-white/10 hover:border-amber-500/40 rounded-xl overflow-hidden shadow-xl transition-all"
    >
      {/* Stamp Image Box */}
      <div className="aspect-square relative overflow-hidden bg-gradient-to-b from-zinc-950 to-zinc-900 p-4 border-b border-white/5 flex items-center justify-center">
        {!isInvalidImage ? (
          <Image
            src={image!}
            alt={title}
            fill
            onError={() => setImgError(true)}
            className="object-contain p-3 transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, 25vw"
            unoptimized
          />
        ) : (
          /* Elegant Fallback for broken/missing images */
          <div className="w-full h-full flex flex-col items-center justify-center border border-dashed border-amber-500/20 rounded-lg p-3 bg-amber-500/5 text-center">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-2">
              <StampIcon size={20} className="text-amber-400 opacity-80" />
            </div>
            <span className="text-[10px] font-serif italic text-amber-200/60 line-clamp-1">{title}</span>
            <span className="text-[9px] font-mono text-zinc-500 mt-1 uppercase">Sello de Colección</span>
          </div>
        )}

        {isForSale && (
          <div className="absolute top-2 right-2 bg-amber-500 text-black text-[9px] px-2 py-0.5 rounded font-black tracking-widest uppercase z-10 shadow-md">
            En Venta
          </div>
        )}

        {isForSale && price && (
          <button
            onClick={handleAddToCart}
            className="absolute inset-x-0 bottom-0 bg-amber-500 text-black py-2.5 translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-2 font-bold text-xs z-20 shadow-[0_-4px_15px_rgba(0,0,0,0.5)]"
          >
            <ShoppingCart size={14} />
            AÑADIR AL CARRITO
          </button>
        )}
      </div>

      {/* Card Info */}
      <div className="p-4 flex-1 flex flex-col bg-zinc-950/80">
        <h3 className="text-xs font-serif font-bold text-amber-100 group-hover:text-amber-400 transition-colors line-clamp-2 mb-3 leading-snug uppercase tracking-wide border-b border-white/5 pb-2">
          {title}
        </h3>

        <div className="space-y-1.5 mb-3">
          <TechnicalRow label="Scott" value={scott} />
          <TechnicalRow label="Catálogo" value="WNS / Colnect" />
        </div>

        <div className="mt-auto pt-3 flex justify-between items-center border-t border-white/10">
          <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Valor</span>
          {isForSale && price ? (
            <span className="text-sm font-mono font-bold text-amber-400">${price.toFixed(2)}</span>
          ) : (
            <span className="text-[10px] text-amber-500/70 font-serif italic">Ver detalle →</span>
          )}
        </div>
      </div>
    </motion.div>
  );

  return id ? <Link href={`/sello/${id}`}>{cardContent}</Link> : cardContent;
}

function TechnicalRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between items-center text-[10px]">
      <span className="text-zinc-500 uppercase tracking-tight font-medium">{label}</span>
      <span className="text-zinc-300 font-mono">{value || "---"}</span>
    </div>
  );
}
