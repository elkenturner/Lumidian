export default function ContentLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 bg-white/5 rounded-lg" />
        <div className="h-9 w-28 bg-white/5 rounded-lg" />
      </div>
      {/* Tab bar */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-9 w-24 bg-white/5 rounded-lg" />
        ))}
      </div>
      {/* Draft cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-40 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
