"use client";

import { useState, useEffect } from "react";
import { BookOpen, TrendingUp, Eye, Loader2 } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export default function DashboardClient() {
  const [stats, setStats] = useState({ totalStamps: 0, visitsToday: 0, visitsAllTime: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("fp_token") : null;
    async function fetchStats() {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const [stampsRes, analyticsRes] = await Promise.all([
          fetch(`${API}/admin/stamps?limit=1`, { headers }),
          fetch(`${API}/analytics/stats`, { headers }),
        ]);
        const stampsData = await stampsRes.json();
        const analyticsData = await analyticsRes.json();
        setStats({
          totalStamps: stampsData?.pagination?.total || 0,
          visitsToday: analyticsData?.visitsToday || 0,
          visitsAllTime: analyticsData?.visitsAllTime || 0,
        });
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const cards = [
    { title: "Sellos", value: stats.totalStamps, icon: BookOpen, trend: "Total en catálogo" },
    { title: "Visitas Hoy", value: stats.visitsToday, icon: TrendingUp, trend: "Últimas 24h" },
    { title: "Visitas Totales", value: stats.visitsAllTime, icon: Eye, trend: "Histórico" },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card) => (
          <div key={card.title} className="p-6 bg-zinc-900 border border-white/5 rounded-xl">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-moss-green/10 text-moss-green-light rounded-lg">
                <card.icon size={20} />
              </div>
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{card.title}</span>
            </div>
            <div className="text-3xl font-bold mb-1">
              {loading ? <Loader2 size={24} className="animate-spin text-zinc-600" /> : card.value.toLocaleString()}
            </div>
            <div className="text-xs text-zinc-500">{card.trend}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
