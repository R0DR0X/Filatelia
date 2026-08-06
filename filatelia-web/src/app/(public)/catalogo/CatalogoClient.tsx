"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, BookOpen, Globe, Stamp, Calendar, Info } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface Country {
  code: string;
  stampCount: number;
  yearFrom: number | null;
  yearTo: number | null;
}

interface StampInGroup {
  id: string;
  nameEn: string | null;
  imageUrl: string | null;
  denomination: string | null;
  currency: string | null;
  wnsNumber: string | null;
  issueDate: string | null;
}

interface Group {
  id: string;
  titleEs: string;
  titleEn: string | null;
  year: number | null;
  countryCode: string;
  stampCount: number;
  stamps: StampInGroup[];
}

interface GroupPagination { page: number; limit: number; total: number; pages: number; }

// ─── Flag ────────────────────────────────────────────────────────────────────
function Flag({ code }: { code: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/40x30/${code.toLowerCase()}.png`}
      alt={code}
      width={32}
      height={24}
      className="rounded-sm object-cover shrink-0"
      onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
    />
  );
}

// ─── Stamp mini card inside a group ──────────────────────────────────────────
import { QuickAddButtons } from "@/components/collection/QuickAddButtons";
import { CollectionIndexProvider } from "@/components/collection/CollectionIndexProvider";

function GroupStampCard({ stamp }: { stamp: StampInGroup }) {
  const [imgError, setImgError] = useState(false);
  const label = stamp.nameEn || stamp.wnsNumber || "Sello";
  const denom = stamp.denomination ? `${stamp.denomination} ${stamp.currency || ""}`.trim() : null;

  const isInvalidImage = !stamp.imageUrl || imgError || stamp.imageUrl.includes("login_error") || stamp.imageUrl.includes("colnect_login") || stamp.imageUrl.endsWith(".html");

  return (
    <div className="group flex flex-col bg-black/60 border border-white/5 hover:border-amber-500/40 rounded-lg overflow-hidden transition-colors">
      <Link href={`/sello/${stamp.id}`}>
        <div className="relative aspect-[3/4] bg-zinc-900 flex items-center justify-center p-1">
          {!isInvalidImage ? (
            <Image
              src={stamp.imageUrl!}
              alt={label}
              fill
              onError={() => setImgError(true)}
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
              sizes="150px"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center border border-dashed border-amber-500/15 rounded bg-amber-500/5">
              <Stamp size={18} className="text-amber-400/60" />
            </div>
          )}
        </div>
      </Link>
      <div className="p-2 space-y-1.5">
        <Link href={`/sello/${stamp.id}`}>
          <p className="text-[10px] text-zinc-300 line-clamp-2 font-serif leading-tight group-hover:text-amber-400 transition-colors">{label}</p>
        </Link>
        {denom && <p className="text-[9px] text-amber-400 font-mono font-bold">{denom}</p>}
        <div className="pt-1 border-t border-white/5">
          <QuickAddButtons stampId={stamp.id} />
        </div>
      </div>
    </div>
  );
}

// ─── Emission group (album card) ─────────────────────────────────────────────
function EmissionGroup({ group }: { group: Group }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4 }}
      className="rounded-xl overflow-hidden border border-moss-green/20"
    >
      {/* Group header — moss green, like a real album */}
      <div className="bg-moss-green px-5 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-white font-serif font-bold text-base leading-tight">{group.titleEs}</h3>
          {group.titleEn && group.titleEn !== group.titleEs && (
            <p className="text-moss-green-light/80 text-[11px] italic">{group.titleEn}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {group.year && (
            <span className="text-white/60 font-serif font-bold text-xl">{group.year}</span>
          )}
          <span className="text-[10px] font-bold bg-white/10 text-white px-2 py-0.5 rounded">
            {group.stampCount} {group.stampCount === 1 ? "sello" : "sellos"}
          </span>
        </div>
      </div>

      {/* Stamps grid */}
      <div className="bg-zinc-950 border-t border-moss-green/10 p-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {group.stamps.slice(0, 16).map((s) => (
            <GroupStampCard key={s.id} stamp={s} />
          ))}
          {group.stampCount > 16 && (
            <Link href={`/biblioteca?countryCode=${group.countryCode}`}>
              <div className="flex flex-col items-center justify-center aspect-[3/4] bg-zinc-900 border border-white/5 hover:border-moss-green/40 rounded-lg transition-colors cursor-pointer">
                <span className="text-zinc-500 text-xs font-bold">+{group.stampCount - 16}</span>
                <span className="text-zinc-600 text-[9px] mt-0.5">más</span>
              </div>
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Country catalog view ─────────────────────────────────────────────────────
function CountryCatalog({ code, onBack }: { code: string; onBack: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [pagination, setPagination] = useState<GroupPagination>({ page: 1, limit: 10, total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/groups/${code}?page=${page}&limit=10`)
      .then((r) => r.json())
      .then((d) => {
        setGroups(d.groups || []);
        setPagination(d.pagination || { page, limit: 10, total: 0, pages: 1 });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [code, page]);

  return (
    <div>
      {/* Back + header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-moss-green-light transition-colors text-xs font-bold uppercase tracking-wider"
        >
          <ChevronLeft size={14} /> Países
        </button>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-3">
          <Flag code={code} />
          <h2 className="text-2xl font-serif text-zinc-100">{code}</h2>
          {pagination.total > 0 && (
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold ml-2">
              {pagination.total} emisiones
            </span>
          )}
        </div>
        <Link
          href={`/biblioteca?countryCode=${code}`}
          className="ml-auto flex items-center gap-1.5 text-xs text-moss-green-light hover:underline"
        >
          Ver todos los sellos →
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-moss-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-24 text-zinc-600">Sin emisiones registradas</div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => <EmissionGroup key={g.id} group={g} />)}

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex justify-center items-center gap-3 pt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-4 py-2 text-xs font-bold bg-zinc-900 border border-white/10 text-zinc-400 rounded-xl disabled:opacity-30 hover:border-moss-green transition-colors"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <span className="text-xs text-zinc-500">{page} / {pagination.pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="flex items-center gap-1 px-4 py-2 text-xs font-bold bg-zinc-900 border border-white/10 text-zinc-400 rounded-xl disabled:opacity-30 hover:border-moss-green transition-colors"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CatalogoClient() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`${API}/countries`)
      .then((r) => r.json())
      .then((d) => setCountries(d.countries || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = countries.filter((c) =>
    search === "" || c.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    // One collection read for the whole page. Every GroupStampCard below asks
    // this provider for its own row instead of fetching `/api/collection`
    // itself — a country can render hundreds of cards, and the endpoint
    // returns the full list every time with no per-stamp filter.
    <CollectionIndexProvider>
    <div className="min-h-screen bg-black">
      {/* ── Hero ── */}
      <section className="relative border-b border-white/10 py-16 overflow-hidden">
        <div className="absolute inset-0 bg-[url('/hero-banner.jpg')] bg-cover bg-center opacity-10 grayscale" />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4">
          <p className="text-[10px] font-bold text-moss-green-light uppercase tracking-[0.3em] mb-2">
            Filatelia Peruana
          </p>
          <h1 className="text-5xl md:text-6xl font-serif mb-3">
            Catálogo <span className="text-moss-green-light">Filatélico</span>
          </h1>
          <p className="text-zinc-400 font-light text-sm max-w-xl">
            Colecciones organizadas por país y emisión, en formato de álbum. Selecciona un país para explorar sus grupos de emisión.
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-10">
        <AnimatePresence mode="wait">
          {/* ── Country selected → show its groups ── */}
          {selectedCountry ? (
            <motion.div
              key={`country-${selectedCountry}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <CountryCatalog
                code={selectedCountry}
                onBack={() => setSelectedCountry(null)}
              />
            </motion.div>
          ) : (
            /* ── Country grid ── */
            <motion.div
              key="country-grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                <div>
                  <h2 className="text-2xl font-serif text-zinc-100">Explorar por País</h2>
                  <p className="text-xs text-zinc-500 mt-1">
                    {loading ? "Cargando..." : `${countries.length} países disponibles`}
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Filtrar país (PE, JP...)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value.toUpperCase())}
                  maxLength={2}
                  className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-moss-green/60 w-48 uppercase"
                />
              </div>

              {/* Info banner */}
              <div className="flex items-start gap-3 bg-zinc-900/60 border border-white/5 rounded-xl p-4 mb-8 text-xs text-zinc-500">
                <Info size={14} className="text-zinc-600 mt-0.5 shrink-0" />
                <span>
                  Para buscar sellos individuales usa la{" "}
                  <Link href="/biblioteca" className="text-moss-green-light hover:underline">Biblioteca →</Link>
                  {" "}El catálogo muestra las emisiones agrupadas tal como aparecen en un álbum filatélico.
                </span>
              </div>

              {loading ? (
                <div className="flex justify-center py-32">
                  <div className="w-8 h-8 border-2 border-moss-green border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {filtered.map((c) => (
                    <motion.button
                      key={c.code}
                      whileHover={{ scale: 1.03 }}
                      onClick={() => setSelectedCountry(c.code)}
                      className="group flex flex-col items-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-white/5 hover:border-moss-green/40 rounded-xl p-4 text-center transition-all"
                    >
                      <Flag code={c.code} />
                      <span className="text-sm font-bold text-zinc-100 uppercase group-hover:text-moss-green-light transition-colors">
                        {c.code}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {c.stampCount.toLocaleString()} sellos
                      </span>
                      {c.yearFrom && (
                        <span className="text-[9px] text-zinc-700">
                          {c.yearFrom}–{c.yearTo || "pres."}
                        </span>
                      )}
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </CollectionIndexProvider>
  );
}
