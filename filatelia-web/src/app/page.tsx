"use client"

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Book, Globe, ShoppingBag, Eye } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function Home() {
  const [visits, setVisits] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API}/analytics/total`)
      .then((r) => r.json())
      .then((d) => setVisits(d?.total || 0))
      .catch(() => setVisits(0));
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      {/* BLOQUE 1 – HERO: LA BIBLIOTECA */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        {/* Fondo de Biblioteca Real */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105 animate-slow-zoom"
          style={{ backgroundImage: "url('/library-bg.png')" }}
        />
        {/* Overlay dramático para legibilidad y esencia oscura */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black" />
        
        {/* Estampillas Flotantes (Esencia) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.img 
            src="/stamp-float-1.png" 
            className="absolute top-[20%] left-[10%] w-32 md:w-48 opacity-20 blur-[1px]"
            animate={{ y: [0, -20, 0], rotate: [0, 5, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.img 
            src="/stamp-float-2.png" 
            className="absolute bottom-[20%] right-[10%] w-32 md:w-48 opacity-20 blur-[1px]"
            animate={{ y: [0, 20, 0], rotate: [0, -5, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          />
          <motion.img 
            src="/stamp-float-3.png" 
            className="absolute top-[60%] left-[80%] w-24 md:w-36 opacity-10 blur-[2px]"
            animate={{ y: [0, -15, 0], rotate: [0, 10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          />
        </div>

        <div className="relative z-10 text-center px-4 max-w-5xl mx-auto">
          <div className="mb-6 inline-block animate-fade-up">
            <span className="px-4 py-1 border border-moss-green/50 text-moss-green-light text-[10px] font-bold uppercase tracking-[0.3em] bg-moss-green/10 backdrop-blur-sm rounded-full">
              Establecido en 2023
            </span>
          </div>
          
          <h1 className="text-5xl md:text-8xl font-serif font-bold text-white mb-8 leading-tight tracking-tight animate-fade-up" style={{ animationDelay: "0.2s" }}>
            Bienvenidos A La Primera <br />
            <span className="text-moss-green-light italic font-serif">Tienda Filatélica</span> <br />
            Del Perú Online
          </h1>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 animate-fade-up" style={{ animationDelay: "0.6s" }}>
            <Link 
              href="/biblioteca" 
              className="px-12 py-4 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-full transition-all shadow-xl shadow-moss-green/20 flex items-center gap-2 group uppercase tracking-widest text-[11px]"
            >
              Entrar
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/registro"
              className="px-12 py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-full border border-white/10 transition-all backdrop-blur-md uppercase tracking-widest text-[11px]"
            >
              Regístrese
            </Link>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce opacity-30">
          <div className="w-px h-12 bg-gradient-to-b from-white to-transparent" />
        </div>
      </section>

      {/* BLOQUE 2 & 3 – CATÁLOGOS Y TIENDA (SISTEMA DE BLOQUES VISUALES) */}
      <section className="py-24 px-4 bg-black relative">
        <div className="max-w-7xl mx-auto space-y-24">
          
          {/* Bloque de Catálogos */}
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-white/10 pb-6 gap-4">
              <div>
                <h2 className="text-4xl font-serif text-white mb-2">Catálogos</h2>
                <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">Explore la colección por país o por tema</p>
              </div>
              <Link href="/catalogo" className="text-moss-green-light text-xs font-bold uppercase tracking-widest hover:underline">Ver todo el catálogo</Link>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <CategoryBlock 
                title="Países" 
                desc="Descubra las emisiones organizadas por naciones soberanas y territorios."
                href="/catalogo"
                image="/hero-banner.jpg"
                icon={<Globe className="text-moss-green-light" />}
              />
              
              <CategoryBlock 
                title="Temáticas" 
                desc="Encuentre estampillas agrupadas por motivos históricos, arte, ciencia y más."
                href="/biblioteca"
                image="/library-bg.png"
                icon={<Book className="text-moss-green-light" />}
              />
            </div>
          </div>

          {/* Bloque de Tienda */}
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-white/10 pb-6 gap-4">
              <div>
                <h2 className="text-4xl font-serif text-white mb-2">Tienda</h2>
                <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">Artículos para su colección</p>
              </div>
              <Link href="/tienda" className="text-moss-green-light text-xs font-bold uppercase tracking-widest hover:underline">Ir a la tienda</Link>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <CategoryBlock
                title="Accesorios"
                desc="Lupas, pinzas y herramientas de alta precisión para el filatelista."
                href="/tienda"
                image="/store-accessories.jpg"
                icon={<ShoppingBag className="text-moss-green-light" />}
              />

              <CategoryBlock
                title="Álbumes"
                desc="Clasificadores y hojas de álbum de calidad de archivo para proteger su legado."
                href="/tienda"
                image="/hero-banner.jpg"
                icon={<Book className="text-moss-green-light" />}
              />
            </div>
            <p className="text-center text-zinc-500 text-[11px] italic font-serif">
              Encuentre productos para organizar, proteger y ampliar su colección
            </p>
          </div>
        </div>
      </section>

      {/* BLOQUE 4 – CONTADOR DE VISITAS */}
      <section className="py-20 border-t border-white/5 bg-zinc-950/50">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-3 text-zinc-500 mb-4">
            <Eye size={18} />
            <span className="text-[10px] uppercase font-bold tracking-[0.2em]">Visitas a la plataforma</span>
          </div>
          <div className="text-6xl md:text-8xl font-serif font-bold text-white tracking-tighter">
            {visits !== null ? visits.toLocaleString('es-PE') : "—"}
          </div>
        </div>
      </section>
    </div>
  );
}

function CategoryBlock({ title, desc, href, image, icon, status = "active" }: { title: string, desc: string, href: string, image: string, icon: any, status?: "active" | "under_construction" | "draft" }) {
  const isUnderConstruction = status === "under_construction";

  return (
    <Link 
      href={isUnderConstruction ? "#" : href} 
      className={`group relative h-[400px] rounded-2xl overflow-hidden border border-white/5 flex flex-col justify-end p-8 transition-all ${isUnderConstruction ? 'cursor-default opacity-80' : 'hover:border-moss-green/50'}`}
    >
      <div 
        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
        style={{ backgroundImage: `url('${image}')` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      
      {isUnderConstruction && (
        <div className="absolute top-6 left-6 z-20">
          <span className="px-3 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-500 text-[9px] font-black uppercase tracking-widest rounded-full backdrop-blur-sm">
            En Construcción
          </span>
        </div>
      )}

      <div className="relative z-10">
        <div className={`mb-4 w-12 h-12 rounded-xl flex items-center justify-center border border-white/10 transition-colors ${isUnderConstruction ? 'bg-zinc-800/50' : 'bg-black/50 backdrop-blur-md group-hover:bg-moss-green'}`}>
          {icon}
        </div>
        <h3 className="text-3xl font-serif font-bold text-white mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm max-w-xs transition-colors group-hover:text-zinc-300">
          {desc}
        </p>
      </div>
      
      {!isUnderConstruction && (
        <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowRight className="text-white" />
        </div>
      )}
    </Link>
  );
}
