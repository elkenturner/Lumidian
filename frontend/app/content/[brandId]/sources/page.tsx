"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import {
  addBrandSource,
  deleteBrandSource,
  listBrandSources,
  type BrandSource,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { logError } from "@/lib/utils/errors";

const SOURCE_LIMIT = 10;

const SOURCE_TYPE_LABEL: Record<BrandSource["source_type"], string> = {
  paper: "Paper",
  article: "Article",
  stat: "Stat",
  case_study: "Case study",
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Curated evidence library for a brand (Task F4). User-added sources count
 * toward the credibility check the writer runs before drafting posts — this
 * is the fix path for "not enough credible sources found" failures surfaced
 * via PieceCard's low-evidence badge and the generate preflight (Task F3).
 */
export default function ContentSourcesPage() {
  const params = useParams<{ brandId: string }>();
  const router = useRouter();
  const brandId = Number(params?.brandId);

  const [sources, setSources] = useState<BrandSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [snippet, setSnippet] = useState("");
  const [sourceType, setSourceType] = useState<BrandSource["source_type"]>("article");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(brandId)) return;
    let cancelled = false;
    listBrandSources(brandId)
      .then((rows) => {
        if (!cancelled) setSources(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          logError(err, "ContentSourcesPage: list");
          setLoadError(true);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const trimmedUrl = url.trim();
  const trimmedTitle = title.trim();
  const atCap = sources.length >= SOURCE_LIMIT;
  const canAdd = !atCap && !submitting && trimmedUrl.length > 0 && trimmedTitle.length > 0;

  async function handleAdd() {
    if (!canAdd) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await addBrandSource(brandId, {
        url: trimmedUrl,
        title: trimmedTitle,
        snippet: snippet.trim() || undefined,
        source_type: sourceType,
      });
      setSources((prev) => [created, ...prev]);
      setUrl("");
      setTitle("");
      setSnippet("");
      setSourceType("article");
      setDeleteError(null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      const detail = err?.response?.data?.detail;
      setFormError(typeof detail === "string" ? detail : "Couldn't add that source. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(sourceId: number) {
    if (!window.confirm("Remove this source? Posts will no longer use it for credibility.")) return;
    setDeletingId(sourceId);
    setDeleteError(null);
    try {
      await deleteBrandSource(brandId, sourceId);
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    } catch (err) {
      logError(err, "ContentSourcesPage: delete");
      setDeleteError("Couldn't remove the source. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  if (!Number.isFinite(brandId)) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1200px] text-[#fb7185]">Invalid brand.</div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-8 max-w-[1200px] flex items-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sources…
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1200px] space-y-6">
      <button
        onClick={() => router.push(`/content/${brandId}`)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to content
      </button>

      <header>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
          Content
        </div>
        <h1 className="text-2xl font-display text-[var(--text-primary)] leading-tight">Sources</h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)] max-w-2xl">
          Sources you add here count toward the credibility check when we write posts. Add
          articles, studies, or trade press you trust. The writer cites them when drafting so
          claims hold up.
        </p>
      </header>

      {loadError ? (
        <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
          Couldn&apos;t load sources for this brand.
        </div>
      ) : (
        <>
          {deleteError && <p className="text-xs text-[#fb7185]">{deleteError}</p>}

          {sources.length === 0 ? (
            <div className="card border-dashed text-sm text-[var(--text-secondary)] text-center py-10">
              No sources yet. Sources you add here count toward the credibility check when we
              write posts. Add articles, studies, or trade press you trust.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {sources.map((s) => (
                <li key={s.id} className="py-4 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="uppercase text-[10px] text-[var(--text-faint)] font-semibold tracking-wide shrink-0">
                        {SOURCE_TYPE_LABEL[s.source_type] ?? s.source_type}
                      </span>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] truncate inline-flex items-center gap-1"
                      >
                        {s.title}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-faint)]">
                      {domainOf(s.url)} · added {new Date(s.added_at).toLocaleDateString()}
                    </div>
                    {s.snippet && (
                      <p className="mt-1.5 text-xs text-[var(--text-secondary)] line-clamp-2 whitespace-pre-wrap">
                        {s.snippet}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    className="shrink-0 text-[var(--text-faint)] hover:text-[#fb7185] transition-colors p-1 disabled:opacity-40"
                    aria-label="Remove source"
                  >
                    {deletingId === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Add a source</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URL (required)"
                disabled={atCap || submitting}
                className="input"
              />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (required)"
                disabled={atCap || submitting}
                maxLength={500}
                className="input"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 sm:items-start">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as BrandSource["source_type"])}
                disabled={atCap || submitting}
                className="input sm:w-auto"
              >
                {(Object.keys(SOURCE_TYPE_LABEL) as BrandSource["source_type"][]).map((t) => (
                  <option key={t} value={t}>
                    {SOURCE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={snippet}
                onChange={(e) => setSnippet(e.target.value)}
                placeholder="Note or key quote (optional)"
                disabled={atCap || submitting}
                maxLength={1500}
                className="input"
              />
            </div>

            {formError && <p className="text-xs text-[#fb7185]">{formError}</p>}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-[var(--text-faint)]">
                {atCap ? `Cap reached (${SOURCE_LIMIT}). Delete one to add more` : `${sources.length} of ${SOURCE_LIMIT}`}
              </span>
              <Button onClick={handleAdd} disabled={!canAdd} size="sm" className="gap-1.5">
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add source
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
