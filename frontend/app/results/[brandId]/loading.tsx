export default function ResultsLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 bg-white/5 rounded-lg" />
        <div className="h-9 w-24 bg-white/5 rounded-lg" />
      </div>
      <div className="h-48 bg-white/5 rounded-xl" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-14 bg-white/5 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
