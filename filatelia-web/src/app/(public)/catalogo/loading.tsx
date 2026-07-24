export default function CatalogoLoading() {
  return (
    <div className="min-h-screen bg-black py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-zinc-800 rounded mb-2 animate-pulse" />
        <div className="h-4 w-64 bg-zinc-800/50 rounded mb-8 animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-white/5 rounded-xl p-4 animate-pulse">
              <div className="h-20 bg-zinc-800 rounded-lg mb-3" />
              <div className="h-3 bg-zinc-800 rounded w-8 mb-2" />
              <div className="h-2 bg-zinc-800/50 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
