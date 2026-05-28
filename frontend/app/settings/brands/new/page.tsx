'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Loader2, CheckCircle, ArrowLeft, BarChart2, Zap, FileText, Lock, Building2 } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import {
  getBillingUsage,
  getBrandProfile,
  getSuggestedPromptsPreview,
  createBrand,
  updateBrandProfile,
  refreshWebsiteContext,
  normaliseWebsiteUrl,
  triggerRun,
  addPrompt,
  BillingUsage,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/utils/errors';

type Step = 'type' | 'details' | 'prompts' | 'profile';
type BrandChoice = 'starter' | 'pro' | 'pitch';

const STEPS: Step[] = ['type', 'details', 'prompts', 'profile'];
const STEP_LABELS: Record<Step, string> = {
  type: 'Type',
  details: 'Brand',
  prompts: 'Prompts',
  profile: 'Profile',
};

const PROMPT_LIMITS: Record<BrandChoice, number> = {
  starter: 25,
  pro: 100,
  pitch: 10,
};

export default function NewBrandPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>('type');
  const [billing, setBilling] = useState<BillingUsage | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Type selection: starter | pro | pitch
  const [brandChoice, setBrandChoice] = useState<BrandChoice | null>(null);

  // Details
  const [brandName, setBrandName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [createdBrandId, setCreatedBrandId] = useState<number | null>(null);

  // Prompts
  const [prompts, setPrompts] = useState<string[]>(['']);
  const [suggestingPrompts, setSuggestingPrompts] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  // Profile
  const [companyDescription, setCompanyDescription] = useState('');

  useEffect(() => {
    getBillingUsage()
      .then((b) => setBilling(b))
      .catch((err) => logError(err, 'NewBrand: fetch billing usage'))
      .finally(() => setLoadingBilling(false));
  }, []);

  const isAdmin = user?.is_admin ?? false;
  const isPro = isAdmin || user?.subscription_tier === 'pro';
  const isOnPaidPlan = isAdmin || !!user?.subscription_tier;

  const standardRemaining = billing
    ? isAdmin ? 999 : Math.max(0, billing.standard_brand_limit - billing.standard_brand_count)
    : null;
  const pitchRemaining = billing
    ? isAdmin ? 999 : Math.max(0, billing.pitch_brand_limit - billing.pitch_brand_count)
    : null;

  const promptLimit = brandChoice ? PROMPT_LIMITS[brandChoice] : 10;

  // Map user choice to API brand_type
  const apiBrandType = brandChoice === 'starter' ? 'standard' as const : (brandChoice ?? undefined);

  function handleSelectType(choice: BrandChoice) {
    setBrandChoice(choice);
    setStep('details');
  }

  async function handleDetails() {
    if (!brandName.trim() || !brandChoice) return;
    if (!websiteUrl.trim()) { setError('Please enter your company website URL.'); return; }
    setSaving(true);
    setError('');
    try {
      const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
      const brand = await createBrand({
        name: brandName.trim(),
        tier: 'basic',
        brand_type: apiBrandType,
        prompts: [],
        website_url: normalisedUrl ?? undefined,
      });
      setCreatedBrandId(brand.id);
      if (normalisedUrl) {
        refreshWebsiteContext(brand.id).catch((err) => logError(err, 'NewBrand: refresh website context'));
      }
      setStep('prompts');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to create brand');
    } finally {
      setSaving(false);
    }
  }

  async function handlePrompts() {
    if (!createdBrandId) return;
    setSaving(true);
    setError('');
    try {
      const validPrompts = prompts.filter((p) => p.trim());
      if (validPrompts.length > 0) {
        await Promise.all(validPrompts.map((p) => addPrompt(createdBrandId, p.trim())));
      }
      // Auto-fill description from scraped website content if available
      if (websiteUrl) {
        try {
          const profile = await getBrandProfile(createdBrandId);
          if (profile.internal_brand_context && !companyDescription) {
            const firstLine = profile.internal_brand_context
              .split(/\n+/)
              .map((l) => l.trim())
              .find((l) => l.length > 20 && !l.startsWith('#') && !l.startsWith('http') && !l.startsWith('['));
            if (firstLine) setCompanyDescription(firstLine.slice(0, 300));
          }
        } catch {}
      }
      setStep('profile');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to save prompts');
    } finally {
      setSaving(false);
    }
  }

  async function handleProfile() {
    if (!createdBrandId) return;
    setSaving(true);
    try {
      if (companyDescription) {
        await updateBrandProfile(createdBrandId, {
          company_description: companyDescription,
        });
      }
      try { await triggerRun(createdBrandId); } catch {}
      router.push(`/dashboard?newBrand=true&brandId=${createdBrandId}`);
    } catch {
      router.push(`/dashboard?newBrand=true&brandId=${createdBrandId}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggestPrompts() {
    if (!brandName.trim()) return;
    setSuggestingPrompts(true);
    setSuggestError('');
    try {
      const suggestions = await getSuggestedPromptsPreview(brandName.trim());
      setPrompts(suggestions.slice(0, promptLimit));
    } catch {
      setSuggestError('Could not generate suggestions. Try again.');
    } finally {
      setSuggestingPrompts(false);
    }
  }

  function addPromptRow() {
    if (prompts.length < promptLimit) setPrompts([...prompts, '']);
  }

  function updatePrompt(i: number, val: string) {
    const next = [...prompts];
    next[i] = val;
    setPrompts(next);
  }

  function goBack() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
    else router.back();
  }

  if (loadingBilling) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex flex-col items-center justify-center px-4 py-12">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[15%] -left-[10%] w-[580px] h-[580px] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 65%)', filter: 'blur(100px)' }} />
        <div className="absolute -bottom-[18%] -right-[5%] w-[480px] h-[480px] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-perplexity) 10%, transparent) 0%, transparent 65%)', filter: 'blur(90px)' }} />
      </div>

      {/* Logo */}
      <div className="relative flex items-center gap-3 mb-10">
        <LumidianLogo size={32} withWordmark />
      </div>

      {/* Step indicators */}
      <div className="relative flex items-center gap-3 mb-8">
        {STEPS.map((s, i) => {
          const done = stepIdx > i;
          const active = step === s;
          return (
            <div key={s} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done ? 'bg-[var(--success)] text-white' : active ? 'bg-[var(--accent)] text-white shadow-[0_0_12px_var(--accent-muted)]' : 'bg-[var(--accent-muted)] border border-[var(--border-default)] text-[var(--text-faint)]'
                }`}>
                  {done ? <CheckCircle size={14} /> : i + 1}
                </div>
                <span className={`text-sm font-medium ${active ? 'text-[var(--text-primary)]' : done ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)]'}`}>
                  {STEP_LABELS[s]}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight size={14} className="text-[var(--accent-muted)]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Card */}
      <div className="card relative w-full max-w-md rounded-2xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.40),inset_0_1px_0_var(--bg-tinted)]">
        {error && (
          <div className="bg-[rgba(127,29,29,0.20)] border border-[rgba(153,27,27,0.30)] rounded-lg px-4 py-3 mb-5">
            <p className="text-sm text-[var(--danger)]">{error}</p>
          </div>
        )}

        {/* ── Step: Type selection ── */}
        {step === 'type' && (
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">Choose brand type</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6">Select the tracking scope for this brand. Your plan determines slot availability.</p>

            <div className="space-y-3 mb-6">

              {/* Standard brand */}
              {(() => {
                const needsUpgrade = !isOnPaidPlan;
                const noSlots = !needsUpgrade && standardRemaining === 0;
                const locked = needsUpgrade || noSlots;
                return (
                  <button
                    onClick={() => locked ? router.push('/settings/billing') : handleSelectType('starter')}
                    className={`w-full text-left rounded-xl p-4 border transition-[border-color,background-color] cursor-pointer ${
                      locked
                        ? 'border-[var(--border-faint)] bg-[rgba(255,255,255,0.03)] hover:border-[var(--accent-muted)] hover:bg-[rgba(255,255,255,0.05)]'
                        : 'border-[var(--accent-muted)] bg-[var(--accent-muted)] hover:border-[var(--accent)] hover:bg-[var(--accent-muted)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--accent-muted)] border border-[var(--accent-muted)] flex items-center justify-center flex-shrink-0">
                        <BarChart2 size={15} className="text-[var(--accent-foreground)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">Standard brand</p>
                          {!isAdmin && billing && !needsUpgrade && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              standardRemaining === 0
                                ? 'bg-[var(--danger)]/12 text-[var(--danger)]'
                                : 'bg-[var(--accent-muted)] text-[var(--accent-foreground)]'
                            }`}>
                              {standardRemaining === 0 ? 'No slots' : `${standardRemaining} slot${standardRemaining === 1 ? '' : 's'} left`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                          Up to <span className="text-[var(--text-secondary)] font-medium">25 prompts</span>. Full tracking with visibility reports and content drafts.
                        </p>
                        {needsUpgrade && <p className="text-[11px] text-[var(--accent-foreground)] mt-1.5">Requires a paid plan — <span className="underline">upgrade</span></p>}
                        {noSlots && <p className="text-[11px] text-[var(--danger)] mt-1.5">No slots remaining — <span className="underline">upgrade to add more</span></p>}
                      </div>
                    </div>
                  </button>
                );
              })()}

              {/* Pro brand */}
              {(() => {
                const needsUpgrade = !isPro;
                const noSlots = !needsUpgrade && standardRemaining === 0;
                const locked = needsUpgrade || noSlots;
                return (
                  <button
                    onClick={() => locked ? router.push('/settings/billing') : handleSelectType('pro')}
                    className={`w-full text-left rounded-xl p-4 border transition-[border-color,background-color] cursor-pointer ${
                      locked
                        ? 'border-[var(--border-faint)] bg-[rgba(255,255,255,0.03)] hover:border-[var(--color-perplexity)]/28 hover:bg-[rgba(255,255,255,0.05)]'
                        : 'border-[var(--color-perplexity)]/28 bg-[var(--color-perplexity)]/6 hover:border-[var(--accent)] hover:bg-[var(--color-perplexity)]/12'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--color-perplexity)]/12 border border-[var(--color-perplexity)]/28 flex items-center justify-center flex-shrink-0">
                        <Zap size={15} className="text-[var(--accent-foreground)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">Pro brand</p>
                            {!isPro && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-perplexity)]/18 text-[var(--accent-foreground)] border border-[var(--color-perplexity)]/30">
                                PRO
                              </span>
                            )}
                          </div>
                          {isAdmin || (isPro && billing) ? (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              standardRemaining === 0
                                ? 'bg-[var(--danger)]/12 text-[var(--danger)]'
                                : 'bg-[var(--color-perplexity)]/15 text-[var(--accent-foreground)]'
                            }`}>
                              {standardRemaining === 0 ? 'No slots' : isAdmin ? 'Unlimited' : `${standardRemaining} slot${standardRemaining === 1 ? '' : 's'} left`}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                          Up to <span className="text-[var(--text-secondary)] font-medium">30 prompts</span>. Deeper tracking with higher prompt coverage.
                        </p>
                        {needsUpgrade && <p className="text-[11px] text-[var(--accent-foreground)] mt-1.5">Requires a Pro plan — <span className="underline">upgrade</span></p>}
                        {noSlots && <p className="text-[11px] text-[var(--danger)] mt-1.5">No slots remaining — <span className="underline">upgrade to add more</span></p>}
                      </div>
                    </div>
                  </button>
                );
              })()}

              {/* Agency brand — admin-only; redirects to /agency/clients to create AgencyClient + Brand */}
              {isAdmin && (
                <button
                  onClick={() => router.push('/agency/clients?new=1')}
                  className="w-full text-left rounded-xl p-4 border border-[var(--color-claude)]/24 bg-[var(--color-claude)]/5 hover:border-[var(--color-claude)] hover:bg-[var(--color-claude)]/10 transition-[border-color,background-color] cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[var(--color-claude)]/12 border border-[var(--color-claude)]/28 flex items-center justify-center flex-shrink-0">
                      <Building2 size={15} className="text-[var(--accent-foreground)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">Agency brand</p>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-claude)]/18 text-[var(--accent-foreground)] border border-[var(--color-claude)]/30">
                            ADMIN
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                        Set up a new agency client with a linked brand. Continues in the <span className="text-[var(--text-secondary)] font-medium">Agency portal</span>.
                      </p>
                    </div>
                  </div>
                </button>
              )}

              {/* Pitch brand — only shown for free users (paid users get full brands) */}
              {!isOnPaidPlan && (() => {
                const locked = pitchRemaining === 0;
                return (
                  <button
                    onClick={() => !locked && handleSelectType('pitch')}
                    disabled={locked}
                    className={`w-full text-left rounded-xl p-4 border transition-[border-color,background-color] ${
                      locked
                        ? 'border-[var(--bg-tinted)] bg-[rgba(255,255,255,0.02)] opacity-50 cursor-not-allowed'
                        : 'border-[var(--warning)]/22 bg-[var(--warning)]/4 hover:border-[var(--warning)] hover:bg-[var(--warning)]/10 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--warning)]/12 border border-[var(--warning)]/25 flex items-center justify-center flex-shrink-0">
                        {locked ? <Lock size={15} className="text-[var(--text-faint)]" /> : <FileText size={15} className="text-[var(--warning)]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-[var(--text-primary)]">Pitch brand</p>
                          {!isAdmin && billing && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              locked
                                ? 'bg-[var(--danger)]/12 text-[var(--danger)]'
                                : pitchRemaining! >= 999
                                ? 'bg-[var(--warning)]/12 text-[var(--warning)]'
                                : 'bg-[var(--warning)]/12 text-[var(--warning)]'
                            }`}>
                              {locked ? 'No slots' : pitchRemaining! >= 999 ? 'Unlimited' : `${pitchRemaining} slot${pitchRemaining === 1 ? '' : 's'} left`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                          Up to <span className="text-[var(--text-secondary)] font-medium">10 prompts</span>, expires after <span className="text-[var(--text-secondary)] font-medium">30 days</span>. Ideal for one-off snapshots and pitch decks.
                        </p>
                        {locked && <p className="text-[11px] text-[var(--danger)] mt-1.5">No slots remaining — upgrade to add more.</p>}
                      </div>
                    </div>
                  </button>
                );
              })()}
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <ArrowLeft size={12} />
              Cancel
            </button>
          </div>
        )}

        {/* ── Step: Brand details ── */}
        {step === 'details' && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Name your brand</h2>
              {brandChoice === 'pitch' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--warning)]/12 text-[var(--warning)] border border-[var(--warning)]/20">Pitch</span>
              )}
              {brandChoice === 'pro' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-perplexity)]/15 text-[var(--accent-foreground)] border border-[var(--color-perplexity)]/25">Pro</span>
              )}
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              {brandChoice === 'pitch'
                ? 'Pitch brands run for 30 days with up to 10 prompts.'
                : `Up to ${promptLimit} prompts. Give your brand a name and website URL.`}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Brand Name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDetails()}
                  placeholder="Your brand name"
                  autoFocus
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Company Website <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow]"
                />
                <p className="text-xs text-[var(--text-faint)] mt-1">Used to improve content draft quality.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={goBack}
                  className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                  Back
                </button>
                <button onClick={handleDetails} disabled={saving || !brandName.trim() || !websiteUrl.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-muted)] hover:border-[var(--accent-muted)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_var(--accent-muted)] disabled:opacity-50 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step: Prompts ── */}
        {step === 'prompts' && (
          <div>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">What do you want to track?</h2>
              <button
                type="button"
                onClick={handleSuggestPrompts}
                disabled={suggestingPrompts}
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-foreground)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors shrink-0 ml-3 mt-0.5"
              >
                {suggestingPrompts ? <Loader2 size={12} className="animate-spin" /> : <span>✦</span>}
                {suggestingPrompts ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              Add questions people might ask AI models where your brand should appear.{' '}
              <span className="text-[var(--text-muted)]">Up to {promptLimit} prompts.</span>
            </p>
            {suggestError && (
              <p className="text-xs text-[var(--danger)] mb-3">{suggestError}</p>
            )}
            <div className="space-y-2 mb-4">
              {prompts.map((p, i) => (
                <input
                  key={i}
                  type="text"
                  value={p}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  placeholder={i === 0 ? `What is ${brandName}?` : 'Add another prompt…'}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow]"
                />
              ))}
              <div className="flex items-center justify-between px-1 pt-1">
                {prompts.length < promptLimit ? (
                  <button onClick={addPromptRow}
                    className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors py-1">
                    <Plus size={13} />
                    Add another prompt
                  </button>
                ) : <span />}
                <span className={`text-[11px] font-medium tabular-nums ${prompts.length >= promptLimit ? 'text-[var(--warning)]' : 'text-[var(--text-faint)]'}`}>
                  {prompts.length}/{promptLimit}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={goBack}
                className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                Back
              </button>
              <button onClick={handlePrompts} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-muted)] hover:border-[var(--accent-muted)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_var(--accent-muted)] disabled:opacity-50 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Profile ── */}
        {step === 'profile' && (
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">Tell us about the brand</h2>
            <p className="text-sm text-[var(--text-muted)] mb-6">Optional — helps generate better content drafts. You can update this later.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Company description</label>
                <textarea
                  value={companyDescription}
                  onChange={(e) => setCompanyDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of what your company does…"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-faint)] resize-none transition-[border-color,box-shadow]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={goBack}
                className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                Back
              </button>
              <button onClick={handleProfile} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-muted)] hover:border-[var(--accent-muted)] text-[var(--accent-foreground)] hover:text-[var(--text-primary)] hover:shadow-[0_0_24px_var(--accent-muted)] disabled:opacity-50 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Setting up…' : 'Launch brand'}
              </button>
            </div>
            <p className="text-center text-xs text-[var(--text-faint)] mt-4">
              <button onClick={handleProfile} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline transition-colors">
                Skip for now
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
