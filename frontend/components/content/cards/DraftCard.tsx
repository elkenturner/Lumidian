'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Loader2,
  X,
  ExternalLink,
  CheckCircle2,
  Trash2,
  Edit2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import {
  generateDraft,
  updateDraft,
  getQuoraQuestions,
  Prompt,
  ContentDraft,
  BrandProfile,
  QuoraQuestion,
} from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { logError } from '@/lib/utils/errors';
import { QualityChecklist } from '../QualityChecklist';
import {
  relativeTime,
  extractSubreddit,
  isPromoRestricted,
  runQualityChecks,
  renderPreviewHtml,
} from '../helpers';

// ── Quora question picker ───────────────────────────────────────────────────

function QuoraQuestionPicker({
  brandId,
  promptId,
  selected,
  onSelect,
}: {
  brandId: number;
  promptId: number | '';
  selected: QuoraQuestion | null;
  onSelect: (q: QuoraQuestion | null) => void;
}) {
  const [questions, setQuestions] = useState<QuoraQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!promptId) { setQuestions([]); setSearched(false); return; }
    setLoading(true);
    setSearched(false);
    getQuoraQuestions(brandId, promptId as number)
      .then((qs) => { setQuestions(qs); setSearched(true); })
      .catch((err) => { logError(err, 'ContentTabPanels: fetch Quora questions'); setQuestions([]); setSearched(true); })
      .finally(() => setLoading(false));
  }, [brandId, promptId]);

  if (!promptId) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-[var(--text-muted)]">
        <Loader2 size={12} className="animate-spin" />
        Finding relevant Quora questions…
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex items-start gap-2 bg-[color-mix(in_srgb,var(--color-gemini)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-gemini)_30%,transparent)] rounded-lg px-3 py-2.5">
        <span className="text-[var(--color-gemini)] text-xs mt-0.5 flex-shrink-0">↗</span>
        <div className="flex-1 min-w-0">
          <a
            href={selected.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--color-gemini)] font-medium hover:text-white transition-colors line-clamp-2"
          >
            {selected.title}
          </a>
          {selected.snippet && (
            <p className="text-[10px] text-[var(--text-faint)] mt-1 line-clamp-2 leading-relaxed">{selected.snippet}</p>
          )}
        </div>
        <button
          onClick={() => onSelect(null)}
          className="flex-shrink-0 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors ml-1"
          aria-label="Remove selected question"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  if (searched && questions.length === 0) {
    return (
      <p className="text-xs text-[var(--text-faint)] py-1">
        No Quora questions found — the draft will be a general answer. You can find a question manually at quora.com.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide font-medium">
        Select a Quora question to target
      </p>
      {questions.map((q) => (
        <button
          key={q.url}
          onClick={() => onSelect(q)}
          className="w-full text-left flex items-start gap-2.5 bg-[var(--bg-base)] hover:bg-[var(--bg-raised)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] rounded-lg px-3 py-2.5 transition-colors group"
        >
          <span className="text-[var(--accent)] text-xs mt-0.5 flex-shrink-0">Q</span>
          <div className="flex-1 min-w-0">
            <span className="text-xs text-[var(--text-primary)] group-hover:text-[var(--text-primary)] transition-colors line-clamp-2 block">
              {q.title}
            </span>
            {q.snippet && (
              <span className="text-[10px] text-[var(--text-faint)] line-clamp-1 block mt-0.5 leading-relaxed">
                {q.snippet}
              </span>
            )}
          </div>
          <span className="text-[10px] text-[var(--text-faint)] group-hover:text-[var(--accent)] flex-shrink-0 mt-0.5 transition-colors">
            Select →
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Draft card (Drafts tab) ─────────────────────────────────────────────────

export function DraftCard({
  draft,
  profile,
  brandName,
  postedItems,
  prompts,
  brandId,
  reportRunning,
  onApprove,
  onDelete,
  onSaved,
  onRegenerated,
}: {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  postedItems: ContentDraft[];
  prompts: Prompt[];
  brandId: number;
  reportRunning: boolean;
  onApprove: (id: number) => Promise<void>;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
  onRegenerated: (d: ContentDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title ?? '');
  const [editContent, setEditContent] = useState(draft.content_text);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showQuoraPicker, setShowQuoraPicker] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<QuoraQuestion | null>(null);
  const [approving, setApproving] = useState(false);

  async function handleApproveClick() {
    setApproving(true);
    try {
      await onApprove(draft.id);
    } catch {
      // onApprove may re-throw on unexpected errors; spinner still clears via finally
    } finally {
      setApproving(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft.content_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (no focus, insecure context, etc.) — fail silently
    }
  }

  async function handleRegenerate(question?: QuoraQuestion) {
    if (reportRunning) return;
    setRegenerating(true);
    setShowQuoraPicker(false);
    try {
      const fresh = await generateDraft(brandId, {
        platform: draft.platform,
        prompt_id: draft.prompt_id ?? undefined,
        quora_question_url: question?.url,
        quora_question_title: question?.title,
        quora_question_snippet: question?.snippet,
      });
      onRegenerated(fresh);
    } catch {
      // ignore — user can retry
    } finally {
      setRegenerating(false);
    }
  }

  const wordCount = draft.content_text.trim().split(/\s+/).filter(Boolean).length;
  const targetPrompt = prompts.find((p) => p.id === draft.prompt_id);
  const qualityChecks = useMemo(
    () => runQualityChecks(draft, profile, brandName),
    [draft, profile, brandName],
  );
  const isLowQuality = qualityChecks.filter((c) => c.passed === false).length >= 2;

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDraft(draft.id, {
        title: editTitle || undefined,
        content_text: editContent,
      });
      onSaved(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const borderClass = isLowQuality
    ? 'border-l-[3px] border-l-[var(--danger)]/50 border-[var(--border-default)]'
    : 'border-[var(--border-default)]';

  return (
    <div className={`card p-5 flex flex-col gap-3 transition-colors ${borderClass}`}>
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <PlatformBadge platform={draft.platform} />
        <span className="text-[10px] text-[var(--text-faint)] shrink-0">
          {relativeTime(draft.created_at)}
        </span>
      </div>

      {/* Target prompt / posting instruction */}
      {draft.opportunity_id != null && draft.platform === 'reddit' &&
       draft.platform_guidelines_applied?.startsWith('http') ? (
        <>
          <a
            href={draft.platform_guidelines_applied}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--color-claude)_7%,transparent)] border border-[color-mix(in_srgb,var(--color-claude)_20%,transparent)] rounded-lg px-3 py-2 group transition-colors hover:border-[color-mix(in_srgb,var(--color-claude)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-claude)_11%,transparent)]"
          >
            <span className="text-[var(--color-claude)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--color-claude)] font-medium flex-1 min-w-0 truncate">
              {draft.content_brief ?? 'Reply directly in this thread'}
            </span>
            <ExternalLink size={11} className="text-[var(--color-claude)]/60 flex-shrink-0 group-hover:text-[var(--color-claude)]" />
          </a>
          {(() => {
            const sub = extractSubreddit(draft.content_brief);
            if (!sub || !isPromoRestricted(sub)) return null;
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--warning)_20%,transparent)] rounded-md px-2.5 py-1.5">
                <AlertTriangle size={10} className="flex-shrink-0" />
                <span>
                  <span className="font-semibold">r/{sub} bans promotion</span>
                  {' '}— this draft avoids direct brand mentions. You may cite sources or reference research indirectly.
                </span>
              </div>
            );
          })()}
        </>
      ) : draft.platform === 'quora' && draft.content_brief?.startsWith('https://www.quora.com') ? (
        <div className="flex flex-col gap-2">
          <a
            href={draft.content_brief}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--color-gemini)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-gemini)_25%,transparent)] rounded-lg px-3 py-2 group transition-colors hover:border-[color-mix(in_srgb,var(--color-gemini)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-gemini)_15%,transparent)]"
          >
            <span className="text-[var(--color-gemini)] text-xs flex-shrink-0">Q</span>
            <span className="text-xs text-[var(--color-gemini)] font-medium flex-1 min-w-0 line-clamp-2">
              {draft.platform_guidelines_applied || draft.content_brief}
            </span>
            <ExternalLink size={11} className="text-[var(--color-gemini)]/50 flex-shrink-0 group-hover:text-[var(--color-gemini)]" />
          </a>
          {showQuoraPicker ? (
            <div className="border border-[var(--border-default)] rounded-lg p-3 bg-[var(--bg-base)]">
              <QuoraQuestionPicker
                brandId={brandId}
                promptId={draft.prompt_id ?? ''}
                selected={pendingQuestion}
                onSelect={setPendingQuestion}
              />
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => pendingQuestion && handleRegenerate(pendingQuestion)}
                  disabled={!pendingQuestion || regenerating || reportRunning}
                  className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  Regenerate with this question
                </button>
                <button
                  onClick={() => { setShowQuoraPicker(false); setPendingQuestion(null); }}
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowQuoraPicker(true)}
              className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)] hover:text-[var(--accent-foreground)] transition-colors self-start"
            >
              <RefreshCw size={10} />
              Find different question
            </button>
          )}
        </div>
      ) : draft.content_brief && draft.platform === 'quora' ? (
        <div className="flex items-start gap-2 bg-[color-mix(in_srgb,var(--color-gemini)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-gemini)_25%,transparent)] rounded-lg px-3 py-2">
          <span className="text-[var(--accent)] text-xs mt-0.5">→</span>
          <p className="text-xs text-[var(--color-gemini)] leading-relaxed">{draft.content_brief}</p>
        </div>
      ) : draft.content_brief && draft.platform === 'reddit' ? (
        <>
          {(() => {
            const sub = extractSubreddit(draft.content_brief);
            const contextText = draft.content_brief.includes(' — ')
              ? draft.content_brief.split(' — ').slice(1).join(' — ')
              : null;
            return (
              <>
                {sub ? (
                  <a
                    href={`https://www.reddit.com/r/${sub}/submit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--color-claude)_7%,transparent)] border border-[color-mix(in_srgb,var(--color-claude)_20%,transparent)] rounded-lg px-3 py-2 group transition-colors hover:border-[color-mix(in_srgb,var(--color-claude)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-claude)_11%,transparent)]"
                  >
                    <span className="text-[var(--color-claude)] text-xs flex-shrink-0">↗</span>
                    <span className="text-xs text-[var(--color-claude)] font-medium flex-1 min-w-0 truncate">
                      Post in r/{sub}
                    </span>
                    <ExternalLink size={11} className="text-[var(--color-claude)]/60 flex-shrink-0 group-hover:text-[var(--color-claude)]" />
                  </a>
                ) : (
                  <p className="text-xs text-[var(--text-faint)] leading-relaxed">
                    <span className="text-[var(--color-claude)] font-medium">{draft.content_brief.split(' — ')[0]}</span>
                  </p>
                )}
                {contextText && (
                  <p className="text-xs text-[var(--text-faint)] leading-relaxed">{contextText}</p>
                )}
                {sub && isPromoRestricted(sub) && (
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--warning)_20%,transparent)] rounded-md px-2.5 py-1.5">
                    <AlertTriangle size={10} className="flex-shrink-0" />
                    <span>
                      <span className="font-semibold">r/{sub} bans promotion</span>
                      {' '}— this draft avoids direct brand mentions. You may cite sources or reference research indirectly.
                    </span>
                  </div>
                )}
              </>
            );
          })()}
        </>
      ) : draft.platform === 'linkedin_article' || draft.platform === 'linkedin' ? (
        <>
          <a
            href="https://www.linkedin.com/article/new/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(10,102,194,0.07)] border border-[rgba(10,102,194,0.20)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(10,102,194,0.35)] hover:bg-[rgba(10,102,194,0.11)]"
          >
            <span className="text-[#0a66c2] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[#0a66c2] font-medium flex-1 min-w-0 truncate">
              Post on LinkedIn
            </span>
            <ExternalLink size={11} className="text-[#0a66c2]/60 flex-shrink-0 group-hover:text-[#0a66c2]" />
          </a>
          {draft.content_brief && (
            <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
              <span className="text-[var(--text-muted)]">Targeting: </span>
              {draft.content_brief}
            </p>
          )}
        </>
      ) : draft.platform === 'x_thread' || draft.platform === 'x' ? (
        <>
          <a
            href="https://x.com/compose/post"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(148,163,184,0.07)] border border-[rgba(148,163,184,0.18)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(148,163,184,0.35)] hover:bg-[rgba(148,163,184,0.11)]"
          >
            <span className="text-[var(--text-secondary)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--text-secondary)] font-medium flex-1 min-w-0 truncate">
              Post on X
            </span>
            <ExternalLink size={11} className="text-[var(--text-secondary)]/60 flex-shrink-0 group-hover:text-[var(--text-secondary)]" />
          </a>
          {draft.content_brief && (
            <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
              <span className="text-[var(--text-muted)]">Targeting: </span>
              {draft.content_brief}
            </p>
          )}
        </>
      ) : draft.platform === 'medium' ? (
        <>
          <a
            href="https://medium.com/new-story"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-[rgba(148,163,184,0.07)] border border-[rgba(148,163,184,0.18)] rounded-lg px-3 py-2 group transition-colors hover:border-[rgba(148,163,184,0.35)] hover:bg-[rgba(148,163,184,0.11)]"
          >
            <span className="text-[var(--text-secondary)] text-xs flex-shrink-0">↗</span>
            <span className="text-xs text-[var(--text-secondary)] font-medium flex-1 min-w-0 truncate">
              Write on Medium
            </span>
            <ExternalLink size={11} className="text-[var(--text-secondary)]/60 flex-shrink-0 group-hover:text-[var(--text-secondary)]" />
          </a>
          {draft.content_brief && (
            <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
              <span className="text-[var(--text-muted)]">Targeting: </span>
              {draft.content_brief}
            </p>
          )}
        </>
      ) : draft.content_brief ? (
        <p className="text-xs text-[var(--text-faint)] leading-relaxed line-clamp-2">
          <span className="text-[var(--text-muted)]">Targeting: </span>
          {draft.content_brief}
        </p>
      ) : null}

      {/* Title or inline editor */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <QualityChecklist
            draft={draft}
            profile={profile}
            brandName={brandName}
            autoExpand={true}
            liveText={editContent}
          />
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title (optional)"
            className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50"
          />
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={8}
            className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 resize-none font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : null}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] px-3 py-1.5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {targetPrompt && (
            <div className="flex items-start gap-1.5 mb-2">
              <span className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide font-medium mt-0.5 flex-shrink-0">Targeting</span>
              <span className="text-[11px] text-[var(--accent)] bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-md px-2 py-0.5 leading-relaxed">{targetPrompt.text}</span>
            </div>
          )}
          {draft.title && (
            <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1">{draft.title}</p>
          )}
          <div className="flex items-center justify-end mb-1.5">
            <span className="text-[10px] text-[var(--text-faint)] font-mono">{wordCount} words</span>
          </div>
          <div
            className="text-sm text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-3"
            style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-subtle) transparent' }}
            dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${renderPreviewHtml(draft.content_text)}</p>` }}
          />
        </div>
      )}

      {!editing && (
        <QualityChecklist draft={draft} profile={profile} brandName={brandName} precomputedChecks={qualityChecks} />
      )}

      {!editing && (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit draft"
            className="flex items-center gap-1.5 text-xs bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-base)]"
          >
            <Edit2 size={11} />
            Edit
          </button>
          <button
            onClick={handleCopy}
            aria-label="Copy draft to clipboard"
            className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-base)] ${
              copied
                ? 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)]'
                : 'bg-[var(--bg-raised)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy'}
            <span className="sr-only" role="status">{copied ? 'Copied to clipboard' : ''}</span>
          </button>
          <button
            onClick={handleApproveClick}
            disabled={approving}
            aria-label={approving ? 'Approving, please wait' : 'Approve draft'}
            className="flex items-center gap-1.5 text-xs bg-[color-mix(in_srgb,var(--success)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--success)_15%,transparent)] disabled:opacity-50 border border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)] rounded-lg px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-base)]"
          >
            {approving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            {approving ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => onDelete(draft.id)}
            disabled={approving}
            aria-label="Dismiss draft"
            className="flex items-center gap-1.5 text-xs text-[var(--danger)]/70 hover:text-[var(--danger)] disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors ml-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-base)]"
          >
            <Trash2 size={11} />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
