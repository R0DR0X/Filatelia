"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Loader2, X, Check, Plus } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface Catalog {
  id: string;
  name: string;
  description: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  status: string;
}

export default function CatalogosAdminClient() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Catalog | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchCatalogs = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem("fp_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API}/admin/catalogs`, { headers });
      const data = await res.json();
      setCatalogs(data.catalogs || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCatalogs(); }, [fetchCatalogs]);

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este catálogo?")) return;
    const token = localStorage.getItem("fp_token");
    try {
      const res = await fetch(`${API}/admin/catalog/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.success) alert(data.error || "Error al eliminar");
    } catch { /* ignore */ }
    fetchCatalogs();
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/catalog/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: editing.name, description: editing.description, yearStart: editing.yearStart, yearEnd: editing.yearEnd, status: editing.status }),
    });
    setSaving(false);
    setEditing(null);
    fetchCatalogs();
  };

  const handleCreate = async () => {
    setSaving(true);
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Nuevo Catálogo", description: "", yearStart: null, yearEnd: null }),
    });
    setSaving(false);
    setCreating(false);
    fetchCatalogs();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-serif">Catálogos</h2>
        <button onClick={() => { setCreating(true); setEditing({ id: "", name: "", description: "", yearStart: null, yearEnd: null, status: "activo" }); }} className="px-4 py-2 bg-moss-green text-white text-xs font-bold uppercase tracking-wider rounded-lg flex items-center gap-2"><Plus size={14} /> Nuevo Catálogo</button>
      </div>
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={32} className="text-moss-green animate-spin" /></div>
      ) : (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider"><th className="text-left p-4">Nombre</th><th className="text-left p-4">Descripción</th><th className="text-left p-4">Años</th><th className="text-left p-4">Estado</th><th className="text-left p-4">Acciones</th></tr></thead>
            <tbody>
              {catalogs.map((c) => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="p-4 text-zinc-200">{c.name}</td>
                  <td className="p-4 text-zinc-400 max-w-[200px] truncate">{c.description || "—"}</td>
                  <td className="p-4 text-zinc-400">{c.yearStart || "?"}–{c.yearEnd || "?"}</td>
                  <td className="p-4"><span className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${c.status === "activo" ? "bg-green-500/10 text-green-400" : "bg-zinc-800 text-zinc-500"}`}>{c.status}</span></td>
                  <td className="p-4"><div className="flex gap-2"><button onClick={() => setEditing(c)} className="p-1.5 hover:bg-white/5 rounded"><Pencil size={14} className="text-zinc-400" /></button><button onClick={() => handleDelete(c.id)} className="p-1.5 hover:bg-red-500/10 rounded"><Trash2 size={14} className="text-red-400" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg">
            <div className="flex justify-between items-center mb-6"><h3 className="text-lg font-bold">{creating ? "Crear" : "Editar"} Catálogo</h3><button onClick={() => { setEditing(null); setCreating(false); }}><X size={20} className="text-zinc-500" /></button></div>
            <div className="space-y-4">
              <div><label className="block text-xs text-zinc-500 mb-1">Nombre</label><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
              <div><label className="block text-xs text-zinc-500 mb-1">Descripción</label><input value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs text-zinc-500 mb-1">Año inicio</label><input type="number" value={editing.yearStart || ""} onChange={(e) => setEditing({ ...editing, yearStart: parseInt(e.target.value) || null })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
                <div><label className="block text-xs text-zinc-500 mb-1">Año fin</label><input type="number" value={editing.yearEnd || ""} onChange={(e) => setEditing({ ...editing, yearEnd: parseInt(e.target.value) || null })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green" /></div>
              </div>
              <div><label className="block text-xs text-zinc-500 mb-1">Estado</label><select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-moss-green"><option value="activo">Activo</option><option value="inactive">Inactivo</option><option value="draft">Borrador</option></select></div>
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
