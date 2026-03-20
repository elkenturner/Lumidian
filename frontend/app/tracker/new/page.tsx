'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Zap, Check, ChevronRight,
  Loader2, Sparkles, X, Clock, Tag,
} from 'lucide-react';
import { createBrand, triggerRun, getSuggestedPromptsPreview } from '@/lib/api';
import clsx from 'clsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_OPTIONS = [
  {
    value: 'basic',
    label: 'Basic',
    runs: '5 queries per prompt',
    description: 'Perfect for small brands starting out.',
    features: ['5 queries per model per run', 'All major AI models', 'Basic analytics'],
    color: '#94a3b8',
    activeBorder: 'border-[#94a3b8]',
    activeBg: 'bg-[#94a3b8]/5',
    badge: 'bg-[#64748b]/20 text-[#94a3b8]',
  },
  {
    value: 'standard',
    label: 'Standard',
    runs: '10 queries per prompt',
    description: 'Great for growing brands that need more data.',
    features: ['10 queries per model per run', 'All major AI models', 'Full analytics + trends'],
    color: '#f59e0b',
    activeBorder: 'border-[#f59e0b]',
    activeBg: 'bg-[#f59e0b]/5',
    badge: 'bg-[#f59e0b]/20 text-[#f59e0b]',
    popular: true,
  },
  {
    value: 'premium',
    label: 'Premium',
    runs: '20 queries per prompt',
    description: 'Maximum coverage for serious brands.',
    features: ['20 queries per model per run', 'All major AI models', 'Advanced analytics + export'],
    color: '#6366f1',
    activeBorder: 'border-[#6366f1]',
    activeBg: 'bg-[#6366f1]/10',
    badge: 'bg-[#6366f1]/20 text-[#818cf8]',
  },
];

const STEPS = ['Brand Info', 'Tracking Prompts', 'Review & Launch'];
const PITCH_PROMPT_LIMIT = 10;

// ── Prompt type label (display only) ─────────────────────────────────────────

type PromptType = 'standard' | 'pitch';

interface PromptEntry {
  text: string;
  type: PromptType;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewBrandPage() {
  const router = useRouter();
  useEffect(() => { document.title = 'Add Brand — ClarityAI'; }, []);
  const [step, setStep] = useState(0);

  // Form data
  const [name, setName] = useState('');
  const [tier, setTier] = useState('standard');
  const [brandType, setBrandType] = useState<'standard' | 'pitch'>('standard');
  const [promptInput, setPromptInput] = useState('');
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  // AI suggestions
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  const isPitch = brandType === 'pitch';
  const promptLimit = isPitch ? PITCH_PROMPT_LIMIT : undefined;
  const canAddMore = promptLimit === undefined || prompts.length < promptLimit;

  function addPrompt(text?: string) {
    const trimmed = (text ?? promptInput).trim();
    if (!trimmed || prompts.some((p) => p.text === trimmed)) return;
    if (!canAddMore) return;
    const type: PromptType = isPitch ? 'pitch' : 'standard';
    setPrompts((prev) => [...prev, { text: trimmed, type }]);
    if (!text) setPromptInput('');
  }

  function removePrompt(idx: number) {
    setPrompts((prev) => prev.filter((_, i) => i !== idx));
  }

  function togglePromptType(idx: number) {
    if (isPitch) return; // pitch brands lock all prompts to pitch type
    setPrompts((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, type: p.type === 'standard' ? 'pitch' : 'standard' } : p
      )
    );
  }

