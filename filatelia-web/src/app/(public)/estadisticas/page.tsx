"use client";

import { useState, useEffect } from "react";
import { Stamp, MapPin, TrendingUp, Eye } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function EstadisticasPage() {
  const [totalStamps, setTotalStamps] = useState(0);
  const [totalCountries, setTotalCountries] = useState(0);
  const [totalVisits, setTotalVisits] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const [stampsRes, countriesRes, visitsRes] = await Promise.all([
          fetch(`${API}/stamps?limit=1`),
          fetch(`${API}/countries`),
          fetch(`${API}/analytics/total`),
        ]);
        const [stampsData, countriesData, visitsData] = await Promise.all([
          stampsRes.json(),
          countriesRes.json(),
          visitsRes.json(),
        ]);
        if (cancelled) return;
        setTotalStamps(stampsData?.pagination?.total || 0);
        setTotalCountries(countriesData?.countries?.length || 0);
        setTotalVisits(visitsData?.total || 0);
      } catch {
        if (!cancelled) setLoading(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  const stats = [
    { icon: Stamp, label: "Sellos", value: totalStamps, color: "moss-green" },
    { icon: MapPin, label: "Países", value: totalCountries, color: "blue-400" },
    { icon: Eye, label: "Visitas", value: totalVisits, color: "amber-400" },
  ];

  return (
    <div className="min-h-screen bg-[#0a0906]">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="mb-12">
          <h1 className="text-4xl font-serif text-white mb-2">
            Estadísticas del <span className="text-moss-green-light">Sitio</span>
          </h1>
          <p className="text-zinc-400">Datos en tiempo real de Filatelia Peruana</p>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
          {stats.map((card) => (
            <div
              key={card.label}
              className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6"
            >
              <div className={`mb-3 text-${card.color}`}>
                <card.icon size={24} />
              </div>
              <div className="text-3xl font-bold text-white mb-1">
                {loading ? "—" : card.value.toLocaleString()}
              </div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
          <h2 className="text-xl font-serif text-white mb-4">
            Acerca de los datos
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Los datos se actualizan en tiempo real. El catálogo incluye sellos del
            sistema WNS (World Numbering System) con cobertura internacional.
          </p>
        </div>
      </div>
    </div>
  );
}
