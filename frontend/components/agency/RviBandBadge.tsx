type Band = 'dominant' | 'winning' | 'even' | 'losing' | 'invisible';

interface Props {
  band: string | null | undefined;
  className?: string;
}

const STYLES: Record<Band, string> = {
  dominant:  'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30',
  winning:   'bg-green-500/10 text-green-400 ring-green-500/30',
  even:      'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  losing:    'bg-amber-500/10 text-amber-400 ring-amber-500/30',
  invisible: 'bg-rose-500/10 text-rose-400 ring-rose-500/30',
};

export function RviBandBadge({ band, className = '' }: Props) {
  const safe = (band && (band in STYLES) ? band : 'even') as Band;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ${STYLES[safe]} ${className}`}
    >
      {safe}
    </span>
  );
}
