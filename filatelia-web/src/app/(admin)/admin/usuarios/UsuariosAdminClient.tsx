"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Shield, UserX } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  roleName: string | null;
}

export default function UsuariosAdminClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem("fp_token");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch(`${API}/admin/users`, { headers });
      const data = await res.json();
      setUsers(data.users || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/user/${userId}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ role: newRole }),
    });
    fetchUsers();
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("¿Eliminar este usuario?")) return;
    const token = localStorage.getItem("fp_token");
    await fetch(`${API}/admin/user/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchUsers();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-serif">Gestión de Usuarios</h2>
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={32} className="text-moss-green animate-spin" /></div>
      ) : (
        <div className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="text-left p-4">Nombre</th>
                <th className="text-left p-4">Email</th>
                <th className="text-left p-4">Rol</th>
                <th className="text-left p-4">Registro</th>
                <th className="text-left p-4">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="p-4 text-zinc-200">{u.name}</td>
                  <td className="p-4 text-zinc-400">{u.email}</td>
                  <td className="p-4">
                    <select
                      value={u.roleName || "user"}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-moss-green"
                    >
                      <option value="user">Usuario</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="p-4 text-zinc-500 text-xs">{new Date(u.createdAt).toLocaleDateString("es-PE")}</td>
                  <td className="p-4">
                    <button onClick={() => handleDelete(u.id)} className="p-1.5 hover:bg-red-500/10 rounded" title="Eliminar">
                      <UserX size={14} className="text-red-400" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