  function removeSuggestion(idx: number) {
    setSuggestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function addSuggestion(text: string, idx: number) {
    addPrompt(text);
    removeSuggestion(idx);
  }

  const fetchSuggestions = useCallback(async () => {
    if (!name.trim() || suggestionsLoaded) return;
    setLoadingSuggestions(true);
    try {
      const results = await getSuggestedPromptsPreview(name.trim());
      setSuggestions(results.slice(0, isPitch ? PITCH_PROMPT_LIMIT : results.length));
      setSuggestionsLoaded(true);
    } catch {
      // Non-fatal
    } finally {
      setLoadingSuggestions(false);
    }
  }, [name, suggestionsLoaded, isPitch]);

  // Reset suggestions when brand type changes
  useEffect(() => {
    setSuggestions([]);
    setSuggestionsLoaded(false);
    setPrompts([]);
  }, [brandType]);

  async function goNext() {
    setError('');
    if (step === 0) {
      if (!name.trim()) { setError('Please enter a brand name.'); return; }
      setStep(1);
      fetchSuggestions();
      return;
    }
    if (step === 1) {
      if (prompts.length === 0) { setError('Add at least one prompt.'); return; }
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    setError('');
    setStep((s) => s - 1);
  }

  async function handleLaunch() {
    if (!name.trim() || prompts.length === 0) return;
    setCreating(true);
    setError('');
    try {
      const brand = await createBrand({
        name: name.trim(),
        tier,
        brand_type: brandType,
        prompts: prompts.map((p) => p.text),
      });
      await triggerRun(brand.id);
      router.push(`/dashboard?newBrand=true&brandId=${brand.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Failed to create brand. Please check your connection and try again.');
      setCreating(false);
    }
  }

  const selectedTier = TIER_OPTIONS.find((t) => t.value === tier)!;
  const progress = ((step + 1) / STEPS.length) * 100;

  // Expiry notice for review
  const pitchExpiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/tracker" className="text-[#64748b] hover:text-[#94a3b8] transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[#e2e8f0]">Track New Brand</h1>
          <p className="text-sm text-[#64748b] mt-0.5">Set up a new brand to monitor its AI visibility</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={clsx(
                'text-xs font-medium transition-colors',
                i === step ? 'text-[#818cf8]' : i < step ? 'text-[#22c55e]' : 'text-[#475569]'
              )}
            >
              {i < step ? <Check size={11} className="inline mr-1" /> : null}
              {label}
            </span>
          ))}
        </div>
        <div className="h-1.5 bg-[#1a1a24] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#6366f1] to-[#818cf8] rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-right text-xs text-[#475569] mt-1">Step {step + 1} of {STEPS.length}</p>
      </div>

      {/* Step 0: Brand Info */}
      {step === 0 && (
        <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">Brand Information</h2>
            <p className="text-sm text-[#64748b]">Tell us about the brand you want to track</p>
          </div>

          {/* Brand name */}
          <div>
            <label className="block text-sm font-medium text-[#94a3b8] mb-2">
              Brand Name <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && goNext()}
              placeholder="e.g. Acme Corp, Notion, Linear..."
              autoFocus
              className="w-full bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#64748b]"
            />
          </div>

          {/* Brand type */}
          <div>
            <label className="block text-sm font-medium text-[#94a3b8] mb-3">Brand Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setBrandType('standard')}
                className={clsx(
                  'border rounded-xl p-4 text-left transition-all duration-150',
                  brandType === 'standard'
                    ? 'border-[#6366f1] bg-[#6366f1]/8'
                    : 'border-[#1e1e2e] bg-[#1a1a24] hover:border-[#2a2a3e]'
                )}
              >
                <div className="text-xs font-bold px-2 py-1 rounded-md inline-block mb-2 bg-[#6366f1]/20 text-[#818cf8]">
                  Standard
                </div>
                <p className="text-sm font-semibold text-[#e2e8f0]">Ongoing tracking</p>
                <p className="text-xs text-[#64748b] mt-1 leading-snug">
                  Permanent brand. Up to 25–100 prompts depending on your plan. Includes scheduled runs.
                </p>
              </button>

              <button
                onClick={() => setBrandType('pitch')}
                className={clsx(
                  'border rounded-xl p-4 text-left transition-all duration-150 relative',
                  brandType === 'pitch'
                    ? 'border-[#f59e0b] bg-[#f59e0b]/5'
                    : 'border-[#1e1e2e] bg-[#1a1a24] hover:border-[#2a2a3e]'
                )}
              >
                <span className="absolute -top-2.5 right-3 bg-[#f59e0b] text-[#0a0a0f] text-xs font-bold px-2 py-0.5 rounded-full">
                  All plans
                </span>
                <div className="text-xs font-bold px-2 py-1 rounded-md inline-block mb-2 bg-[#f59e0b]/20 text-[#f59e0b]">
                  Pitch Deck
                </div>
                <p className="text-sm font-semibold text-[#e2e8f0]">7-day snapshot</p>
                <p className="text-xs text-[#64748b] mt-1 leading-snug">
                  Up to 10 prompts. Expires after 7 days. Great for demos, proposals, or quick visibility checks.
                </p>
              </button>
            </div>
          </div>

          {/* Plan tier — only for standard brands */}
          {!isPitch && (
            <div>
              <label className="block text-sm font-medium text-[#94a3b8] mb-3">
                Plan Tier <span className="text-[#ef4444]">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TIER_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTier(t.value)}
                    className={clsx(
                      'relative border rounded-xl p-4 text-left transition-all duration-150',
                      tier === t.value
                        ? `${t.activeBorder} ${t.activeBg}`
                        : 'border-[#1e1e2e] bg-[#1a1a24] hover:border-[#2a2a3e]'
                    )}
                  >
                    {t.popular && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#f59e0b] text-[#0a0a0f] text-xs font-bold px-2 py-0.5 rounded-full">
                        Popular
                      </span>
                    )}
                    <div className={`text-xs font-bold px-2 py-1 rounded-md inline-block mb-2 ${t.badge}`}>
                      {t.label}
                    </div>
                    <p className="text-sm font-semibold text-[#e2e8f0]">{t.runs}</p>
                    <p className="text-xs text-[#64748b] mt-1 leading-snug">{t.description}</p>
                    <ul className="mt-3 space-y-1">
                      {t.features.map((f) => (
                        <li key={f} className="flex items-start gap-1.5">
                          <Check size={10} className="text-[#22c55e] flex-shrink-0 mt-0.5" />
                          <span className="text-xs text-[#94a3b8] leading-snug">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pitch notice */}
          {isPitch && (
            <div className="flex items-start gap-3 bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-xl px-4 py-3">
              <Clock size={14} className="text-[#f59e0b] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#f59e0b]">Pitch deck — expires in 7 days</p>
                <p className="text-xs text-[#64748b] mt-0.5">
                  Add up to 10 prompts. Tracking will stop automatically after 7 days. Upgrade to a standard brand for ongoing monitoring.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={goNext}
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            >
              Continue
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Add Prompts */}
      {step === 1 && (
        <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">Tracking Prompts</h2>
              {promptLimit && (
                <span className={clsx(
                  'text-xs font-semibold px-2.5 py-1 rounded-full border',
                  prompts.length >= promptLimit
                    ? 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30'
                    : 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30'
                )}>
                  {prompts.length}/{promptLimit} prompts
                </span>
              )}
            </div>
            <p className="text-sm text-[#64748b]">
              Prompts are queries users ask AI models where <strong className="text-[#94a3b8]">{name}</strong> should appear.
              {isPitch && <span className="text-[#f59e0b]"> Max {PITCH_PROMPT_LIMIT} for pitch decks.</span>}
            </p>
          </div>

          {/* Prompt type legend — for standard brands */}
          {!isPitch && (
            <div className="flex items-center gap-4 text-xs text-[#64748b]">
              <span className="flex items-center gap-1.5">
                <Tag size={10} className="text-[#6366f1]" />
                <span className="text-[#818cf8] font-medium">Standard</span> — ongoing tracking
              </span>
              <span className="flex items-center gap-1.5">
                <Tag size={10} className="text-[#f59e0b]" />
                <span className="text-[#f59e0b] font-medium">Pitch</span> — demo / proposal set
              </span>
              <span className="text-[#334155]">Click label to toggle</span>
            </div>
          )}

          {/* AI Suggestions */}
          {(loadingSuggestions || suggestions.length > 0) && (
            <div className="bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.20)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                {loadingSuggestions
                  ? <Loader2 size={13} className="animate-spin text-[#818cf8]" />
                  : <Sparkles size={13} className="text-[#818cf8]" />}
                <span className="text-sm font-medium text-[#818cf8]">
                  {loadingSuggestions ? 'Generating AI suggestions…' : `${suggestions.length} suggested prompts`}
                </span>
              </div>

              {!loadingSuggestions && suggestions.length > 0 && (
                <div className="space-y-1.5">
                  {suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 group">
                      <span className="text-xs text-[#64748b] flex-1 leading-relaxed pt-0.5">{s}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => addSuggestion(s, i)}
                          disabled={prompts.some((p) => p.text === s) || !canAddMore}
                          className="flex items-center gap-1 text-xs text-[#6366f1] hover:text-[#818cf8] disabled:opacity-40 disabled:cursor-default transition-colors px-2 py-0.5 rounded"
                        >
                          <Plus size={11} />
                          {prompts.some((p) => p.text === s) ? 'Added' : !canAddMore ? 'Limit reached' : 'Add'}
                        </button>
                        <button
                          onClick={() => removeSuggestion(i)}
                          className="text-[#475569] hover:text-[#64748b] transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {canAddMore && (
                    <button
                      onClick={() => {
                        suggestions.forEach((s) => addPrompt(s));
                        setSuggestions([]);
                      }}
                      className="mt-2 text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors"
                    >
                      Add all suggestions
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Manual input */}
          <div>
            <label className="block text-sm font-medium text-[#94a3b8] mb-2">Add custom prompt</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canAddMore && addPrompt()}
                placeholder="What is the best project management tool?"
                disabled={!canAddMore}
                className="flex-1 bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#64748b] disabled:opacity-50"
              />
              <button
                onClick={() => addPrompt()}
                disabled={!promptInput.trim() || !canAddMore}
                className="flex items-center gap-1.5 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                <Plus size={15} />
                Add
              </button>
            </div>
            <p className="text-xs text-[#64748b] mt-1.5">Press Enter to quickly add</p>
          </div>

          {/* Added prompts */}
          {prompts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[#94a3b8]">Your prompts ({prompts.length})</span>
                <button onClick={() => setPrompts([])} className="text-xs text-[#64748b] hover:text-[#ef4444] transition-colors">
                  Clear all
                </button>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {prompts.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg px-4 py-3 group hover:border-[#2a2a3e] transition-colors">
                    <span className="text-xs font-mono text-[#6366f1] flex-shrink-0 mt-0.5 w-5 text-right">{i + 1}.</span>
                    <span className="text-sm text-[#94a3b8] flex-1 leading-relaxed">{p.text}</span>
                    {/* Prompt type toggle */}
                    <button
                      onClick={() => togglePromptType(i)}
                      disabled={isPitch}
                      title={isPitch ? 'All prompts in a pitch brand are pitch type' : 'Click to toggle prompt type'}
                      className={clsx(
                        'flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 transition-colors',
                        p.type === 'pitch'
                          ? 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30'
                          : 'text-[#818cf8] bg-[#6366f1]/10 border-[#6366f1]/20',
                        !isPitch && 'hover:opacity-80 cursor-pointer',
                        isPitch && 'cursor-default',
                      )}
                    >
                      <Tag size={9} />
                      {p.type === 'pitch' ? 'Pitch' : 'Standard'}
                    </button>
                    <button onClick={() => removePrompt(i)} className="text-[#64748b] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {prompts.length === 0 && !loadingSuggestions && suggestions.length === 0 && (
            <div className="border border-dashed border-[#1e1e2e] rounded-xl py-10 text-center">
              <p className="text-sm text-[#64748b]">No prompts added yet</p>
              <p className="text-xs text-[#4a5568] mt-1">Add prompts above or use AI suggestions</p>
            </div>
          )}

          {error && (
            <p className="text-sm text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={goBack} className="flex items-center gap-2 bg-[#1a1a24] hover:bg-[#222232] border border-[#1e1e2e] text-[#94a3b8] rounded-lg px-5 py-2.5 text-sm font-medium transition-colors">
              <ArrowLeft size={15} />
              Back
            </button>
            <button
              onClick={goNext}
              disabled={prompts.length === 0}
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            >
              Review
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">Review &amp; Launch</h2>
            <p className="text-sm text-[#64748b]">Confirm your setup before starting the first report</p>
          </div>

          <div className="bg-[#1a1a24] border border-[#1e1e2e] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-bold text-[#6366f1]">{name.charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <p className="text-lg font-bold text-[#e2e8f0]">{name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {isPitch ? (
                    <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b]">
                      Pitch Deck — 7-day snapshot
                    </span>
                  ) : (
                    <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded ${selectedTier.badge}`}>
                      {selectedTier.label} — {selectedTier.runs}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {isPitch && (
              <div className="flex items-center gap-2 text-xs text-[#f59e0b] bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-lg px-3 py-2">
                <Clock size={12} className="flex-shrink-0" />
                This pitch deck expires on <strong className="ml-1">{pitchExpiryDate}</strong>
              </div>
            )}

            <div className="h-px bg-[#1e1e2e]" />

            <div>
              <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                {prompts.length} Prompt{prompts.length !== 1 ? 's' : ''} to track
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {prompts.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <ChevronRight size={12} className="text-[#6366f1] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-[#94a3b8] flex-1">{p.text}</span>
                    <span className={clsx(
                      'text-xs px-1.5 py-0.5 rounded-full flex-shrink-0',
                      p.type === 'pitch' ? 'text-[#f59e0b] bg-[#f59e0b]/10' : 'text-[#818cf8] bg-[#6366f1]/10'
                    )}>
                      {p.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#1e1e2e]" />

            <div className="bg-[#6366f1]/5 border border-[#6366f1]/20 rounded-lg p-3">
              <p className="text-xs text-[#94a3b8] leading-relaxed">
                <span className="text-[#818cf8] font-medium">What happens next: </span>
                ClarityAI will immediately send your prompts to ChatGPT, Claude, Perplexity, and Gemini,
                checking each response for mentions of <strong className="text-[#e2e8f0]">{name}</strong>. Results will be available in seconds.
              </p>
            </div>
          </div>

          {error && (
            <p className="text-sm text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={goBack}
              disabled={creating}
              className="flex items-center gap-2 bg-[#1a1a24] hover:bg-[#222232] border border-[#1e1e2e] text-[#94a3b8] rounded-lg px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <ArrowLeft size={15} />
              Back
            </button>
            <button
              onClick={handleLaunch}
              disabled={creating}
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
            >
              {creating ? (
                <><Loader2 size={15} className="animate-spin" />Launching…</>
              ) : (
                <><Zap size={15} />Launch &amp; Start Tracking</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
