'use client';

import { motion } from 'framer-motion';
import { fadeIn, staggerContainer, staggerChild } from '@/lib/motion';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  Settings,
  ExternalLink,
  Building2,
  X,
  ChevronRight,
  Zap,
} from 'lucide-react';
import BrandAvatar from '@/components/BrandAvatar';
import {
  getBrands,
  createBrand,
  getOverview,
  Brand,
  OverviewData,
  triggerRun,
} from '@/lib/api';
import RunStatusBadge from '@/components/RunStatusBadge';
import clsx from 'clsx';

const TIER_OPTIONS = [
  {
    value: 'basic',
    label: 'Starter',
    runs: '10 prompts per brand',
    description: '$100/mo, 1 standard brand',
  },
  {
    value: 'starter',
    label: 'Growth',
    runs: '25 prompts per brand',
    description: '$300/mo, 1 standard brand',
  },
  {
    value: 'pro',
    label: 'Pro',
    runs: '30 prompts per brand',
    description: '$500/mo, 2 pro brands',
  },
];

interface BrandCard {
  brand: Brand;
  overview: OverviewData | null;
}

export default function TrackerPage() {
  const router = useRouter();
  const [brandCards, setBrandCards] = useState<BrandCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [formName, setFormName] = useState('');
  const [formTier, setFormTier] = useState('basic');
  const [formPromptInput, setFormPromptInput] = useState('');
  const [formPrompts, setFormPrompts] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBrands();
  }, []);

  async function loadBrands() {
    try {
      const brands = await getBrands();
      // Single-brand app: redirect directly to brand settings if one exists
      if (brands.length > 0) {
        router.replace('/settings');
        return;
      }
      setBrandCards([]);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  function addPrompt() {
    const trimmed = formPromptInput.trim();
    if (!trimmed || formPrompts.includes(trimmed)) return;
    setFormPrompts((prev) => [...prev, trimmed]);
    setFormPromptInput('');
  }

  function removePrompt(idx: number) {
    setFormPrompts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCreate() {
    if (!formName.trim()) { setError('Brand name is required.'); return; }
    if (formPrompts.length === 0) { setError('Add at least one prompt.'); return; }
    setError('');
    setCreating(true);
    try {
      const brand = await createBrand({ name: formName.trim(), tier: formTier, prompts: formPrompts });
      // Trigger initial run — non-fatal if it fails (plan limit, etc.)
      try { await triggerRun(brand.id); } catch { /* dashboard will surface the status */ }
      router.push('/dashboard');
    } catch {
      setError('Failed to create brand. Please try again.');
      setCreating(false);
    }
  }

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="px-8 py-8 max-w-7xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-display text-[var(--text-primary)]">Tracked Brands</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1.5">
            Manage brands and monitor their AI visibility
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[var(--border-default)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--accent-light)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          Track New Brand
        </button>
      </div>

      {/* Brand cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-[rgba(95,126,166,0.06)] border border-[var(--border-default)] rounded-xl p-6 animate-pulse"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-[rgba(95,126,166,0.06)] rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[rgba(95,126,166,0.06)] rounded w-24" />
                  <div className="h-3 bg-[rgba(95,126,166,0.06)] rounded w-16" />
                </div>
              </div>
              <div className="space-y-2 mb-4">
                <div className="h-3 bg-[rgba(95,126,166,0.06)] rounded" />
                <div className="h-3 bg-[rgba(95,126,166,0.06)] rounded w-4/5" />
              </div>
              <div className="flex gap-2">
                <div className="h-9 bg-[rgba(95,126,166,0.06)] rounded-lg flex-1" />
                <div className="h-9 bg-[rgba(95,126,166,0.06)] rounded-lg flex-1" />
              </div>
            </div>
          ))}
        </div>
      ) : brandCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(95,126,166,0.14), rgba(124,58,237,0.09))',
              border: '1px solid rgba(95,126,166,0.26)',
              boxShadow: '0 0 28px rgba(95,126,166,0.10)',
            }}
          >
            <Building2 size={26} className="text-[var(--accent-foreground)]" />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">No brands tracked yet</h3>
          <p className="text-sm text-[var(--text-muted)] mb-6 max-w-sm">
            Add your first brand to start monitoring its visibility in AI-generated responses.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[var(--border-default)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--accent-light)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] rounded-lg px-5 py-2.5 text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Track Your First Brand
          </button>
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {brandCards.map(({ brand, overview }) => {
            const latestRun = overview?.latest_run;
            const score = latestRun?.overall_score;
            return (
              <motion.div
                key={brand.id}
                variants={staggerChild}
                className="bg-[rgba(95,126,166,0.06)] border border-[var(--border-default)] rounded-xl p-6 hover:border-[rgba(95,126,166,0.35)] transition-[border-color] duration-200 flex flex-col"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <BrandAvatar
                      name={brand.name}
                      websiteUrl={brand.website_url}
                      size={40}
                      className="rounded-xl bg-[rgba(95,126,166,0.06)] border border-[var(--border-subtle)]"
                      style={{ padding: 6 }}
                      textClassName="text-sm font-bold text-[var(--accent)]"
                    />
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{brand.name}</p>
                      <span className="inline-flex items-center mt-0.5 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(95,126,166,0.08)] text-[var(--text-muted)] border border-[var(--border-default)] capitalize">
                        {brand.brand_type === 'pro' ? 'Pro' : brand.brand_type === 'pitch' ? 'Pitch' : 'Standard'}
                      </span>
                    </div>
                  </div>
                  {latestRun && <RunStatusBadge status={latestRun.status} />}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-[rgba(95,126,166,0.06)] border border-[var(--border-subtle)] rounded-lg p-3">
                    <p className="text-xs text-[var(--text-faint)]">Score</p>
                    <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">
                      {score != null ? `${Math.round(score)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-[rgba(95,126,166,0.06)] border border-[var(--border-subtle)] rounded-lg p-3">
                    <p className="text-xs text-[var(--text-faint)]">Prompts</p>
                    <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">
                      {brand.prompt_count}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 mt-auto">
                  <Link
                    href={`/tracker/${brand.id}`}
                    className="flex items-center justify-center gap-1.5 flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[var(--border-faint)] border border-[var(--bg-tinted-hover)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 text-xs font-medium transition-[color,background-color]"
                  >
                    <Settings size={12} />
                    Settings
                  </Link>
                  <Link
                    href="/dashboard"
                    className="flex items-center justify-center gap-1.5 flex-1 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 border border-[var(--accent)]/30 text-[var(--accent-foreground)] rounded-lg px-3 py-2 text-xs font-medium transition-colors"
                  >
                    <ExternalLink size={12} />
                    View Results
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Create Brand Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !creating && setShowModal(false)}
          />
          <div className="relative bg-[rgba(95,126,166,0.06)] border border-[var(--border-default)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[rgba(255,255,255,0.07)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
                  <Zap size={14} className="text-white" />
                </div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Track New Brand</h2>
              </div>
              {!creating && (
                <button
                  onClick={() => setShowModal(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Brand Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  disabled={creating}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[var(--bg-tinted-hover)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-faint)] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Plan Tier
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TIER_OPTIONS.map((tier) => (
                    <button
                      key={tier.value}
                      onClick={() => setFormTier(tier.value)}
                      disabled={creating}
                      className={clsx(
                        'border rounded-xl p-3 text-left transition-[border-color,background-color] duration-150',
                        formTier === tier.value
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border-subtle)] bg-[rgba(95,126,166,0.05)] hover:border-[rgba(95,126,166,0.35)]'
                      )}
                    >
                      <span className={clsx(
                        'text-xs font-semibold px-1.5 py-0.5 rounded',
                        formTier === tier.value
                          ? 'bg-[var(--accent)]/20 text-[var(--accent-foreground)]'
                          : 'bg-[var(--border-faint)] text-[var(--text-muted)]'
                      )}>
                        {tier.label}
                      </span>
                      <p className="text-xs text-[var(--text-muted)] mt-2">{tier.runs}</p>
                      <p className="text-xs text-[var(--text-faint)] mt-0.5 leading-tight">
                        {tier.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Tracking Prompts
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formPromptInput}
                    onChange={(e) => setFormPromptInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addPrompt()}
                    placeholder="e.g. What is the best CRM software?"
                    disabled={creating}
                    className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[var(--bg-tinted-hover)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 placeholder:text-[var(--text-faint)] disabled:opacity-50"
                  />
                  <button
                    onClick={addPrompt}
                    disabled={creating || !formPromptInput.trim()}
                    className="bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[var(--border-default)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--accent-light)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-40 rounded-lg px-3 py-2 transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {formPrompts.length > 0 && (
                  <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                    {formPrompts.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 bg-[rgba(95,126,166,0.06)] border border-[var(--border-subtle)] rounded-lg px-3 py-2"
                      >
                        <ChevronRight size={12} className="text-[var(--accent)] flex-shrink-0" />
                        <span className="text-xs text-[var(--text-secondary)] flex-1 line-clamp-1">{p}</span>
                        <button
                          onClick={() => removePrompt(i)}
                          disabled={creating}
                          className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors flex-shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[var(--text-faint)] mt-1.5">
                  {formPrompts.length} prompt{formPrompts.length !== 1 ? 's' : ''} added
                  {formPrompts.length === 0 && ' (at least 1 required)'}
                </p>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-3">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => !creating && setShowModal(false)}
                  disabled={creating}
                  className="flex-1 bg-[rgba(255,255,255,0.05)] hover:bg-[var(--border-faint)] border border-[var(--bg-tinted-hover)] text-[var(--text-muted)] rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 flex items-center justify-center gap-2 bg-[rgba(95,126,166,0.15)] hover:bg-[rgba(95,126,166,0.22)] border border-[var(--border-default)] hover:border-[rgba(95,126,166,0.45)] text-[var(--accent-foreground)] hover:text-[var(--accent-light)] hover:shadow-[0_0_24px_rgba(95,126,166,0.18)] disabled:opacity-50 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
                >
                  {creating ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Zap size={15} />
                      Start Tracking
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
