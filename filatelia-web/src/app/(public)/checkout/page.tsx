"use client";

import { useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/useCartStore";
import { PaymentMethod, ShippingDetails, OrderRecord } from "@/types/order";
import { 
  ShoppingBag, 
  Trash2, 
  Plus, 
  Minus, 
  CheckCircle2, 
  AlertCircle, 
  CreditCard, 
  QrCode, 
  Landmark, 
  ArrowLeft,
  Loader2
} from "lucide-react";

export default function CheckoutPage() {
  const { items, removeItem, updateQuantity, clearCart, getTotal } = useCartStore();

  const [shippingDetails, setShippingDetails] = useState<ShippingDetails>({
    fullName: "",
    address: "",
    city: "",
    postalCode: "",
    phone: "",
  });

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("yape_plin");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<{ orderId: string } | null>(null);

  const subtotal = getTotal();
  const shippingCost = items.length > 0 ? 15.00 : 0.00;
  const totalAmount = subtotal + shippingCost;

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!shippingDetails.fullName.trim()) newErrors.fullName = "El nombre completo es obligatorio";
    if (!shippingDetails.address.trim()) newErrors.address = "La dirección de entrega es obligatoria";
    if (!shippingDetails.city.trim()) newErrors.city = "La ciudad es obligatoria";
    if (!shippingDetails.postalCode.trim()) newErrors.postalCode = "El código postal es obligatorio";
    if (!shippingDetails.phone.trim()) newErrors.phone = "El teléfono de contacto es obligatorio";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof ShippingDetails, value: string) => {
    setShippingDetails((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (items.length === 0) {
      setApiError("El carrito está vacío.");
      return;
    }

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        items,
        shippingDetails,
        paymentMethod,
        subtotal,
        shippingCost,
        totalAmount,
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo procesar el pedido");
      }

      // Save order to localStorage for profile view
      const newOrderRecord: OrderRecord = {
        id: data.orderId,
        date: new Date().toISOString().split("T")[0],
        itemsCount: items.reduce((acc, item) => acc + item.quantity, 0),
        totalAmount,
        status: "Pending",
        shippingDetails,
        paymentMethod,
        items: [...items],
      };

      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem("fp_orders");
          const existingOrders = stored ? JSON.parse(stored) : [];
          localStorage.setItem("fp_orders", JSON.stringify([newOrderRecord, ...existingOrders]));
        } catch {}
      }

      // Clear cart on success
      clearCart();
      setCompletedOrder({ orderId: data.orderId });
    } catch (err: any) {
      setApiError(err.message || "Ocurrió un error inesperado al procesar el pedido.");
    } finally {
      setSubmitting(false);
    }
  };

  if (completedOrder) {
    return (
      <div className="min-h-screen bg-black text-white py-16 px-4 flex flex-col items-center justify-center">
        <div className="max-w-lg w-full bg-zinc-900/90 border border-emerald-500/30 rounded-2xl p-8 text-center backdrop-blur-sm shadow-2xl">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
            <CheckCircle2 size={36} />
          </div>
          <h1 className="text-3xl font-serif font-bold text-white mb-2">¡Pedido Confirmado!</h1>
          <p className="text-zinc-400 text-sm mb-6">
            Gracias por tu compra. Tu orden ha sido registrada exitosamente con el código:
          </p>
          <div className="bg-black/60 border border-white/10 rounded-xl p-4 mb-8 font-mono text-xl text-emerald-400 font-bold tracking-wider">
            {completedOrder.orderId}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/perfil"
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-900/20 text-center"
            >
              Ver mis Pedidos
            </Link>
            <Link
              href="/catalogo"
              className="flex-1 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-sm rounded-xl transition-all text-center"
            >
              Volver al Catálogo
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-black text-white py-16 px-4 flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-zinc-900/60 border border-white/10 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-zinc-800 text-zinc-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShoppingBag size={28} />
          </div>
          <h1 className="text-2xl font-serif text-white font-semibold mb-2">Tu carrito está vacío</h1>
          <p className="text-zinc-400 text-sm mb-6">Explora nuestro catálogo filatélico y añade piezas a tu colección.</p>
          <Link
            href="/catalogo"
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition-all"
          >
            <ArrowLeft size={16} /> Explorar Catálogo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8 border-b border-white/10 pb-4">
          <Link href="/catalogo" className="p-2 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-white transition-all">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-3xl font-serif font-bold text-white">Finalizar Compra</h1>
            <p className="text-zinc-400 text-xs mt-0.5">Revisa tus sellos filatélicos y completa los datos de entrega.</p>
          </div>
        </div>

        {apiError && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3 text-red-400 text-sm">
            <AlertCircle size={20} className="shrink-0" />
            <span>{apiError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Form & Payment (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Shipping Details Card */}
            <div className="bg-zinc-900/80 border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif font-semibold text-white mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center font-bold">1</span>
                Datos de Envío
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Nombre Completo *</label>
                  <input
                    type="text"
                    value={shippingDetails.fullName}
                    onChange={(e) => handleInputChange("fullName", e.target.value)}
                    placeholder="Ej. Rodrigo Filatelia"
                    className={`w-full bg-black border ${errors.fullName ? "border-red-500 focus:ring-red-500" : "border-white/10 focus:border-emerald-500"} rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-all`}
                  />
                  {errors.fullName && <p className="text-red-400 text-xs mt-1">{errors.fullName}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Dirección Completa *</label>
                  <input
                    type="text"
                    value={shippingDetails.address}
                    onChange={(e) => handleInputChange("address", e.target.value)}
                    placeholder="Ej. Av. Larco 456, Depto 302"
                    className={`w-full bg-black border ${errors.address ? "border-red-500 focus:ring-red-500" : "border-white/10 focus:border-emerald-500"} rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-all`}
                  />
                  {errors.address && <p className="text-red-400 text-xs mt-1">{errors.address}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Ciudad / Provincia *</label>
                    <input
                      type="text"
                      value={shippingDetails.city}
                      onChange={(e) => handleInputChange("city", e.target.value)}
                      placeholder="Ej. Lima"
                      className={`w-full bg-black border ${errors.city ? "border-red-500 focus:ring-red-500" : "border-white/10 focus:border-emerald-500"} rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-all`}
                    />
                    {errors.city && <p className="text-red-400 text-xs mt-1">{errors.city}</p>}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Código Postal *</label>
                    <input
                      type="text"
                      value={shippingDetails.postalCode}
                      onChange={(e) => handleInputChange("postalCode", e.target.value)}
                      placeholder="Ej. 15074"
                      className={`w-full bg-black border ${errors.postalCode ? "border-red-500 focus:ring-red-500" : "border-white/10 focus:border-emerald-500"} rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-all`}
                    />
                    {errors.postalCode && <p className="text-red-400 text-xs mt-1">{errors.postalCode}</p>}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Teléfono / Celular *</label>
                  <input
                    type="text"
                    value={shippingDetails.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                    placeholder="Ej. +51 999 888 777"
                    className={`w-full bg-black border ${errors.phone ? "border-red-500 focus:ring-red-500" : "border-white/10 focus:border-emerald-500"} rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-all`}
                  />
                  {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
                </div>
              </div>
            </div>

            {/* Payment Method Card */}
            <div className="bg-zinc-900/80 border border-white/10 rounded-2xl p-6">
              <h2 className="text-xl font-serif font-semibold text-white mb-4 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center font-bold">2</span>
                Método de Pago
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("yape_plin")}
                  className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all ${
                    paymentMethod === "yape_plin"
                      ? "bg-emerald-950/40 border-emerald-500 text-white"
                      : "bg-black/50 border-white/10 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  <QrCode size={20} className={paymentMethod === "yape_plin" ? "text-emerald-400" : "text-zinc-500"} />
                  <div>
                    <div className="text-sm font-bold">Yape / Plin</div>
                    <div className="text-[11px] text-zinc-400">Pago móvil rápido en Perú</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("mercadopago")}
                  className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all ${
                    paymentMethod === "mercadopago"
                      ? "bg-emerald-950/40 border-emerald-500 text-white"
                      : "bg-black/50 border-white/10 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  <CreditCard size={20} className={paymentMethod === "mercadopago" ? "text-emerald-400" : "text-zinc-500"} />
                  <div>
                    <div className="text-sm font-bold">Mercado Pago</div>
                    <div className="text-[11px] text-zinc-400">Tarjetas de crédito / débito</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("paypal")}
                  className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all ${
                    paymentMethod === "paypal"
                      ? "bg-emerald-950/40 border-emerald-500 text-white"
                      : "bg-black/50 border-white/10 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  <CreditCard size={20} className={paymentMethod === "paypal" ? "text-emerald-400" : "text-zinc-500"} />
                  <div>
                    <div className="text-sm font-bold">PayPal</div>
                    <div className="text-[11px] text-zinc-400">Pago internacional seguro</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("bank_transfer")}
                  className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all ${
                    paymentMethod === "bank_transfer"
                      ? "bg-emerald-950/40 border-emerald-500 text-white"
                      : "bg-black/50 border-white/10 text-zinc-400 hover:border-white/20"
                  }`}
                >
                  <Landmark size={20} className={paymentMethod === "bank_transfer" ? "text-emerald-400" : "text-zinc-500"} />
                  <div>
                    <div className="text-sm font-bold">Transferencia</div>
                    <div className="text-[11px] text-zinc-400">BCP, Interbank, BBVA</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Order Summary (5 cols) */}
          <div className="lg:col-span-5">
            <div className="bg-zinc-900/80 border border-white/10 rounded-2xl p-6 sticky top-6 space-y-6">
              <h2 className="text-xl font-serif font-semibold text-white border-b border-white/10 pb-3 flex items-center gap-2">
                <ShoppingBag size={20} className="text-emerald-400" />
                Resumen del Pedido
              </h2>

              {/* Items List */}
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 bg-black/40 border border-white/5 rounded-xl p-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">{item.title}</h4>
                      {item.scott && <p className="text-[10px] text-emerald-400 font-mono">{item.scott}</p>}
                      <p className="text-xs text-zinc-400 mt-0.5">S/. {item.price.toFixed(2)} c/u</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-white/10 rounded-lg overflow-hidden bg-zinc-900">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="px-2 text-xs font-bold text-white">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Calculations */}
              <div className="space-y-2 border-t border-white/10 pt-4 text-xs">
                <div className="flex justify-between text-zinc-400">
                  <span>Subtotal</span>
                  <span>S/. {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Costo de Envío (Asegurado)</span>
                  <span>S/. {shippingCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-white border-t border-white/10 pt-3">
                  <span>Total</span>
                  <span className="text-emerald-400">S/. {totalAmount.toFixed(2)}</span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Procesando Pedido...
                  </>
                ) : (
                  <>Confirmar y Pagar (S/. {totalAmount.toFixed(2)})</>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
