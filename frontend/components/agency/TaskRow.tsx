'use client';

import { useState } from 'react';
import { agencyDeleteTask, agencyUpdateTask, type AgencyTask, type TaskStatus } from '@/lib/api';
import { AssigneePicker } from './AssigneePicker';

interface Props {
  task: AgencyTask;
  onChange: (next: AgencyTask) => void;
  onDelete: (id: number) => void;
}

const STATUS_PILL: Record<TaskStatus, string> = {
  open: 'bg-slate-500/20 text-slate-300',
  in_progress: 'bg-amber-500/20 text-amber-300',
  done: 'bg-emerald-500/20 text-emerald-300',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
};

function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const t = new Date(normalized).getTime();
  const now = Date.now();
  const overdue = t < now;
  const days = Math.round((t - now) / 86400000);
  let text: string;
  if (Math.abs(days) < 1) text = overdue ? 'Today (overdue)' : 'Today';
  else if (days > 0) text = `in ${days}d`;
  else text = `${Math.abs(days)}d overdue`;
  return { text, overdue };
}

export function TaskRow({ task, onChange, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const due = dueLabel(task.due_at);

  const setStatus = async (status: TaskStatus) => {
    const next = await agencyUpdateTask(task.id, { status });
    onChange(next);
  };
  const setAssignee = async (userId: number | null) => {
    const next = await agencyUpdateTask(task.id, { assigned_to_user_id: userId });
    onChange(next);
  };
  const remove = async () => {
    if (!confirm('Delete this task?')) return;
    await agencyDeleteTask(task.id);
    onDelete(task.id);
  };

  return (
    <li className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-left font-medium text-[var(--text-primary)] hover:underline"
            >
              {task.title}
            </button>
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            {due && (
              <span className={`text-xs ${due.overdue ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                {due.text}
              </span>
            )}
          </div>
          {expanded && task.description && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
              {task.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <AssigneePicker
              value={task.assigned_to_user_id}
              onChange={setAssignee}
              compact
            />
            <select
              value={task.status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-primary)]"
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
            <button onClick={remove} className="text-[var(--text-muted)] hover:text-red-400">
              Delete
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
