'use client';

import React from 'react';
import { Stamp, CheckCircle, ExternalLink } from 'lucide-react';
import Image from 'next/image';

export interface MatchItem {
  id: string;
  nameEs: string;
  nameEn?: string | null;
  scottNumber?: string | null;
  year?: number | null;
  countryCode?: string | null;
  imageUrl?: string | null;
  marketPriceUsd?: number | null;
  confidence: number;
  similarity?: number;
}

interface MatchResultsGridProps {
  results: MatchItem[];
  queryTimeMs?: number;
}

export default function MatchResultsGrid({ results, queryTimeMs }: MatchResultsGridProps) {
  if (!results || results.length === 0) {
    return (
      <div className="text-center py-12 bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6">
        <Stamp size={40} className="text-zinc-600 mx-auto mb-3" />
        <h4 className="text-white font-medium text-lg">Sin coincidencias visuales</h4>
        <p className="text-zinc-400 text-sm mt-1">No se encontraron estampillas en el catálogo que coincidan con la imagen o consulta dada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-serif text-white">
          Resultados de Coincidencia <span className="text-zinc-500">({results.length})</span>
        </h3>
        {queryTimeMs && (
          <span className="text-xs text-zinc-500 font-mono">
            Tiempo de búsqueda: {queryTimeMs}ms
          </span>
        )}
      </div>

      <div className="grid gap-4">
        {results.map((stamp, idx) => {
          const confidenceBadgeColor =
            stamp.confidence >= 80
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              : stamp.confidence >= 50
              ? 'bg-moss-green/20 text-moss-green-light border-moss-green/30'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/30';

          return (
            <div
              key={stamp.id || idx}
              className="p-5 bg-zinc-900/60 border border-zinc-800 hover:border-moss-green/40 rounded-2xl transition-all shadow-md flex flex-col md:flex-row items-center gap-5"
            >
              <div className="relative w-20 h-24 bg-black/60 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-800 flex items-center justify-center">
                {stamp.imageUrl ? (
                  <Image src={stamp.imageUrl} alt={stamp.nameEs} fill className="object-contain p-1" />
                ) : (
                  <Stamp size={28} className="text-zinc-600" />
                )}
              </div>

              <div className="flex-1 text-center md:text-left space-y-1">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded">
                    #{idx + 1}
                  </span>
                  <h4 className="text-lg font-serif text-white font-medium">{stamp.nameEs}</h4>
                </div>

                {stamp.nameEn && (
                  <p className="text-sm text-zinc-400 italic">{stamp.nameEn}</p>
                )}

                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs text-zinc-400 mt-2">
                  {stamp.countryCode && (
                    <span>País: <strong className="text-zinc-200">{stamp.countryCode}</strong></span>
                  )}
                  {stamp.year && (
                    <span>Año: <strong className="text-zinc-200">{stamp.year}</strong></span>
                  )}
                  {stamp.scottNumber && (
                    <span>Scott: <strong className="text-moss-green-light">{stamp.scottNumber}</strong></span>
                  )}
                  {stamp.marketPriceUsd && (
                    <span>Precio Est.: <strong className="text-emerald-400">${stamp.marketPriceUsd} USD</strong></span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-center md:items-end gap-2 flex-shrink-0">
                <div className={`px-4 py-2 rounded-xl border font-bold text-center ${confidenceBadgeColor}`}>
                  <div className="text-xl leading-none">{stamp.confidence}%</div>
                  <div className="text-[10px] uppercase tracking-wider mt-1 opacity-80">Confianza</div>
                </div>

                <a
                  href={`/sello/${stamp.id}`}
                  className="inline-flex items-center gap-1 text-xs text-moss-green-light hover:underline font-medium mt-1"
                >
                  Ver Ficha <ExternalLink size={12} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
