"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Pencil, Trash2, Loader2, X, Check } from "lucide-react";
import Image from "next/image";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface Stamp {
  id: string;
  wnsNumber: string | null;
  nameEs: string | null;
  nameEn: string | null;
  countryCode: string | null;
  year: number | null;
  theme: string | null;
  marketPriceUsd: number | null;
  imageUrl: string | null;
}

export default function SellosAdminClient() {
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Stamp | null>(null);
  const [saving, setSaving] = useState(false);
  const limit = 20;

  const fetchStamps = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem("fp_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    try {
      const res = await fetch(`${API}/admin/stamps?${params}`, { headers });
      const data = await res.json();
      setStamps(data.stamps || []);
      setTotal(data.pagination?.total || 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { fetchStamps(); }, [fetchStamps]);

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este sello?")) return;
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/stamp/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchStamps();
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/stamp/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nameEs: editing.nameEs,
        nameEn: editing.nameEn,
        scottNumber: editing.wnsNumber,
        marketPriceUsd: editing.marketPriceUsd,
        theme: editing.theme,
      }),
    });
    setSaving(false);
    setEditing(null);
    fetchStamps();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5">
          <Search size={16} className="text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por nombre, WNS..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="bg-transparent outline-none text-sm w-full text-zinc-200 placeholder-zinc-600"
          />
        </div>
      </div>

      <div className="text-sm text-zinc-500">{total.toLocaleString()} sellos</div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={32} className="text-moss-green animate-spin" /></div>
      ) : (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="text-left p-4">Imagen</th>
                <th className="text-left p-4">WNS</th>
                <th className="text-left p-4">Nombre</th>
                <th className="text-left p-4">País</th>
                <th className="text-left p-4">Año</th>
                <th className="text-left p-4">Precio</th>
                <th className="text-left p-4">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {stamps.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="p-3">
                    {s.imageUrl ? (
                      <div className="relative w-12 h-12 bg-zinc-800 rounded-lg overflow-hidden">
                        <Image src={s.imageUrl} alt="" fill className="object-contain p-1" unoptimized />
                      </div>
                    ) : (
                      <div className="w-12 h-12 bg-zinc-800 rounded-lg" />
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs text-zinc-400">{s.wnsNumber || "—"}</td>
                  <td className="p-3 text-zinc-200 max-w-[200px] truncate">{s.nameEs || s.nameEn || "—"}</td>
                  <td className="p-3 text-zinc-400">{s.countryCode || "—"}</td>
                  <td className="p-3 text-zinc-400">{s.year || "—"}</td>
                  <td className="p-3 text-moss-green-light">{s.marketPriceUsd ? `$${s.marketPriceUsd}` : "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(s)} className="p-1.5 hover:bg-white/5 rounded"><Pencil size={14} className="text-zinc-400" /></button>
                      <button onClick={() => handleDelete(s.id)} className="p-1.5 hover:bg-red-500/10 rounded"><Trash2 size={14} className="text-red-400" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            return (
              <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 text-xs font-bold rounded-lg ${p === page ? "bg-moss-green text-white" : "bg-zinc-900 text-zinc-500 hover:border-moss-green"}`}>{p}</button>
            );
          })}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">Editar Sello</h3>
              <button onClick={() => setEditing(null)}><X size={20} className="text-zinc-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Nombre (ES)</label>
                <input value={editing.nameEs || ""} onChange={(e) => setEditing({ ...editing, nameEs: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Nombre (EN)</label>
                <input value={editing.nameEn || ""} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Precio USD</label>
                <input type="number" value={editing.marketPriceUsd || ""} onChange={(e) => setEditing({ ...editing, marketPriceUsd: parseFloat(e.target.value) || null })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Temática</label>
                <input value={editing.theme || ""} onChange={(e) => setEditing({ ...editing, theme: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-moss-green hover:bg-moss-green-dark text-white text-sm font-bold rounded-lg flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
