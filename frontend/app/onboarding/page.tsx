'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, ChevronRight, Plus, Loader2, CheckCircle } from 'lucide-react';
import {
  getBrands,
  createBrand,
  updateBrandProfile,
  refreshWebsiteContext,
  normaliseWebsiteUrl,
  triggerRun,
  Brand,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: brand name + website
  const [brandName, setBrandName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [createdBrandId, setCreatedBrandId] = useState<number | null>(null);

  // Step 2: prompts
  const [prompts, setPrompts] = useState<string[]>(['']);

  // Step 3: profile basics
  const [companyDescription, setCompanyDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');

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
    if (!brandName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const normalisedUrl = normaliseWebsiteUrl(websiteUrl);
      const brand = await createBrand({
        name: brandName.trim(),
        tier: 'basic',
        prompts: [],
        website_url: normalisedUrl ?? undefined,
      });
      setCreatedBrandId(brand.id);
      // Fire-and-forget Jina fetch if website provided
      if (normalisedUrl) {
        refreshWebsiteContext(brand.id).catch((err) => {
          console.warn('[Onboarding] Jina fetch failed for brand', brand.id, err);
        });
      }
      setStep(2);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to create brand');
    } finally {
      setSaving(false);
    }
  }

  async function handleStep2() {
    if (!createdBrandId) return;
    setSaving(true);
    setError('');
    try {
      const validPrompts = prompts.filter((p) => p.trim());
      if (validPrompts.length > 0) {
        const { addPrompt } = await import('@/lib/api');
        await Promise.all(validPrompts.map((p) => addPrompt(createdBrandId, p.trim())));
      }
      setStep(3);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save prompts');
    } finally {
      setSaving(false);
    }
  }

  async function handleStep3() {
    if (!createdBrandId) return;
    setSaving(true);
    setError('');
    try {
      if (companyDescription || targetAudience) {
        await updateBrandProfile(createdBrandId, {
          company_description: companyDescription || undefined,
          target_audience: targetAudience || undefined,
        });
      }
      // Auto-trigger a tracking run for the new brand
      try {
        const runResult = await triggerRun(createdBrandId);
        console.info('[Onboarding] Auto-run triggered — brand_id=%d run_id=%d', createdBrandId, runResult.run_id);
      } catch (err) {
        console.warn('[Onboarding] Auto-run failed for brand_id=%d (non-fatal):', createdBrandId, err);
      }
      router.push('/dashboard?newBrand=true');
    } catch {
      // Profile save is optional — still proceed
      router.push('/dashboard?newBrand=true');
    } finally {
      setSaving(false);
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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[#6366f1]" />
      </div>
    );
  }

  const stepLabels = ['Brand', 'Prompts', 'Profile'];

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-9 h-9 rounded-xl bg-[#6366f1] flex items-center justify-center">
          <Zap size={18} className="text-white" fill="white" />
        </div>
        <span className="text-xl font-bold text-[#e2e8f0]">ClarityAI</span>
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
                  done ? 'bg-[#10b981] text-white' : active ? 'bg-[#6366f1] text-white' : 'bg-[#1a1a24] border border-[#2a2a3a] text-[#475569]'
                }`}>
                  {done ? <CheckCircle size={14} /> : s}
                </div>
                <span className={`text-sm font-medium ${active ? 'text-[#e2e8f0]' : done ? 'text-[#64748b]' : 'text-[#475569]'}`}>
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <ChevronRight size={14} className="text-[#2a2a3a]" />
              )}
            </div>
          );
        })}
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-[#111118] border border-[#1e1e2e] rounded-2xl p-8">
        {error && (
          <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-lg px-4 py-3 mb-5">
            <p className="text-sm text-[#f87171]">{error}</p>
          </div>
        )}

        {/* Step 1: Brand name */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-[#e2e8f0] mb-1">What&apos;s your brand?</h2>
            <p className="text-sm text-[#64748b] mb-6">Enter the name of the brand you want to track across AI models.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Brand Name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStep1()}
                  placeholder="e.g. Acme Corp, MyProduct, ..."
                  autoFocus
                  className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Company Website <span className="text-[#475569] font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                />
                <p className="text-xs text-[#475569] mt-1">We&apos;ll use this to improve content draft quality.</p>
              </div>
              <button
                onClick={handleStep1}
                disabled={saving || !brandName.trim()}
                className="w-full flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Prompts */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-[#e2e8f0] mb-1">What do you want to track?</h2>
            <p className="text-sm text-[#64748b] mb-6">Add questions that people might ask AI models where your brand could come up.</p>
            <div className="space-y-2 mb-4">
              {prompts.map((p, i) => (
                <input
                  key={i}
                  type="text"
                  value={p}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  placeholder={i === 0 ? `What is ${brandName}?` : 'Add another prompt…'}
                  className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                />
              ))}
              {prompts.length < 10 && (
                <button
                  onClick={addPromptRow}
                  className="flex items-center gap-1.5 text-xs text-[#64748b] hover:text-[#94a3b8] transition-colors px-1 py-1"
                >
                  <Plus size={13} />
                  Add another prompt
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
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
            <h2 className="text-xl font-bold text-[#e2e8f0] mb-1">Tell us about your brand</h2>
            <p className="text-sm text-[#64748b] mb-6">Optional — helps generate better content drafts. You can update this later.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Company description</label>
                <textarea
                  value={companyDescription}
                  onChange={(e) => setCompanyDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of what your company does…"
                  className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] resize-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">Target audience</label>
                <input
                  type="text"
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g. B2B SaaS companies, healthcare professionals…"
                  className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#475569] transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep(2)}
                className="flex-1 bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
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
              <button onClick={handleStep3} className="text-[#64748b] hover:text-[#94a3b8] underline transition-colors">
                Skip for now
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
