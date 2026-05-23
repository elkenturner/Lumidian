'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown,
  FileText,
  Loader2,
  Mail,
  Send,
  User,
  Video as VideoIcon,
} from 'lucide-react';
import {
  agencyGenerateWeeklyReport,
  agencyUpdateClient,
  getDrafts,
  getRecentRuns,
  type AgencyClient,
  type AgencyDocument,
  type ContentDraft,
  type TrackingRun,
} from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ClientBrandTab } from './ClientBrandTab';
import { ClientPipelineTab } from './ClientPipelineTab';
import { ClientStaffPanel } from './ClientStaffPanel';
import { DocumentList } from './DocumentList';
import { GenerateDraftButton } from './GenerateDraftButton';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { PromptScoresPanel } from './PromptScoresPanel';
import { RunTrackingButton } from './RunTrackingButton';
import { AuditSummaryCard } from './AuditSummaryCard';
import { CopyReviewLinkButton } from './CopyReviewLinkButton';
import { SendDraftsToClientModal } from './SendDraftsToClientModal';
import {
  ClientNextStepShelf,
  computeNextStep,
  type NextStepAction,
  type NextStepDraftCounts,
} from './ClientNextStepShelf';
import { isDraftStale, nudgeMessageText } from './agency-helpers';

interface Props {
  client: AgencyClient;
  onChange: (next: AgencyClient) => void;
  reviewLinkUrl: string | null;
}

const STATUSES: AgencyClient['status'][] = ['onboarding', 'active', 'paused', 'churned'];

const STATUS_COLORS: Record<AgencyClient['status'], string> = {
  onboarding: 'bg-amber-500/20 text-amber-300',
  active: 'bg-emerald-500/20 text-emerald-300',
  paused: 'bg-slate-500/20 text-slate-300',
  churned: 'bg-rose-500/20 text-rose-300',
};

const TABS = ['pipeline', 'tracking', 'audit', 'brand', 'documents'] as const;
type TabKey = (typeof TABS)[number];

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

