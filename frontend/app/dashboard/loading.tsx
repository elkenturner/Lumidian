export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 bg-white/5 rounded-lg" />
        <div className="h-9 w-32 bg-white/5 rounded-lg" />
      </div>
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-white/5 rounded-xl" />
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="h-64 bg-white/5 rounded-xl" />
      {/* Table skeleton */}
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-12 bg-white/5 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
