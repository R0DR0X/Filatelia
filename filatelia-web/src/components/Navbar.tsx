"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, Search, Menu, User, ChevronDown, LogOut, LayoutDashboard } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useCartStore } from "@/store/useCartStore";
import { getMe, logout } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";

// Identity is resolved asynchronously (the `fp_session` cookie is httpOnly,
// so nothing can be read synchronously on first paint). Until `/api/auth/me`
// answers, the nav must assert NEITHER state: rendering the logged-out icon
// while unknown makes every authenticated visitor flash "logged out" — and
// the admin link disappear — on every hard page load.
type NavIdentity =
  | { status: "unknown" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "anonymous" };

export default function Navbar() {
  const itemCount = useCartStore((state) => state.getItemCount());
  const openCart = useCartStore((state) => state.openCart);
  const pathname = usePathname();
  const [identity, setIdentity] = useState<NavIdentity>({ status: "unknown" });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const user = identity.status === "authenticated" ? identity.user : null;

  useEffect(() => {
    getMe().then((result) => {
      // `unavailable` = the probe failed (offline, 5xx, timeout). Keep the
      // previous state instead of demoting the visitor to anonymous.
      if (result.status === "unavailable") return;
      setIdentity(
        result.status === "authenticated"
          ? { status: "authenticated", user: result.user }
          : { status: "anonymous" }
      );
    });
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = async () => {
    await logout();
    setIdentity({ status: "anonymous" });
    setDropdownOpen(false);
    window.location.href = "/";
  };

  const navLinks = [
    { href: "/biblioteca", label: "Biblioteca" },
    { href: "/catalogo", label: "Catálogo" },
    { href: "/identificar", label: "Identificar" },
    { href: "/tienda", label: "Tienda" },
    { href: "/subastas", label: "Subastas" },
    { href: "/colecciones", label: "Mi Colección" },
  ];

  return (
    <nav className="border-b border-white/5 bg-black/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 bg-moss-green rounded-full flex items-center justify-center text-white font-serif font-bold text-xl group-hover:scale-110 transition-transform shadow-lg shadow-moss-green/20">
            FP
          </div>
          <div className="hidden sm:block">
            <span className="block text-xs font-bold tracking-widest text-zinc-500 uppercase">Perú</span>
            <span className="block font-serif text-lg leading-none">Filatelia</span>
          </div>
        </Link>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-8 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`hover:text-moss-green transition-colors ${
                pathname?.startsWith(link.href) ? "text-moss-green-light" : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-5">
          <button className="text-zinc-400 hover:text-white transition-colors">
            <Search size={20} />
          </button>

          {/* Auth area */}
          {user ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <div className="w-8 h-8 bg-moss-green/20 text-moss-green-light rounded-full flex items-center justify-center text-xs font-bold border border-moss-green/30">
                  {user.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <ChevronDown size={14} className="text-zinc-500 hidden sm:block" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-12 w-56 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl py-2 z-50">
                  <div className="px-4 py-2 border-b border-white/5">
                    <div className="text-sm font-bold text-white">{user.name}</div>
                    <div className="text-xs text-zinc-500">{user.email}</div>
                  </div>
                  <Link
                    href="/perfil"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <User size={16} /> Mi Perfil
                  </Link>
                  {user.role === "admin" && (
                    <Link
                      href="/admin/dashboard"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      <LayoutDashboard size={16} /> Admin Panel
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-400 hover:bg-white/5 hover:text-red-400 transition-colors w-full text-left"
                  >
                    <LogOut size={16} /> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          ) : identity.status === "anonymous" ? (
            <Link href="/login" className="text-zinc-400 hover:text-white transition-colors">
              <User size={20} />
            </Link>
          ) : (
            // Identity still unknown: neutral placeholder, same footprint as
            // the avatar, following the `animate-pulse` skeleton convention
            // used by the route-level `loading.tsx` files.
            <div
              role="status"
              aria-label="Verificando sesión"
              className="w-8 h-8 rounded-full bg-zinc-800/80 border border-white/5 animate-pulse"
            />
          )}

          <button
            onClick={openCart}
            className="relative p-2 bg-moss-green/10 text-moss-green rounded-full hover:bg-moss-green/20 transition-all group"
          >
            <ShoppingCart size={20} className="group-hover:scale-110 transition-transform" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-white text-black text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-md">
                {itemCount}
              </span>
            )}
          </button>

          <button
            className="md:hidden text-zinc-400"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <Menu size={24} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-white/5 bg-black/95 backdrop-blur-md">
          <div className="px-4 py-4 space-y-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block text-sm font-bold uppercase tracking-widest text-zinc-400 hover:text-moss-green-light transition-colors py-2"
              >
                {link.label}
              </Link>
            ))}
            {identity.status === "anonymous" && (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="block text-sm font-bold uppercase tracking-widest text-moss-green-light py-2"
              >
                Iniciar Sesión
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
