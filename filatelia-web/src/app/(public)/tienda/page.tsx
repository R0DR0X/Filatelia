"use client";

import { useState, useEffect } from "react";
import { ShoppingBag, Search, Filter, Truck, ShieldCheck, Sparkles, Plus, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCartStore } from "@/store/useCartStore";

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  status: string;
  categoryId?: string;
  imageUrl?: string;
}

export default function TiendaPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [addedItemIds, setAddedItemIds] = useState<Record<string, boolean>>({});

  const { addItem } = useCartStore();

  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetch("/api/products");
        if (res.ok) {
          const data = await res.json();
          if (data.products) {
            setProducts(data.products);
          }
        }
      } catch (err) {
        console.error("Error loading products:", err);
      } finally {
        setLoading(false);
      }
    }
    loadProducts();
  }, []);

  const categories = [
    { id: "all", label: "Todas las piezas" },
    { id: "cat-prod-1", label: "Estampillas Clásicas" },
    { id: "cat-prod-3", label: "Álbumes y Clasificadores" },
    { id: "cat-prod-2", label: "Accesorios y Estuches" },
  ];

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === "all" || p.categoryId === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const handleAddToCart = (product: Product) => {
    addItem({
      id: product.id,
      title: product.name,
      price: product.price,
      quantity: 1,
      image: product.imageUrl || "/images/products/clasificador-64-marron.jpeg",
    });

    setAddedItemIds((prev) => ({ ...prev, [product.id]: true }));
    setTimeout(() => {
      setAddedItemIds((prev) => ({ ...prev, [product.id]: false }));
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0906] text-amber-50/90 font-sans">
      {/* Hero Header */}
      <div className="border-b border-amber-500/10 bg-gradient-to-b from-amber-950/20 via-black to-[#0a0906] py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-xs font-bold uppercase tracking-widest mb-3">
                <Sparkles size={13} /> Tienda Filatélica Oficial
              </div>
              <h1 className="text-4xl sm:text-5xl font-serif text-amber-100 tracking-tight">
                Colección & Accesorios <span className="text-amber-500 italic">Exclusivos</span>
              </h1>
              <p className="text-zinc-400 font-light max-w-2xl mt-2 text-sm sm:text-base">
                Piezas originales de catálogo, clasificadores de cuero, estuches Hawid de conservación y accesorios certificados con garantía filatélica.
              </p>
            </div>

            <div className="flex gap-4 shrink-0">
              <div className="bg-zinc-900/80 p-4 rounded-xl border border-amber-500/15 flex items-center gap-3">
                <Truck className="text-amber-400" size={24} />
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Envíos Certificados</div>
                  <div className="text-sm font-bold text-amber-100">Todo el Perú e Intl.</div>
                </div>
              </div>
              <div className="bg-zinc-900/80 p-4 rounded-xl border border-amber-500/15 flex items-center gap-3">
                <ShieldCheck className="text-amber-400" size={24} />
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Garantía</div>
                  <div className="text-sm font-bold text-amber-100">100% Autenticidad</div>
                </div>
              </div>
            </div>
          </div>

          {/* Search & Categories Bar */}
          <div className="mt-10 flex flex-col md:flex-row gap-4 justify-between items-center bg-zinc-900/60 p-3 rounded-2xl border border-amber-500/10 backdrop-blur-md">
            {/* Category pills */}
            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 custom-scrollbar">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                    selectedCategory === cat.id
                      ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                      : "bg-black/40 text-zinc-400 hover:text-amber-200 hover:bg-zinc-800/80 border border-white/5"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full md:w-80">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Buscar por nombre o descripción..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/60 border border-amber-500/20 rounded-xl pl-10 pr-4 py-2 text-xs text-amber-100 placeholder:text-zinc-600 focus:border-amber-500 outline-none transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-zinc-900/40 border border-amber-500/10 rounded-2xl p-4 space-y-4 animate-pulse">
                <div className="aspect-square bg-zinc-800/50 rounded-xl" />
                <div className="h-4 bg-zinc-800/80 rounded w-3/4" />
                <div className="h-3 bg-zinc-800/40 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20 border border-amber-500/10 rounded-2xl bg-zinc-900/20">
            <ShoppingBag size={48} className="mx-auto mb-4 text-amber-500/40" />
            <h3 className="text-xl font-serif text-amber-100 mb-2">No se encontraron productos</h3>
            <p className="text-zinc-500 text-sm">Prueba ajustando los filtros o la búsqueda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <AnimatePresence mode="popLayout">
              {filteredProducts.map((product) => (
                <motion.div
                  key={product.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="group bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-amber-500/15 hover:border-amber-500/40 rounded-2xl overflow-hidden flex flex-col justify-between shadow-xl transition-all hover:shadow-amber-500/5"
                >
                  {/* Image container */}
                  <div className="relative aspect-square bg-black/80 overflow-hidden flex items-center justify-center p-6 border-b border-white/5">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="text-xs text-zinc-600 font-serif italic">Sin vista previa</div>
                    )}

                    {/* Stock Tag */}
                    <div className="absolute top-3 right-3">
                      <span className="px-2.5 py-1 bg-black/80 backdrop-blur-md border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase tracking-wider rounded-md">
                        {product.stock > 0 ? `Stock: ${product.stock}` : "Agotado"}
                      </span>
                    </div>
                  </div>

                  {/* Body content */}
                  <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <h3 className="text-lg font-serif font-bold text-amber-100 group-hover:text-amber-400 transition-colors leading-tight">
                        {product.name}
                      </h3>
                      {product.description && (
                        <p className="text-zinc-400 text-xs mt-2 line-clamp-2 leading-relaxed font-light">
                          {product.description}
                        </p>
                      )}
                    </div>

                    {/* Footer price & action */}
                    <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Precio Un.</div>
                        <div className="text-2xl font-mono font-bold text-amber-400">
                          ${product.price.toFixed(2)}
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddToCart(product)}
                        disabled={product.stock <= 0}
                        className={`px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all ${
                          addedItemIds[product.id]
                            ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
                            : product.stock > 0
                            ? "bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20"
                            : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                        }`}
                      >
                        {addedItemIds[product.id] ? (
                          <>
                            <Check size={14} /> Añadido
                          </>
                        ) : (
                          <>
                            <Plus size={14} /> Añadir
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
