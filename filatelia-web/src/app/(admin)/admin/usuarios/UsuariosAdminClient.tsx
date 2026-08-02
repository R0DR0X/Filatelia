"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Shield, UserX, AlertCircle } from "lucide-react";
import { adminFetch, adminErrorMessage } from "@/lib/adminApi";

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
  // Any admin call can fail (expired session, missing proxy config, upstream
  // timeout). Failures are shown here instead of being swallowed; the table
  // is only refetched when the mutation actually succeeded.
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) { setError(adminErrorMessage(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError(null);
    try {
      await adminFetch(`user/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
    } catch (e) {
      setError(adminErrorMessage(e));
      return;
    }
    fetchUsers();
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("¿Eliminar este usuario?")) return;
    setError(null);
    try {
      await adminFetch(`user/${userId}`, { method: "DELETE" });
    } catch (e) {
      setError(adminErrorMessage(e));
      return;
    }
    fetchUsers();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-serif">Gestión de Usuarios</h2>
      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}
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
