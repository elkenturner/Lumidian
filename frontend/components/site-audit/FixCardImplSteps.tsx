'use client';

interface Props {
  steps: string[];
}

export function FixCardImplSteps({ steps }: Props) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        How to install
      </p>
      <ol className="space-y-2 text-sm text-[var(--text-secondary)]">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              className="shrink-0 w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center tabular-nums"
              style={{
                background: 'var(--accent-muted)',
                color: 'var(--accent-light)',
                border: '1px solid var(--accent-muted)',
              }}
            >
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
