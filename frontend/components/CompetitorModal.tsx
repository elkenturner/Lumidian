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

  // Build a map of name -> mention_rate from last run analytics
  const rateByName = new Map(competitorStats.filter((s) => !s.is_primary).map((s) => [s.name.toLowerCase(), s.mention_rate]));

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const c = await addCompetitor(brandId, newName.trim());
      const updated = [...local, c];
      setLocal(updated);
      setNewName('');
      onChanged(updated);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    setRemovingId(id);
    try {
      await removeCompetitor(brandId, id);
      const updated = local.filter((c) => c.id !== id);
      setLocal(updated);
      onChanged(updated);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Competitors</DialogTitle>
          <p className="text-xs text-[#64748B] mt-0.5">Track competitor mentions to unlock Share of Voice</p>
        </DialogHeader>

        <div className="space-y-2 mb-4 min-h-[40px]">
          {local.length === 0 ? (
            <div className="flex flex-col items-center py-5 text-center">
              <Building2 size={18} className="text-[#475569] mb-2" />
              <p className="text-sm text-[#475569]">No competitors added yet</p>
              <p className="text-xs text-[#475569] mt-0.5">Add competitor names below to track share of voice</p>
            </div>
          ) : local.map((c) => {
            const rate = rateByName.get(c.name.toLowerCase());
            return (
              <div key={c.id} className="flex items-center gap-3 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.12)] rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#F0F4F8] font-medium truncate">{c.name}</p>
                </div>
                {rate !== undefined && (
                  <span className="text-xs font-bold tabular-nums text-[#94A3B8] flex-shrink-0">
                    {Math.round(rate * 100)}%
                  </span>
                )}
                <button
                  onClick={() => handleRemove(c.id)}
                  disabled={removingId === c.id}
                  aria-label="Remove competitor"
                  className="text-[#475569] hover:text-[#f87171] transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  {removingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Competitor brand name"
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Add
            </button>
          </div>
        </div>

        {local.length > 0 && (
          <p className="text-xs text-[#475569] mt-3">Run a new report to see updated Share of Voice data.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
