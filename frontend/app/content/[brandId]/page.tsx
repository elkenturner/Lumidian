'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Settings2,
  TrendingUp,
  Loader2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
} from 'lucide-react';
import {
  getBrand,
  getDrafts,
  generateDraft,
  updateDraft,
  postDraft,
  deleteDraft,
  getContentSettings,
  updateContentSettings,
  getAttribution,
  BrandDetail,
  ContentDraft,
  BrandContentSettings,
  ContentAttribution,
  Prompt,
} from '@/lib/api';
import ContentDraftCard from '@/components/ContentDraftCard';
import PlatformBadge from '@/components/PlatformBadge';
import AttributionBadge from '@/components/AttributionBadge';

const PLATFORMS = ['reddit', 'quora', 'medium', 'wikipedia'] as const;
type Platform = (typeof PLATFORMS)[number];

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'every_3_days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'manual', label: 'Manual only' },
];

export default function BrandContentPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = Number(params.brandId);

  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [settings, setSettings] = useState<BrandContentSettings[]>([]);
  const [attribution, setAttribution] = useState<ContentAttribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Platform | 'all'>('all');
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [editingDraft, setEditingDraft] = useState<ContentDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, d, s, a] = await Promise.all([
        getBrand(brandId),
        getDrafts(brandId),
        getContentSettings(brandId),
        getAttribution(brandId),
      ]);
      setBrand(b);
      setDrafts(d);
      setSettings(s);
      setAttribution(a);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const getSettings = (platform: string): BrandContentSettings | undefined =>
    settings.find((s) => s.platform === platform);

  async function toggleAutoPost(platform: string) {
    const current = getSettings(platform);
    const newVal = current ? !current.auto_post : true;
    try {
      const updated = await updateContentSettings(brandId, platform, { auto_post: newVal });
      setSettings((prev) =>
        prev.map((s) => (s.platform === platform ? updated : s))
      );
    } catch {/* ignore */}
  }

  async function updateFrequency(platform: string, frequency: string) {
    try {
      const updated = await updateContentSettings(brandId, platform, {
        drafting_frequency: frequency as BrandContentSettings['drafting_frequency'],
      });
      setSettings((prev) =>
        prev.map((s) => (s.platform === platform ? updated : s))
      );
    } catch {/* ignore */}
  }

  async function handleApprove(id: number) {
    try {
      const updated = await updateDraft(id, { status: 'approved' });
      setDrafts((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch {/* ignore */}
  }

  async function handlePost(id: number) {
    try {
      const updated = await postDraft(id, {});
      setDrafts((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch {/* ignore */}
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this draft?')) return;
    try {
      await deleteDraft(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch {/* ignore */}
  }

  async function handleSaveEdit(id: number, text: string, title: string) {
    try {
      const updated = await updateDraft(id, { content_text: text, title });
      setDrafts((prev) => prev.map((d) => (d.id === id ? updated : d)));
      setEditingDraft(null);
    } catch {/* ignore */}
  }

  const filteredDrafts =
    activeTab === 'all' ? drafts : drafts.filter((d) => d.platform === activeTab);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-[#6366f1]" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="p-8 text-center text-[#94a3b8]">
        Brand not found.{' '}
        <Link href="/tracker" className="text-[#6366f1] underline">
          Back to Tracker
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/content"
            className="p-2 rounded-lg hover:bg-[#1a1a24] text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#e2e8f0]">{brand.name}</h1>
            <p className="text-sm text-[#64748b] mt-0.5">Content Management</p>
          </div>
        </div>
        <button
          onClick={() => setShowGenerateModal(true)}
          className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Generate Draft
        </button>
      </div>

      {/* Platform Settings */}
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <Settings2 className="w-4 h-4 text-[#6366f1]" />
          <h2 className="text-base font-semibold text-[#e2e8f0]">Platform Settings</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLATFORMS.map((platform) => {
            const s = getSettings(platform);
            const autoPost = s?.auto_post ?? false;
            const frequency = s?.drafting_frequency ?? 'weekly';
            return (
              <div key={platform} className="bg-[#1a1a24] border border-[#1e1e2e] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <PlatformBadge platform={platform} />
                </div>

                {/* Frequency */}
                <div className="mb-3">
                  <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1 block">
                    Frequency
                  </label>
                  <div className="relative">
                    <select
                      value={frequency}
                      onChange={(e) => updateFrequency(platform, e.target.value)}
                      className="w-full appearance-none bg-[#0d0d14] border border-[#1e1e2e] text-[#e2e8f0] text-xs rounded px-2 py-1.5 pr-6 focus:outline-none focus:border-[#6366f1]"
                    >
                      {FREQUENCY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#64748b] pointer-events-none" />
                  </div>
                </div>

                {/* Auto-post toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#94a3b8]">Auto-post</span>
                  <button
                    onClick={() => toggleAutoPost(platform)}
                    className={`flex items-center gap-1 text-xs transition-colors ${
                      autoPost ? 'text-[#6366f1]' : 'text-[#64748b]'
                    }`}
                  >
                    {autoPost ? (
                      <ToggleRight className="w-5 h-5" />
                    ) : (
                      <ToggleLeft className="w-5 h-5" />
                    )}
                    {autoPost ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[#64748b] mt-4">
          Auto-post is <span className="text-[#f59e0b]">OFF</span> by default. Enable only after
          reviewing content and connecting your accounts in{' '}
          <Link href="/settings/accounts" className="text-[#6366f1] underline">
            Connected Accounts
          </Link>
          .
        </p>
      </div>

      {/* Drafts */}
      <div>
        {/* Platform tabs */}
        <div className="flex items-center gap-1 mb-5 border-b border-[#1e1e2e]">
          {(['all', ...PLATFORMS] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'text-[#6366f1] border-[#6366f1]'
                  : 'text-[#64748b] border-transparent hover:text-[#94a3b8]'
              }`}
            >
              {tab === 'all' ? 'All Drafts' : tab}
              {tab !== 'all' && (
                <span className="ml-1.5 text-xs bg-[#1a1a24] text-[#64748b] rounded-full px-1.5 py-0.5">
                  {drafts.filter((d) => d.platform === tab).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {filteredDrafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 bg-[#1a1a24] rounded-xl flex items-center justify-center mb-4">
              <Plus className="w-6 h-6 text-[#64748b]" />
            </div>
            <p className="text-[#94a3b8] font-medium mb-1">No drafts yet</p>
            <p className="text-sm text-[#64748b] mb-4">
              Generate content targeting your lowest-visibility prompts
            </p>
            <button
              onClick={() => setShowGenerateModal(true)}
              className="bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              Generate First Draft
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredDrafts.map((draft) => (
              <ContentDraftCard
                key={draft.id}
                draft={draft}
                onEdit={setEditingDraft}
                onApprove={handleApprove}
                onPost={handlePost}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Attribution */}
      {attribution.length > 0 && (
        <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-[#22c55e]" />
            <h2 className="text-base font-semibold text-[#e2e8f0]">Content Attribution</h2>
            <span className="text-xs text-[#64748b]">
              — how your posted content has affected visibility scores
            </span>
          </div>
          <div className="space-y-3">
            {attribution.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between bg-[#1a1a24] border border-[#1e1e2e] rounded-lg px-4 py-3"
              >
                <div>
                  <p className="text-sm text-[#e2e8f0]">
                    <span className="font-medium capitalize">{a.platform}</span> post targeting:{' '}
                    <span className="text-[#94a3b8] italic">
                      "{a.prompt_text ?? `Prompt #${a.prompt_id}`}"
                    </span>
                  </p>
                  <p className="text-xs text-[#64748b] mt-0.5">
                    Before: {a.visibility_before?.toFixed(1) ?? '—'}% → After:{' '}
                    {a.visibility_after?.toFixed(1) ?? '—'}%
                  </p>
                </div>
                <AttributionBadge attribution={a} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate modal */}
      {showGenerateModal && (
        <GenerateModal
          brand={brand}
          onClose={() => setShowGenerateModal(false)}
          onGenerated={(draft) => {
            setDrafts((prev) => [draft, ...prev]);
            setShowGenerateModal(false);
          }}
        />
      )}

      {/* Edit modal */}
      {editingDraft && (
        <EditModal
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={handleSaveEdit}
        />
      )}
    </div>
  );
}

// ── Generate Modal ──────────────────────────────────────────────────────────

function GenerateModal({
  brand,
  onClose,
  onGenerated,
}: {
  brand: BrandDetail;
  onClose: () => void;
  onGenerated: (d: ContentDraft) => void;
}) {
  const [platform, setPlatform] = useState('reddit');
  const [promptId, setPromptId] = useState<number | 'auto'>('auto');
  const [customBrief, setCustomBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const draft = await generateDraft(brand.id, {
        platform,
        prompt_id: promptId === 'auto' ? undefined : promptId,
        custom_brief: customBrief || undefined,
      });
      onGenerated(draft);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-[#e2e8f0] mb-5">Generate Draft</h2>

        {/* Platform */}
        <label className="block text-xs text-[#64748b] uppercase tracking-wide mb-1">Platform</label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${
                platform === p
                  ? 'border-[#6366f1] bg-[#6366f1]/10 text-[#6366f1]'
                  : 'border-[#1e1e2e] text-[#64748b] hover:border-[#6366f1]/50 hover:text-[#94a3b8]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Target prompt */}
        <label className="block text-xs text-[#64748b] uppercase tracking-wide mb-1">
          Target Prompt
        </label>
        <select
          value={promptId}
          onChange={(e) =>
            setPromptId(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
          }
          className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2 mb-4 focus:outline-none focus:border-[#6366f1]"
        >
          <option value="auto">Auto-select (lowest visibility)</option>
          {brand.prompts.map((p: Prompt) => (
            <option key={p.id} value={p.id}>
              {p.text.slice(0, 60)}
            </option>
          ))}
        </select>

        {/* Custom brief */}
        <label className="block text-xs text-[#64748b] uppercase tracking-wide mb-1">
          Additional Brief{' '}
          <span className="normal-case text-[#64748b]">(optional)</span>
        </label>
        <textarea
          value={customBrief}
          onChange={(e) => setCustomBrief(e.target.value)}
          placeholder="Any specific angle, tone, or talking points..."
          rows={3}
          className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2 mb-5 focus:outline-none focus:border-[#6366f1] resize-none placeholder-[#64748b]"
        />

        {error && (
          <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2 mb-4">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#e2e8f0] text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {generating && <Loader2 className="w-4 h-4 animate-spin" />}
            {generating ? 'Generating…' : 'Generate with AI'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: ContentDraft;
  onClose: () => void;
  onSaved: (id: number, text: string, title: string) => void;
}) {
  const [title, setTitle] = useState(draft.title ?? '');
  const [text, setText] = useState(draft.content_text);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSaved(draft.id, text, title);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl w-full max-w-2xl p-6 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#e2e8f0]">Edit Draft</h2>
          <PlatformBadge platform={draft.platform} />
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-[#6366f1]"
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] text-sm rounded-lg px-3 py-2 mb-4 focus:outline-none focus:border-[#6366f1] resize-none font-mono min-h-[300px]"
        />

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#e2e8f0] text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