export function ClientCockpit({ client, onChange, reviewLinkUrl }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const initialTab: TabKey = (TABS as readonly string[]).includes(tabFromUrl ?? '')
    ? (tabFromUrl as TabKey)
    : 'pipeline';
  const [tab, setTab] = useState<TabKey>(initialTab);

  const [saving, setSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<AgencyDraft[] | null>(null);
  const [latestRunIso, setLatestRunIso] = useState<string | null>(null);
  const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);

  const [sendDraftsOpen, setSendDraftsOpen] = useState(false);
  const [justGeneratedDoc, setJustGeneratedDoc] = useState<AgencyDocument | null>(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  // Fetch drafts (for shelf + Pipeline tab).
  useEffect(() => {
    if (client.brand_id == null) {
      setDrafts([]);
      return;
    }
    getDrafts(client.brand_id)
      .then((data) => setDrafts(data as AgencyDraft[]))
      .catch(() => setDrafts([]));
  }, [client.brand_id, draftsRefreshKey]);

  // Fetch latest tracking run timestamp (for shelf).
  useEffect(() => {
    if (client.brand_id == null) {
      setLatestRunIso(null);
      return;
    }
    getRecentRuns(client.brand_id)
      .then((runs: TrackingRun[]) => {
        const completed = runs.filter((r) => r.completed_at).sort((a, b) => {
          return new Date(b.completed_at as string).getTime() - new Date(a.completed_at as string).getTime();
        });
        setLatestRunIso(completed[0]?.completed_at ?? null);
      })
      .catch(() => setLatestRunIso(null));
  }, [client.brand_id, trackingRefreshKey]);

  // Sync tab selection to URL (?tab=pipeline).
  const handleTabChange = (next: string) => {
    setTab(next as TabKey);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const counts: NextStepDraftCounts = useMemo(() => {
    if (!drafts) return { toReview: 0, approved: 0, staleWithClient: 0, inFlight: 0 };
    let toReview = 0;
    let approved = 0;
    let staleWithClient = 0;
    let inFlight = 0;
    for (const d of drafts) {
      if (d.status === 'draft' || d.status === 'changes_requested') toReview++;
      if (d.status === 'approved') approved++;
      if (d.status === 'awaiting_client' && isDraftStale(d)) staleWithClient++;
      if (
        d.status === 'draft' ||
        d.status === 'changes_requested' ||
        d.status === 'awaiting_client' ||
        d.status === 'approved'
      ) {
        inFlight++;
      }
    }
    return { toReview, approved, staleWithClient, inFlight };
  }, [drafts]);

  const action = useMemo(
    () => computeNextStep(counts, latestRunIso),
    [counts, latestRunIso],
  );

  const updateStatus = async (status: AgencyClient['status']) => {
    setSaving(true);
    setStatusError(null);
    try {
      const next = await agencyUpdateClient(client.id, { status });
      onChange(next);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  const onGenerateWeekly = async () => {
    setDocsBusy(true);
    setDocsError(null);
    try {
      const doc = await agencyGenerateWeeklyReport(client.id);
      setJustGeneratedDoc(doc);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : 'Failed to generate report');
    } finally {
      setDocsBusy(false);
    }
  };

  const handleNextStep = (a: NextStepAction) => {
    switch (a.kind) {
      case 'review_drafts':
      case 'mark_posted':
        handleTabChange('pipeline');
        return;
      case 'send_to_client':
        setSendDraftsOpen(true);
        return;
      case 'nudge_client': {
        const msg = nudgeMessageText(client.primary_contact_name ?? null, reviewLinkUrl ?? '');
        navigator.clipboard.writeText(msg).catch(() => {});
        return;
      }
      case 'run_tracking':
        handleTabChange('tracking');
        return;
      case 'generate_drafts':
        handleTabChange('pipeline');
        return;
      case 'all_caught_up':
        return;
    }
  };

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>

      {/* Header row */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-[var(--text-muted)]">/{client.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status chip */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={saving}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[client.status]} hover:opacity-90 disabled:opacity-50`}
              >
                {client.status}
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => updateStatus(s)}
                  disabled={s === client.status}
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Retainer chip */}
          {client.retainer_amount_usd != null && (
            <span className="rounded-full bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              ${client.retainer_amount_usd}/mo
            </span>
          )}

          {/* Contact popover */}
          {(client.primary_contact_name || client.primary_contact_email) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  title="Contact"
                >
                  <User className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Primary contact</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {client.primary_contact_name && (
                  <DropdownMenuItem disabled className="flex gap-2 opacity-100">
                    <User className="h-3.5 w-3.5" />
                    {client.primary_contact_name}
                  </DropdownMenuItem>
                )}
                {client.primary_contact_email && (
                  <DropdownMenuItem
                    onSelect={() => {
                      window.location.href = `mailto:${client.primary_contact_email}`;
                    }}
                    className="flex gap-2"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {client.primary_contact_email}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Link
            href={`/agency/clients/${client.id}/video`}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <VideoIcon className="h-3 w-3" />
            Video studio
          </Link>

          <CopyReviewLinkButton clientId={client.id} />
        </div>
      </div>

      {statusError && <p className="mt-3 text-sm text-red-400">{statusError}</p>}

      {/* Next-step shelf */}
      {drafts != null && (
        <div className="mt-6">
          <ClientNextStepShelf
            action={action}
            clientName={client.name}
            onAction={handleNextStep}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="brand">Brand</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setSendDraftsOpen(true)}
              disabled={counts.approved === 0}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40"
              title={counts.approved === 0 ? 'No approved drafts to send' : 'Send approved drafts to client review'}
            >
              <Send className="h-3 w-3" />
              Send drafts to client review
            </button>
            <GenerateDraftButton
              clientId={client.id}
              brandId={client.brand_id}
              onGenerated={() => setDraftsRefreshKey((k) => k + 1)}
            />
          </div>
          <ClientPipelineTab
            brandId={client.brand_id}
            reviewLinkUrl={reviewLinkUrl}
            primaryContactName={client.primary_contact_name}
            lifted={drafts}
            onDraftsChanged={() => setDraftsRefreshKey((k) => k + 1)}
          />
        </TabsContent>

        <TabsContent value="tracking" className="mt-6">
          <div className="mb-4 flex items-center justify-end">
            <RunTrackingButton
              clientId={client.id}
              onTriggered={() => setTrackingRefreshKey((k) => k + 1)}
            />
          </div>
          <LumidianTrackingWidget key={trackingRefreshKey} brandId={client.brand_id} />
          <div className="mt-4">
            <PromptScoresPanel brandId={client.brand_id} />
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <AuditSummaryCard clientId={client.id} brandId={client.brand_id} />
        </TabsContent>

        <TabsContent value="brand" className="mt-6">
          <div className="mb-4">
            <ClientStaffPanel clientId={client.id} />
          </div>
          <ClientBrandTab brandId={client.brand_id} client={client} />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
            {docsError && <span className="text-xs text-red-400">{docsError}</span>}
            <button
              onClick={onGenerateWeekly}
              disabled={docsBusy}
              className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
            >
              {docsBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {docsBusy ? 'Generating…' : 'Generate weekly report'}
            </button>
          </div>
          <DocumentList clientId={client.id} injectDoc={justGeneratedDoc} />
        </TabsContent>
      </Tabs>

      <SendDraftsToClientModal
        open={sendDraftsOpen}
        onOpenChange={setSendDraftsOpen}
        clientId={client.id}
        clientName={client.name}
        brandId={client.brand_id}
        primaryContactName={client.primary_contact_name}
        primaryContactEmail={client.primary_contact_email ?? null}
        onSent={() => setDraftsRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
