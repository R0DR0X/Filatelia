"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Globe, ChevronLeft, ChevronRight, X, SlidersHorizontal, Library } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { parseBrowseFilters } from "@/lib/stampDetail";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface Stamp {
  id: string;
  nameEs: string | null;
  nameEn: string | null;
  wnsNumber: string | null;
  scottNumber: string | null;
  countryCode: string | null;
  year: number | null;
  issueDate: string | null;
  denomination: number | null;
  currency: string | null;
  imageUrl: string | null;
  marketPriceUsd: number | null;
  theme: string | null;
  source: string | null;
}

interface Pagination { page: number; limit: number; total: number; pages: number; }

// ─── Stamp Card ───────────────────────────────────────────────────────────────
function StampTile({ stamp }: { stamp: Stamp }) {
  const [imgError, setImgError] = useState(false);
  const name = stamp.nameEs || stamp.nameEn || "Sin nombre";
  const denom = stamp.denomination
    ? `${stamp.denomination} ${stamp.currency || ""}`.trim()
    : null;

  const isInvalidImage = !stamp.imageUrl || imgError || stamp.imageUrl.includes("login_error") || stamp.imageUrl.includes("colnect_login") || stamp.imageUrl.endsWith(".html");

  return (
    <Link href={`/sello/${stamp.id}`}>
      <motion.article
        whileHover={{ y: -4 }}
        transition={{ duration: 0.18 }}
        className="group bg-zinc-900 border border-white/5 hover:border-amber-500/40 rounded-xl overflow-hidden cursor-pointer transition-colors h-full flex flex-col"
      >
        {/* Stamp image */}
        <div className="relative aspect-[4/3] bg-gradient-to-b from-zinc-950 to-zinc-900 overflow-hidden flex-shrink-0 flex items-center justify-center p-2">
          {!isInvalidImage ? (
            <Image
              src={stamp.imageUrl!}
              alt={name}
              fill
              onError={() => setImgError(true)}
              className="object-contain p-3 transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center border border-dashed border-amber-500/15 rounded-lg p-2 bg-amber-500/5 text-center">
              <Library size={22} className="text-amber-400/60 mb-1" />
              <span className="text-[9px] font-mono text-zinc-500 uppercase">{stamp.countryCode || "FILATELIA"}</span>
            </div>
          )}

          {/* Year badge */}
          {stamp.year && (
            <span className="absolute top-2 left-2 bg-black/80 backdrop-blur-md text-amber-200 text-[9px] font-bold px-2 py-0.5 rounded border border-amber-500/20">
              {stamp.year}
            </span>
          )}

          {/* For sale badge */}
          {stamp.marketPriceUsd && (
            <span className="absolute top-2 right-2 bg-amber-500 text-black text-[9px] font-black px-2 py-0.5 rounded shadow">
              ${stamp.marketPriceUsd.toFixed(0)}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="p-3 flex flex-col flex-1">
          <p className="text-xs font-bold text-zinc-100 line-clamp-2 leading-tight font-serif mb-auto group-hover:text-amber-400 transition-colors">
            {name}
          </p>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
            <span className="text-[10px] text-zinc-500 uppercase font-mono font-bold">
              {stamp.countryCode || "??"}
            </span>
            {denom ? (
              <span className="text-[10px] text-amber-400 font-mono font-bold">{denom}</span>
            ) : stamp.wnsNumber ? (
              <span className="text-[9px] text-zinc-600 font-mono truncate max-w-[72px]">
                {stamp.wnsNumber}
              </span>
            ) : (
              <span className="text-[9px] text-amber-500/70 italic font-serif">Detalle →</span>
            )}
          </div>
        </div>
      </motion.article>
    </Link>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BibliotecaClient() {
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 48, total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Active (applied) filters.
  //
  // `theme` and `groupId` have no input of their own: they only ever arrive as
  // a link from a stamp's detail page, and are surfaced as a removable chip
  // below rather than as another text box nobody would type into.
  const [applied, setApplied] = useState({
    search: "", country: "", yearFrom: "", yearTo: "", theme: "", groupId: "",
  });

  const topRef = useRef<HTMLDivElement>(null);

  // Until this existed the catalogue ignored its own query string, so the
  // `/biblioteca?countryCode=PE` link that the detail page has always rendered
  // navigated here and then showed the unfiltered catalogue — a dead link that
  // looks alive. E3.6 adds two more such links, so this had to be fixed first.
  const searchParams = useSearchParams();
  useEffect(() => {
    const fromUrl = parseBrowseFilters(new URLSearchParams(searchParams.toString()));
    const next = {
      search: fromUrl.search ?? "",
      country: fromUrl.countryCode ?? "",
      yearFrom: fromUrl.yearFrom ?? "",
      yearTo: fromUrl.yearTo ?? "",
      theme: fromUrl.theme ?? "",
      groupId: fromUrl.groupId ?? "",
    };
    // Seed the visible inputs too, so the filter panel reflects the URL.
    setSearch(next.search);
    setCountry(next.country);
    setYearFrom(next.yearFrom);
    setYearTo(next.yearTo);
    setApplied(next);
    setPage(1);
  }, [searchParams]);

  const fetchStamps = useCallback((p: number, filters: typeof applied) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "48" });
    if (filters.country) params.set("countryCode", filters.country.toUpperCase());
    if (filters.search) params.set("search", filters.search);
    if (filters.yearFrom) params.set("yearFrom", filters.yearFrom);
    if (filters.yearTo) params.set("yearTo", filters.yearTo);
    if (filters.theme) params.set("theme", filters.theme);
    if (filters.groupId) params.set("groupId", filters.groupId);

    fetch(`${API}/stamps?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setStamps(d.stamps || []);
        setPagination(d.pagination || { page: p, limit: 48, total: 0, pages: 1 });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStamps(page, applied);
  }, [page, applied, fetchStamps]);

  const applyFilters = () => {
    // theme/groupId carry over: they came from a link, and typing in the
    // search box must not silently drop the series the user is browsing.
    const next = { search, country, yearFrom, yearTo, theme: applied.theme, groupId: applied.groupId };
    setApplied(next);
    setPage(1);
    setShowFilters(false);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const clearAll = () => {
    setSearch(""); setCountry(""); setYearFrom(""); setYearTo("");
    setApplied({ search: "", country: "", yearFrom: "", yearTo: "", theme: "", groupId: "" });
    setPage(1);
  };

  const clearLinkedFilter = (key: "theme" | "groupId") => {
    setApplied((prev) => ({ ...prev, [key]: "" }));
    setPage(1);
  };

  const changePage = (next: number) => {
    setPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const hasFilters =
    applied.search || applied.country || applied.yearFrom || applied.yearTo ||
    applied.theme || applied.groupId;

  return (
    <div className="min-h-screen bg-black" ref={topRef}>

      {/* ── Hero ── */}
      <section className="relative border-b border-white/10 py-16 overflow-hidden">
        <div className="absolute inset-0 bg-[url('/hero-banner.jpg')] bg-cover bg-center opacity-10 grayscale" />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4">
          <p className="text-[10px] font-bold text-moss-green-light uppercase tracking-[0.3em] mb-2">
            Filatelia Peruana
          </p>
          <h1 className="text-5xl md:text-6xl font-serif mb-3">
            Biblioteca <span className="text-moss-green-light">Filatélica</span>
          </h1>
          <p className="text-zinc-400 font-light text-sm max-w-xl">
            {pagination.total > 0
              ? `${pagination.total.toLocaleString()} sellos indexados — busca, filtra y descubre`
              : "El repositorio más completo de sellos en español"}
          </p>

          {/* Inline search */}
          <div className="flex flex-wrap gap-3 mt-8">
            <div className="flex flex-1 min-w-[260px] max-w-md items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 focus-within:border-moss-green/60 transition-colors">
              <Search size={15} className="text-zinc-500 shrink-0" />
              <input
                type="text"
                placeholder="Buscar por nombre, WNS, tema..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                className="bg-transparent outline-none text-sm text-zinc-200 placeholder-zinc-600 w-full"
              />
              {search && (
                <button onClick={() => setSearch("")}>
                  <X size={13} className="text-zinc-600 hover:text-zinc-300" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 focus-within:border-moss-green/60 transition-colors w-32">
              <Globe size={14} className="text-zinc-500 shrink-0" />
              <input
                type="text"
                placeholder="País (PE)"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                maxLength={2}
                className="bg-transparent outline-none text-sm text-zinc-200 placeholder-zinc-600 w-full uppercase"
              />
            </div>

            <button
              onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-bold uppercase tracking-wider transition-colors ${
                showFilters
                  ? "bg-moss-green/20 border-moss-green/40 text-moss-green-light"
                  : "bg-zinc-900 border-white/10 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              <SlidersHorizontal size={14} />
              Filtros
            </button>

            <button
              onClick={applyFilters}
              className="px-6 py-3 bg-moss-green hover:bg-moss-green-dark text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-colors"
            >
              Buscar
            </button>

            {hasFilters && (
              <button onClick={clearAll} className="flex items-center gap-1.5 px-4 py-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-white text-xs font-bold rounded-xl border border-white/5 transition-colors">
                <X size={12} /> Limpiar
              </button>
            )}
          </div>

          {/* Extra filters (year range) */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">Año desde</label>
                    <input
                      type="number"
                      placeholder="1840"
                      value={yearFrom}
                      onChange={(e) => setYearFrom(e.target.value)}
                      className="w-24 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-moss-green/60"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">hasta</label>
                    <input
                      type="number"
                      placeholder="2024"
                      value={yearTo}
                      onChange={(e) => setYearTo(e.target.value)}
                      className="w-24 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-moss-green/60"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Active filter chips */}
        {hasFilters && (
          <div className="flex flex-wrap gap-2 mb-6">
            {applied.search && (
              <Chip label={`"${applied.search}"`} onRemove={() => { setSearch(""); setApplied((a) => ({ ...a, search: "" })); setPage(1); }} />
            )}
            {applied.country && (
              <Chip label={`País: ${applied.country}`} onRemove={() => { setCountry(""); setApplied((a) => ({ ...a, country: "" })); setPage(1); }} />
            )}
            {(applied.yearFrom || applied.yearTo) && (
              <Chip
                label={`Años: ${applied.yearFrom || "?"}–${applied.yearTo || "?"}`}
                onRemove={() => { setYearFrom(""); setYearTo(""); setApplied((a) => ({ ...a, yearFrom: "", yearTo: "" })); setPage(1); }}
              />
            )}
            {/* Arrived here from a stamp's detail page. Without these chips the
                catalogue would silently show a subset with no visible reason. */}
            {applied.theme && (
              <Chip label={`Tema: ${applied.theme}`} onRemove={() => clearLinkedFilter("theme")} />
            )}
            {applied.groupId && (
              <Chip label="Serie" onRemove={() => clearLinkedFilter("groupId")} />
            )}
          </div>
        )}

        {/* Count + pagination top */}
        {!loading && (
          <div className="flex justify-between items-center mb-6 text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
            <span>{pagination.total.toLocaleString()} sellos</span>
            {pagination.pages > 1 && (
              <span>Página {page} de {pagination.pages}</span>
            )}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-40">
            <div className="w-9 h-9 border-2 border-moss-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : stamps.length === 0 ? (
          <div className="text-center py-32">
            <Library size={48} className="text-zinc-800 mx-auto mb-4" />
            <p className="text-zinc-500 mb-3">No se encontraron sellos con esos filtros.</p>
            <button onClick={clearAll} className="text-moss-green-light text-sm hover:underline">
              Limpiar filtros
            </button>
          </div>
        ) : (
          <motion.div
            key={`${page}-${JSON.stringify(applied)}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          >
            {stamps.map((s) => <StampTile key={s.id} stamp={s} />)}
          </motion.div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex justify-center items-center gap-3 mt-12">
            <button
              onClick={() => changePage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-zinc-900 border border-white/10 text-zinc-400 rounded-xl disabled:opacity-30 hover:border-moss-green transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>

            {/* Page numbers (compact) */}
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, pagination.pages - 4));
                const p = start + i;
                return (
                  <button
                    key={p}
                    onClick={() => changePage(p)}
                    className={`w-8 h-8 text-xs font-bold rounded-lg transition-colors ${
                      p === page
                        ? "bg-moss-green text-white"
                        : "bg-zinc-900 border border-white/10 text-zinc-500 hover:border-moss-green"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => changePage(Math.min(pagination.pages, page + 1))}
              disabled={page === pagination.pages}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-zinc-900 border border-white/10 text-zinc-400 rounded-xl disabled:opacity-30 hover:border-moss-green transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-moss-green/10 text-moss-green-light border border-moss-green/20 rounded-full">
      {label}
      <button onClick={onRemove} className="hover:text-white transition-colors">
        <X size={10} />
      </button>
    </span>
  );
}
