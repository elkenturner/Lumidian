"use client";

interface Citation {
  source_ref: string;
  url: string;
  title: string | null;
  position_marker: number | null;
}

export function CitationsSubpanel({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) {
    return <div className="text-sm text-[var(--text-faint)]">No citations.</div>;
  }
  return (
    <ol className="space-y-1 text-sm">
      {citations.map((c) => (
        <li key={c.source_ref} className="flex items-start gap-2">
          <span className="text-[var(--text-faint)] shrink-0 font-mono text-xs pt-0.5">
            {c.source_ref}
          </span>
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-primary)] hover:underline"
          >
            {c.title || c.url}
          </a>
        </li>
      ))}
    </ol>
  );
}
