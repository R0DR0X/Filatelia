"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
        <AlertCircle size={40} className="text-red-400" />
      </div>
      <h1 className="text-3xl font-serif text-white mb-3">Algo salió mal</h1>
      <p className="text-zinc-500 text-sm mb-8 max-w-md">Ocurrió un error inesperado. Por favor intenta recargar la página.</p>
      <div className="flex gap-4">
        <button onClick={() => reset()} className="px-6 py-3 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-xl transition-colors text-sm">Reintentar</button>
        <Link href="/" className="px-6 py-3 bg-zinc-900 border border-white/10 text-zinc-300 font-bold rounded-xl transition-colors text-sm">Ir al Inicio</Link>
      </div>
    </div>
  );
}
