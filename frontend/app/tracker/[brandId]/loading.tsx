export default function BrandTrackerLoading() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-white/5 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-20 bg-white/5 rounded-xl" />
        ))}
      </div>
      <div className="h-48 bg-white/5 rounded-xl" />
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-white/5 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
