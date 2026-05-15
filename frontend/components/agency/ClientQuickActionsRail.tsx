'use client';

import { useEffect, useState } from 'react';
import {
  agencyListActivity,
  type ActivityEvent,
  type AgencyClient,
  type AgencyDocument,
} from '@/lib/api';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { ReviewLinkSection } from './ReviewLinkSection';
import { SendDraftsToClientModal } from './SendDraftsToClientModal';
import { iconForEventType } from './activity-icons';

interface Props {
  client: AgencyClient;
  onDocumentGenerated: (doc: AgencyDocument) => void;
  onDraftsSent: () => void;
}

const CLIENT_EVENT_TYPES = new Set([
  'client_approved',
  'client_changes_requested',
  'client_rejected',
]);

function timeAgo(iso: string): string {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const diff = (Date.now() - new Date(normalized).getTime()) / 1000;
  if (diff < 0) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ClientQuickActionsRail({ client, onDocumentGenerated, onDraftsSent }: Props) {
  const [sendOpen, setSendOpen] = useState(false);
  const [recent, setRecent] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    agencyListActivity(client.id, { limit: 30 })
      .then((events) => {
        setRecent(events.filter((e) => CLIENT_EVENT_TYPES.has(e.event_type)).slice(0, 5));
      })
      .catch(() => setRecent([]));
  }, [client.id]);

  return (
    <aside className="sticky top-6 space-y-4 self-start">
      <ReviewLinkSection clientId={client.id} />

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Quick actions</h3>
        <div className="space-y-2">
          <button
            onClick={() => setSendOpen(true)}
            className="w-full rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
          >
            Send drafts to client review
          </button>
          <GenerateDocumentButton clientId={client.id} onGenerated={onDocumentGenerated} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Recent client actions</h3>
        {recent.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No client actions yet.</p>
        )}
        <ul className="space-y-2">
          {recent.map((e) => {
            const Icon = iconForEventType(e.event_type);
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-raised)] text-[var(--text-secondary)]">
                  <Icon width={11} height={11} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-primary)]">{e.body}</p>
                  <p className="text-[var(--text-muted)]">{timeAgo(e.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <SendDraftsToClientModal
        open={sendOpen}
        onOpenChange={setSendOpen}
        clientId={client.id}
        clientName={client.name}
        brandId={client.brand_id}
        primaryContactName={client.primary_contact_name}
        primaryContactEmail={client.primary_contact_email ?? null}
        onSent={onDraftsSent}
      />
    </aside>
  );
}
