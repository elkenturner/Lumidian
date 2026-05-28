'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Shield, Loader2, RefreshCw, Eye, Save, Activity, User, Settings,
  ChevronDown, ChevronUp, Plus, Trash2, Pencil, X, Check, FileText,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { logError } from '@/lib/utils/errors';
import {
  adminGetUser, adminEditUser, adminGetUserRuns, adminGetUserBrands,
  adminImpersonate, adminTriggerRun, adminGenerateDraft,
  adminEditBrand, adminAddPrompt, adminEditPrompt, adminDeletePrompt,
  adminAddCompetitor, adminDeleteCompetitor, swapSessionToken,
  AdminUserDetail, AdminEditUserPayload, AdminBrandDetail, AdminUserRun,
} from '@/lib/api';
import { AppToast, ToastData } from '@/components/AppToast';

// ---------------------------------------------------------------------------
// Reusable small components (matching admin/page.tsx patterns)
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-500/15 text-green-400 border-green-500/30',
    running:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
    pending:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    failed:    'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[status] ?? 'bg-[var(--bg-tinted)] text-[var(--text-secondary)] border-[var(--border-subtle)]'}`}>
      {status}
    </span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-[var(--text-faint)] text-[10px]">free</span>;
  const DISPLAY: Record<string, string> = { basic: 'Starter', starter: 'Growth', pro: 'Pro' };
  const cls = tier === 'pro'
    ? 'bg-[var(--accent)]/20 text-[var(--accent-foreground)] border-[var(--accent)]/30'
    : tier === 'starter'
    ? 'bg-[var(--border-faint)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
    : 'bg-[rgba(255,255,255,0.04)] text-[var(--text-faint)] border-[var(--bg-tinted)]';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{DISPLAY[tier] ?? tier}</span>
  );
}

function TypeBadge({ type }: { type: string }) {
  if (type === 'pitch') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent-foreground)] border border-[var(--accent)]/20">
        pitch
      </span>
    );
  }
  return null;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] last:border-0">
      <span className="text-xs text-[var(--text-faint)]">{label}</span>
      <span className="text-xs text-[var(--text-primary)]">{children}</span>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-5 rounded-xl text-center">
      <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">{value}</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">{label}</div>
    </div>
  );
}

// Date formatting helper
function fmtDate(v: string | null): string {
  if (!v) return '\u2014';
  return new Date(v + 'Z').toLocaleDateString();
}

// Tier display name
const TIER_DISPLAY: Record<string, string> = { basic: 'Starter', starter: 'Growth', pro: 'Pro' };
function tierLabel(t: string | null): string { return t ? (TIER_DISPLAY[t] ?? t) : 'Free'; }

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'edit' | 'brands' | 'activity';
const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: User },
  { key: 'edit',     label: 'Edit User', icon: Settings },
  { key: 'brands',   label: 'Brands', icon: FileText },
  { key: 'activity', label: 'Activity', icon: Activity },
];

// ---------------------------------------------------------------------------
// Brands tab — expandable brand card
// ---------------------------------------------------------------------------

