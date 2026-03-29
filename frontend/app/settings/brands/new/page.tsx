'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Loader2, CheckCircle, ArrowLeft, BarChart2, Zap, FileText, Lock } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import {
  getBillingUsage,
  createBrand,
  updateBrandProfile,
  refreshWebsiteContext,
  normaliseWebsiteUrl,
  triggerRun,
  addPrompt,
  BillingUsage,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

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

  // Profile
  const [companyDescription, setCompanyDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');

  useEffect(() => {
    getBillingUsage()
      .then((b) => setBilling(b))
      .catch(() => {})
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
  const apiBrandType = brandChoice === 'pitch' ? 'pitch' : 'standard';

  function handleSelectType(choice: BrandChoice) {
    setBrandChoice(choice);
    setStep('details');
  }

  async function handleDetails() {
    if (!brandName.trim() || !brandChoice) return;
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
        refreshWebsiteContext(brand.id).catch(() => {});
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
      if (companyDescription || targetAudience) {
        await updateBrandProfile(createdBrandId, {
          company_description: companyDescription || undefined,
          target_audience: targetAudience || undefined,
        });
      }
      try { await triggerRun(createdBrandId); } catch {}
      router.push('/dashboard?newBrand=true');
    } catch {
      router.push('/dashboard?newBrand=true');
    } finally {
      setSaving(false);
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
      <div className="min-h-screen bg-[#080C14] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#6366f1]" />
      </div>
    );
  }

  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-[#080C14] flex flex-col items-center justify-center px-4 py-12">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[15%] -left-[10%] w-[580px] h-[580px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(55,48,163,0.15) 0%, transparent 65%)', filter: 'blur(100px)' }} />
        <div className="absolute -bottom-[18%] -right-[5%] w-[480px] h-[480px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 65%)', filter: 'blur(90px)' }} />
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
                  done ? 'bg-[#10b981] text-white' : active ? 'bg-[#6366f1] text-white shadow-[0_0_12px_rgba(99,102,241,0.40)]' : 'bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] text-[#475569]'
                }`}>
                  {done ? <CheckCircle size={14} /> : i + 1}
                </div>
                <span className={`text-sm font-medium ${active ? 'text-[#F0F4F8]' : done ? 'text-[#64748b]' : 'text-[#475569]'}`}>
                  {STEP_LABELS[s]}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <ChevronRight size={14} className="text-[rgba(99,102,241,0.30)]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-2xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.40),inset_0_1px_0_rgba(255,255,255,0.06)]">
        {error && (
          <div className="bg-[rgba(127,29,29,0.20)] border border-[rgba(153,27,27,0.30)] rounded-lg px-4 py-3 mb-5">
            <p className="text-sm text-[#f87171]">{error}</p>
          </div>
        )}

        {/* ── Step: Type selection ── */}
        {step === 'type' && (
          <div>
            <h2 className="text-xl font-bold text-[#F0F4F8] mb-1">Choose brand type</h2>
            <p className="text-sm text-[#64748B] mb-6">Select the tracking scope for this brand. Your plan determines slot availability.</p>

            <div className="space-y-3 mb-6">

              {/* Starter brand */}
              {(() => {
                const locked = !isOnPaidPlan || standardRemaining === 0;
                const lockedMsg = !isOnPaidPlan
                  ? 'Requires a paid plan.'
                  : 'No slots remaining — upgrade to add more.';
                return (
                  <button
                    onClick={() => !locked && handleSelectType('starter')}
                    disabled={locked}
                    className={`w-full text-left rounded-xl p-4 border transition-all ${
                      locked
                        ? 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] opacity-50 cursor-not-allowed'
                        : 'border-[rgba(99,102,241,0.22)] bg-[rgba(99,102,241,0.04)] hover:border-[#6366f1] hover:bg-[rgba(99,102,241,0.10)] cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.25)] flex items-center justify-center flex-shrink-0">
                        {locked ? <Lock size={15} className="text-[#475569]" /> : <BarChart2 size={15} className="text-[#818cf8]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-[#E2E8F0]">Starter brand</p>
                          {!isAdmin && billing && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              standardRemaining === 0
                                ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]'
                                : 'bg-[rgba(99,102,241,0.15)] text-[#818cf8]'
                            }`}>
                              {standardRemaining === 0 ? 'No slots' : `${standardRemaining} slot${standardRemaining === 1 ? '' : 's'} left`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#64748B] leading-relaxed">
                          Up to <span className="text-[#94A3B8] font-medium">25 prompts</span>. Full tracking with visibility reports and content drafts.
                        </p>
                        {locked && <p className="text-[11px] text-[#f87171] mt-1.5">{lockedMsg}</p>}
                      </div>
                    </div>
                  </button>
                );
              })()}

              {/* Pro brand */}
              {(() => {
                const locked = !isPro || standardRemaining === 0;
                const lockedMsg = !isPro
                  ? 'Requires a Pro plan.'
                  : 'No slots remaining — upgrade to add more.';
                return (
                  <button
                    onClick={() => !locked && handleSelectType('pro')}
                    disabled={locked}
                    className={`w-full text-left rounded-xl p-4 border transition-all ${
                      locked
                        ? 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] opacity-50 cursor-not-allowed'
                        : 'border-[rgba(139,92,246,0.28)] bg-[rgba(139,92,246,0.06)] hover:border-[#8b5cf6] hover:bg-[rgba(139,92,246,0.12)] cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[rgba(139,92,246,0.12)] border border-[rgba(139,92,246,0.28)] flex items-center justify-center flex-shrink-0">
                        {locked ? <Lock size={15} className="text-[#475569]" /> : <Zap size={15} className="text-[#a78bfa]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[#E2E8F0]">Pro brand</p>
                            {!isPro && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[rgba(139,92,246,0.18)] text-[#a78bfa] border border-[rgba(139,92,246,0.30)]">
                                PRO
                              </span>
                            )}
                          </div>
                          {isAdmin || (isPro && billing) ? (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              standardRemaining === 0
                                ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]'
                                : 'bg-[rgba(139,92,246,0.15)] text-[#a78bfa]'
                            }`}>
                              {standardRemaining === 0 ? 'No slots' : isAdmin ? 'Unlimited' : `${standardRemaining} slot${standardRemaining === 1 ? '' : 's'} left`}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-[#64748B] leading-relaxed">
                          Up to <span className="text-[#94A3B8] font-medium">100 prompts</span>. Deeper tracking with higher prompt coverage.
                        </p>
                        {locked && <p className="text-[11px] text-[#f87171] mt-1.5">{lockedMsg}</p>}
                      </div>
                    </div>
                  </button>
                );
              })()}

              {/* Pitch brand */}
              {(() => {
                const locked = pitchRemaining === 0;
                return (
                  <button
                    onClick={() => !locked && handleSelectType('pitch')}
                    disabled={locked}
                    className={`w-full text-left rounded-xl p-4 border transition-all ${
                      locked
                        ? 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] opacity-50 cursor-not-allowed'
                        : 'border-[rgba(245,158,11,0.22)] bg-[rgba(245,158,11,0.04)] hover:border-[#f59e0b] hover:bg-[rgba(245,158,11,0.10)] cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.25)] flex items-center justify-center flex-shrink-0">
                        {locked ? <Lock size={15} className="text-[#475569]" /> : <FileText size={15} className="text-[#f59e0b]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-[#E2E8F0]">Pitch brand</p>
                          {!isAdmin && billing && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              locked
                                ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]'
                                : pitchRemaining! >= 999
                                ? 'bg-[rgba(245,158,11,0.12)] text-[#f59e0b]'
                                : 'bg-[rgba(245,158,11,0.12)] text-[#f59e0b]'
                            }`}>
                              {locked ? 'No slots' : pitchRemaining! >= 999 ? 'Unlimited' : `${pitchRemaining} slot${pitchRemaining === 1 ? '' : 's'} left`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#64748B] leading-relaxed">
                          Up to <span className="text-[#94A3B8] font-medium">10 prompts</span>, expires after <span className="text-[#94A3B8] font-medium">30 days</span>. Ideal for one-off snapshots and pitch decks.
                        </p>
                        {locked && <p className="text-[11px] text-[#f87171] mt-1.5">No slots remaining — upgrade to add more.</p>}
                      </div>
                    </div>
                  </button>
                );
              })()}
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#94A3B8] transition-colors"
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
              <h2 className="text-xl font-bold text-[#F0F4F8]">Name your brand</h2>
              {brandChoice === 'pitch' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(245,158,11,0.12)] text-[#f59e0b] border border-[rgba(245,158,11,0.20)]">Pitch</span>
              )}
              {brandChoice === 'pro' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[rgba(139,92,246,0.15)] text-[#a78bfa] border border-[rgba(139,92,246,0.25)]">Pro</span>
              )}
            </div>
            <p className="text-sm text-[#64748B] mb-6">
              {brandChoice === 'pitch'
                ? 'Pitch brands run for 30 days with up to 10 prompts.'
                : `Up to ${promptLimit} prompts. Give your brand a name and optionally link your website.`}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Brand Name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDetails()}
                  placeholder="Acme Inc."
                  autoFocus
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] placeholder:text-[#475569] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  Company Website <span className="text-[#475569] font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] placeholder:text-[#475569] transition-all"
                />
                <p className="text-xs text-[#475569] mt-1">Used to improve content draft quality.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={goBack}
                  className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                  Back
                </button>
                <button onClick={handleDetails} disabled={saving || !brandName.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors shadow-[0_0_20px_rgba(99,102,241,0.25)]">
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
            <h2 className="text-xl font-bold text-[#F0F4F8] mb-1">What do you want to track?</h2>
            <p className="text-sm text-[#64748B] mb-6">
              Add questions people might ask AI models where your brand should appear.{' '}
              <span className="text-[#64748B]">Up to {promptLimit} prompts.</span>
            </p>
            <div className="space-y-2 mb-4">
              {prompts.map((p, i) => (
                <input
                  key={i}
                  type="text"
                  value={p}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  placeholder={i === 0 ? `What is ${brandName}?` : 'Add another prompt…'}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] placeholder:text-[#475569] transition-all"
                />
              ))}
              <div className="flex items-center justify-between px-1 pt-1">
                {prompts.length < promptLimit ? (
                  <button onClick={addPromptRow}
                    className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors py-1">
                    <Plus size={13} />
                    Add another prompt
                  </button>
                ) : <span />}
                <span className={`text-[11px] font-medium tabular-nums ${prompts.length >= promptLimit ? 'text-[#f59e0b]' : 'text-[#475569]'}`}>
                  {prompts.length}/{promptLimit}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={goBack}
                className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                Back
              </button>
              <button onClick={handlePrompts} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Profile ── */}
        {step === 'profile' && (
          <div>
            <h2 className="text-xl font-bold text-[#F0F4F8] mb-1">Tell us about the brand</h2>
            <p className="text-sm text-[#64748B] mb-6">Optional — helps generate better content drafts. You can update this later.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Company description</label>
                <textarea
                  value={companyDescription}
                  onChange={(e) => setCompanyDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of what your company does…"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] placeholder:text-[#475569] resize-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Target audience</label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g. B2B SaaS companies, healthcare professionals…"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] placeholder:text-[#475569] transition-all"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={goBack}
                className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                Back
              </button>
              <button onClick={handleProfile} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? 'Setting up…' : 'Launch brand'}
              </button>
            </div>
            <p className="text-center text-xs text-[#475569] mt-4">
              <button onClick={handleProfile} className="text-[#64748B] hover:text-[#94A3B8] underline transition-colors">
                Skip for now
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
