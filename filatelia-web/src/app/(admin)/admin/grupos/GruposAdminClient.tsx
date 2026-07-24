"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Loader2, X, Check, Plus } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface Group {
  id: string;
  titleEs: string;
  titleEn: string | null;
  year: number | null;
  catalogId: string;
}

export default function GruposAdminClient() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem("fp_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API}/admin/groups`, { headers });
      const data = await res.json();
      setGroups(data.groups || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este grupo y sus sellos?")) return;
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/group/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    fetchGroups();
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/group/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ titleEs: editing.titleEs, titleEn: editing.titleEn, year: editing.year, catalogId: editing.catalogId }),
    });
    setSaving(false);
    setEditing(null);
    fetchGroups();
  };

  const handleCreate = async () => {
    setSaving(true);
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/group`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ catalogId: "cat-scraper-global", titleEs: "Nuevo Grupo", titleEn: "New Group", year: new Date().getFullYear() }),
    });
    setSaving(false);
    setCreating(false);
    fetchGroups();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif">Grupos de Emisión</h2>
        <button onClick={() => { setCreating(true); setEditing({ id: "", titleEs: "", titleEn: "", year: null, catalogId: "cat-scraper-global" }); }} className="px-4 py-2 bg-moss-green text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center gap-2"><Plus size={14} /> Nuevo Grupo</button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={32} className="text-moss-green animate-spin" /></div>
      ) : (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider"><th className="text-left p-4">Título ES</th><th className="text-left p-4">Título EN</th><th className="text-left p-4">Año</th><th className="text-left p-4">Acciones</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="p-4 text-zinc-200">{g.titleEs}</td>
                  <td className="p-4 text-zinc-400">{g.titleEn || "—"}</td>
                  <td className="p-4 text-zinc-400">{g.year || "—"}</td>
                  <td className="p-4"><div className="flex gap-2"><button onClick={() => setEditing(g)} className="p-1.5 hover:bg-white/5 rounded"><Pencil size={14} className="text-zinc-400" /></button><button onClick={() => handleDelete(g.id)} className="p-1.5 hover:bg-red-500/10 rounded"><Trash2 size={14} className="text-red-400" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg">
            <div className="flex justify-between items-center mb-6"><h3 className="text-lg font-bold">{creating ? "Crear" : "Editar"} Grupo</h3><button onClick={() => { setEditing(null); setCreating(false); }}><X size={20} className="text-zinc-500" /></button></div>
            <div className="space-y-4">
              <div><label className="block text-xs text-zinc-500 mb-1">Título (ES)</label><input value={editing.titleEs} onChange={(e) => setEditing({ ...editing, titleEs: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
              <div><label className="block text-xs text-zinc-500 mb-1">Título (EN)</label><input value={editing.titleEn || ""} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
              <div><label className="block text-xs text-zinc-500 mb-1">Año</label><input type="number" value={editing.year || ""} onChange={(e) => setEditing({ ...editing, year: parseInt(e.target.value) || null })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setEditing(null); setCreating(false); }} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancelar</button>
              <button onClick={creating ? handleCreate : handleSave} disabled={saving} className="px-6 py-2 bg-moss-green text-white text-sm font-bold rounded-lg flex items-center gap-2">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
