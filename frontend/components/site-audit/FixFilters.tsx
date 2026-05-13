'use client';

import { Search } from 'lucide-react';

export interface FixFilterState {
  category: string | null; // null = all
  priority: string | null;
  status: 'pending' | 'applied' | 'dismissed' | 'all';
  query: string;
}

interface Props {
  state: FixFilterState;
  onChange: (next: FixFilterState) => void;
  counts: {
    total: number;
    pending: number;
    applied: number;
    dismissed: number;
  };
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'bot_access', label: 'AI bots' },
  { value: 'content', label: 'Content' },
  { value: 'schema', label: 'Schema' },
  { value: 'technical', label: 'Technical' },
  { value: 'authority', label: 'Authority' },
];

const PRIORITIES: { value: string; label: string; color: string }[] = [
  { value: 'high', label: 'High', color: 'var(--danger-text)' },
  { value: 'medium', label: 'Medium', color: 'var(--warning-text)' },
  { value: 'low', label: 'Low', color: 'var(--text-muted)' },
];

export function FixFilters({ state, onChange, counts }: Props) {
  return (
    <div className="card mb-4 space-y-3">
      {/* Status row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
          Status
        </span>
        {(['pending', 'applied', 'dismissed', 'all'] as const).map((s) => {
          const active = state.status === s;
          const count =
            s === 'pending' ? counts.pending
              : s === 'applied' ? counts.applied
                : s === 'dismissed' ? counts.dismissed
                  : counts.total;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...state, status: s })}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                active
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
              style={{
                background: active ? 'var(--accent-muted)' : 'transparent',
                border: `1px solid ${active ? 'var(--accent-light)' : 'var(--border-subtle)'}`,
              }}
            >
              {s[0].toUpperCase() + s.slice(1)}
              <span className="ml-1.5 tabular-nums text-[var(--text-faint)]">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Category + priority + search row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
          Filter
        </span>
        <ChipGroup
          options={CATEGORIES}
          value={state.category}
          onChange={(v) => onChange({ ...state, category: v })}
        />
        <span className="text-[var(--text-faint)]">·</span>
        <ChipGroup
          options={PRIORITIES.map((p) => ({ value: p.value, label: p.label, dot: p.color }))}
          value={state.priority}
          onChange={(v) => onChange({ ...state, priority: v })}
        />
        <div className="flex-1 min-w-[140px] relative">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
          />
          <input
            type="text"
            value={state.query}
            onChange={(e) => onChange({ ...state, query: e.target.value })}
            placeholder="Search fixes…"
            className="w-full pl-7 pr-3 py-1.5 rounded text-xs bg-[var(--bg-base)] border border-[var(--border-subtle)] focus:outline-none focus:border-[var(--accent-light)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)]"
          />
        </div>
      </div>
    </div>
  );
}

function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; dot?: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active ? null : opt.value)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors inline-flex items-center gap-1.5 ${
              active
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            style={{
              background: active ? 'var(--accent-muted)' : 'transparent',
              border: `1px solid ${active ? 'var(--accent-light)' : 'var(--border-subtle)'}`,
            }}
          >
            {opt.dot && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: opt.dot }}
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
