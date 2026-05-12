'use client';

import { useEffect, useState } from 'react';
import { agencyStaff, type AgencyStaffMember } from '@/lib/api';

interface Props {
  value: number | null;
  onChange: (userId: number | null) => Promise<void> | void;
  compact?: boolean;
}

export function AssigneePicker({ value, onChange, compact }: Props) {
  const [staff, setStaff] = useState<AgencyStaffMember[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    agencyStaff().then(setStaff).catch(() => setStaff([]));
  }, []);

  const handle = async (next: number | null) => {
    setBusy(true);
    try { await onChange(next); } finally { setBusy(false); }
  };

  return (
    <select
      value={value ?? ''}
      onChange={(e) => handle(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      disabled={busy}
      className={`rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] ${
        compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
      } disabled:opacity-50`}
    >
      <option value="">Unassigned</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name || s.email}
        </option>
      ))}
    </select>
  );
}
