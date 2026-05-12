'use client';

import { useEffect, useState } from 'react';
import { agencyCreateTask, agencyListTasks, type AgencyTask } from '@/lib/api';
import { TaskRow } from './TaskRow';

interface Props {
  clientId: number;
}

export function TaskList({ clientId }: Props) {
  const [tasks, setTasks] = useState<AgencyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    agencyListTasks(clientId)
      .then(setTasks)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load tasks'))
      .finally(() => setLoading(false));
  }, [clientId]);

  const create = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const next = await agencyCreateTask(clientId, { title: newTitle.trim() });
      setTasks((prev) => [...prev, next]);
      setNewTitle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const visible = showDone ? tasks : tasks.filter((t) => t.status !== 'done');

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Tasks</h3>
        <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Show completed
        </label>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New task…"
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
        />
        <button
          onClick={create}
          disabled={creating || !newTitle.trim()}
          className="rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && visible.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          {tasks.length === 0 ? 'No tasks yet. Add the first one above.' : 'No open tasks. Toggle "Show completed" to see done items.'}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onChange={(next) => setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)))}
            onDelete={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
          />
        ))}
      </ul>
    </section>
  );
}
