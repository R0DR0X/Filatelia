export default function BibliotecaLoading() {
  return (
    <div className="min-h-screen bg-black py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-zinc-800 rounded mb-2 animate-pulse" />
        <div className="h-4 w-64 bg-zinc-800/50 rounded mb-8 animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-white/5 rounded-xl overflow-hidden">
              <div className="aspect-[4/3] bg-zinc-800 animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-zinc-800 rounded animate-pulse" />
                <div className="h-2 bg-zinc-800/50 rounded w-2/3 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
