export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Lumidian Agency · Client review</h1>
      </div>
      <div className="mx-auto max-w-3xl px-6 py-8">{children}</div>
    </div>
  );
}
