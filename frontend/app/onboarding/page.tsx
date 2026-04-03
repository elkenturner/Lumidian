'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Loader2, CheckCircle } from 'lucide-react';
import LumidianLogo from '@/components/LumidianLogo';
import {
  getBrands,
  getSuggestedPromptsPreview,
  createBrand,
  updateBrandProfile,
  fetchWebsiteContext,
  normaliseWebsiteUrl,
  triggerRun,
} from '@/lib/api';
type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: brand name + website
  const [brandName, setBrandName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteContext, setWebsiteContext] = useState('');
  const [fetching, setFetching] = useState(false);

  // Step 2: prompts
  const [prompts, setPrompts] = useState<string[]>(['']);
  const [suggestingPrompts, setSuggestingPrompts] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  // Step 3: profile basics
  const [companyDescription, setCompanyDescription] = useState('');

  useEffect(() => {
    // Skip onboarding if brand already exists
    getBrands()
      .then((brands) => {
        if (brands.length > 0) router.replace('/dashboard');
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  async function handleStep1() {
    if (!brandName.trim() || !websiteUrl.trim()) return;
    setFetching(true);
    setError('');
    try {
      const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
      if (!normalisedUrl) {
        setError('Please enter a valid website URL.');
        return;
      }
      const result = await fetchWebsiteContext(normalisedUrl);
      setWebsiteContext(result.context);
      setStep(2);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to fetch website. Please check the URL and try again.');
    } finally {
      setFetching(false);
    }
  }

  async function handleStep2() {
    setSaving(true);
    setError('');
    try {
      // Pre-fill description from website context if available and not already set
      if (websiteContext && !companyDescription) {
        const firstLine = websiteContext
          .split(/\n+/)
          .map((l) => l.trim())
          .find((l) => l.length > 20 && !l.startsWith('#') && !l.startsWith('http') && !l.startsWith('['));
        if (firstLine) setCompanyDescription(firstLine.slice(0, 300));
      }
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function handleStep3() {
    setSaving(true);
    setError('');
    try {
      // 1. Create brand with prompts
      const validPrompts = prompts.filter((p) => p.trim());
      const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
      const brand = await createBrand({
        name: brandName.trim(),
        tier: 'basic',
        brand_type: 'pitch',
        prompts: validPrompts.length > 0 ? validPrompts : [],
        website_url: normalisedUrl ?? undefined,
      });

      // 2. Update profile with description + website context
      try {
        await updateBrandProfile(brand.id, {
          company_description: companyDescription || undefined,
          internal_brand_context: websiteContext || undefined,
        });
      } catch {
        // Profile update is non-fatal
        console.warn('[Onboarding] Profile update failed (non-fatal)');
      }

      // 3. Trigger tracking run
      try {
        const runResult = await triggerRun(brand.id);
        console.info('[Onboarding] Auto-run triggered — brand_id=%d run_id=%d', brand.id, runResult.run_id);
      } catch (err) {
        console.warn('[Onboarding] Auto-run failed (non-fatal):', err);
      }

      // 4. Redirect
      router.push(`/dashboard?newBrand=true&brandId=${brand.id}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail || 'Failed to create brand');
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggestPrompts() {
    if (!brandName.trim()) return;
    setSuggestingPrompts(true);
    setSuggestError('');
    try {
      const suggestions = await getSuggestedPromptsPreview(
        brandName.trim(),
        '',
        websiteContext,
      );
      setPrompts(suggestions.slice(0, 10));
    } catch {
      setSuggestError('Could not generate suggestions. Try again.');
    } finally {
      setSuggestingPrompts(false);
    }
  }

  function addPromptRow() {
    if (prompts.length < 10) setPrompts([...prompts, '']);
  }

  function updatePrompt(i: number, val: string) {
    const next = [...prompts];
    next[i] = val;
    setPrompts(next);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080C14] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#6366f1]" />
      </div>
    );
  }

  const stepLabels = ['Brand', 'Prompts', 'Profile'];

  return (
    <div className="min-h-screen bg-[#080C14] flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <LumidianLogo size={36} withWordmark />
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-3 mb-8">
        {stepLabels.map((label, i) => {
          const s = (i + 1) as Step;
          const done = step > s;
          const active = step === s;
          return (
            <div key={label} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done ? 'bg-[#10b981] text-white' : active ? 'bg-[#6366f1] text-white shadow-[0_0_12px_rgba(99,102,241,0.40)]' : 'bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.22)] text-[#475569]'
                }`}>
                  {done ? <CheckCircle size={14} /> : s}
                </div>
                <span className={`text-sm font-medium ${active ? 'text-[#F0F4F8]' : done ? 'text-[#64748b]' : 'text-[#475569]'}`}>
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <ChevronRight size={14} className="text-[rgba(99,102,241,0.30)]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-[rgba(99,102,241,0.06)] backdrop-blur-md border border-[rgba(99,102,241,0.22)] rounded-2xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.40),inset_0_1px_0_rgba(255,255,255,0.06)]">
        {error && (
          <div className="bg-[rgba(127,29,29,0.20)] border border-[rgba(153,27,27,0.30)] rounded-lg px-4 py-3 mb-5">
            <p className="text-sm text-[#f87171]">{error}</p>
          </div>
        )}

        {/* Step 1: Brand name */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-[#F0F4F8] mb-1">What&apos;s your brand?</h2>
            <p className="text-sm text-[#64748B] mb-6">We&apos;ll track how AI models mention your brand and generate a pitch deck with your visibility data. Free for 30 days.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Brand Name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStep1()}
                  placeholder="Your brand name"
                  autoFocus
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 placeholder:text-[#475569] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Company Website <span className="text-[#ef4444]">*</span></label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 placeholder:text-[#475569] transition-all"
                />
                <p className="text-xs text-[#475569] mt-1">We&apos;ll use this to improve content draft quality.</p>
              </div>
              <button
                onClick={handleStep1}
                disabled={fetching || !brandName.trim() || !websiteUrl.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors shadow-[0_0_20px_rgba(99,102,241,0.25)]"
              >
                {fetching ? <Loader2 size={14} className="animate-spin" /> : null}
                {fetching ? 'Fetching website...' : 'Fetch & Continue'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Prompts */}
        {step === 2 && (
          <div>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-xl font-bold text-[#F0F4F8]">What do you want to track?</h2>
              <button
                type="button"
                onClick={handleSuggestPrompts}
                disabled={suggestingPrompts}
                className="flex items-center gap-1.5 text-xs font-medium text-[#a78bfa] hover:text-[#c4b5fd] disabled:opacity-50 transition-colors shrink-0 ml-3 mt-0.5"
              >
                {suggestingPrompts ? <Loader2 size={12} className="animate-spin" /> : <span>✦</span>}
                {suggestingPrompts ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
            <p className="text-sm text-[#64748B] mb-6">Add questions that people might ask AI models where your brand could come up.</p>
            {suggestError && (
              <p className="text-xs text-[#f87171] mb-3">{suggestError}</p>
            )}
            <div className="space-y-2 mb-4">
              {prompts.map((p, i) => (
                <input
                  key={i}
                  type="text"
                  value={p}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  placeholder={i === 0 ? `What is ${brandName}?` : 'Add another prompt…'}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 placeholder:text-[#475569] transition-all"
                />
              ))}
              <div className="flex items-center justify-between px-1 pt-1">
                {prompts.length < 10 ? (
                  <button
                    onClick={addPromptRow}
                    className="flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#94A3B8] transition-colors py-1"
                  >
                    <Plus size={13} />
                    Add another prompt
                  </button>
                ) : <span />}
                <span className={`text-[11px] font-medium tabular-nums ${prompts.length >= 10 ? 'text-[#f59e0b]' : 'text-[#475569]'}`}>
                  {prompts.length}/10
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleStep2}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Profile basics */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold text-[#F0F4F8] mb-1">Tell us about your brand</h2>
            <p className="text-sm text-[#64748B] mb-6">Optional — helps generate better content drafts. You can update this later.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Company description</label>
                <textarea
                  value={companyDescription}
                  onChange={(e) => setCompanyDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of what your company does…"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(99,102,241,0.22)] text-[#F0F4F8] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/50 placeholder:text-[#475569] resize-none transition-all"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep(2)}
                className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.09)] border border-[rgba(99,102,241,0.22)] text-[#94A3B8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleStep3}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {saving ? 'Setting up…' : 'Go to Dashboard'}
              </button>
            </div>
            <p className="text-center text-xs text-[#475569] mt-4">
              <button onClick={handleStep3} className="text-[#64748B] hover:text-[#94A3B8] underline transition-colors">
                Skip for now
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
