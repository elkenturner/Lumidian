'use client';

import { useEffect, useState } from 'react';
import {
  agencyDeleteNote,
  agencyEditNote,
  agencyListActivity,
  agencyPostNote,
  type ActivityEvent,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { iconForEventType } from './activity-icons';

interface Props {
  clientId: number;
}

const PAGE_SIZE = 50;

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface NoteEditorProps {
  initialBody: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}

function NoteEditor({ initialBody, onSave, onCancel }: NoteEditorProps) {
  const [text, setText] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={async () => {
            if (!text.trim()) return;
            setBusy(true);
            try { await onSave(text.trim()); } finally { setBusy(false); }
          }}
          disabled={busy || !text.trim()}
          className="rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ActivityFeed({ clientId }: Props) {
  const { user } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState('');
  const [posting, setPosting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: number) => {
    try {
      const next = await agencyListActivity(clientId, { limit: PAGE_SIZE, before });
      setEvents((prev) => (before === undefined ? next : [...prev, ...next]));
      setHasMore(next.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const postNote = async () => {
    if (!composer.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const created = await agencyPostNote(clientId, composer.trim());
      setEvents((prev) => [created, ...prev]);
      setComposer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post note');
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (eventId: number, body: string) => {
    try {
      const updated = await agencyEditNote(eventId, body);
      setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save edit');
    }
  };

  const deleteNote = async (eventId: number) => {
    try {
      await agencyDeleteNote(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete note');
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h3 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">Activity & notes</h3>

      <div className="mb-4 space-y-2">
        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <button
            onClick={postNote}
            disabled={posting || !composer.trim()}
            className="rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Post note'}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

      {!loading && events.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">No activity yet. Post the first note above.</p>
      )}

      <ul className="space-y-3">
        {events.map((event) => {
          const Icon = iconForEventType(event.event_type);
          const isOwnNote =
            event.event_type === 'note' && user?.id != null && event.actor_user_id === user.id;
          const isEditing = editingId === event.id;
          return (
            <li
              key={event.id}
              className="flex gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
            >
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                <Icon width={14} height={14} />
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <NoteEditor
                    initialBody={event.body}
                    onSave={(body) => saveEdit(event.id, body)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-[var(--text-primary)]">{event.body}</p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>{event.actor_name ?? 'Lumidian'}</span>
                  <span>·</span>
                  <span>{timeAgo(event.created_at)}</span>
                  {event.updated_at && <span>· edited</span>}
                  {isOwnNote && !isEditing && (
                    <>
                      <span>·</span>
                      <button onClick={() => setEditingId(event.id)} className="hover:underline">
                        Edit
                      </button>
                      <span>·</span>
                      <button onClick={() => deleteNote(event.id)} className="hover:underline">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => load(events[events.length - 1]?.id)}
            className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            Load older
          </button>
        </div>
      )}
    </section>
  );
}
