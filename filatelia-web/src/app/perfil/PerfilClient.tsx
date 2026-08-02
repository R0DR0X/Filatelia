"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { User, Mail, Shield, LogOut, BookOpen, LayoutDashboard, Loader2, MapPin, Award, ShoppingBag, Clock, Gavel, TrendingUp, AlertCircle, CheckCircle, RefreshCw, Archive, Sparkles, Handshake } from "lucide-react";
import { getMe, logout } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import Link from "next/link";
import { getInitials } from "@/lib/utils";
import { OrderRecord } from "@/types/order";
import { CollectionTabs } from "@/components/collection/CollectionTabs";
import { UserCollectionItem, ConditionGrade, MatchProposal, ListType } from "@/types/collection";

const DEFAULT_ORDERS: OrderRecord[] = [
  {
    id: "ORD-2026-94812",
    date: "2026-07-20",
    itemsCount: 2,
    totalAmount: 185.00,
    status: "Completed",
    shippingDetails: {
      fullName: "Rodrigo Filatelia",
      address: "Av. Larco 456, Depto 302",
      city: "Lima",
      postalCode: "15074",
      phone: "+51 999 888 777"
    },
    paymentMethod: "yape_plin",
    items: [
      { id: "stamp-01", title: "Perú 1857 1d Azul UN DINERO", price: 150.00, quantity: 1, scott: "Scott #1" },
      { id: "stamp-02", title: "Perú 1858 1d Rojo Frambuesa", price: 35.00, quantity: 1, scott: "Scott #3" }
    ]
  },
  {
    id: "ORD-2026-88912",
    date: "2026-07-15",
    itemsCount: 1,
    totalAmount: 95.00,
    status: "Processing",
    shippingDetails: {
      fullName: "Rodrigo Filatelia",
      address: "Av. Larco 456, Depto 302",
      city: "Lima",
      postalCode: "15074",
      phone: "+51 999 888 777"
    },
    paymentMethod: "mercadopago",
    items: [
      { id: "stamp-03", title: "Perú 1860 1d Azul Escudo", price: 95.00, quantity: 1, scott: "Scott #7" }
    ]
  }
];

interface UserAuctionBid {
  auctionId: string;
  title: string;
  myBid: number;
  highestBid: number;
  status: "winning" | "outbid" | "won" | "ended";
  date: string;
}

const DEFAULT_USER_BIDS: UserAuctionBid[] = [
  {
    auctionId: "auc-01",
    title: "Perú 1857 1d Azul UN DINERO - Par Horizontal Raro",
    myBid: 150.00,
    highestBid: 150.00,
    status: "winning",
    date: "2026-07-23 11:30"
  },
  {
    auctionId: "auc-03",
    title: "Perú 1860 1d Azul Escudo - Cancelación Sobrecargada",
    myBid: 165.00,
    highestBid: 180.00,
    status: "outbid",
    date: "2026-07-23 10:15"
  },
  {
    auctionId: "auc-04",
    title: "Perú 1871 TREN Un Peseta Bermellón - Muestra de Ensayo",
    myBid: 320.00,
    highestBid: 320.00,
    status: "won",
    date: "2026-07-20 18:00"
  }
];

