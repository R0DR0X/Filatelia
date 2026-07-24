"use client";

import { useState, useEffect } from "react";
import { Eye, TrendingUp, Calendar } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function AnaliticaPage() {
  const [stats, setStats] = useState({ visitsToday: 0, visitsAllTime: 0, topPaths: [] as any[] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("fp_token") : null;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API}/analytics/stats`, { headers })
      .then((r) => r.json())
      .then((d) => {
        setStats({
          visitsToday: d?.visitsToday || 0,
          visitsAllTime: d?.visitsAllTime || 0,
          topPaths: d?.topPaths || [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const maxVisits = Math.max(...stats.topPaths.map((p: any) => p.visits), 1);

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-serif">Analítica</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="p-6 bg-zinc-900 border border-white/5 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-2"><Calendar size={14} /> Visitas Hoy</div>
          <div className="text-3xl font-bold">{loading ? "—" : stats.visitsToday.toLocaleString()}</div>
        </div>
        <div className="p-6 bg-zinc-900 border border-white/5 rounded-xl">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-2"><Eye size={14} /> Visitas Totales</div>
          <div className="text-3xl font-bold">{loading ? "—" : stats.visitsAllTime.toLocaleString()}</div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-white/5 rounded-xl p-6">
        <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-6">Top Páginas</h3>
        {stats.topPaths.length === 0 ? (
          <p className="text-zinc-600 text-sm">Sin datos aún</p>
        ) : (
          <div className="space-y-4">
            {stats.topPaths.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-4">
                <span className="text-xs text-zinc-600 w-6">{i + 1}</span>
                <span className="text-sm text-zinc-300 flex-1 font-mono">{p.path}</span>
                <div className="w-32 bg-zinc-800 rounded-full h-2">
                  <div className="bg-moss-green h-full rounded-full" style={{ width: `${(p.visits / maxVisits) * 100}%` }} />
                </div>
                <span className="text-xs text-zinc-500 w-12 text-right">{p.visits}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
