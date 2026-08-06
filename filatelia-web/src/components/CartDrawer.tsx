"use client"

import { useCartStore } from "@/store/useCartStore"
import { ShoppingCart, X, Plus, Minus, Trash2, ArrowRight, AlertTriangle } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"
import { formatOrderMoney, summarizeCartCurrency } from "@/lib/checkout"

export default function CartDrawer() {
  const { items, isOpen, closeCart, removeItem, updateQuantity, getItemCount } = useCartStore()

  // The cart can hold items whose catalog row has no declared currency yet,
  // or a mix of currencies — summing raw prices in that case produces a
  // number that means nothing. `summarizeCartCurrency` refuses instead of
  // guessing; the subtotal line below shows that refusal in Spanish rather
  // than a misleading total.
  const currencySummary = summarizeCartCurrency(
    items.map((item) => ({ price: item.price, quantity: item.quantity, currency: item.currency }))
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-zinc-950 border-l border-white/10 z-[60] shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black">
              <div className="flex items-center gap-3">
                <ShoppingCart className="text-moss-green" size={24} />
                <h2 className="text-xl font-serif font-bold text-white uppercase tracking-tight">Tu Colección</h2>
                <span className="bg-moss-green text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {getItemCount()}
                </span>
              </div>
              <button onClick={closeCart} className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                  <ShoppingCart size={64} strokeWidth={1} />
                  <p className="font-serif italic">Tu carrito está vacío</p>
                  <button onClick={closeCart} className="text-xs text-moss-green-light hover:underline uppercase tracking-widest font-bold">
                    Seguir explorando
                  </button>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex gap-4 group">
                    <div className="w-20 h-20 bg-zinc-900 rounded-lg border border-white/5 flex items-center justify-center overflow-hidden shrink-0">
                      {item.image ? (
                        <img src={item.image} alt={item.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-[10px] text-zinc-700 font-bold uppercase">Sin imagen</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="text-sm font-bold text-zinc-100 truncate pr-2 uppercase leading-tight">{item.title}</h3>
                        <span className="text-sm font-mono text-moss-green-light">
                          {formatOrderMoney(item.price * item.quantity, item.currency)}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Scott: {item.scott || "N/A"}</p>
                      
                      <div className="flex justify-between items-center">
                        <div className="flex items-center bg-black border border-white/10 rounded-md overflow-hidden">
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="p-1 px-2 hover:bg-white/5 text-zinc-400"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="px-3 text-xs font-bold text-zinc-300">{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="p-1 px-2 hover:bg-white/5 text-zinc-400"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <button 
                          onClick={() => removeItem(item.id)}
                          className="text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="p-6 bg-black border-t border-white/10 space-y-4 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-500 uppercase tracking-widest font-bold">Subtotal</span>
                  <span className="text-xl font-mono text-white font-bold">
                    {currencySummary.ok && currencySummary.currency
                      ? formatOrderMoney(currencySummary.subtotal, currencySummary.currency)
                      : "—"}
                  </span>
                </div>
                {/* `=== false`, not `!currencySummary.ok` — see the note in
                    src/app/(public)/checkout/page.tsx: negated boolean
                    discriminants don't narrow under this project's
                    `strict: false` tsconfig. */}
                {currencySummary.ok === false ? (
                  <div className="flex items-start gap-2 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{currencySummary.message}</span>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-600 italic">Impuestos y envío calculados en el checkout.</p>
                )}
                <Link 
                  href="/checkout" 
                  onClick={closeCart}
                  className="w-full bg-moss-green hover:bg-moss-green-dark text-white font-bold py-4 rounded-lg flex items-center justify-center gap-3 transition-all group"
                >
                  FINALIZAR COMPRA
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
