export default function SubastasLoading() {
  return (
    <div className="min-h-screen bg-black py-12 px-4 max-w-7xl mx-auto space-y-8">
      {/* Header skeleton */}
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-zinc-900 rounded-full mx-auto animate-pulse" />
        <div className="h-10 w-72 bg-zinc-900 rounded-xl mx-auto animate-pulse" />
        <div className="h-4 w-96 bg-zinc-900/60 rounded-lg mx-auto animate-pulse" />
      </div>

      {/* Filter skeleton */}
      <div className="h-14 bg-zinc-900/60 rounded-2xl animate-pulse border border-white/5" />

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-zinc-900/50 border border-white/5 rounded-2xl h-[420px] animate-pulse flex flex-col justify-between p-5">
            <div className="h-48 bg-zinc-800/50 rounded-xl w-full" />
            <div className="space-y-2">
              <div className="h-4 bg-zinc-800/60 rounded w-3/4" />
              <div className="h-3 bg-zinc-800/40 rounded w-1/2" />
            </div>
            <div className="h-12 bg-zinc-800/50 rounded-xl w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
