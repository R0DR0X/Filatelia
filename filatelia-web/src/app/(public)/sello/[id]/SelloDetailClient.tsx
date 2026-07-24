"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Stamp, Calendar, MapPin, DollarSign, Palette, Shield, Tag, Hash, Loader2 } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface StampDetail {
  id: string;
  wnsNumber: string | null;
  scottNumber: string | null;
  countryCode: string | null;
  countryNameEs: string | null;
  countryNameEn: string | null;
  year: number | null;
  issueDate: string | null;
  denomination: number | null;
  currency: string | null;
  nameEs: string | null;
  nameEn: string | null;
  descriptionEs: string | null;
  descriptionEn: string | null;
  imageUrl: string | null;
  theme: string | null;
  source: string | null;
  isVerified: number;
  isRare: number;
  marketPriceUsd: number | null;
  rarityScore: number | null;
  groupTitleEs: string | null;
  groupTitleEn: string | null;
  color: string | null;
  perforation: string | null;
  printRun: number | null;
  designer: string | null;
  printer: string | null;
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-4">
      <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
        {icon}
        {label}
      </div>
      <div className="text-white font-bold text-sm">{value}</div>
    </div>
  );
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-zinc-500 text-sm">{label}:</span>
      <span className="text-white text-sm font-mono">{value}</span>
    </>
  );
}

