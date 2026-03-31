export default function ReportsLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-28 bg-white/5 rounded-lg" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-14 bg-white/5 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
