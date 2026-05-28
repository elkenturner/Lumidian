'use client';

import { useState } from 'react';
import { Plus, Loader2, Trash2, Building2 } from 'lucide-react';
import { addCompetitor, removeCompetitor, Competitor, CompetitorStat } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function CompetitorModal({
  brandId,
  competitors,
  competitorStats,
  onClose,
  onChanged,
}: {
  brandId: number;
  competitors: Competitor[];
  competitorStats: CompetitorStat[];
  onClose: () => void;
  onChanged: (updated: Competitor[]) => void;
}) {
  const [local, setLocal] = useState(competitors);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Build a map of name -> mention_rate from last run analytics
  const rateByName = new Map(competitorStats.filter((s) => !s.is_primary).map((s) => [s.name.toLowerCase(), s.mention_rate]));

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setError('');
    try {
      const c = await addCompetitor(brandId, newName.trim());
      const updated = [...local, c];
      setLocal(updated);
      setNewName('');
      onChanged(updated);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to add competitor.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    setRemovingId(id);
    setError('');
    try {
      await removeCompetitor(brandId, id);
      const updated = local.filter((c) => c.id !== id);
      setLocal(updated);
      onChanged(updated);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to remove competitor.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Competitors</DialogTitle>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Track competitor mentions to unlock Share of Voice</p>
        </DialogHeader>

        <div className="space-y-2 mb-4 min-h-[40px]">
          {local.length === 0 ? (
            <div className="flex flex-col items-center py-5 text-center">
              <Building2 size={18} className="text-[var(--text-faint)] mb-2" />
              <p className="text-sm text-[var(--text-faint)]">No competitors added yet</p>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">Add competitor names below to track share of voice</p>
            </div>
          ) : local.map((c) => {
            const rate = rateByName.get(c.name.toLowerCase());
            return (
              <div key={c.id} className="flex items-center gap-3 bg-[rgba(95,126,166,0.06)] border border-[rgba(95,126,166,0.12)] rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)] font-medium truncate">{c.name}</p>
                </div>
                {rate !== undefined && (
                  <span className="text-xs font-bold tabular-nums font-mono text-[var(--text-secondary)] flex-shrink-0">
                    {Math.round(rate * 100)}%
                  </span>
                )}
                <button
                  onClick={() => handleRemove(c.id)}
                  disabled={removingId === c.id}
                  aria-label="Remove competitor"
                  className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  {removingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Competitor brand name"
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[var(--bg-tinted-hover)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add
            </button>
          </div>
        </div>

        {local.length > 0 && (
          <p className="text-xs text-[var(--text-faint)] mt-3">Run a new report to see updated Share of Voice data.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