export default function SelloDetailClient({ id }: { id: string }) {
  const [stamp, setStamp] = useState<StampDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`${API}/stamp/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.stamp) {
          setStamp(d.stamp);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0906] flex items-center justify-center">
        <Loader2 size={32} className="text-moss-green animate-spin" />
      </div>
    );
  }

  if (notFound || !stamp) {
    return (
      <div className="min-h-screen bg-[#0a0906] flex flex-col items-center justify-center gap-4">
        <Stamp size={48} className="text-zinc-700" />
        <p className="text-zinc-500">Sello no encontrado</p>
        <Link href="/biblioteca" className="text-moss-green-light hover:underline text-sm">
          ← Volver a la Biblioteca
        </Link>
      </div>
    );
  }

  const issueFormatted = stamp.issueDate
    ? new Date(stamp.issueDate).toLocaleDateString("es-PE", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const displayName = stamp.nameEs || stamp.nameEn || "Sin nombre";
  const hasEnglishName = stamp.nameEn && stamp.nameEn !== stamp.nameEs;
  const countryDisplay = stamp.countryNameEs || stamp.countryCode || null;

  return (
    <div className="min-h-screen bg-[#0a0906]">
      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex items-center gap-3 text-xs text-zinc-500">
        <Link href="/biblioteca" className="hover:text-moss-green-light transition-colors flex items-center gap-1.5">
          <ArrowLeft size={14} /> Catálogo
        </Link>
        {stamp.countryCode && (
          <>
            <span>/</span>
            <Link
              href={`/biblioteca?countryCode=${stamp.countryCode}`}
              className="hover:text-moss-green-light transition-colors"
            >
              {countryDisplay}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-zinc-300 truncate max-w-[200px]">{displayName}</span>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* ── Image ── */}
          <div className="relative">
            <div className="sticky top-24">
              <div className="relative aspect-[4/5] max-w-sm mx-auto bg-zinc-900/50 rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
                {stamp.imageUrl ? (
                  <Image
                    src={stamp.imageUrl}
                    alt={displayName}
                    fill
                    className="object-contain p-6"
                    sizes="(max-width: 768px) 100vw, 40vw"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                    <Stamp size={64} className="text-zinc-700" />
                    <p className="text-zinc-600 text-xs">Sin imagen disponible</p>
                  </div>
                )}

                {/* Source badge */}
                {stamp.source && (
                  <div className="absolute bottom-3 right-3 text-[9px] font-bold uppercase tracking-wider px-2 py-1 bg-black/70 text-zinc-500 rounded">
                    {stamp.source === 'wns' ? 'WNS Official' : stamp.source}
                  </div>
                )}
              </div>

              {/* Catalog refs */}
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {stamp.wnsNumber && (
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-zinc-900 border border-white/10 rounded-lg font-mono">
                    <span className="text-zinc-500">WNS</span>
                    <span className="text-moss-green-light">{stamp.wnsNumber}</span>
                  </span>
                )}
                {stamp.scottNumber && (
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-zinc-900 border border-white/10 rounded-lg font-mono">
                    <span className="text-zinc-500">Scott</span>
                    <span className="text-moss-green-light">{stamp.scottNumber}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Details ── */}
          <div className="space-y-8">
            {/* Title */}
            <div>
              {stamp.isRare ? (
                <span className="inline-block mb-2 px-3 py-1 bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
                  Pieza Rara
                </span>
              ) : null}
              <h1 className="text-3xl md:text-4xl font-serif text-white leading-tight mb-2">
                {displayName}
              </h1>
              {hasEnglishName && (
                <p className="text-zinc-500 text-sm italic">{stamp.nameEn}</p>
              )}
              {stamp.groupTitleEs && (
                <p className="text-xs text-zinc-600 mt-1 uppercase tracking-wider">
                  {stamp.groupTitleEs}
                </p>
              )}
            </div>

            {/* Key facts */}
            <div className="grid grid-cols-2 gap-3">
              {stamp.year && (
                <InfoCard icon={<Calendar size={13} />} label="Año de emisión" value={String(stamp.year)} />
              )}
              {countryDisplay && (
                <InfoCard icon={<MapPin size={13} />} label="País emisor" value={countryDisplay} />
              )}
              {stamp.denomination && stamp.currency && (
                <InfoCard icon={<DollarSign size={13} />} label="Valor facial" value={`${stamp.denomination} ${stamp.currency}`} />
              )}
              {stamp.marketPriceUsd && (
                <div className="bg-moss-green/10 border border-moss-green/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-moss-green text-xs mb-1">
                    <DollarSign size={13} /> Precio mercado
                  </div>
                  <div className="text-moss-green-light font-bold">${stamp.marketPriceUsd.toFixed(2)}</div>
                </div>
              )}
            </div>

            {/* Issue date */}
            {issueFormatted && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Calendar size={14} className="text-zinc-600" />
                Emitido el <span className="text-zinc-200 font-medium">{issueFormatted}</span>
              </div>
            )}

            {/* Description */}
            {(stamp.descriptionEs || stamp.descriptionEn) && (
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">
                  Descripción
                </h3>
                <p className="text-zinc-300 leading-relaxed text-sm">
                  {stamp.descriptionEs || stamp.descriptionEn}
                </p>
              </div>
            )}

            {/* Technical specs */}
            {(stamp.color || stamp.perforation || stamp.printRun || stamp.designer || stamp.printer) && (
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                  <Palette size={12} /> Especificaciones Técnicas
                </h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {stamp.color && <TechRow label="Color" value={stamp.color} />}
                  {stamp.perforation && <TechRow label="Perforación" value={stamp.perforation} />}
                  {stamp.printRun && <TechRow label="Tiraje" value={stamp.printRun.toLocaleString("es-PE")} />}
                  {stamp.designer && <TechRow label="Diseñador" value={stamp.designer} />}
                  {stamp.printer && <TechRow label="Impresor" value={stamp.printer} />}
                </div>
              </div>
            )}

            {/* Theme */}
            {stamp.theme && (
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                  <Tag size={12} /> Temática
                </h3>
                <span className="px-4 py-2 bg-moss-green/10 text-moss-green-light rounded-full text-sm border border-moss-green/20">
                  {stamp.theme}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-white/5">
              <button className="flex-1 py-3 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-xl transition-colors text-sm">
                + Añadir a Mi Colección
              </button>
              {stamp.marketPriceUsd && (
                <button className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl border border-moss-green/30 transition-colors text-sm">
                  Comprar — ${stamp.marketPriceUsd.toFixed(2)}
                </button>
              )}
            </div>

            {stamp.isVerified ? (
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <Shield size={12} className="text-moss-green" />
                Información verificada
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
