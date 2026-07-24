"use client";

import { useState } from "react";
import Link from "next/link";
import { User, Mail, Lock, Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";
import { register } from "@/lib/auth";

export default function RegistroPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const update = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.password.length < 6) return setError("La contraseña debe tener al menos 6 caracteres");
    if (form.password !== form.confirm) return setError("Las contraseñas no coinciden");
    setLoading(true);
    const result = await register(form.name, form.email, form.password);
    setLoading(false);
    if (result.success) {
      setDone(true);
      setTimeout(() => { window.location.href = "/perfil"; }, 2000);
    } else {
      setError(result.error || "Error al registrarse");
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center">
          <CheckCircle size={56} className="text-moss-green mx-auto mb-4" />
          <h2 className="text-2xl font-serif text-white mb-2">¡Cuenta creada!</h2>
          <p className="text-zinc-400 text-sm">Redirigiendo a tu perfil...</p>
        </div>
      </div>
    );
  }

  const strength = form.password.length >= 8 && /[A-Z]/.test(form.password) && /[0-9]/.test(form.password)
    ? "fuerte" : form.password.length >= 6 ? "media" : form.password.length > 0 ? "débil" : "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4 py-12">
      <div className="absolute inset-0 bg-[url('/hero-banner.jpg')] bg-cover bg-center opacity-10 grayscale" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center w-16 h-16 bg-moss-green rounded-2xl mb-5 shadow-lg shadow-moss-green/20 hover:scale-105 transition-transform">
            <span className="text-2xl font-serif font-bold text-white">FP</span>
          </Link>
          <h1 className="text-3xl font-serif font-bold mb-1">Crea tu cuenta</h1>
          <p className="text-zinc-500 text-sm">Únete a la comunidad filatélica del Perú</p>
        </div>

        <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/5 p-8 rounded-2xl shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Nombre completo</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                <input type="text" required value={form.name} onChange={update("name")}
                  placeholder="Tu nombre"
                  className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:border-moss-green outline-none transition-all" />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Correo Electrónico</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                <input type="email" required value={form.email} onChange={update("email")}
                  placeholder="tu@correo.com"
                  className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm focus:border-moss-green outline-none transition-all" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                <input type={showPw ? "text" : "password"} required value={form.password} onChange={update("password")}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-black/60 border border-white/10 rounded-xl py-3 pl-10 pr-10 text-sm focus:border-moss-green outline-none transition-all" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {strength && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex gap-1 flex-1">
                    {["débil","media","fuerte"].map((s, i) => (
                      <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${
                        (strength === "débil" && i === 0) ? "bg-red-500" :
                        (strength === "media" && i <= 1) ? "bg-yellow-500" :
                        (strength === "fuerte") ? "bg-moss-green" : "bg-zinc-800"
                      }`} />
                    ))}
                  </div>
                  <span className={`text-[10px] font-bold uppercase ${
                    strength === "fuerte" ? "text-moss-green" : strength === "media" ? "text-yellow-500" : "text-red-400"
                  }`}>{strength}</span>
                </div>
              )}
            </div>

            {/* Confirm */}
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Confirmar contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                <input type={showPw ? "text" : "password"} required value={form.confirm} onChange={update("confirm")}
                  placeholder="Repite tu contraseña"
                  className={`w-full bg-black/60 border rounded-xl py-3 pl-10 pr-4 text-sm outline-none transition-all ${
                    form.confirm && form.confirm !== form.password ? "border-red-500/50" : "border-white/10 focus:border-moss-green"
                  }`} />
              </div>
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-moss-green hover:bg-moss-green-dark disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
              {loading ? <><Loader2 size={16} className="animate-spin" /> Creando cuenta...</> : "CREAR CUENTA"}
            </button>
          </form>

          <p className="text-center text-xs text-zinc-500 mt-6">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-moss-green-light font-bold hover:underline">Inicia sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
