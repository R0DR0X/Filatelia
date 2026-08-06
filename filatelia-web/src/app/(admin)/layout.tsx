"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileUp,
  Stamp,
  Users,
  Library,
  Layers,
  BarChart3,
  LogOut
} from "lucide-react";
import { logout } from "@/lib/auth";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  // Every admin page that exists belongs here. Five of these were built and
  // then never linked — /admin/sellos, /admin/usuarios, /admin/catalogos,
  // /admin/grupos and /admin/analitica were reachable only by typing the URL,
  // so the panel looked like it did two things when it does seven. An
  // unlinked page is indistinguishable from a missing feature.
  const sidebarItems = [
    { href: "/admin/dashboard", icon: LayoutDashboard, label: "Resumen" },
    { href: "/admin/sellos", icon: Stamp, label: "Sellos" },
    { href: "/admin/catalogos", icon: Library, label: "Catálogos" },
    { href: "/admin/grupos", icon: Layers, label: "Grupos" },
    { href: "/admin/usuarios", icon: Users, label: "Usuarios" },
    { href: "/admin/analitica", icon: BarChart3, label: "Analítica" },
    { href: "/admin/importar", icon: FileUp, label: "Importar Excel" },
  ];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 flex flex-col sticky top-0 h-screen bg-black">
        <div className="p-6 border-b border-white/5">
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-moss-green rounded-lg flex items-center justify-center font-bold">
              A
            </div>
            <span className="font-serif font-bold tracking-tight">ADMIN PANEL</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4">
          {sidebarItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-4 py-2 rounded-md text-sm transition-all
                  ${isActive
                    ? "bg-moss-green/10 text-moss-green-light border border-moss-green/20"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"}
                `}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-2">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-2 text-sm text-zinc-500 hover:text-red-400 hover:bg-red-400/5 rounded-md transition-all"
          >
            <LogOut size={20} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-serif">Panel de Administración</h1>
            <p className="text-sm text-zinc-500">Gestiona filateliaperuana.com</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium">Administrador</div>
              <div className="text-xs text-zinc-500">admin@filateliaperuana.com</div>
            </div>
            <div className="w-10 h-10 bg-zinc-800 rounded-full border border-white/10" />
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
