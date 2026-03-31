export default function SettingsLoading() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-8 w-32 bg-white/5 rounded-lg" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
