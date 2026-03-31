export default function TrackerLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-white/5 rounded-lg" />
        <div className="h-9 w-32 bg-white/5 rounded-lg" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-16 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
