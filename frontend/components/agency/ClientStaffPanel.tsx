'use client';

import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import {
  agencyAssignStaff,
  agencyListClientStaff,
  agencyStaff,
  agencyUnassignStaff,
  type AgencyStaffMember,
  type ClientStaffAssignment,
} from '@/lib/api';

interface Props {
  clientId: number;
}

export function ClientStaffPanel({ clientId }: Props) {
  const [assigned, setAssigned] = useState<ClientStaffAssignment[]>([]);
  const [allStaff, setAllStaff] = useState<AgencyStaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picker, setPicker] = useState<number | ''>('');

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, s] = await Promise.all([agencyListClientStaff(clientId), agencyStaff()]);
      setAssigned(a);
      setAllStaff(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, [clientId]);

  const assignedIds = new Set(assigned.map((a) => a.user_id));
  const eligible = allStaff.filter((s) => !assignedIds.has(s.id));

  const onAdd = async () => {
    if (typeof picker !== 'number') return;
    setBusy(true);
    setError(null);
    try {
      await agencyAssignStaff(clientId, picker);
      setPicker('');
      setAdding(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (userId: number) => {
    if (!confirm('Remove this staff member from the client?')) return;
    setBusy(true);
    setError(null);
    try {
      await agencyUnassignStaff(clientId, userId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unassign');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Assigned staff
        </h3>
        {!adding && eligible.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <UserPlus className="h-3 w-3" />
            Assign
          </button>
        )}
      </div>

      {loading && <p className="text-xs text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && assigned.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">No staff assigned. Admins can still access this client.</p>
      )}

      <ul className="space-y-1">
        {assigned.map((a) => (
          <li
            key={a.user_id}
            className="flex items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-xs"
          >
            <span className="text-[var(--text-primary)]">
              {a.name || a.email}
              {a.name && <span className="ml-2 text-[var(--text-muted)]">{a.email}</span>}
            </span>
            <button
              onClick={() => onRemove(a.user_id)}
              disabled={busy}
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-red-400 disabled:opacity-50"
              title="Remove from client"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-3 flex gap-2">
          <select
            value={picker}
            onChange={(e) => setPicker(e.target.value ? Number(e.target.value) : '')}
            className="flex-1 rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value="">Pick a staff member…</option>
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ? `${s.name} (${s.email})` : s.email}
              </option>
            ))}
          </select>
          <button
            onClick={onAdd}
            disabled={busy || picker === ''}
            className="rounded bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => {
              setAdding(false);
              setPicker('');
            }}
            className="rounded border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
