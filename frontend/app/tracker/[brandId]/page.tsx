'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect to unified Settings page — brand settings are now managed there
export default function BrandSettingsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/settings'); }, [router]);
  return null;
}

// Keep original code below (unused — preserved for reference)
import Link from 'next/link';
import {
  ArrowLeft,
  Trash2,
  Plus,
  Save,
  ChevronRight,
  AlertTriangle,
  Play,
  Loader2,
  CheckCircle,
  Building2,
  MessageSquare,
  Users,
  Shield,
  BarChart2,
  X,
  BookOpen,
  ToggleLeft,
  ToggleRight,
  Radio,
  Sparkles,
} from 'lucide-react';
import {
  getBrand,
  updateBrand,
  deleteBrand,
  addPrompt,
  deletePrompt,
  triggerRun,
  getCompetitors,
  addCompetitor,
  removeCompetitor,
  getBrandProfile,
  updateBrandProfile,
  refreshWebsiteContext,
  normaliseWebsiteUrl,
  getContentSettings,
  updateContentSettings,
  getSuggestedPrompts,
  BrandDetail,
  Prompt,
  Competitor,
  BrandProfile,
  BrandContentSettings,
  Publication,
} from '@/lib/api';
import clsx from 'clsx';

type Tab = 'general' | 'profile';

const TIER_OPTIONS = [
  { value: 'basic', label: 'Basic', runs: '5x per report' },
  { value: 'standard', label: 'Standard', runs: '10x per report' },
  { value: 'premium', label: 'Premium', runs: '20x per report' },
];

// ── Editable list ─────────────────────────────────────────────────────────────

