'use client';

import { useState } from 'react';
import {
  Loader2,
  ExternalLink,
  Trash2,
  Edit2,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { updateDraft, ContentDraft, BrandProfile } from '@/lib/api';
import PlatformBadge from '@/components/PlatformBadge';
import { QualityChecklist } from '../QualityChecklist';
import {
  wikiToPlain,
  extractCitations,
  plainToWikiFormat,
  renderPreviewHtml,
} from '../helpers';

export function WikipediaDraftCard({
  draft,
  brandName,
  profile,
  onDelete,
  onSaved,
}: {
  draft: ContentDraft;
  brandName: string;
  profile: BrandProfile | null;
  onDelete: (id: number) => void;
  onSaved: (d: ContentDraft) => void;
}) {
  const originalWiki = draft.content_text;
  const citations = extractCitations(originalWiki);

  const [plainText, setPlainText] = useState(() => wikiToPlain(originalWiki));
  const [hasEdited, setHasEdited] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const wikiFormat = hasEdited
    ? plainToWikiFormat(plainText, originalWiki, citations, brandName)
    : originalWiki;

  const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
  const showCOI = plainText.toLowerCase().includes((brandName ?? '').toLowerCase()) && brandName.length > 0;

  function handlePlainChange(val: string) {
    setPlainText(val);
    setHasEdited(true);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(wikiFormat);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — fail silently
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateDraft(draft.id, { content_text: wikiFormat });
      onSaved(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const articleUrl = draft.content_brief ?? '';
  const articleTitle = draft.title ?? 'Unknown Wikipedia article';

  const rawGuidelines = draft.platform_guidelines_applied ?? '';
  const insertLocation: string = (() => {
    if (!rawGuidelines) return '';
    try {
      const parsed = JSON.parse(rawGuidelines);
      if (Array.isArray(parsed)) return '';
      return String(parsed);
    } catch {
      return rawGuidelines;
    }
  })();

  return (
    <>
      {showCOI && (
        <div className="flex items-center gap-2 text-xs text-[var(--warning)] px-1 -mb-1">
          <AlertTriangle size={11} className="shrink-0" />
          <span>
            Conflict of interest disclosure may be required if this content references your brand.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Wikipedia:Conflict_of_interest"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--warning)]/50 hover:decoration-[var(--warning)]"
            >
              See Wikipedia&apos;s COI guidelines.
            </a>
          </span>
        </div>
      )}

      <div className="card card-hover p-5 flex flex-col gap-3 transition-colors">
        <div className="flex items-start gap-2 flex-wrap">
          <PlatformBadge platform="wikipedia" />
          <div className="flex-1 min-w-0">
            {articleUrl ? (
              <a
                href={articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1 leading-snug"
              >
                {articleTitle}
                <ExternalLink size={11} className="shrink-0 text-[var(--text-faint)]" />
              </a>
            ) : (
              <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">{articleTitle}</p>
            )}
          </div>
        </div>

        {insertLocation && (
          <div className="bg-[var(--bg-raised)] border border-[var(--border-default)] rounded-lg px-3 py-2.5">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1 font-medium">Where to insert</p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{insertLocation}</p>
          </div>
        )}

        {editing ? (
          <div className="flex flex-col gap-2">
            <QualityChecklist draft={draft} profile={profile} brandName={brandName} autoExpand liveText={wikiFormat} />
            <textarea
              value={plainText}
              onChange={(e) => handlePlainChange(e.target.value)}
              rows={7}
              className="w-full bg-[var(--bg-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/50 resize-none leading-relaxed font-sans"
              placeholder="Edit the plain text. Wiki formatting and citations are applied automatically."
            />
            <p className="text-[10px] text-[var(--text-faint)]">
              Edit in plain text — wiki links, citations, and markup are applied automatically when you copy.
            </p>
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
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md p-0.5">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'preview' ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                >Preview</button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'raw' ? 'bg-[var(--bg-card)] text-[var(--accent-foreground)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                >Raw</button>
              </div>
              <span className="text-[10px] text-[var(--text-faint)] font-mono">{wordCount} words</span>
            </div>

            {viewMode === 'raw' ? (
              <pre
                className="text-xs text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-3 whitespace-pre-wrap font-mono"
                style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-subtle) transparent' }}
              >
                {wikiFormat}
              </pre>
            ) : (
              <div
                className="text-sm text-[var(--text-secondary)] leading-relaxed overflow-y-auto bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-lg p-3"
                style={{ maxHeight: '12rem', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-subtle) transparent' }}
                dangerouslySetInnerHTML={{ __html: `<p style="margin:0">${renderPreviewHtml(plainText)}</p>` }}
              />
            )}
          </div>
        )}

        {!editing && (
          <QualityChecklist draft={draft} profile={profile} brandName={brandName} liveText={wikiFormat} />
        )}

        {!editing && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition-colors ${
                copied
                  ? 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border border-[color-mix(in_srgb,var(--success)_25%,transparent)] text-[var(--success)]'
                  : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
              }`}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Copy Wiki Format'}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs bg-[var(--bg-raised)] hover:bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg px-3 py-1.5 transition-colors"
            >
              <Edit2 size={11} />
              Edit
            </button>
            <button
              onClick={() => onDelete(draft.id)}
              className="flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--danger)] rounded-lg px-3 py-1.5 transition-colors ml-auto"
            >
              <Trash2 size={11} />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </>
  );
}
