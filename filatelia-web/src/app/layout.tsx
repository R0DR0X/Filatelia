import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";
import PageTransition from "@/components/PageTransition";
import AnalyticsTracker from "@/components/AnalyticsTracker";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Filatelia Peruana | Catálogo Digital y Tienda",
  description: "La primera plataforma filatélica online del Perú. Catálogo visual premium y tienda especializada.",
  openGraph: {
    siteName: "Filatelia Peruana",
    type: "website",
    locale: "es_PE",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className={`${inter.variable} ${playfair.variable} font-sans antialiased bg-black text-zinc-100`}>
        <Providers>
          <Navbar />
          <PageTransition>
            {children}
          </PageTransition>
        </Providers>
        <AnalyticsTracker />
        <footer className="border-t border-white/5 py-12 mt-24 bg-zinc-950">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-moss-green rounded-full flex items-center justify-center text-white font-serif font-bold text-sm">FP</div>
                <span className="font-serif text-sm">Filatelia Peruana</span>
              </div>
              <nav className="flex items-center gap-6 text-xs font-bold uppercase tracking-widest text-zinc-500">
                <Link href="/biblioteca" className="hover:text-moss-green-light transition-colors">Biblioteca</Link>
                <Link href="/catalogo" className="hover:text-moss-green-light transition-colors">Catálogo</Link>
                <Link href="/identificar" className="hover:text-moss-green-light transition-colors">Identificar</Link>
                <Link href="/estadisticas" className="hover:text-moss-green-light transition-colors">Estadísticas</Link>
              </nav>
              <p className="text-zinc-600 text-xs">
                © 2026 Filatelia Peruana. Todos los derechos reservados.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
