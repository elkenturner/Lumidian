"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { editClusterBrief, type ContentBrief } from "@/lib/api";
import { BriefVersionHistory } from "./BriefVersionHistory";

interface Props {
  brandId: number;
  clusterId: number;
  brief: ContentBrief | null;
  /** Version pieces were generated from. Defaults to brief.version when omitted. */
  currentVersion?: number;
  onUpdated: (b: ContentBrief) => void;
  /** When provided, enables a "Save & regenerate" action that saves the brief then rewrites all posts. */
  onRegeneratePieces?: () => Promise<void>;
}

export function BriefPanel({ brandId, clusterId, brief, currentVersion, onUpdated, onRegeneratePieces }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [positioning, setPositioning] = useState(brief?.positioning ?? "");
  const [keyClaims, setKeyClaims] = useState((brief?.key_claims ?? []).join("\n"));
  const [phrasings, setPhrasings] = useState((brief?.canonical_phrasings ?? []).join("\n"));
  const [narrative, setNarrative] = useState(brief?.narrative_spine ?? "");
  const [stats, setStats] = useState(
    (brief?.stats ?? []).map((s) => [s.label, s.value, s.source].join(" | ")).join("\n"),
  );
  const [toneNotes, setToneNotes] = useState(brief?.tone_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftVersion, setDraftVersion] = useState<number>(brief?.version ?? 1);
  const effectiveCurrentVersion = currentVersion ?? brief?.version ?? 1;

  if (!brief) {
    return (
      <div className="card border-dashed flex items-center gap-3 text-sm text-[var(--text-secondary)]">
        <FileText className="h-4 w-4 text-[var(--text-faint)] shrink-0" />
        No strategy yet — generate posts for this question to create one.
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await editClusterBrief(brandId, clusterId, {
        positioning,
        key_claims: keyClaims
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        canonical_phrasings: phrasings
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        narrative_spine: narrative,
        stats: stats
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [label = "", value = "", source = ""] = l.split("|").map((p) => p.trim());
            return { label, value, source };
          }),
        tone_notes: toneNotes,
      });
      onUpdated(updated);
      setDraftVersion(updated.version);
      setDraftDirty(false);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveAndRegenerate() {
    await save();
    if (!onRegeneratePieces) return;
    setRegenerating(true);
    try {
      await onRegeneratePieces();
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="w-full px-5 py-3 flex items-center justify-between hover:bg-[var(--bg-card)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 font-semibold text-[var(--text-primary)] text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
          Brief
          <span className="text-xs font-medium text-[var(--text-faint)]">v{brief.version}</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-faint)] hidden sm:inline">
            Generated {new Date(brief.created_at).toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setEditing(true);
            }}
            className="text-xs font-medium text-[var(--accent,#60a5fa)] hover:underline"
          >
            Edit
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-5 space-y-5 text-sm">
          <p className="text-xs text-[var(--text-faint)]">
            The shared strategy behind every post in this cluster. Edit it and regenerate to change all posts at once.
          </p>
          {draftDirty && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              You have unsaved brief changes. Click <strong>Save</strong> below to persist.
            </div>
          )}
          {draftVersion > effectiveCurrentVersion && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              Brief is at v{draftVersion}; pieces below were generated from v{effectiveCurrentVersion}.
              Click <strong>Rewrite all posts</strong> above to apply the new strategy.
            </div>
          )}
          {!editing ? (
            <>
              <Field label="The angle">{brief.positioning || <Empty />}</Field>
              <Field label="Core messages (each post rewords these — never verbatim)">
                {brief.canonical_phrasings.length ? (
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {brief.canonical_phrasings.map((p, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-[var(--text-faint)]">•</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </Field>
              <Field label="Claims we make">
                {brief.key_claims.length ? (
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {brief.key_claims.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-[var(--text-faint)]">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </Field>
              {brief.stats.length > 0 && (
                <Field label="Stats">
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {brief.stats.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-[var(--text-faint)]">•</span>
                        <span>
                          <span className="text-[var(--text-primary)] font-medium">{s.label}:</span>{" "}
                          {s.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
              <Field label="Story arc">{brief.narrative_spine || <Empty />}</Field>
              {brief.tone_notes && <Field label="Tone">{brief.tone_notes}</Field>}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                Edit brief
              </Button>
            </>
          ) : (
            <>
              <Field label="The angle">
                <textarea
                  value={positioning}
                  onChange={(e) => {
                    setPositioning(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input"
                  rows={2}
                />
              </Field>
              <Field label="Core messages (one per line)">
                <textarea
                  value={phrasings}
                  onChange={(e) => {
                    setPhrasings(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input font-mono text-xs"
                  rows={4}
                />
              </Field>
              <Field label="Claims we make (one per line)">
                <textarea
                  value={keyClaims}
                  onChange={(e) => {
                    setKeyClaims(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input"
                  rows={4}
                />
              </Field>
              <Field label="Story arc">
                <textarea
                  value={narrative}
                  onChange={(e) => {
                    setNarrative(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input"
                  rows={2}
                />
              </Field>
              <Field label="Stats (one per line — label | value | source)">
                <textarea
                  value={stats}
                  onChange={(e) => {
                    setStats(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input font-mono text-xs"
                  rows={3}
                  placeholder="Conversion lift | 32% | internal benchmark 2026"
                />
              </Field>
              <Field label="Tone">
                <textarea
                  value={toneNotes}
                  onChange={(e) => {
                    setToneNotes(e.target.value);
                    setDraftDirty(true);
                  }}
                  className="input"
                  rows={2}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={save}
                  disabled={saving || regenerating}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                {onRegeneratePieces && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={saveAndRegenerate}
                    disabled={saving || regenerating}
                    title="Save the brief and immediately rewrite all 5 posts from it"
                  >
                    {regenerating ? "Regenerating…" : "Save & regenerate"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={saving || regenerating}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
          <BriefVersionHistory
            brandId={brandId}
            clusterId={clusterId}
            currentVersion={effectiveCurrentVersion}
            onRevert={(b) => {
              setPositioning(b.positioning);
              setPhrasings((b.canonical_phrasings ?? []).join("\n"));
              setKeyClaims((b.key_claims ?? []).join("\n"));
              setNarrative(b.narrative_spine ?? "");
              setStats((b.stats ?? []).map((s) => [s.label, s.value, s.source].join(" | ")).join("\n"));
              setToneNotes(b.tone_notes ?? "");
              setDraftDirty(true);
              setEditing(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
        {label}
      </div>
      <div className="text-[var(--text-primary)] leading-relaxed">{children}</div>
    </div>
  );
}

function Empty() {
  return <span className="text-[var(--text-faint)] italic">—</span>;
}