function EditableList({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addItem = () => {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setInputVal('');
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[36px]">
        {items.map((item, idx) => (
          <span
            key={idx}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#6366f1]/10 border border-[#6366f1]/30 rounded-full text-sm text-[#818cf8]"
          >
            {item}
            <button
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="text-[#6366f1]/60 hover:text-[#818cf8] transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
        />
        <button
          onClick={addItem}
          className="px-3 py-2 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg text-[#64748b] hover:text-[#818cf8] hover:border-[#6366f1]/40 transition-all"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Completion bar ────────────────────────────────────────────────────────────

function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#6366f1';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-[#1e1e2e] rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-sm font-semibold" style={{ color }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

// ── Profile section card ──────────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[#1a1a24] border border-[#2a2a3a] flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={15} className="text-[#6366f1]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#e2e8f0]">{title}</h3>
          <p className="text-xs text-[#64748b] mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Publications editor ───────────────────────────────────────────────────────

function PublicationsEditor({
  items,
  onChange,
}: {
  items: Publication[];
  onChange: (pubs: Publication[]) => void;
}) {
  function update(idx: number, field: keyof Publication, value: string) {
    const next = items.map((p, i) => (i === idx ? { ...p, [field]: value } : p));
    onChange(next);
  }

  function add() {
    onChange([...items, { url: '', title: '', publisher: '', date: '' }]);
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      {items.map((pub, idx) => (
        <div key={idx} className="bg-[#0d0d14] border border-[#1e1e2e] rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[#64748b] font-medium">Publication {idx + 1}</span>
            <button onClick={() => remove(idx)} className="text-[#475569] hover:text-[#f87171] transition-colors">
              <X size={13} />
            </button>
          </div>
          <input
            type="url"
            placeholder="DOI / URL (e.g. https://doi.org/10.1038/…)"
            value={pub.url}
            onChange={(e) => update(idx, 'url', e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-md text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
          <input
            type="text"
            placeholder="Title of the paper"
            value={pub.title}
            onChange={(e) => update(idx, 'title', e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-md text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Publisher / journal"
              value={pub.publisher}
              onChange={(e) => update(idx, 'publisher', e.target.value)}
              className="flex-1 px-2.5 py-1.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-md text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
            <input
              type="text"
              placeholder="Year"
              value={pub.date}
              onChange={(e) => update(idx, 'date', e.target.value)}
              className="w-20 px-2.5 py-1.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-md text-xs text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs text-[#64748b] hover:text-[#818cf8] border border-dashed border-[#1e1e2e] hover:border-[#6366f1]/40 rounded-lg px-3 py-2 transition-colors w-full justify-center"
      >
        <Plus size={13} />
        Add publication
      </button>
      <p className="text-xs text-[#475569]">
        Used to populate Wikipedia citations. DOI links are preferred.
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BrandSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = Number(params.brandId);

  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // General tab state
  const [editName, setEditName] = useState('');
  const [editTier, setEditTier] = useState('basic');
  const [editWebsiteUrl, setEditWebsiteUrl] = useState('');
  const [refreshingContext, setRefreshingContext] = useState(false);
  const [contextRefreshed, setContextRefreshed] = useState(false);
  const [contextFailed, setContextFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [newPromptText, setNewPromptText] = useState('');
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [deletingPromptId, setDeletingPromptId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [running, setRunning] = useState(false);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [deletingCompetitorId, setDeletingCompetitorId] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Drafting settings state
  const [draftSettings, setDraftSettings] = useState<BrandContentSettings[]>([]);

  // Profile tab state
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [companyDescription, setCompanyDescription] = useState('');
  const [keyStats, setKeyStats] = useState<string[]>([]);
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [whatNotToSay, setWhatNotToSay] = useState<string[]>([]);
  const [targetAudience, setTargetAudience] = useState('');
  const [approvedLanguage, setApprovedLanguage] = useState<string[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [data, comps, prof, settings] = await Promise.all([
          getBrand(brandId),
          getCompetitors(brandId),
          getBrandProfile(brandId),
          getContentSettings(brandId),
        ]);
        setBrand(data);
        setEditName(data.name);
        setEditTier(data.tier);
        setEditWebsiteUrl(data.website_url ?? '');
        setCompetitors(comps);
        setProfile(prof);
        setDraftSettings(settings);
        setCompanyDescription(prof.company_description ?? '');
        setKeyStats(prof.key_stats ?? []);
        setToneOfVoice(prof.tone_of_voice ?? '');
        setWhatNotToSay(prof.what_not_to_say ?? []);
        setTargetAudience(prof.target_audience ?? '');
        setApprovedLanguage(prof.approved_language ?? []);
        setPublications(prof.publications ?? []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [brandId]);

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const updated = await updateBrand(brandId, { name: editName.trim(), tier: editTier, website_url: normaliseWebsiteUrl(editWebsiteUrl) });
      setBrand((prev) => prev ? { ...prev, ...updated } : null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshContext() {
    setRefreshingContext(true);
    setContextFailed(false);
    const prevFetched = profile?.website_context_last_fetched ?? null;
    try {
      await refreshWebsiteContext(brandId);
    } catch (err) {
      console.warn('[Settings] Jina refresh request failed:', err);
      setContextFailed(true);
      setRefreshingContext(false);
      return;
    }
    // Poll profile until website_context_last_fetched updates (max 45s)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const updated = await getBrandProfile(brandId);
        if (updated.website_context_last_fetched !== prevFetched) {
          clearInterval(poll);
          setProfile(updated);
          setContextRefreshed(true);
          setRefreshingContext(false);
          setTimeout(() => setContextRefreshed(false), 4000);
          return;
        }
      } catch { /* ignore poll errors */ }
      if (attempts >= 15) {
        clearInterval(poll);
        setContextFailed(true);
        setRefreshingContext(false);
      }
    }, 3000);
  }

  async function handleAddPrompt() {
    const trimmed = newPromptText.trim();
    if (!trimmed) return;
    setAddingPrompt(true);
    try {
      const prompt = await addPrompt(brandId, trimmed);
      setBrand((prev) => prev ? { ...prev, prompts: [...prev.prompts, prompt], prompt_count: prev.prompt_count + 1 } : null);
      setNewPromptText('');
    } finally {
      setAddingPrompt(false);
    }
  }

  async function handleDeletePrompt(promptId: number) {
    setDeletingPromptId(promptId);
    try {
      await deletePrompt(brandId, promptId);
      setBrand((prev) =>
        prev ? { ...prev, prompts: prev.prompts.filter((p: Prompt) => p.id !== promptId), prompt_count: prev.prompt_count - 1 } : null
      );
    } finally {
      setDeletingPromptId(null);
    }
  }

  async function handleSuggestPrompts() {
    if (!brand) return;
    setLoadingSuggestions(true);
    setShowSuggestions(true);
    try {
      const s = await getSuggestedPrompts(brand.id);
      setSuggestions(s);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function handleAddSuggestion(text: string) {
    setBrand((prev) => {
      if (!prev) return prev;
      return { ...prev, prompts: [...prev.prompts, { id: Date.now(), brand_id: prev.id, text }], prompt_count: prev.prompt_count + 1 };
    });
    setSuggestions((prev) => prev.filter((s) => s !== text));
    try {
      const newPrompt = await addPrompt(brand!.id, text);
      setBrand((prev) => {
        if (!prev) return prev;
        const filtered = prev.prompts.filter((p) => p.text !== text || p.id !== Date.now());
        return { ...prev, prompts: [...filtered, newPrompt] };
      });
    } catch { /* ignore */ }
  }

  async function handleRunReport() {
    setRunning(true);
    try {
      await triggerRun(brandId);
      router.push('/dashboard');
    } catch {
      setRunning(false);
    }
  }

  async function handleAddCompetitor() {
    const trimmed = newCompetitorName.trim();
    if (!trimmed) return;
    setAddingCompetitor(true);
    try {
      const comp = await addCompetitor(brandId, trimmed);
      setCompetitors((prev) => [...prev, comp]);
      setNewCompetitorName('');
    } finally {
      setAddingCompetitor(false);
    }
  }

  async function handleRemoveCompetitor(competitorId: number) {
    setDeletingCompetitorId(competitorId);
    try {
      await removeCompetitor(brandId, competitorId);
      setCompetitors((prev) => prev.filter((c) => c.id !== competitorId));
    } finally {
      setDeletingCompetitorId(null);
    }
  }

  async function handleDeleteBrand() {
    setDeleting(true);
    try {
      await deleteBrand(brandId);
      router.push('/dashboard');
    } catch {
      setDeleting(false);
    }
  }

  async function handleProfileSave() {
    setProfileSaving(true);
    try {
      const updated = await updateBrandProfile(brandId, {
        company_description: companyDescription,
        key_stats: keyStats,
        tone_of_voice: toneOfVoice,
        what_not_to_say: whatNotToSay,
        target_audience: targetAudience,
        approved_language: approvedLanguage,
        publications,
      });
      setProfile(updated);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleToggleDraftPlatform(platform: string, enabled: boolean) {
    const updated = await updateContentSettings(brandId, platform, { enabled });
    setDraftSettings((prev) =>
      prev.map((s) => (s.platform === platform ? { ...s, ...updated } : s))
    );
  }

  async function handleDraftFreqChange(platform: string, freq: string) {
    const updated = await updateContentSettings(brandId, platform, {
      drafting_frequency: freq as BrandContentSettings['drafting_frequency'],
    });
    setDraftSettings((prev) =>
      prev.map((s) => (s.platform === platform ? { ...s, ...updated } : s))
    );
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[#1a1a24] rounded w-48" />
          <div className="h-4 bg-[#1a1a24] rounded w-32" />
          <div className="h-48 bg-[#111118] border border-[#1e1e2e] rounded-xl" />
          <div className="h-48 bg-[#111118] border border-[#1e1e2e] rounded-xl" />
        </div>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="px-8 py-8 text-center text-[#64748b]">
        Brand not found.{' '}
        <Link href="/dashboard" className="text-[#818cf8] hover:underline">
          Go back
        </Link>
      </div>
    );
  }

  const completionPct = profile?.completion_pct ?? 0;

  return (
    <div className="px-8 py-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/dashboard"
          className="text-[#475569] hover:text-[#64748b] transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-2xl font-bold text-[#e2e8f0]">{brand.name}</h1>
        <span className="text-sm text-[#64748b] capitalize bg-[#1a1a24] border border-[#2a2a3a] px-2.5 py-1 rounded-full">
          {brand.tier}
        </span>
      </div>
      <p className="text-sm text-[#64748b] mb-6 ml-9">
        Brand settings, profile knowledge base, and tracking configuration
      </p>

      {/* Run Report Banner */}
      <div className="bg-[#1a1a24] border border-[#6366f1]/30 rounded-xl p-4 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[#e2e8f0]">Run a new report</p>
          <p className="text-xs text-[#818cf8] mt-0.5">
            Query all AI models with your prompts and get updated visibility scores
          </p>
        </div>
        <button
          onClick={handleRunReport}
          disabled={running}
          className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors flex-shrink-0 ml-4"
        >
          {running ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play size={14} />
              Run Report Now
            </>
          )}
        </button>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-[#1e1e2e] mb-6">
        {(['general', 'profile'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors',
              activeTab === tab
                ? 'text-[#818cf8] border-[#6366f1] bg-[#111118]'
                : 'text-[#64748b] border-transparent hover:text-[#94a3b8]'
            )}
          >
            {tab === 'general' ? 'General' : 'Brand Profile'}
          </button>
        ))}
      </div>

      {/* ── GENERAL TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          {/* Brand Settings */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
            <h2 className="text-base font-semibold text-[#e2e8f0] mb-5">Brand Settings</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#94a3b8] mb-2">
                  Brand Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#94a3b8] mb-2">
                  Company Website
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editWebsiteUrl}
                    onChange={(e) => setEditWebsiteUrl(e.target.value)}
                    placeholder="https://yourcompany.com"
                    className="flex-1 bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569]"
                  />
                  <button
                    onClick={handleRefreshContext}
                    disabled={refreshingContext || !editWebsiteUrl.trim()}
                    title="Fetch website content to improve draft quality"
                    className={`flex items-center gap-1.5 border disabled:opacity-50 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      contextFailed
                        ? 'bg-[#7f1d1d]/20 border-[#991b1b]/40 text-[#f87171]'
                        : 'bg-[#1a1a24] hover:bg-[#2a2a3a] border-[#2a2a3a] text-[#94a3b8]'
                    }`}
                  >
                    {refreshingContext ? (
                      <><Loader2 size={13} className="animate-spin" />Fetching…</>
                    ) : contextRefreshed ? (
                      '✓ Content fetched'
                    ) : contextFailed ? (
                      '✕ Fetch failed — retry'
                    ) : (
                      'Fetch Content'
                    )}
                  </button>
                </div>
                {/* Persistent last-fetched status */}
                {profile?.website_context_last_fetched ? (
                  <p className="text-xs text-[#475569] mt-1">
                    Last fetched:{' '}
                    <span className="text-[#64748b]">
                      {new Date(profile.website_context_last_fetched + 'Z').toLocaleString()}
                    </span>
                    {' · '}
                    <span className="text-[#334155]">Refreshed monthly automatically</span>
                  </p>
                ) : (
                  <p className="text-xs text-[#475569] mt-1">
                    {contextFailed
                      ? 'Fetch failed. Check the URL is publicly accessible and try again.'
                      : 'No content fetched yet. Click "Fetch Content" to import your website.'}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#94a3b8] mb-2">
                  Plan Tier
                </label>
                <div className="flex gap-2">
                  {TIER_OPTIONS.map((tier) => (
                    <button
                      key={tier.value}
                      onClick={() => setEditTier(tier.value)}
                      className={clsx(
                        'flex-1 border rounded-lg py-2.5 px-3 text-sm font-medium transition-all',
                        editTier === tier.value
                          ? 'border-[#6366f1] bg-[#6366f1]/10 text-[#818cf8]'
                          : 'border-[#1e1e2e] bg-[#1a1a24] text-[#64748b] hover:border-[#2a2a3a]'
                      )}
                    >
                      <span className="block">{tier.label}</span>
                      <span className="text-xs opacity-70">{tier.runs}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-5 pt-5 border-t border-[#1e1e2e]">
              <button
                onClick={handleSave}
                disabled={saving || saveSuccess}
                className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : saveSuccess ? (
                  '✓ Saved'
                ) : (
                  <>
                    <Save size={14} />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Tracking Prompts */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold text-[#e2e8f0]">Tracking Prompts</h2>
                <p className="text-xs text-[#64748b] mt-0.5">
                  {brand.prompts.length} prompt{brand.prompts.length !== 1 ? 's' : ''} configured
                </p>
              </div>
              <button
                onClick={handleSuggestPrompts}
                disabled={loadingSuggestions}
                className="flex items-center gap-1.5 text-xs bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#818cf8] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {loadingSuggestions ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Suggest
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newPromptText}
                onChange={(e) => setNewPromptText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()}
                placeholder="Enter a new prompt question..."
                className="flex-1 bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569]"
              />
              <button
                onClick={handleAddPrompt}
                disabled={addingPrompt || !newPromptText.trim()}
                className="flex items-center gap-1.5 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                {addingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add
              </button>
            </div>

            {brand.prompts.length === 0 ? (
              <div className="text-center py-8 text-[#64748b] text-sm border border-dashed border-[#2a2a3a] rounded-lg bg-[#1a1a24]">
                No prompts yet. Add one above.
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {brand.prompts.map((prompt: Prompt) => (
                  <div
                    key={prompt.id}
                    className="flex items-start gap-3 bg-[#1a1a24] border border-[#2a2a3a] rounded-lg px-4 py-3 group hover:border-[#3a3a4a] transition-colors"
                  >
                    <ChevronRight size={14} className="text-[#6366f1] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-[#94a3b8] flex-1 leading-relaxed">
                      {prompt.text}
                    </span>
                    <button
                      onClick={() => handleDeletePrompt(prompt.id)}
                      disabled={deletingPromptId === prompt.id}
                      className="text-[#2a2a3a] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      {deletingPromptId === prompt.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Prompt suggestions panel */}
            {showSuggestions && (
              <div className="mt-4 border border-[#2a2a3a] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1a24] border-b border-[#2a2a3a]">
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} className="text-[#818cf8]" />
                    <span className="text-xs font-semibold text-[#e2e8f0]">Suggested Prompts</span>
                    <span className="text-xs text-[#475569]">click to add</span>
                  </div>
                  <button
                    onClick={() => { setShowSuggestions(false); setSuggestions([]); }}
                    className="text-[#475569] hover:text-[#94a3b8] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                {loadingSuggestions ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-[#64748b] text-xs">
                    <Loader2 size={14} className="animate-spin text-[#6366f1]" />
                    Generating suggestions with Claude…
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[#475569]">
                    No suggestions available. Try adding more brand profile info.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1e1e2e] max-h-72 overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleAddSuggestion(s)}
                        className="w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-[#1a1a24] transition-colors group"
                      >
                        <Plus size={13} className="text-[#6366f1] flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                        <span className="text-xs text-[#94a3b8] group-hover:text-[#e2e8f0] leading-relaxed transition-colors">{s}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Competitors */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-[#e2e8f0]">Competitors</h2>
              <p className="text-xs text-[#64748b] mt-0.5">
                Track competitor mention rates alongside your brand
              </p>
            </div>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newCompetitorName}
                onChange={(e) => setNewCompetitorName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCompetitor()}
                placeholder="Enter competitor name..."
                className="flex-1 bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569]"
              />
              <button
                onClick={handleAddCompetitor}
                disabled={addingCompetitor || !newCompetitorName.trim()}
                className="flex items-center gap-1.5 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                {addingCompetitor ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add
              </button>
            </div>

            {competitors.length === 0 ? (
              <div className="text-center py-8 text-[#64748b] text-sm border border-dashed border-[#2a2a3a] rounded-lg bg-[#1a1a24]">
                No competitors tracked. Add one above.
              </div>
            ) : (
              <div className="space-y-2">
                {competitors.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex items-center gap-3 bg-[#1a1a24] border border-[#2a2a3a] rounded-lg px-4 py-3 group hover:border-[#3a3a4a] transition-colors"
                  >
                    <ChevronRight size={14} className="text-[#475569] flex-shrink-0" />
                    <span className="text-sm text-[#94a3b8] flex-1">{comp.name}</span>
                    <button
                      onClick={() => handleRemoveCompetitor(comp.id)}
                      disabled={deletingCompetitorId === comp.id}
                      className="text-[#2a2a3a] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      {deletingCompetitorId === comp.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drafting Settings */}
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <Radio size={16} className="text-[#6366f1]" />
              <div>
                <h2 className="text-base font-semibold text-[#e2e8f0]">Drafting</h2>
                <p className="text-xs text-[#64748b] mt-0.5">
                  Platform toggles and auto-draft frequency. Changes save immediately.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {(['reddit', 'quora', 'medium', 'wikipedia'] as const).map((platform) => {
                const setting = draftSettings.find((s) => s.platform === platform);
                const enabled = setting?.enabled ?? true;
                const freq = setting?.drafting_frequency ?? 'weekly';
                const FREQ_OPTIONS = [
                  { value: 'daily', label: 'Daily' },
                  { value: 'every_3_days', label: 'Every 3 days' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'manual', label: 'Manual only' },
                ];
                return (
                  <div key={platform} className="flex items-center gap-3 py-2 border-b border-[#1e1e2e] last:border-0">
                    <button
                      onClick={() => handleToggleDraftPlatform(platform, !enabled)}
                      className="text-[#475569] hover:text-[#94a3b8] transition-colors shrink-0"
                      title={enabled ? 'Disable platform' : 'Enable platform'}
                    >
                      {enabled ? (
                        <ToggleRight size={20} className="text-[#6366f1]" />
                      ) : (
                        <ToggleLeft size={20} />
                      )}
                    </button>
                    <span className="text-sm text-[#94a3b8] capitalize w-24 shrink-0">{platform}</span>
                    {enabled ? (
                      <select
                        value={freq}
                        onChange={(e) => handleDraftFreqChange(platform, e.target.value)}
                        className="flex-1 appearance-none bg-[#1a1a24] border border-[#1e1e2e] text-[#94a3b8] text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#6366f1]"
                      >
                        {FREQ_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="flex-1 text-xs text-[#475569]">Disabled</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-[#111118] border border-red-900/40 rounded-xl p-6">
            <h2 className="text-base font-semibold text-red-400 mb-2 flex items-center gap-2">
              <AlertTriangle size={16} />
              Danger Zone
            </h2>
            <p className="text-sm text-[#64748b] mb-5">
              Deleting this brand will permanently remove all tracking data, runs, and results.
              This action cannot be undone.
            </p>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 bg-red-900/20 hover:bg-red-900/30 border border-red-900/50 text-red-400 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                <Trash2 size={14} />
                Delete Brand
              </button>
            ) : (
              <div className="bg-red-900/10 border border-red-900/40 rounded-lg p-4">
                <p className="text-sm font-medium text-[#e2e8f0] mb-3">
                  Are you absolutely sure you want to delete &quot;{brand.name}&quot;?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                    className="bg-[#1a1a24] border border-[#1e1e2e] text-[#94a3b8] rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#2a2a3a] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteBrand}
                    disabled={deleting}
                    className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {deleting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Yes, Delete Brand
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PROFILE TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div>
          {/* Completion bar */}
          <div className="mb-5 p-4 bg-[#111118] border border-[#1e1e2e] rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#94a3b8]">Profile Completion</span>
              <span className="text-xs text-[#64748b]">
                {completionPct >= 100
                  ? 'Complete — ready for drafting'
                  : `${Math.round(100 - completionPct)}% remaining`}
              </span>
            </div>
            <CompletionBar pct={completionPct} />
          </div>

          {/* Save button (top) */}
          <div className="flex justify-end mb-4">
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                profileSaved
                  ? 'bg-[#064e3b]/30 text-[#10b981] border border-[#065f46]/40'
                  : 'bg-[#6366f1] text-white hover:bg-[#4f46e5] disabled:opacity-50'
              )}
            >
              {profileSaved ? (
                <>
                  <CheckCircle size={16} />
                  Saved
                </>
              ) : (
                <>
                  <Save size={16} />
                  {profileSaving ? 'Saving…' : 'Save Profile'}
                </>
              )}
            </button>
          </div>

          <div className="space-y-4">
            <SectionCard
              icon={Building2}
              title="Company Description"
              description="What the company does — used as context for all content drafts"
            >
              <textarea
                value={companyDescription}
                onChange={(e) => setCompanyDescription(e.target.value)}
                placeholder="Describe the company, its products, mission, and what makes it unique…"
                rows={4}
                className="w-full px-3 py-2.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
              />
            </SectionCard>

            <SectionCard
              icon={BarChart2}
              title="Key Stats & Approved Claims"
              description="Specific data points and statistics that can be cited in content"
            >
              <EditableList
                items={keyStats}
                onChange={setKeyStats}
                placeholder="Add a stat or claim, then press Enter…"
              />
            </SectionCard>

            <SectionCard
              icon={MessageSquare}
              title="Tone of Voice"
              description="How the brand should sound — guides the style of all drafted content"
            >
              <textarea
                value={toneOfVoice}
                onChange={(e) => setToneOfVoice(e.target.value)}
                placeholder="e.g. Professional but approachable. Confident without being arrogant…"
                rows={3}
                className="w-full px-3 py-2.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
              />
            </SectionCard>

            <SectionCard
              icon={AlertTriangle}
              title="What NOT to Say"
              description="Phrases, claims, or topics to avoid — legal or brand restrictions"
            >
              <EditableList
                items={whatNotToSay}
                onChange={setWhatNotToSay}
                placeholder="Add a phrase or claim to avoid…"
              />
            </SectionCard>

            <SectionCard
              icon={Users}
              title="Target Audience"
              description="Who the brand is trying to reach — informs framing in drafts"
            >
              <textarea
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="e.g. Healthcare professionals and clinical researchers…"
                rows={3}
                className="w-full px-3 py-2.5 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg text-sm text-[#e2e8f0] placeholder-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
              />
            </SectionCard>

            <SectionCard
              icon={Shield}
              title="Clinical / Legal Approved Language"
              description="Pre-approved phrases, disclaimers, and citations for regulated claims"
            >
              <EditableList
                items={approvedLanguage}
                onChange={setApprovedLanguage}
                placeholder="Add an approved phrase or disclaimer…"
              />
            </SectionCard>

            <SectionCard
              icon={BookOpen}
              title="Publications"
              description="Peer-reviewed papers — used to populate Wikipedia citation refs automatically"
            >
              <PublicationsEditor items={publications} onChange={setPublications} />
            </SectionCard>
          </div>

          {/* Save button (bottom) */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className={clsx(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
                profileSaved
                  ? 'bg-[#064e3b]/30 text-[#10b981] border border-[#065f46]/40'
                  : 'bg-[#6366f1] text-white hover:bg-[#4f46e5] disabled:opacity-50'
              )}
            >
              {profileSaved ? (
                <>
                  <CheckCircle size={16} />
                  Saved
                </>
              ) : (
                <>
                  <Save size={16} />
                  {profileSaving ? 'Saving…' : 'Save Profile'}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
