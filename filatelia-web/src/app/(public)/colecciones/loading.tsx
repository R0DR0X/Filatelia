export default function ColeccionesLoading() {
  return (
    <div className="min-h-screen bg-black py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-56 bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-80 bg-zinc-800/50 rounded animate-pulse" />

        <div className="flex gap-2 pt-4 border-b border-white/10 pb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 w-28 bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 bg-zinc-800 rounded-lg animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-zinc-800 rounded animate-pulse w-3/4" />
                  <div className="h-2 bg-zinc-800/50 rounded animate-pulse w-1/3" />
                </div>
              </div>
              <div className="h-2 bg-zinc-800/50 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
