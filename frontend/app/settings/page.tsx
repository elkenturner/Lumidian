'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  User,
  Save,
  AlertTriangle,
  Calendar,
  Pause,
  Play,
  Loader2,
  Plus,
  Trash2,
  ChevronRight,
  X,
  CheckCircle,
  Building2,
  MessageSquare,
  Users,
  Shield,
  BarChart2,
  BookOpen,
  Sparkles,
  Wand2,
} from 'lucide-react';
import clsx from 'clsx';
import {
  getBrands,
  getBrand,
  updateBrand,
  deleteBrand,
  addPrompt,
  deletePrompt,
  getCompetitors,
  addCompetitor,
  removeCompetitor,
  getBrandProfile,
  updateBrandProfile,
  aiFillProfile,
  refreshWebsiteContext,
  normaliseWebsiteUrl,
  getSuggestedPrompts,
  getSchedulerStatus,
  setSchedulerStatus,
  triggerPromptRun,
  getTeamMembers,
  inviteTeamMember,
  removeTeamMember,
  BrandDetail,
  Prompt,
  Competitor,
  BrandProfile,
  Publication,
  TeamMember,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

type SettingsTab = 'general' | 'profile' | 'team';

// ── Auto-growing textarea ─────────────────────────────────────────────────────

function AutoTextarea({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={4}
      className={className}
      style={{ overflow: 'hidden' }}
    />
  );
}

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
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-[#6366f1]/10 border border-[#6366f1]/30 rounded-md text-xs text-[#818cf8] leading-snug"
          >
            {item}
            <button
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              className="shrink-0 text-[#6366f1]/50 hover:text-[#f87171] transition-colors"
            >
              <X size={11} />
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
          className="flex-1 px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-lg text-sm text-[#F0F4F8] placeholder:text-[#475569] focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]/15 transition-colors"
        />
        <button
          onClick={addItem}
          className="px-3 py-2 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg text-[#64748B] hover:text-[#6366f1] hover:border-[#6366f1]/40 hover:bg-[rgba(99,102,241,0.06)] transition-all duration-150"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Completion bar ─────────────────────────────────────────────────────────────

function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#6366f1';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-[rgba(99,102,241,0.06)] rounded-full h-2">
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

// ── Section card ──────────────────────────────────────────────────────────────

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
    <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={15} className="text-[#6366f1]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#F0F4F8]">{title}</h3>
          <p className="text-xs text-[#64748B] mt-0.5">{description}</p>
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
        <div key={idx} className="bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[#64748B] font-medium">Publication {idx + 1}</span>
            <button onClick={() => remove(idx)} className="text-[#475569] hover:text-[#f87171] transition-colors">
              <X size={13} />
            </button>
          </div>
          <input
            type="url"
            placeholder="DOI / URL"
            value={pub.url}
            onChange={(e) => update(idx, 'url', e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-md text-xs text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
          <input
            type="text"
            placeholder="Title"
            value={pub.title}
            onChange={(e) => update(idx, 'title', e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-md text-xs text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Publisher / journal"
              value={pub.publisher}
              onChange={(e) => update(idx, 'publisher', e.target.value)}
              className="flex-1 px-2.5 py-1.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-md text-xs text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
            <input
              type="text"
              placeholder="Year"
              value={pub.date}
              onChange={(e) => update(idx, 'date', e.target.value)}
              className="w-20 px-2.5 py-1.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-md text-xs text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#6366f1] border border-dashed border-[rgba(99,102,241,0.22)] hover:border-[#6366f1]/40 rounded-lg px-3 py-2 transition-colors w-full justify-center"
      >
        <Plus size={13} />
        Add publication
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    (searchParams.get('tab') as SettingsTab) || 'general'
  );
  const [loading, setLoading] = useState(true);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [brand, setBrand] = useState<BrandDetail | null>(null);

  // General tab state
  const [editName, setEditName] = useState('');
  const [editWebsiteUrl, setEditWebsiteUrl] = useState('');
  const [refreshingContext, setRefreshingContext] = useState(false);
  const [contextRefreshed, setContextRefreshed] = useState(false);
  const [contextFailed, setContextFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newPromptText, setNewPromptText] = useState('');
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [deletingPromptId, setDeletingPromptId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [deletingCompetitorId, setDeletingCompetitorId] = useState<number | null>(null);
  const [showDeleteBrandConfirm, setShowDeleteBrandConfirm] = useState(false);
  const [deletingBrand, setDeletingBrand] = useState(false);

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
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [aiFilling, setAiFilling] = useState(false);
  const [aiFillError, setAiFillError] = useState<string | null>(null);

  // Account tab state
  const [displayName, setDisplayName] = useState('');
  const [accountSaved, setAccountSaved] = useState(false);
  const [schedulerPaused, setSchedulerPaused] = useState(false);
  const [schedulerLoading, setSchedulerLoading] = useState(true);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);

  // Team tab state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);

  useEffect(() => { document.title = 'Settings — Lumidian'; }, []);

  useEffect(() => {
    async function load() {
      try {
        // Start brand details fetching as soon as getBrands resolves —
        // don't wait for getSchedulerStatus (independent, slower).
        const brandsPromise = getBrands();
        const schedulerPromise = getSchedulerStatus().catch(() => null);
        const detailsPromise = brandsPromise.then((brands) => {
          if (brands.length === 0) return null;
          return Promise.all([
            getBrand(brands[0].id),
            getCompetitors(brands[0].id),
            getBrandProfile(brands[0].id).catch(() => null),
          ]);
        });

        const [brands, schedulerStatus, details] = await Promise.all([
          brandsPromise,
          schedulerPromise,
          detailsPromise.catch(() => null),
        ]);

        if (schedulerStatus) {
          setSchedulerPaused(schedulerStatus.paused);
        }
        setSchedulerLoading(false);

        if (brands.length === 0) {
          setLoading(false);
          return;
        }

        const firstBrand = brands[0];
        setBrandId(firstBrand.id);

        const [brandDetail, comps, prof] = (details ?? await Promise.all([
          getBrand(firstBrand.id),
          getCompetitors(firstBrand.id),
          getBrandProfile(firstBrand.id).catch(() => null),
        ])) as [BrandDetail, Competitor[], BrandProfile | null];

        setBrand(brandDetail);
        setEditName(brandDetail.name);
        setEditWebsiteUrl(brandDetail.website_url ?? '');
        setCompetitors(comps);

        if (prof) {
          setProfile(prof);
          setCompanyDescription(prof.company_description ?? '');
          setKeyStats(prof.key_stats ?? []);
          setToneOfVoice(prof.tone_of_voice ?? '');
          setWhatNotToSay(prof.what_not_to_say ?? []);
          setTargetAudience(prof.target_audience ?? '');
          setApprovedLanguage(prof.approved_language ?? []);
          setPublications(prof.publications ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }

    // Load display name from localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('clarity_settings');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.displayName) setDisplayName(parsed.displayName);
        } catch { /* ignore */ }
      }
    }

    load();
  }, []);

  // Load team members when team tab is selected
  useEffect(() => {
    if (activeTab !== 'team') return;
    setTeamLoading(true);
    getTeamMembers()
      .then(setTeamMembers)
      .catch(() => setTeamLoadError('Could not load team members. Please refresh the page.'))
      .finally(() => setTeamLoading(false));
  }, [activeTab]);

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteLink(null);
    try {
      const res = await inviteTeamMember(inviteEmail.trim());
      setInviteLink(window.location.origin + res.invite_link);
      setInviteEmail('');
      const updated = await getTeamMembers();
      setTeamMembers(updated);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setInviteError(err?.response?.data?.detail ?? 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(id: number) {
    setRemovingMemberId(id);
    try {
      await removeTeamMember(id);
      setTeamMembers((prev) => prev.filter((m) => m.id !== id));
    } catch {}
    setRemovingMemberId(null);
  }

  // ── General handlers ────────────────────────────────────────────────────────

  async function handleSave() {
    if (!brandId || !editName.trim()) return;
    setSaving(true);
    setSaveError(null);
    const normalisedUrl = normaliseWebsiteUrl(editWebsiteUrl);
    const urlChanged = normalisedUrl !== (brand?.website_url ?? '');
    try {
      const updated = await updateBrand(brandId, {
        name: editName.trim(),
        website_url: normalisedUrl,
      });
      setBrand((prev) => prev ? { ...prev, ...updated } : null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setSaveError(err?.response?.data?.detail ?? 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
    if (urlChanged && normalisedUrl) {
      handleRefreshContext();
    }
  }

  async function handleRefreshContext() {
    if (!brandId) return;
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
      } catch { /* ignore */ }
      if (attempts >= 15) {
        clearInterval(poll);
        setContextFailed(true);
        setRefreshingContext(false);
      }
    }, 3000);
  }

  async function handleAddPrompt() {
    if (!brandId) return;
    const trimmed = newPromptText.trim();
    if (!trimmed) return;
    setAddingPrompt(true);
    try {
      const prompt = await addPrompt(brandId, trimmed);
      setBrand((prev) => prev ? { ...prev, prompts: [...prev.prompts, prompt], prompt_count: prev.prompt_count + 1 } : null);
      setNewPromptText('');
      // Fire single-prompt run in background — does not block UI
      triggerPromptRun(brandId, prompt.id)
        .then(({ run_id }) => {
          // Store in localStorage so dashboard can pick up the badge state
          if (typeof window !== 'undefined') {
            const key = 'pendingPromptRuns';
            const existing: Array<{ promptId: number; runId: number }> = JSON.parse(
              localStorage.getItem(key) ?? '[]'
            );
            existing.push({ promptId: prompt.id, runId: run_id });
            localStorage.setItem(key, JSON.stringify(existing));
          }
        })
        .catch((err) => console.warn('[Settings] Prompt mini-run failed to start:', err));
    } finally {
      setAddingPrompt(false);
    }
  }

  async function handleDeletePrompt(promptId: number) {
    if (!brandId) return;
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
    if (!brandId) return;
    setBrand((prev) => {
      if (!prev) return prev;
      return { ...prev, prompts: [...prev.prompts, { id: Date.now(), brand_id: prev.id, text, prompt_type: 'standard' as const }], prompt_count: prev.prompt_count + 1 };
    });
    setSuggestions((prev) => prev.filter((s) => s !== text));
    try {
      const newPrompt = await addPrompt(brandId, text);
      setBrand((prev) => {
        if (!prev) return prev;
        const filtered = prev.prompts.filter((p) => p.text !== text || p.id !== Date.now());
        return { ...prev, prompts: [...filtered, newPrompt] };
      });
    } catch { /* ignore */ }
  }

  async function handleAddCompetitor() {
    if (!brandId) return;
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
    if (!brandId) return;
    setDeletingCompetitorId(competitorId);
    try {
      await removeCompetitor(brandId, competitorId);
      setCompetitors((prev) => prev.filter((c) => c.id !== competitorId));
    } finally {
      setDeletingCompetitorId(null);
    }
  }

  async function handleDeleteBrand() {
    if (!brandId) return;
    setDeletingBrand(true);
    try {
      await deleteBrand(brandId);
      router.push('/onboarding');
    } catch {
      setDeletingBrand(false);
    }
  }

  // ── Profile handlers ────────────────────────────────────────────────────────

  async function handleAiFill() {
    if (!brandId) return;
    setAiFilling(true);
    setAiFillError(null);
    try {
      const result = await aiFillProfile(brandId);
      if (result.company_description) setCompanyDescription(result.company_description);
      if (result.target_audience) setTargetAudience(result.target_audience);
      if (result.tone_of_voice) setToneOfVoice(result.tone_of_voice);
      if (result.key_stats.length > 0) setKeyStats((prev) => {
        const combined = [...prev, ...result.key_stats.filter((s) => !prev.includes(s))];
        return combined;
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAiFillError(e?.response?.data?.detail || 'AI fill failed. Please try again.');
    } finally {
      setAiFilling(false);
    }
  }

  async function handleProfileSave() {
    if (!brandId) return;
    setProfileSaving(true);
    setProfileSaveError(null);
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
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setProfileSaveError(err?.response?.data?.detail ?? 'Failed to save profile. Please try again.');
    } finally {
      setProfileSaving(false);
    }
  }

  // ── Account handlers ─────────────────────────────────────────────────────────

  function handleAccountSave() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('clarity_settings', JSON.stringify({ displayName }));
    }
    setAccountSaved(true);
    setTimeout(() => setAccountSaved(false), 2500);
  }

  async function handleToggleScheduler() {
    setSchedulerLoading(true);
    setSchedulerError(null);
    try {
      const result = await setSchedulerStatus(!schedulerPaused);
      setSchedulerPaused(result.paused);
    } catch {
      setSchedulerError('Failed to update scheduler. Check that the backend is running.');
    } finally {
      setSchedulerLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-8 max-w-5xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[rgba(255,255,255,0.06)] rounded w-32" />
          <div className="h-10 bg-[rgba(255,255,255,0.06)] rounded w-64" />
          <div className="h-48 bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.22)] rounded-xl" />
        </div>
      </div>
    );
  }

  const completionPct = profile?.completion_pct ?? 0;

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#F0F4F8]">Settings</h1>
        <p className="text-[13px] text-[#64748B] mt-1.5">
          {brand ? `Managing settings for ${brand.name}` : 'Manage your account preferences'}
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-[rgba(99,102,241,0.22)] mb-6">
        {(['general', 'profile', 'team'] as SettingsTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-[3px] -mb-px transition-all',
              activeTab === tab
                ? 'text-[#818CF8] border-[#6366f1] bg-[rgba(99,102,241,0.08)]'
                : 'text-[#64748B] border-transparent hover:text-[#94A3B8] hover:bg-[rgba(255,255,255,0.03)]'
            )}
          >
            {tab === 'general' ? 'General' : tab === 'profile' ? 'Brand Profile' : 'Team'}
          </button>
        ))}
      </div>

      {/* ── GENERAL TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'general' && brand && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column */}
          <div className="space-y-6">
          {/* Brand Settings */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
            <h2 className="text-[15px] font-semibold text-[#F0F4F8] pb-3 mb-5 border-b border-[rgba(255,255,255,0.07)]">Brand Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-2">Brand Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-2">Company Website</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editWebsiteUrl}
                    onChange={(e) => setEditWebsiteUrl(e.target.value)}
                    placeholder="yourcompany.com"
                    className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569]"
                  />
                  {refreshingContext && (
                    <span className="flex items-center gap-1.5 text-xs text-[#94A3B8] whitespace-nowrap">
                      <Loader2 size={13} className="animate-spin" />Importing…
                    </span>
                  )}
                </div>
                {profile?.website_context_last_fetched ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${contextRefreshed ? 'bg-green-400 animate-pulse' : 'bg-green-500'}`} />
                    <p className="text-xs text-[#64748B]">
                      Content imported{' '}
                      {new Date(profile.website_context_last_fetched + 'Z').toLocaleString()}
                      {' · '}refreshed monthly
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#475569] mt-1">
                    {contextFailed
                      ? 'Import failed. Check the URL is publicly accessible and save again.'
                      : 'Website content will be imported automatically when you save a URL.'}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 mt-5 pt-5 border-t border-[rgba(99,102,241,0.22)]">
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
                  <><Save size={14} />Save Changes</>
                )}
              </button>
              {saveError && (
                <p className="text-xs text-[#f87171]">{saveError}</p>
              )}
            </div>
          </div>

          {/* Tracking Prompts */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
            <div className="flex items-center justify-between pb-3 mb-5 border-b border-[rgba(255,255,255,0.07)]">
              <div>
                <h2 className="text-[15px] font-semibold text-[#F0F4F8]">Tracking Prompts</h2>
                <p className="text-xs text-[#64748B] mt-0.5">
                  {(() => {
                    const limit = brand.brand_type === 'pitch' ? 10 : (user?.prompt_limit ?? 25);
                    const color = brand.prompts.length >= limit ? '#f87171' : brand.prompts.length >= limit * 0.8 ? '#f59e0b' : '#64748B';
                    return <span style={{ color }}>{brand.prompts.length}/{limit} prompts</span>;
                  })()}
                </p>
              </div>
              <button
                onClick={handleSuggestPrompts}
                disabled={loadingSuggestions}
                className="flex items-center gap-1.5 text-xs bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(99,102,241,0.06)] border border-[rgba(255,255,255,0.10)] text-[#94A3B8] hover:text-[#6366f1] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
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
                className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569]"
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
              <div className="flex flex-col items-center py-8 text-center border border-dashed border-[rgba(99,102,241,0.22)] rounded-lg bg-[rgba(255,255,255,0.03)]">
                <MessageSquare size={18} className="text-[#475569] mb-2" />
                <p className="text-sm text-[#475569]">No prompts yet</p>
                <p className="text-xs text-[#475569] mt-0.5">Add your first prompt above</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {brand.prompts.map((prompt: Prompt) => (
                  <div
                    key={prompt.id}
                    className="flex items-start gap-3 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg px-4 py-3 group hover:border-[rgba(255,255,255,0.14)] transition-colors"
                  >
                    <ChevronRight size={14} className="text-[#6366f1] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-[#94A3B8] flex-1 leading-relaxed">{prompt.text}</span>
                    <button
                      onClick={() => handleDeletePrompt(prompt.id)}
                      disabled={deletingPromptId === prompt.id}
                      aria-label="Delete prompt"
                      className="text-[rgba(255,255,255,0.15)] hover:text-[#f87171] opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
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

            {showSuggestions && (
              <div className="mt-4 border border-[rgba(255,255,255,0.10)] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[rgba(255,255,255,0.06)] border-b border-[rgba(99,102,241,0.22)]">
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} className="text-[#6366f1]" />
                    <span className="text-xs font-semibold text-[#F0F4F8]">Suggested Prompts</span>
                    <span className="text-xs text-[#475569]">click to add</span>
                  </div>
                  <button
                    onClick={() => { setShowSuggestions(false); setSuggestions([]); }}
                    aria-label="Close suggestions"
                    className="text-[#475569] hover:text-[#94A3B8] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                {loadingSuggestions ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-[#64748B] text-xs">
                    <Loader2 size={14} className="animate-spin text-[#6366f1]" />
                    Generating suggestions with Claude…
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[#475569]">
                    No suggestions available. Try adding more brand profile info.
                  </div>
                ) : (
                  <div className="divide-y divide-[rgba(255,255,255,0.08)] max-h-72 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleAddSuggestion(s)}
                        className="w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-[rgba(255,255,255,0.06)] transition-colors group"
                      >
                        <Plus size={13} className="text-[#6366f1] flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-[#94A3B8] group-hover:text-[#F0F4F8] leading-relaxed transition-colors">{s}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>

          <div className="space-y-6">
          {/* Competitors */}
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
            <div className="pb-3 mb-5 border-b border-[rgba(255,255,255,0.07)]">
              <h2 className="text-[15px] font-semibold text-[#F0F4F8]">Competitors</h2>
              <p className="text-xs text-[#64748B] mt-0.5">Track competitor mention rates alongside your brand</p>
            </div>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newCompetitorName}
                onChange={(e) => setNewCompetitorName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCompetitor()}
                placeholder="Enter competitor name..."
                className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[#F0F4F8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569]"
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
              <div className="flex flex-col items-center py-8 text-center border border-dashed border-[rgba(99,102,241,0.22)] rounded-lg bg-[rgba(255,255,255,0.03)]">
                <Building2 size={18} className="text-[#475569] mb-2" />
                <p className="text-sm text-[#475569]">No competitors tracked</p>
                <p className="text-xs text-[#475569] mt-0.5 opacity-60">Add one above to unlock Share of Voice</p>
              </div>
            ) : (
              <div className="space-y-2">
                {competitors.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex items-center gap-3 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] rounded-lg px-4 py-3 group hover:border-[rgba(255,255,255,0.14)] transition-colors"
                  >
                    <ChevronRight size={14} className="text-[#475569] flex-shrink-0" />
                    <span className="text-sm text-[#94A3B8] flex-1">{comp.name}</span>
                    <button
                      onClick={() => handleRemoveCompetitor(comp.id)}
                      disabled={deletingCompetitorId === comp.id}
                      aria-label="Remove competitor"
                      className="text-[rgba(255,255,255,0.15)] hover:text-[#f87171] opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
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

          </div>
        </div>
      )}

      {activeTab === 'general' && !brand && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] flex items-center justify-center mb-4">
            <Building2 size={20} className="text-[#6366f1]/50" />
          </div>
          <p className="text-sm font-medium text-[#F0F4F8] mb-1">No brand yet</p>
          <p className="text-xs text-[#64748B] mb-4">Add your first brand to start tracking AI visibility.</p>
          <a href="/onboarding" className="inline-flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-3 py-2 font-medium transition-colors">
            Create a brand
          </a>
        </div>
      )}

      {/* ── PROFILE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div>
          {profile && (
            <div className="mb-5 p-4 bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[#94A3B8]">Profile Completion</span>
                <span className="text-xs text-[#64748B]">
                  {completionPct >= 100 ? 'Complete — ready for drafting' : `${Math.round(100 - completionPct)}% remaining`}
                </span>
              </div>
              <CompletionBar pct={completionPct} />
            </div>
          )}

          <div className="flex items-center justify-between mb-4 gap-3">
            {/* AI Fill button — only shown when website is set */}
            <div className="flex items-center gap-3">
              {editWebsiteUrl ? (
                <button
                  onClick={handleAiFill}
                  disabled={aiFilling || profileSaving}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[rgba(99,102,241,0.10)] hover:bg-[rgba(99,102,241,0.18)] border border-[rgba(99,102,241,0.28)] text-[#818cf8] disabled:opacity-50 transition-all"
                  title="Scan website and auto-fill profile fields"
                >
                  {aiFilling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  {aiFilling ? 'Scanning website…' : 'Fill from website'}
                </button>
              ) : (
                <p className="text-xs text-[#475569]">Add a website URL in Brand Settings to enable AI fill.</p>
              )}
              {aiFillError && <p className="text-xs text-[#f87171]">{aiFillError}</p>}
            </div>
            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all shrink-0',
                profileSaved
                  ? 'bg-[#064e3b]/30 text-[#10b981] border border-[#065f46]/40'
                  : 'bg-[#6366f1] text-white hover:bg-[#4f46e5] disabled:opacity-50'
              )}
            >
              {profileSaved ? (
                <><CheckCircle size={16} />Saved</>
              ) : (
                <><Save size={16} />{profileSaving ? 'Saving…' : 'Save Profile'}</>
              )}
            </button>
          </div>

          <div className="space-y-4">
            <SectionCard
              icon={Building2}
              title="Company Description"
              description="What your brand does — used as context for all content drafts"
            >
              <AutoTextarea
                value={companyDescription}
                onChange={setCompanyDescription}
                placeholder="Describe the company, its products, mission, and what makes it unique…"
                className="w-full px-3 py-2.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-lg text-sm text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
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
                className="w-full px-3 py-2.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-lg text-sm text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
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
                className="w-full px-3 py-2.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-lg text-sm text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1] resize-none"
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

          <div className="mt-6 flex items-center justify-end gap-3">
            {profileSaveError && (
              <p className="text-xs text-[#f87171]">{profileSaveError}</p>
            )}
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
                <><CheckCircle size={16} />Saved</>
              ) : (
                <><Save size={16} />{profileSaving ? 'Saving…' : 'Save Profile'}</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── TEAM TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'team' && (
        <div className="space-y-5">
          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
            <h2 className="text-base font-semibold text-[#F0F4F8] mb-1">Invite Team Members</h2>
            <p className="text-sm text-[#64748B] mb-4">Team members get read-only access to your brands, reports, and drafts. They cannot trigger runs or change settings.</p>

            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                placeholder="colleague@company.com"
                className="flex-1 px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] rounded-lg text-sm text-[#F0F4F8] placeholder-[#475569] focus:outline-none focus:border-[#6366f1]"
              />
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-[#6366f1] text-white rounded-lg text-sm font-medium hover:bg-[#4f46e5] disabled:opacity-50 transition-colors"
              >
                {inviting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Invite
              </button>
            </div>

            {inviteError && (
              <p className="mt-2 text-xs text-[#f87171]">{inviteError}</p>
            )}

            {inviteLink && (
              <div className="mt-3 p-3 bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] rounded-lg">
                <p className="text-xs text-[#10b981] mb-1 font-medium">Invite link generated — share this with your team member:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs text-[#94A3B8] break-all bg-[rgba(0,0,0,0.2)] px-2 py-1.5 rounded">{inviteLink}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(inviteLink)}
                    className="shrink-0 px-2 py-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] border border-[rgba(255,255,255,0.08)] rounded transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-[#475569] mt-1">Link expires in 48 hours.</p>
              </div>
            )}
          </div>

          <div className="bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-xl p-6 shadow-[0_4px_24px_rgba(0,0,0,0.20)]">
            <h2 className="text-base font-semibold text-[#F0F4F8] mb-4">Team Members</h2>
            {teamLoading ? (
              <div className="flex items-center gap-2 text-[#64748B] text-sm"><Loader2 size={14} className="animate-spin" />Loading…</div>
            ) : teamLoadError ? (
              <p className="text-sm text-[#f87171]">{teamLoadError}</p>
            ) : teamMembers.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <Users size={18} className="text-[#475569] mb-2" />
                <p className="text-sm text-[#475569]">No team members yet</p>
                <p className="text-xs text-[#475569] mt-0.5">Invite someone above to collaborate</p>
              </div>
            ) : (
              <div className="divide-y divide-[rgba(255,255,255,0.06)]">
                {teamMembers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm text-[#F0F4F8]">{m.invited_email}</p>
                      <p className="text-xs text-[#475569] mt-0.5">
                        {m.accepted ? (
                          <span className="text-[#10b981]">Active · Viewer</span>
                        ) : (
                          <span className="text-[#f59e0b]">Pending invitation</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      disabled={removingMemberId === m.id}
                      aria-label="Remove team member"
                      className="p-1.5 text-[#475569] hover:text-[#f87171] transition-colors rounded"
                      title="Remove"
                    >
                      {removingMemberId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete brand confirmation modal */}
      {showDeleteBrandConfirm && brand && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowDeleteBrandConfirm(false)} />
          <div className="relative bg-[rgba(10,14,24,0.97)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-sm font-semibold text-[#F0F4F8] mb-2">Are you sure?</h3>
            <p className="text-xs text-[#64748B] mb-5 leading-relaxed">
              This will permanently delete all tracking data, runs, and results for <span className="text-[#F0F4F8] font-medium">{brand.name}</span>. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteBrandConfirm(false)}
                disabled={deletingBrand}
                className="flex-1 py-2 text-xs text-[#64748B] hover:text-[#94A3B8] border border-[rgba(99,102,241,0.22)] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteBrand}
                disabled={deletingBrand}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg disabled:opacity-50 transition-colors"
              >
                {deletingBrand ? <Loader2 size={11} className="animate-spin" /> : null}
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete brand — visible but not alarming */}
      {brand && (
        <div className="mt-8 pt-5 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#94A3B8]">Delete brand</p>
              <p className="text-xs text-[#475569] mt-0.5">Permanently removes this brand and all its tracking data</p>
            </div>
            <button
              type="button"
              onClick={() => setShowDeleteBrandConfirm(true)}
              className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#f87171] border border-[rgba(255,255,255,0.10)] hover:border-red-900/40 rounded-lg px-3 py-1.5 transition-colors shrink-0"
            >
              <Trash2 size={12} />
              Delete brand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
