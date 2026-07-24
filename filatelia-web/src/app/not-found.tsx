import Link from "next/link";
import { Stamp } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 text-center">
      <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-8">
        <Stamp size={48} className="text-zinc-600" />
      </div>
      <h1 className="text-6xl font-serif font-bold text-white mb-4">404</h1>
      <p className="text-xl text-zinc-400 mb-2">Este sello no está en la colección</p>
      <p className="text-sm text-zinc-600 mb-8">La página que buscas no existe o fue movida.</p>
      <div className="flex gap-4">
        <Link href="/" className="px-6 py-3 bg-moss-green hover:bg-moss-green-dark text-white font-bold rounded-xl transition-colors text-sm">Volver al Inicio</Link>
        <Link href="/biblioteca" className="px-6 py-3 bg-zinc-900 border border-white/10 hover:border-moss-green/50 text-zinc-300 font-bold rounded-xl transition-colors text-sm">Buscar en Biblioteca</Link>
      </div>
    </div>
  );
}
