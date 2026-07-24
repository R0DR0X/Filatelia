export default function AdminDashboardLoading() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-6 bg-zinc-900 border border-white/5 rounded-xl animate-pulse">
            <div className="flex justify-between items-start mb-4">
              <div className="w-10 h-10 bg-zinc-800 rounded-lg" />
              <div className="h-3 w-16 bg-zinc-800 rounded" />
            </div>
            <div className="h-8 w-24 bg-zinc-800 rounded mb-1" />
            <div className="h-3 w-20 bg-zinc-800/50 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
