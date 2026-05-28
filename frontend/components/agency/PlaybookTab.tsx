'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  agencyGenerateDocument,
  agencyListDocuments,
  agencyListMilestones,
  type AgencyClient,
  type AgencyClientMilestone,
  type AgencyDocument,
  type ContentDraft,
} from '@/lib/api';
import { DocumentViewer } from './DocumentViewer';
import { PlaybookEngagement } from './PlaybookEngagement';
import { PlaybookLaunchRow } from './PlaybookLaunchRow';
import { PlaybookReports } from './PlaybookReports';
import { PlaybookWeeklyExecution } from './PlaybookWeeklyExecution';

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

interface Props {
  client: AgencyClient;
  drafts: AgencyDraft[] | null;
  latestRunIso: string | null;
  reviewLinkUrl: string | null;
  onDraftsChanged: () => void;
  onTrackingTriggered: () => void;
  onOpenSendModal: () => void;
}

const LAUNCH_LABELS: Record<string, { label: string; docKind: string | null; secondary?: { href: string; label: string } }> = {
  kickoff:         { label: 'Kickoff',          docKind: 'kickoff_checklist' },
  sow:             { label: 'SOW',              docKind: 'sow' },
  initial_audit:   { label: 'Initial audit',    docKind: 'audit_initial' },
  strategy_locked: { label: 'Strategy locked',  docKind: null, secondary: { href: '?tab=brand', label: 'Open Brand → Prompts' } },
};

export function PlaybookTab({
  client,
  drafts,
  latestRunIso,
  reviewLinkUrl,
  onDraftsChanged,
  onTrackingTriggered,
  onOpenSendModal,
}: Props) {
  const [milestones, setMilestones] = useState<AgencyClientMilestone[] | null>(null);
  const [reports, setReports] = useState<{ weekly: AgencyDocument | null; monthly: AgencyDocument | null }>({
    weekly: null,
    monthly: null,
  });
  const [viewerDoc, setViewerDoc] = useState<AgencyDocument | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    agencyListMilestones(client.id).then(setMilestones).catch(() => setMilestones([]));
  }, [client.id]);

  useEffect(() => {
    Promise.all([
      agencyListDocuments(client.id, 'agency_weekly_report'),
      agencyListDocuments(client.id, 'monthly_report'),
    ]).then(([w, m]) => {
      setReports({ weekly: w[0] ?? null, monthly: m[0] ?? null });
    });
  }, [client.id]);

  const byKind = useMemo(() => {
    const m = new Map<string, AgencyClientMilestone>();
    for (const ms of milestones ?? []) m.set(ms.kind, ms);
    return m;
  }, [milestones]);

  const upsertMilestone = (next: AgencyClientMilestone) => {
    setMilestones((prev) =>
      (prev ?? []).map((m) => (m.kind === next.kind ? next : m)),
    );
  };

  const generateDoc = async (kind: string) => {
    setGenError(null);
    try {
      const doc = await agencyGenerateDocument(client.id, kind);
      setViewerDoc(doc);
      if (kind === 'agency_weekly_report') setReports((r) => ({ ...r, weekly: doc }));
      if (kind === 'monthly_report') setReports((r) => ({ ...r, monthly: doc }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate document');
    }
  };

  if (milestones == null) {
    return <div className="text-sm text-[var(--text-muted)]">Loading playbook…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Launch */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Launch
        </h2>
        <div className="space-y-2">
          {(['kickoff', 'sow', 'initial_audit', 'strategy_locked'] as const).map((k) => {
            const m = byKind.get(k);
            if (!m) return null;
            const cfg = LAUNCH_LABELS[k];
            return (
              <PlaybookLaunchRow
                key={k}
                milestone={m}
                label={cfg.label}
                docKind={cfg.docKind}
                secondaryHref={cfg.secondary?.href}
                secondaryLabel={cfg.secondary?.label}
                onChanged={upsertMilestone}
                onGenerateDoc={generateDoc}
              />
            );
          })}
        </div>
      </section>

      {/* Engagements */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Engagements
        </h2>
        <div className="space-y-3">
          <PlaybookWeeklyExecution
            clientId={client.id}
            brandId={client.brand_id}
            drafts={drafts}
            latestRunIso={latestRunIso}
            reviewLinkUrl={reviewLinkUrl}
            primaryContactName={client.primary_contact_name}
            onDraftsChanged={onDraftsChanged}
            onTrackingTriggered={onTrackingTriggered}
            onOpenSendModal={onOpenSendModal}
          />

          {byKind.get('wikipedia_plan') && (
            <PlaybookEngagement
              milestone={byKind.get('wikipedia_plan')!}
              label="Wikipedia plan"
              docKind="wikipedia_plan"
              deepLinkHref={client.brand_id ? `/wiki/${client.brand_id}` : '#'}
              deepLinkLabel="Open Wikipedia surface"
              onChanged={upsertMilestone}
              onGenerateDoc={generateDoc}
            />
          )}

          {byKind.get('site_plan') && (
            <PlaybookEngagement
              milestone={byKind.get('site_plan')!}
              label="Site plan"
              docKind="site_plan"
              deepLinkHref={client.brand_id ? `/site-audit/${client.brand_id}` : '#'}
              deepLinkLabel="Open Site Audit"
              onChanged={upsertMilestone}
              onGenerateDoc={generateDoc}
            />
          )}

          <PlaybookReports
            clientId={client.id}
            lastWeekly={reports.weekly}
            lastMonthly={reports.monthly}
            onGenerated={(doc) => {
              setViewerDoc(doc);
              if (doc.kind === 'agency_weekly_report') setReports((r) => ({ ...r, weekly: doc }));
              if (doc.kind === 'monthly_report') setReports((r) => ({ ...r, monthly: doc }));
            }}
          />
        </div>
      </section>

      {genError && <p className="text-sm text-rose-400">{genError}</p>}

      <DocumentViewer
        doc={viewerDoc}
        onClose={() => setViewerDoc(null)}
        onChange={(next) => setViewerDoc(next)}
        onDelete={(_id) => setViewerDoc(null)}
      />
    </div>
  );
}
