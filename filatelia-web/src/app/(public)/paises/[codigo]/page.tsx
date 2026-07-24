import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import StampCard from "@/components/catalog/StampCard";
import { Stamp, Calendar, TrendingUp } from "lucide-react";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export default async function PaisPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const countryCode = codigo.toUpperCase();

  const country = await prisma.country.findFirst({
    where: { code: countryCode },
  });

  if (!country) notFound();

  // FIX: usar countryCode en vez de countryId
  const stamps = await prisma.stamp.findMany({
    where: { countryCode: countryCode },
    take: 100,
    include: {
      catalogNumbers: true,
    }
  });

  const years = stamps.map((s: any) => s.year).filter(Boolean) as number[];
  const minYear = years.length > 0 ? Math.min(...years) : null;
  const maxYear = years.length > 0 ? Math.max(...years) : null;

  return (
    <div className="min-h-screen bg-[#0a0906]">
      {/* Hero Section */}
      <div className="bg-zinc-900/50 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row items-start gap-6">
            {/* Bandera real */}
            <img
              src={`https://flagcdn.com/80x60/${countryCode.toLowerCase()}.png`}
              alt={country.nameEs || countryCode}
              width={80}
              height={60}
              className="rounded-lg object-cover shrink-0 border border-white/10"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />

            <div className="flex-1">
              <h1 className="text-4xl font-serif text-white mb-2">
                {country.nameEs}
              </h1>
              <p className="text-zinc-400 mb-4">
                {country.nameEn}
              </p>

              {/* Stats */}
              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <Stamp size={16} className="text-moss-green" />
                  <span className="text-white font-bold">{stamps.length}</span>
                  <span className="text-zinc-500 text-sm">sellos</span>
                </div>
                {(minYear || maxYear) && (
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-moss-green" />
                    <span className="text-white font-bold">{minYear} - {maxYear || 'presente'}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-moss-green" />
                  <span className="text-zinc-400 text-sm">Código: {country.code}</span>
                </div>
              </div>

              {/* Links */}
              <div className="flex items-center gap-4 mt-4">
                <Link href="/catalogo" className="text-moss-green-light text-sm font-bold hover:underline">
                  Ver en Catálogo →
                </Link>
                <Link href={`/biblioteca?countryCode=${countryCode}`} className="text-moss-green-light text-sm font-bold hover:underline">
                  Buscar en Biblioteca →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stamps Grid */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-serif text-white mb-8">
          Sellos de <span className="text-moss-green-light">{country.nameEs}</span>
        </h2>

        {stamps.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <Stamp size={48} className="mx-auto mb-4 text-zinc-700" />
            <p className="mb-4">No hay sellos registrados para este país aún.</p>
            <Link href="/biblioteca" className="text-moss-green-light text-sm font-bold hover:underline">
              Explorar Biblioteca →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stamps.map((stamp: any) => {
              const scott = stamp.catalogNumbers?.find((c: any) => c.catalogName?.toLowerCase() === 'scott');

              return (
                <StampCard
                  key={stamp.id}
                  id={stamp.id}
                  title={stamp.nameEs || stamp.nameEn || 'Sin nombre'}
                  scott={scott?.number}
                  image={stamp.imageUrl}
                />
              );
            })}
          </div>
        )}

        {stamps.length >= 100 && (
          <p className="text-center text-zinc-500 text-sm mt-8">
            Mostrando los primeros 100 sellos. Usa los filtros para refinar tu búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}
