"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Lock, Mail, Loader2, Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const [from, setFrom] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFrom(params.get("from") || "");
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) {
      const dest = from || (result.user?.role === "admin" ? "/admin/dashboard" : "/perfil");
      window.location.href = dest;
    } else {
      setError(result.error || "Credenciales incorrectas");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="absolute inset-0 bg-[url('/hero-banner.jpg')] bg-cover bg-center opacity-10 grayscale" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center justify-center w-16 h-16 bg-moss-green rounded-2xl mb-6 shadow-lg shadow-moss-green/20 hover:scale-105 transition-transform">
            <span className="text-2xl font-serif font-bold text-white">FP</span>
          </Link>
          <h1 className="text-3xl font-serif font-bold mb-2">Bienvenido de nuevo</h1>
          <p className="text-zinc-500 text-sm">Ingresa tus credenciales para acceder</p>
        </div>

        <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/5 p-8 rounded-2xl shadow-2xl">
          <a
            href="/api/auth/google"
            className="w-full bg-white hover:bg-zinc-100 text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.9c1.7-1.57 2.7-3.88 2.7-6.64z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.9-2.27c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34C2.44 15.98 5.48 18 9 18z" />
              <path fill="#FBBC05" d="M3.95 10.7c-.18-.54-.28-1.11-.28-1.7s.1-1.16.28-1.7V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z" />
            </svg>
            Iniciar sesión con Google
          </a>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">o con tu correo</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                Correo Electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                <input
                  type="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:border-moss-green outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                <input
                  type={showPw ? "text" : "password"} required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-10 pr-10 text-sm focus:border-moss-green outline-none transition-all"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-moss-green hover:bg-moss-green-dark disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
              {loading ? <><Loader2 size={16} className="animate-spin" /> Ingresando...</> : "INICIAR SESIÓN"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/5 text-center space-y-3">
            <p className="text-xs text-zinc-500">
              ¿No tienes cuenta?{" "}
              <Link href="/registro" className="text-moss-green-light font-bold hover:underline">
                Regístrate gratis
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
