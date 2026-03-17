'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Zap,
  Check,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { createBrand, triggerRun } from '@/lib/api';
import clsx from 'clsx';

const TIER_OPTIONS = [
  {
    value: 'basic',
    label: 'Basic',
    runs: '5 queries per prompt',
    description: 'Perfect for small brands starting out with AI visibility tracking.',
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
    description: 'Great for growing brands that need more data and accuracy.',
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
    description: 'Maximum coverage and statistical accuracy for serious brands.',
    features: ['20 queries per model per run', 'All major AI models', 'Advanced analytics + export'],
    color: '#6366f1',
    activeBorder: 'border-[#6366f1]',
    activeBg: 'bg-[#6366f1]/10',
    badge: 'bg-[#6366f1]/20 text-[#818cf8]',
  },
];

const STEPS = ['Brand Info', 'Add Prompts', 'Review & Launch'];

export default function NewBrandPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Form data
  const [name, setName] = useState('');
  const [tier, setTier] = useState('standard');
  const [promptInput, setPromptInput] = useState('');
  const [prompts, setPrompts] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  function addPrompt() {
    const trimmed = promptInput.trim();
    if (!trimmed || prompts.includes(trimmed)) return;
    setPrompts((prev) => [...prev, trimmed]);
    setPromptInput('');
  }

  function removePrompt(idx: number) {
    setPrompts((prev) => prev.filter((_, i) => i !== idx));
  }

  function goNext() {
    setError('');
    if (step === 0) {
      if (!name.trim()) { setError('Please enter a brand name.'); return; }
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
      const brand = await createBrand({ name: name.trim(), tier, prompts });
      await triggerRun(brand.id);
      router.push(`/results/${brand.id}`);
    } catch {
      setError('Failed to create brand. Please check your connection and try again.');
      setCreating(false);
    }
  }

  const selectedTier = TIER_OPTIONS.find((t) => t.value === tier)!;

  return (
    <div className="px-8 py-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/tracker"
          className="text-[#64748b] hover:text-[#94a3b8] transition-colors"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[#e2e8f0]">Track New Brand</h1>
          <p className="text-sm text-[#64748b] mt-0.5">
            Set up a new brand to monitor its AI visibility
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                  i < step
                    ? 'bg-[#22c55e] text-white'
                    : i === step
                    ? 'bg-[#6366f1] text-white ring-4 ring-[#6366f1]/20'
                    : 'bg-[#1a1a24] border border-[#1e1e2e] text-[#64748b]'
                )}
              >
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              <span
                className={clsx(
                  'text-sm font-medium',
                  i === step ? 'text-[#e2e8f0]' : i < step ? 'text-[#22c55e]' : 'text-[#64748b]'
                )}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={clsx(
                  'w-12 h-px mx-3',
                  i < step ? 'bg-[#22c55e]/40' : 'bg-[#1e1e2e]'
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Brand Info */}
      {step === 0 && (
        <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">Brand Information</h2>
            <p className="text-sm text-[#64748b]">Tell us about the brand you want to track</p>
          </div>

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

          <div>
            <label className="block text-sm font-medium text-[#94a3b8] mb-3">
              Plan Tier <span className="text-[#ef4444]">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
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
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-1">Add Tracking Prompts</h2>
            <p className="text-sm text-[#64748b]">
              Enter prompts that users might ask AI models where your brand should appear
            </p>
          </div>

          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-[#94a3b8] mb-2">
              New Prompt
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPrompt()}
                placeholder="What is the best project management tool?"
                autoFocus
                className="flex-1 bg-[#1a1a24] border border-[#1e1e2e] text-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6366f1] placeholder:text-[#64748b]"
              />
              <button
                onClick={addPrompt}
                disabled={!promptInput.trim()}
                className="flex items-center gap-1.5 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                <Plus size={15} />
                Add
              </button>
            </div>
            <p className="text-xs text-[#64748b] mt-1.5">Press Enter to quickly add prompts</p>
          </div>

          {/* Prompts list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#94a3b8]">
                Added Prompts ({prompts.length})
              </span>
              {prompts.length > 0 && (
                <button
                  onClick={() => setPrompts([])}
                  className="text-xs text-[#64748b] hover:text-[#ef4444] transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            {prompts.length === 0 ? (
              <div className="border border-dashed border-[#1e1e2e] rounded-xl py-10 text-center">
                <p className="text-sm text-[#64748b]">No prompts added yet</p>
                <p className="text-xs text-[#4a5568] mt-1">Add prompts above to get started</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {prompts.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-[#1a1a24] border border-[#1e1e2e] rounded-lg px-4 py-3 group hover:border-[#2a2a3e] transition-colors"
                  >
                    <span className="text-xs font-mono text-[#6366f1] flex-shrink-0 mt-0.5 w-5 text-right">
                      {i + 1}.
                    </span>
                    <span className="text-sm text-[#94a3b8] flex-1 leading-relaxed">{p}</span>
                    <button
                      onClick={() => removePrompt(i)}
                      className="text-[#64748b] hover:text-[#ef4444] opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/30 rounded-lg px-4 py-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-between pt-2">
            <button
              onClick={goBack}
              className="flex items-center gap-2 bg-[#1a1a24] hover:bg-[#222232] border border-[#1e1e2e] text-[#94a3b8] rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
            >
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
            <p className="text-sm text-[#64748b]">
              Confirm your setup before starting the first report
            </p>
          </div>

          {/* Summary card */}
          <div className="bg-[#1a1a24] border border-[#1e1e2e] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center flex-shrink-0">
                <span className="text-lg font-bold text-[#6366f1]">
                  {name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-lg font-bold text-[#e2e8f0]">{name}</p>
                <span
                  className={`inline-flex items-center mt-0.5 text-xs font-semibold px-2 py-0.5 rounded ${selectedTier.badge}`}
                >
                  {selectedTier.label} — {selectedTier.runs}
                </span>
              </div>
            </div>

            <div className="h-px bg-[#1e1e2e]" />

            <div>
              <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                {prompts.length} Prompt{prompts.length !== 1 ? 's' : ''} to track
              </p>
              <div className="space-y-1.5">
                {prompts.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <ChevronRight size={12} className="text-[#6366f1] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-[#94a3b8]">{p}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#1e1e2e]" />

            <div className="bg-[#6366f1]/5 border border-[#6366f1]/20 rounded-lg p-3">
              <p className="text-xs text-[#94a3b8] leading-relaxed">
                <span className="text-[#818cf8] font-medium">What happens next: </span>
                ClarityAI will immediately send your prompts to ChatGPT, Claude, Perplexity, and
                Gemini, checking each response for mentions of <strong className="text-[#e2e8f0]">{name}</strong>. Results will be available in seconds.
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
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <Zap size={15} />
                  Launch &amp; Start Tracking
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
