'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  agencyListDocuments,
  agencyListMilestones,
  agencyRenderDocument,
  MissingFieldsError,
  parseApiError,
  type AgencyClient,
  type AgencyClientMilestone,
  type AgencyDocument,
  type ContentDraft,
} from '@/lib/api';
import { DocumentViewer } from './DocumentViewer';
import { MissingBrandFieldsCard } from './MissingBrandFieldsCard';
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
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);

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
    if (busyKind) return;
    setGenError(null);
    setMissing(null);
    setBusyKind(kind);
    try {
      const { blob, filename } = await agencyRenderDocument(client.id, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof MissingFieldsError) {
        setMissing(e.missingFields);
      } else {
        setGenError(parseApiError(e, 'Failed to generate document'));
      }
    } finally {
      setBusyKind(null);
    }
  };

  if (milestones == null) {
    return <div className="text-sm text-[var(--text-muted)]">Loading playbook…</div>;
  }

  return (
    <div className="space-y-6">
      {genError && (
        <div
          role="alert"
          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          <span className="font-medium">Couldn't generate document.</span> {genError}
        </div>
      )}
      {missing && (
        <MissingBrandFieldsCard
          brandId={client.brand_id}
          missingFields={missing}
          onDismiss={() => setMissing(null)}
        />
      )}
      {busyKind && (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-muted)]">
          Generating <span className="text-[var(--text-secondary)]">{busyKind.replace(/_/g, ' ')}</span>… this typically takes 20–60s.
        </div>
      )}

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
                generating={cfg.docKind != null && busyKind === cfg.docKind}
                disabled={busyKind != null && busyKind !== cfg.docKind}
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
              generating={busyKind === 'wikipedia_plan'}
              disabled={busyKind != null && busyKind !== 'wikipedia_plan'}
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
              generating={busyKind === 'site_plan'}
              disabled={busyKind != null && busyKind !== 'site_plan'}
            />
          )}

          <PlaybookReports
            clientId={client.id}
            brandId={client.brand_id}
            lastWeekly={reports.weekly}
            lastMonthly={reports.monthly}
            onGenerated={(doc) => {
              if (doc.kind === 'agency_weekly_report') setReports((r) => ({ ...r, weekly: doc }));
              if (doc.kind === 'monthly_report') setReports((r) => ({ ...r, monthly: doc }));
            }}
          />
        </div>
      </section>

      <DocumentViewer
        doc={viewerDoc}
        onClose={() => setViewerDoc(null)}
        onChange={(next) => setViewerDoc(next)}
        onDelete={(_id) => setViewerDoc(null)}
      />
    </div>
  );
}