export default function PerfilClient() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"coleccion" | "intercambios" | "pedidos" | "subastas">("coleccion");
  
  const [collectionItems, setCollectionItems] = useState<UserCollectionItem[]>([]);
  const [matchProposals, setMatchProposals] = useState<MatchProposal[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

  useEffect(() => {
    getMe().then((result) => {
      // This page has nothing to render without an identity, so both
      // `anonymous` (authoritative 401) and `unavailable` (transient
      // failure) send the visitor to /login — the login page re-probes the
      // session, so a blip costs a redirect, never a wrong logged-in view.
      if (result.status !== "authenticated") {
        router.push("/login?from=/perfil");
        return;
      }
      const u = result.user;
      setUser(u);
      
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem("fp_orders");
          if (stored) {
            const parsed = JSON.parse(stored);
            setOrders(Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ORDERS);
          } else {
            setOrders(DEFAULT_ORDERS);
          }
        } catch {
          setOrders(DEFAULT_ORDERS);
        }
      }

      // Fetch user collection
      const collectionFetch = fetch("/api/collection")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.items)) {
            setCollectionItems(data.items);
          }
        })
        .catch(console.error);

      // Fetch trade matches
      setLoadingMatches(true);
      const matchFetch = fetch("/api/match")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.proposals)) {
            setMatchProposals(data.proposals);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingMatches(false));

      Promise.allSettled([collectionFetch, matchFetch]).finally(() => {
        setLoading(false);
      });
    });
  }, [router]);

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  const handleUpdateCondition = async (id: number, condition: ConditionGrade, notes?: string) => {
    try {
      const res = await fetch("/api/collection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, condition, notes }),
      });
      const data = await res.json();
      if (data.success) {
        setCollectionItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, condition, notes: notes || "" } : item))
        );
      }
    } catch (err) {
      console.error("Failed to update item:", err);
    }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      const res = await fetch(`/api/collection?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        setCollectionItems((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  const getStatusBadge = (status: OrderRecord["status"]) => {
    switch (status) {
      case "Completed": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "Processing": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "Pending": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "Cancelled": return "bg-red-500/10 text-red-400 border-red-500/20";
      default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  };

  const getBidBadge = (status: UserAuctionBid["status"]) => {
    switch (status) {
      case "winning":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase"><TrendingUp size={12} /> Ganando</span>;
      case "outbid":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[10px] font-bold uppercase"><AlertCircle size={12} /> Superado</span>;
      case "won":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[10px] font-bold uppercase"><CheckCircle size={12} /> Ganado</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 rounded-full text-[10px] font-bold uppercase">Finalizado</span>;
    }
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "yape_plin": return "Yape / Plin";
      case "mercadopago": return "Mercado Pago";
      case "paypal": return "PayPal";
      case "bank_transfer": return "Transferencia";
      default: return method;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 size={32} className="text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const avatarInitials = getInitials(user.name);

  return (
    <div className="min-h-screen bg-black py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header Profile Section */}
        <div className="bg-zinc-900/80 border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-emerald-950/60 text-emerald-400 rounded-full flex items-center justify-center text-3xl font-serif font-bold border-2 border-emerald-500/30 shadow-lg shadow-emerald-950/50">
              {avatarInitials}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-serif text-white font-semibold">{user.name}</h1>
                <span className={`px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full border ${
                  user.role === "admin"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                }`}>
                  {user.role === "admin" ? "Administrador" : "Coleccionista Gold"}
                </span>
              </div>
              <p className="text-zinc-400 text-sm mt-1">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800/80 hover:bg-zinc-800 border border-white/10 rounded-xl text-xs font-bold text-zinc-300 hover:text-white transition-all"
          >
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>

        {/* Info Grid: Collector Tier & Shipping Address */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-900/60 border border-white/5 rounded-xl p-5 flex items-start gap-4">
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20">
              <Award size={20} />
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Nivel de Coleccionista</div>
              <div className="text-white font-medium mt-1">Coleccionista Gold</div>
              <div className="text-xs text-zinc-400 mt-0.5">Acceso a subastas privadas en vivo</div>
            </div>
          </div>

          <div className="bg-zinc-900/60 border border-white/5 rounded-xl p-5 flex items-start gap-4 md:col-span-2">
            <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
              <MapPin size={20} />
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Dirección de Envío Habitual</div>
              <div className="text-white font-medium mt-1">Av. Larco 456, Depto 302, Miraflores</div>
              <div className="text-xs text-zinc-400 mt-0.5">Lima, Perú (Cod. Postal 15074) • +51 999 888 777</div>
            </div>
          </div>
        </div>

        {/* Action Links */}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/subastas"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-sm font-bold text-emerald-300 hover:bg-emerald-900/40 transition-all"
          >
            <Gavel size={16} /> Ir a Subastas en Vivo
          </Link>
          <Link
            href="/catalogo"
            className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3.5 bg-zinc-900 border border-white/10 rounded-xl text-sm font-bold text-zinc-200 hover:border-emerald-500/40 hover:text-white transition-all"
          >
            <BookOpen size={16} /> Explorar Catálogo
          </Link>
          {user.role === "admin" && (
            <Link
              href="/admin/dashboard"
              className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm font-bold text-amber-400 hover:bg-amber-500/20 transition-all"
            >
              <LayoutDashboard size={16} /> Panel Admin
            </Link>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab("coleccion")}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === "coleccion"
                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Archive size={14} /> Mi Inventario ({collectionItems.length})
          </button>
          <button
            onClick={() => setActiveTab("intercambios")}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === "intercambios"
                ? "bg-blue-950/60 text-blue-400 border border-blue-500/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Handshake size={14} /> Coincidencias de Canje ({matchProposals.length})
          </button>
          <button
            onClick={() => setActiveTab("pedidos")}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === "pedidos"
                ? "bg-zinc-800 text-white border border-white/10"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <ShoppingBag size={14} /> Historial de Pedidos ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab("subastas")}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === "subastas"
                ? "bg-amber-950/60 text-amber-400 border border-amber-500/30"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Gavel size={14} /> Mis Subastas ({DEFAULT_USER_BIDS.length})
          </button>
        </div>

        {/* Tab Content: Mi Inventario (3-Tab Collection) */}
        {activeTab === "coleccion" && (
          <div className="bg-zinc-900/60 border border-white/10 rounded-2xl p-6">
            <CollectionTabs
              items={collectionItems}
              onUpdateCondition={handleUpdateCondition}
              onDeleteItem={handleDeleteItem}
            />
          </div>
        )}

        {/* Tab Content: Coincidencias de Canje (Auto-Match) */}
        {activeTab === "intercambios" && (
          <div className="bg-zinc-900/60 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-white font-serif font-semibold text-lg flex items-center gap-2">
                  <Handshake className="text-blue-400" size={20} /> Propuestas de Intercambio Recíproco
                </h3>
                <p className="text-zinc-400 text-xs mt-1">
                  Algoritmo 2-Way Reciprocal Matching: Coleccionistas que poseen sellos de tu Lista de Deseos y buscan sellos de tu Lista de Intercambio.
                </p>
              </div>

              <span className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-mono font-bold rounded-full">
                {matchProposals.length} coincidencias
              </span>
            </div>

            {loadingMatches ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="text-blue-400 animate-spin" />
              </div>
            ) : matchProposals.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-zinc-900/30">
                <RefreshCw className="mx-auto text-zinc-600 mb-2" size={24} />
                <p className="text-zinc-400 text-sm font-medium">No se encontraron coincidencias recíprocas en este momento</p>
                <p className="text-zinc-600 text-xs mt-1">Agrega más sellos a tu Lista de Deseos y Lista de Intercambio para potenciar el motor de automatch</p>
              </div>
            ) : (
              <div className="space-y-4">
                {matchProposals.map((prop, idx) => (
                  <div
                    key={idx}
                    className="bg-black/50 border border-blue-500/20 rounded-xl p-5 space-y-4 hover:border-blue-500/40 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-white font-bold text-base">{prop.partnerName}</h4>
                        <p className="text-zinc-400 text-xs">{prop.partnerEmail}</p>
                      </div>

                      <div className="text-right">
                        <div className="text-2xl font-mono font-extrabold text-blue-400">
                          {prop.matchScore.toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Match Score</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-white/5">
                      <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-3">
                        <div className="text-xs font-bold text-emerald-400 mb-2">Sellos que recibirías:</div>
                        <ul className="list-disc list-inside text-xs text-zinc-300 space-y-1">
                          {prop.itemsYouGet.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg p-3">
                        <div className="text-xs font-bold text-amber-400 mb-2">Sellos que entregarías:</div>
                        <ul className="list-disc list-inside text-xs text-zinc-300 space-y-1">
                          {prop.itemsYouGive.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Pedidos */}
        {activeTab === "pedidos" && (
          <div className="bg-zinc-900/60 border border-white/10 rounded-2xl p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-zinc-400">
                    <th className="py-3 px-4">N° Pedido</th>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4 text-center">Ítems</th>
                    <th className="py-3 px-4">Pago</th>
                    <th className="py-3 px-4">Total</th>
                    <th className="py-3 px-4">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {orders.map((order) => (
                    <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 px-4 font-mono font-medium text-white">{order.id}</td>
                      <td className="py-4 px-4 text-zinc-400 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} className="text-zinc-500" />
                          {order.date}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center font-medium text-zinc-300">{order.itemsCount}</td>
                      <td className="py-4 px-4 text-zinc-400 text-xs">{getPaymentMethodLabel(order.paymentMethod)}</td>
                      <td className="py-4 px-4 font-semibold text-emerald-400">S/. {order.totalAmount.toFixed(2)}</td>
                      <td className="py-4 px-4">
                        <span className={`inline-block px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border ${getStatusBadge(order.status)}`}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab Content: Mis Subastas */}
        {activeTab === "subastas" && (
          <div className="bg-zinc-900/60 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-zinc-400">
                    <th className="py-3 px-4">Lote / Subasta</th>
                    <th className="py-3 px-4">Fecha Puja</th>
                    <th className="py-3 px-4">Mi Oferta</th>
                    <th className="py-3 px-4">Oferta Máxima</th>
                    <th className="py-3 px-4">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {DEFAULT_USER_BIDS.map((bid) => (
                    <tr key={bid.auctionId} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 px-4 font-medium text-white line-clamp-1">{bid.title}</td>
                      <td className="py-4 px-4 text-zinc-400 text-xs">{bid.date}</td>
                      <td className="py-4 px-4 font-mono font-bold text-white">S/. {bid.myBid.toFixed(2)}</td>
                      <td className="py-4 px-4 font-mono font-bold text-emerald-400">S/. {bid.highestBid.toFixed(2)}</td>
                      <td className="py-4 px-4">{getBidBadge(bid.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
