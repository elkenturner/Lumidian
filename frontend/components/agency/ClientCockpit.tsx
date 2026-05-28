'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown,
  Mail,
  User,
  Video as VideoIcon,
} from 'lucide-react';
import {
  agencyUpdateClient,
  getDrafts,
  getRecentRuns,
  type AgencyClient,
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
import { ClientStaffPanel } from './ClientStaffPanel';
import { LumidianTrackingWidget } from './LumidianTrackingWidget';
import { PromptScoresPanel } from './PromptScoresPanel';
import { RunTrackingButton } from './RunTrackingButton';
import { AuditSummaryCard } from './AuditSummaryCard';
import { CopyReviewLinkButton } from './CopyReviewLinkButton';
import { SendDraftsToClientModal } from './SendDraftsToClientModal';
import { PlaybookTab } from './PlaybookTab';

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

const TABS = ['playbook', 'tracking', 'audit', 'brand'] as const;
const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  pipeline: 'playbook',
  documents: 'brand',
};
type TabKey = (typeof TABS)[number];

type AgencyDraft = Omit<ContentDraft, 'status'> & {
  status: string;
  client_feedback?: string | null;
  updated_at?: string | null;
};

export function ClientCockpit({ client, onChange, reviewLinkUrl }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab') ?? '';
  const initialTab: TabKey =
    (TABS as readonly string[]).includes(tabFromUrl)
      ? (tabFromUrl as TabKey)
      : ((LEGACY_TAB_REDIRECTS[tabFromUrl] as TabKey | undefined) ?? 'playbook');
  const [tab, setTab] = useState<TabKey>(initialTab);

  const [saving, setSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<AgencyDraft[] | null>(null);
  const [latestRunIso, setLatestRunIso] = useState<string | null>(null);
  const [trackingRefreshKey, setTrackingRefreshKey] = useState(0);
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0);

  const [sendDraftsOpen, setSendDraftsOpen] = useState(false);

  useEffect(() => {
    if (client.brand_id == null) {
      setDrafts([]);
      return;
    }
    getDrafts(client.brand_id)
      .then((data) => setDrafts(data as AgencyDraft[]))
      .catch(() => setDrafts([]));
  }, [client.brand_id, draftsRefreshKey]);

  useEffect(() => {
    if (client.brand_id == null) {
      setLatestRunIso(null);
      return;
    }
    getRecentRuns(client.brand_id)
      .then((runs: TrackingRun[]) => {
        const completed = runs
          .filter((r) => r.completed_at)
          .sort((a, b) => new Date(b.completed_at as string).getTime() - new Date(a.completed_at as string).getTime());
        setLatestRunIso(completed[0]?.completed_at ?? null);
      })
      .catch(() => setLatestRunIso(null));
  }, [client.brand_id, trackingRefreshKey]);

  useEffect(() => {
    if (tabFromUrl && !(TABS as readonly string[]).includes(tabFromUrl)) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', initialTab);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [tabFromUrl, initialTab, router, searchParams]);

  const handleTabChange = (next: string) => {
    setTab(next as TabKey);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

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

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <Link href="/agency/clients" className="text-xs text-[var(--text-muted)] hover:underline">
        ← All clients
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-[var(--text-muted)]">/{client.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
                <DropdownMenuItem key={s} onSelect={() => updateStatus(s)} disabled={s === client.status}>
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {client.retainer_amount_usd != null && (
            <span className="rounded-full bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
              ${client.retainer_amount_usd}/mo
            </span>
          )}

          {(client.primary_contact_name || client.primary_contact_email) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
                    onSelect={() => { window.location.href = `mailto:${client.primary_contact_email}`; }}
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
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
          >
            <VideoIcon className="h-3 w-3" />
            Video studio
          </Link>

          <CopyReviewLinkButton clientId={client.id} />
        </div>
      </div>

      {statusError && <p className="mt-3 text-sm text-red-400">{statusError}</p>}

      <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value="playbook">Playbook</TabsTrigger>
          <TabsTrigger value="tracking">Tracking</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="brand">Brand</TabsTrigger>
        </TabsList>

        <TabsContent value="playbook" className="mt-6">
          <PlaybookTab
            client={client}
            drafts={drafts}
            latestRunIso={latestRunIso}
            reviewLinkUrl={reviewLinkUrl}
            onDraftsChanged={() => setDraftsRefreshKey((k) => k + 1)}
            onTrackingTriggered={() => setTrackingRefreshKey((k) => k + 1)}
            onOpenSendModal={() => setSendDraftsOpen(true)}
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
          <ClientBrandTab brandId={client.brand_id} client={client} clientId={client.id} />
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