function BrandCard({
  brand, onUpdate, onTriggerRun, onGenerateDraft, onError,
}: {
  brand: AdminBrandDetail;
  onUpdate: (b: AdminBrandDetail) => void;
  onTriggerRun: (brandId: number) => void;
  onGenerateDraft: (brandId: number) => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);

  // Editable brand fields
  const [editName, setEditName] = useState(brand.name);
  const [editSlug, setEditSlug] = useState(brand.slug);
  const [editTier, setEditTier] = useState(brand.tier);
  const [editType, setEditType] = useState(brand.brand_type);
  const [editUrl, setEditUrl] = useState(brand.website_url ?? '');

  // Prompt editing state
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editPromptText, setEditPromptText] = useState('');
  const [addingPrompt, setAddingPrompt] = useState(false);
  const [newPromptText, setNewPromptText] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);

  // Competitor state
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [newCompUrl, setNewCompUrl] = useState('');
  const [compBusy, setCompBusy] = useState(false);

  async function handleSaveBrand() {
    setSaving(true);
    try {
      await adminEditBrand(brand.id, {
        name: editName, slug: editSlug, tier: editTier, brand_type: editType,
        website_url: editUrl || undefined,
      });
      onUpdate({ ...brand, name: editName, slug: editSlug, tier: editTier, brand_type: editType, website_url: editUrl || null });
    } catch (err) { logError(err, 'AdminUserDetail: save brand'); onError('Failed to save brand.'); }
    finally { setSaving(false); }
  }

  async function handleRun() {
    setRunning(true);
    try { await adminTriggerRun(brand.id); onTriggerRun(brand.id); }
    catch { onError('Failed to trigger run.'); }
    finally { setRunning(false); }
  }

  async function handleDraft() {
    setDrafting(true);
    try { await adminGenerateDraft(brand.id); setDrafted(true); onGenerateDraft(brand.id); }
    catch { onError('Failed to queue drafts.'); }
    finally { setDrafting(false); }
  }

  // Prompt handlers
  async function handleSavePrompt(promptId: number) {
    setPromptBusy(true);
    try {
      const updated = await adminEditPrompt(promptId, editPromptText);
      onUpdate({ ...brand, prompts: brand.prompts.map((p) => p.id === promptId ? { ...p, text: updated.text } : p) });
      setEditingPromptId(null);
    } catch (err) { logError(err, 'AdminUserDetail: edit prompt'); onError('Failed to save prompt.'); }
    finally { setPromptBusy(false); }
  }

  async function handleDeletePrompt(promptId: number) {
    setPromptBusy(true);
    try {
      await adminDeletePrompt(promptId);
      onUpdate({ ...brand, prompts: brand.prompts.filter((p) => p.id !== promptId) });
    } catch (err) { logError(err, 'AdminUserDetail: delete prompt'); onError('Failed to delete prompt.'); }
    finally { setPromptBusy(false); }
  }

  async function handleAddPrompt() {
    if (!newPromptText.trim()) return;
    setPromptBusy(true);
    try {
      const added = await adminAddPrompt(brand.id, newPromptText.trim());
      onUpdate({ ...brand, prompts: [...brand.prompts, added] });
      setNewPromptText('');
      setAddingPrompt(false);
    } catch (err) { logError(err, 'AdminUserDetail: add prompt'); onError('Failed to add prompt.'); }
    finally { setPromptBusy(false); }
  }

  // Competitor handlers
  async function handleAddCompetitor() {
    if (!newCompName.trim()) return;
    setCompBusy(true);
    try {
      const added = await adminAddCompetitor(brand.id, newCompName.trim(), newCompUrl.trim() || undefined);
      onUpdate({ ...brand, competitors: [...brand.competitors, added] });
      setNewCompName('');
      setNewCompUrl('');
      setAddingCompetitor(false);
    } catch (err) { logError(err, 'AdminUserDetail: add competitor'); onError('Failed to add competitor.'); }
    finally { setCompBusy(false); }
  }

  async function handleDeleteCompetitor(compId: number) {
    setCompBusy(true);
    try {
      await adminDeleteCompetitor(compId);
      onUpdate({ ...brand, competitors: brand.competitors.filter((c) => c.id !== compId) });
    } catch (err) { logError(err, 'AdminUserDetail: delete competitor'); onError('Failed to delete competitor.'); }
    finally { setCompBusy(false); }
  }

  const inputCls = 'bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] w-full';

  return (
    <div className="card rounded-xl overflow-hidden">
      {/* Collapsed header */}
      <div className="flex items-center gap-3 px-5 py-4">
        <button onClick={() => setExpanded((v) => !v)} className="shrink-0 cursor-pointer text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{brand.name}</span>
            <span className="text-[10px] text-[var(--text-faint)] font-mono">/{brand.slug}</span>
            <TierBadge tier={brand.tier} />
            <TypeBadge type={brand.brand_type} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-[var(--text-faint)]">
            <span>Score: {brand.latest_score != null ? `${brand.latest_score.toFixed(1)}%` : '\u2014'}</span>
            <span>{brand.prompts.length} prompt{brand.prompts.length !== 1 ? 's' : ''}</span>
            <span>{brand.competitors.length} competitor{brand.competitors.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-40 transition-colors cursor-pointer border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Run
          </button>
          <button
            onClick={handleDraft}
            disabled={drafting}
            className={`flex items-center gap-1 text-xs disabled:opacity-40 transition-colors cursor-pointer border rounded-lg px-2.5 py-1.5 ${
              drafted ? 'text-[var(--success)] border-[var(--success)]/30' : 'text-[var(--text-muted)] hover:text-[var(--success)] border-[var(--border-subtle)]'
            }`}
          >
            {drafting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            {drafted ? 'Queued' : 'Draft'}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[var(--border-subtle)] px-5 py-5 space-y-6">
          {/* Editable brand fields */}
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Brand Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Slug</label>
                <input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Tier</label>
                <select value={editTier} onChange={(e) => setEditTier(e.target.value)} className={inputCls}>
                  <option value="basic">basic</option>
                  <option value="standard">standard</option>
                  <option value="premium">premium</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Type</label>
                <select value={editType} onChange={(e) => setEditType(e.target.value)} className={inputCls}>
                  <option value="standard">standard</option>
                  <option value="pitch">pitch</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Website URL</label>
                <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="https://..." className={inputCls} />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={handleSaveBrand} disabled={saving} className="flex items-center gap-1.5 text-xs font-medium bg-[var(--accent)] text-white rounded-lg px-3 py-1.5 disabled:opacity-50 cursor-pointer transition-colors hover:opacity-90">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save Brand
              </button>
            </div>
          </div>

          {/* Prompts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Prompts ({brand.prompts.length})</h4>
              <button onClick={() => { setAddingPrompt(true); setNewPromptText(''); }} className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:text-[var(--accent-foreground)] cursor-pointer transition-colors">
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {brand.prompts.map((p) => (
                <div key={p.id} className="flex items-start gap-2 group">
                  {editingPromptId === p.id ? (
                    <>
                      <input value={editPromptText} onChange={(e) => setEditPromptText(e.target.value)} className={`${inputCls} flex-1`} autoFocus />
                      <button onClick={() => handleSavePrompt(p.id)} disabled={promptBusy} className="text-[var(--success)] hover:opacity-80 cursor-pointer shrink-0 mt-2"><Check size={14} /></button>
                      <button onClick={() => setEditingPromptId(null)} className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer shrink-0 mt-2"><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 text-xs text-[var(--text-primary)] py-2 leading-relaxed">
                        {p.text}
                        <span className="ml-2 text-[10px] text-[var(--text-faint)]">({p.prompt_type})</span>
                      </div>
                      <button onClick={() => { setEditingPromptId(p.id); setEditPromptText(p.text); }} className="text-[var(--text-faint)] hover:text-[var(--accent)] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-2"><Pencil size={12} /></button>
                      <button onClick={() => handleDeletePrompt(p.id)} disabled={promptBusy} className="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-2"><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
              ))}
              {brand.prompts.length === 0 && !addingPrompt && (
                <p className="text-xs text-[var(--text-faint)] py-2">No prompts configured</p>
              )}
              {addingPrompt && (
                <div className="flex items-start gap-2">
                  <input value={newPromptText} onChange={(e) => setNewPromptText(e.target.value)} placeholder="New prompt text..." className={`${inputCls} flex-1`} autoFocus />
                  <button onClick={handleAddPrompt} disabled={promptBusy || !newPromptText.trim()} className="text-[var(--success)] hover:opacity-80 cursor-pointer shrink-0 mt-2 disabled:opacity-40"><Check size={14} /></button>
                  <button onClick={() => setAddingPrompt(false)} className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer shrink-0 mt-2"><X size={14} /></button>
                </div>
              )}
            </div>
          </div>

          {/* Competitors */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Competitors ({brand.competitors.length})</h4>
              <button onClick={() => { setAddingCompetitor(true); setNewCompName(''); setNewCompUrl(''); }} className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:text-[var(--accent-foreground)] cursor-pointer transition-colors">
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {brand.competitors.map((c) => (
                <div key={c.id} className="flex items-center gap-2 group">
                  <span className="flex-1 text-xs text-[var(--text-primary)]">
                    {c.name}
                    {c.website_url && <span className="ml-2 text-[10px] text-[var(--text-faint)]">{c.website_url}</span>}
                  </span>
                  <button onClick={() => handleDeleteCompetitor(c.id)} disabled={compBusy} className="text-[var(--text-faint)] hover:text-[var(--danger)] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={12} /></button>
                </div>
              ))}
              {brand.competitors.length === 0 && !addingCompetitor && (
                <p className="text-xs text-[var(--text-faint)] py-2">No competitors configured</p>
              )}
              {addingCompetitor && (
                <div className="flex items-start gap-2">
                  <input value={newCompName} onChange={(e) => setNewCompName(e.target.value)} placeholder="Competitor name" className={`${inputCls} flex-1`} autoFocus />
                  <input value={newCompUrl} onChange={(e) => setNewCompUrl(e.target.value)} placeholder="Website (optional)" className={`${inputCls} flex-1`} />
                  <button onClick={handleAddCompetitor} disabled={compBusy || !newCompName.trim()} className="text-[var(--success)] hover:opacity-80 cursor-pointer shrink-0 mt-2 disabled:opacity-40"><Check size={14} /></button>
                  <button onClick={() => setAddingCompetitor(false)} className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] cursor-pointer shrink-0 mt-2"><X size={14} /></button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user: authUser, loading: authLoading } = useAuth();

  const rawId = params.userId as string;
  const userId = Number(rawId);

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [brands, setBrands] = useState<AdminBrandDetail[]>([]);
  const [runs, setRuns] = useState<AdminUserRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<ToastData | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Edit form state
  const [editTier, setEditTier] = useState<string>('');
  const [editStatus, setEditStatus] = useState<string>('');
  const [editTrialEnd, setEditTrialEnd] = useState('');
  const [editName, setEditName] = useState('');
  const [editVerified, setEditVerified] = useState(false);
  const [editPaused, setEditPaused] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [editChanges, setEditChanges] = useState<string[]>([]);

  // Impersonate state
  const [impersonating, setImpersonating] = useState(false);

  const load = useCallback(async () => {
    if (isNaN(userId)) { setError('Invalid user ID.'); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [u, b, r] = await Promise.all([
        adminGetUser(userId),
        adminGetUserBrands(userId),
        adminGetUserRuns(userId),
      ]);
      setDetail(u);
      setBrands(b);
      setRuns(r);
      // Seed edit form
      setEditTier(u.subscription_tier ?? '');
      setEditStatus(u.subscription_status ?? '');
      setEditTrialEnd(u.trial_end ?? '');
      setEditName(u.name ?? '');
      setEditVerified(u.email_verified);
      setEditPaused(u.is_paused);
    } catch (err) {
      logError(err, 'AdminUserDetail: load');
      setError('Failed to load user details.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { document.title = detail ? `${detail.email} \u2014 Admin` : 'User \u2014 Admin'; }, [detail]);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) { router.replace('/login'); return; }
    if (!authUser.is_admin) { router.replace('/dashboard'); return; }
    load();
  }, [authUser, authLoading, router, load]);

  // Compute edit changes for confirmation panel
  function computeChanges(): string[] {
    if (!detail) return [];
    const ch: string[] = [];
    const newTier = editTier || null;
    const newStatus = editStatus || null;
    const newTrialEnd = editTrialEnd || null;
    if (newTier !== detail.subscription_tier) ch.push(`Tier: ${tierLabel(detail.subscription_tier)} \u2192 ${tierLabel(newTier)}`);
    if (newStatus !== detail.subscription_status) ch.push(`Status: ${detail.subscription_status ?? 'none'} \u2192 ${newStatus ?? 'none'}`);
    if (newTrialEnd !== detail.trial_end) ch.push(`Trial end: ${detail.trial_end ?? 'none'} \u2192 ${newTrialEnd ?? 'none'}`);
    if (editName !== (detail.name ?? '')) ch.push(`Name: "${detail.name ?? ''}" \u2192 "${editName}"`);
    if (editVerified !== detail.email_verified) ch.push(`Email verified: ${detail.email_verified} \u2192 ${editVerified}`);
    if (editPaused !== detail.is_paused) ch.push(`Paused: ${detail.is_paused} \u2192 ${editPaused}`);
    return ch;
  }

  function handlePreSave() {
    const ch = computeChanges();
    if (ch.length === 0) { setToast({ message: 'No changes to save.', type: 'info' }); return; }
    setEditChanges(ch);
    setShowConfirm(true);
  }

  async function handleSaveUser() {
    if (!detail) return;
    setEditSaving(true);
    setShowConfirm(false);
    try {
      const payload: AdminEditUserPayload = {};
      const newTier = editTier || null;
      const newStatus = editStatus || null;
      const newTrialEnd = editTrialEnd || null;
      if (newTier !== detail.subscription_tier) payload.subscription_tier = newTier;
      if (newStatus !== detail.subscription_status) payload.subscription_status = newStatus;
      if (newTrialEnd !== detail.trial_end) payload.trial_end = newTrialEnd;
      if (editName !== (detail.name ?? '')) payload.name = editName;
      if (editVerified !== detail.email_verified) payload.email_verified = editVerified;
      if (editPaused !== detail.is_paused) payload.is_paused = editPaused;
      const updated = await adminEditUser(userId, payload);
      setDetail(updated);
    } catch (err) {
      logError(err, 'AdminUserDetail: save user');
      setToast({ message: 'Failed to save user.', type: 'error' });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleImpersonate() {
    if (!detail) return;
    setImpersonating(true);
    try {
      const result = await adminImpersonate(userId);
      sessionStorage.setItem('admin_restore_token', result.admin_token);
      // Set cookie via Next.js Route Handler (reliable, bypasses rewrite proxy)
      await swapSessionToken(result.target_token);
      // Full reload — resets BrandContext, api.ts _cache, and all module
      // state so the dashboard fetches fresh data as the impersonated user.
      window.location.href = '/dashboard';
    } catch (err) {
      logError(err, 'AdminUserDetail: impersonate');
      setToast({ message: 'Failed to impersonate user.', type: 'error' });
      setImpersonating(false);
    }
  }

  function handleBrandUpdate(updated: AdminBrandDetail) {
    setBrands((prev) => prev.map((b) => b.id === updated.id ? updated : b));
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const inputCls = 'bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] w-full';

  // Loading skeleton
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] p-6">
        <div className="max-w-5xl mx-auto animate-pulse space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded bg-[var(--bg-tinted)]" />
            <div className="h-6 bg-[var(--bg-tinted)] rounded w-60" />
          </div>
          <div className="flex gap-2">
            {[1,2,3,4].map((i) => <div key={i} className="h-8 bg-[var(--bg-tinted)] rounded-lg w-24" />)}
          </div>
          <div className="h-64 card rounded-xl" />
          <div className="grid grid-cols-3 gap-4">
            {[1,2,3].map((i) => <div key={i} className="h-24 card rounded-xl" />)}
          </div>
          <div className="h-48 card rounded-xl" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center px-4">
        <div className="bg-[#7f1d1d]/20 border border-[#991b1b]/30 rounded-xl p-6 text-center max-w-sm">
          <Shield size={32} className="text-[var(--danger)] mx-auto mb-3" />
          <p className="text-[var(--danger)] text-sm mb-4">{error}</p>
          <Link href="/admin" className="text-xs text-[var(--accent)] hover:text-[var(--accent-foreground)] transition-colors">
            &larr; Back to Admin
          </Link>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Link href="/admin" className="mt-1 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0">
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-[var(--text-primary)] truncate">{detail.email}</h1>
                {detail.is_admin && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--accent)]/20 text-[var(--accent-foreground)] border border-[var(--accent)]/30">
                    <Shield size={10} /> Admin
                  </span>
                )}
              </div>
              {detail.name && <p className="text-sm text-[var(--text-muted)] mt-0.5">{detail.name}</p>}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <TierBadge tier={detail.subscription_tier} />
                {detail.is_paused && (
                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">Paused</span>
                )}
                {!detail.email_verified && (
                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/30">Unverified</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleImpersonate}
            disabled={impersonating}
            className="flex items-center gap-1.5 text-xs font-medium border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            {impersonating ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
            Impersonate
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border-subtle)]">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                tab === key
                  ? 'border-[var(--accent)] text-[var(--accent-foreground)]'
                  : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Brands" value={detail.brand_count} />
              <StatCard label="Total Runs" value={detail.total_runs} />
              <StatCard label="Total Drafts" value={detail.total_drafts} />
            </div>

            {/* Info card */}
            <div className="card p-5 rounded-xl">
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">User Information</h3>
              <InfoRow label="Email">{detail.email}</InfoRow>
              <InfoRow label="Name">{detail.name ?? '\u2014'}</InfoRow>
              <InfoRow label="Joined">{fmtDate(detail.created_at)}</InfoRow>
              <InfoRow label="Last Active">{fmtDate(detail.last_active)}</InfoRow>
              <InfoRow label="Tier">{tierLabel(detail.subscription_tier)}</InfoRow>
              <InfoRow label="Status">{detail.subscription_status ?? '\u2014'}</InfoRow>
              <InfoRow label="Trial End">{fmtDate(detail.trial_end)}</InfoRow>
              <InfoRow label="Email Verified">{detail.email_verified ? 'Yes' : 'No'}</InfoRow>
              <InfoRow label="Paused">{detail.is_paused ? 'Yes' : 'No'}</InfoRow>
              <InfoRow label="2FA Enabled">{detail.totp_enabled ? 'Yes' : 'No'}</InfoRow>
              <InfoRow label="Google Linked">{detail.google_id ? 'Yes' : 'No'}</InfoRow>
              <InfoRow label="Stripe ID">{detail.stripe_customer_id ?? '\u2014'}</InfoRow>
            </div>

            {/* Recent runs (last 10) */}
            <div className="card rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-2">
                  <Activity size={13} className="text-[var(--accent-foreground)]" />
                  Recent Runs
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Brand</th>
                      <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Status</th>
                      <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Score</th>
                      <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Type</th>
                      <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.slice(0, 10).map((r) => (
                      <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.02)]">
                        <td className="px-4 py-2.5 text-[var(--text-primary)]">{r.brand_name}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] font-mono">{r.overall_score != null ? `${r.overall_score.toFixed(1)}%` : '\u2014'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-faint)]">{r.run_type}</td>
                        <td className="px-4 py-2.5 text-[var(--text-faint)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                    {runs.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--text-faint)]">No runs yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Edit User ── */}
        {tab === 'edit' && (
          <div className="card p-5 rounded-xl space-y-5">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Edit User</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Subscription Tier</label>
                <select value={editTier} onChange={(e) => setEditTier(e.target.value)} className={inputCls}>
                  <option value="">Free</option>
                  <option value="basic">Starter (basic)</option>
                  <option value="starter">Growth (starter)</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Subscription Status</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className={inputCls}>
                  <option value="">None</option>
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-faint)] mb-1">Trial End</label>
                <input type="date" value={editTrialEnd ? editTrialEnd.slice(0, 10) : ''} onChange={(e) => setEditTrialEnd(e.target.value || '')} className={inputCls} />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editVerified} onChange={(e) => setEditVerified(e.target.checked)} className="accent-[var(--accent)]" />
                <span className="text-xs text-[var(--text-primary)]">Email Verified</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editPaused} onChange={(e) => setEditPaused(e.target.checked)} className="accent-[var(--accent)]" />
                <span className="text-xs text-[var(--text-primary)]">Account Paused</span>
              </label>
            </div>

            {/* Confirmation panel */}
            {showConfirm && (
              <div className="bg-[var(--bg-raised)] border border-[var(--border-subtle)] rounded-xl p-4">
                <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Confirm Changes</h4>
                <ul className="space-y-1 mb-4">
                  {editChanges.map((c, i) => (
                    <li key={i} className="text-xs text-[var(--text-muted)]">&bull; {c}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button onClick={() => setShowConfirm(false)} className="flex-1 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-lg transition-colors cursor-pointer">Cancel</button>
                  <button onClick={handleSaveUser} disabled={editSaving} className="flex-1 py-2 text-xs font-medium bg-[var(--accent)] text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 hover:opacity-90">
                    {editSaving ? 'Saving...' : 'Confirm & Save'}
                  </button>
                </div>
              </div>
            )}

            {!showConfirm && (
              <div className="flex justify-end">
                <button onClick={handlePreSave} disabled={editSaving} className="flex items-center gap-1.5 text-xs font-medium bg-[var(--accent)] text-white rounded-lg px-4 py-2 disabled:opacity-50 cursor-pointer transition-colors hover:opacity-90">
                  {editSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Changes
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Brands ── */}
        {tab === 'brands' && (
          <div className="space-y-4">
            {brands.length === 0 && (
              <div className="card p-8 rounded-xl text-center">
                <p className="text-sm text-[var(--text-faint)]">This user has no brands.</p>
              </div>
            )}
            {brands.map((b) => (
              <BrandCard
                key={b.id}
                brand={b}
                onUpdate={handleBrandUpdate}
                onTriggerRun={() => {}}
                onGenerateDraft={() => {}}
                onError={(message) => setToast({ message, type: 'error' })}
              />
            ))}
          </div>
        )}

        {/* ── Activity ── */}
        {tab === 'activity' && (
          <div className="card rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)]">
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-2">
                <Activity size={13} className="text-[var(--accent-foreground)]" />
                All Tracking Runs ({runs.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Brand</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Score</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Queries</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Mentions</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Started</th>
                    <th className="text-left text-[var(--text-faint)] px-4 py-2.5 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.02)]">
                      <td className="px-4 py-2.5 text-[var(--text-primary)]">{r.brand_name}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] font-mono">{r.overall_score != null ? `${r.overall_score.toFixed(1)}%` : '\u2014'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-faint)] font-mono">{r.total_queries ?? '\u2014'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-faint)] font-mono">{r.total_mentions ?? '\u2014'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-faint)]">{r.run_type}</td>
                      <td className="px-4 py-2.5 text-[var(--text-faint)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-faint)] whitespace-nowrap">{fmtDate(r.completed_at)}</td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--text-faint)]">No tracking runs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
      {toast && <AppToast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
