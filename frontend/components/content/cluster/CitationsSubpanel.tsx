"use client";

interface Citation {
  source_ref: string;
  url: string;
  title: string | null;
  position_marker: number | null;
  tier?: "T1" | "T2" | "T3" | "brand" | null;
}

// Shared tier vocabulary — matches SourceSpinePanel so a source reads the same
// whether you see it in the per-post citation list or the cluster source spine.
const TIER_COLORS: Record<string, string> = {
  T1: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  T2: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  T3: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  brand: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const TIER_LABEL: Record<string, string> = {
  T1: "Major press & research",
  T2: "Industry press",
  T3: "Other web",
  brand: "Your site & profile",
};

function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  return (
    <span
      className={`px-1.5 py-0.5 rounded border shrink-0 text-[10px] ${
        TIER_COLORS[tier] ?? TIER_COLORS.T3
      }`}
    >
      {TIER_LABEL[tier] ?? tier}
    </span>
  );
}

export function CitationsSubpanel({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) {
    return <div className="text-sm text-[var(--text-faint)]">No citations.</div>;
  }
  return (
    <ol className="space-y-1.5 text-sm">
      {citations.map((c) => (
        <li key={c.source_ref} className="flex items-start gap-2">
          <span className="text-[var(--text-faint)] shrink-0 font-mono text-xs pt-0.5">
            {c.source_ref}
          </span>
          <TierBadge tier={c.tier} />
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-primary)] hover:underline min-w-0 break-words"
          >
            {c.title || c.url}
          </a>
        </li>
      ))}
    </ol>
  );
}
