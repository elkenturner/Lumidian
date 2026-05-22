"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { editClusterBrief, type ContentBrief } from "@/lib/api";
import { BriefVersionHistory } from "./BriefVersionHistory";

interface Props {
  brandId: number;
  clusterId: number;
  brief: ContentBrief | null;
  /** Version pieces were generated from. Defaults to brief.version when omitted. */
  currentVersion?: number;
  onUpdated: (b: ContentBrief) => void;
}

export function BriefPanel({ brandId, clusterId, brief, currentVersion, onUpdated }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [positioning, setPositioning] = useState(brief?.positioning ?? "");
  const [keyClaims, setKeyClaims] = useState((brief?.key_claims ?? []).join("\n"));
  const [phrasings, setPhrasings] = useState((brief?.canonical_phrasings ?? []).join("\n"));
  const [narrative, setNarrative] = useState(brief?.narrative_spine ?? "");
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftVersion, setDraftVersion] = useState<number>(brief?.version ?? 1);
  const effectiveCurrentVersion = currentVersion ?? brief?.version ?? 1;

  if (!brief) {
    return (
      <div className="card border-dashed flex items-center gap-3 text-sm text-[var(--text-secondary)]">
        <FileText className="h-4 w-4 text-[var(--text-faint)] shrink-0" />
        No brief yet. Regenerate this cluster to produce one.
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
      });
      onUpdated(updated);
      setDraftVersion(updated.version);
      setDraftDirty(false);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-[var(--bg-card)]"
      >
        <span className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
          Brief
          <span className="text-xs font-medium text-[var(--text-faint)]">v{brief.version}</span>
        </span>
        <span className="text-xs text-[var(--text-faint)]">
          Generated {new Date(brief.created_at).toLocaleString()}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-5 space-y-5 text-sm">
          {draftDirty && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              You have unsaved brief changes. Click <strong>Save</strong> below to persist.
            </div>
          )}
          {draftVersion > effectiveCurrentVersion && (
            <div className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              Brief is at v{draftVersion}; pieces below were generated from v{effectiveCurrentVersion}.
              Click <strong>Regenerate pieces</strong> on the cluster page to apply the new brief.
            </div>
          )}
          {!editing ? (
            <>
              <Field label="Positioning">{brief.positioning || <Empty />}</Field>
              <Field label="Canonical phrasings (appear verbatim across pieces)">
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
              <Field label="Key claims">
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
              <Field label="Narrative spine">{brief.narrative_spine || <Empty />}</Field>
              {brief.tone_notes && <Field label="Tone notes">{brief.tone_notes}</Field>}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn btn-secondary !py-1.5 text-xs"
              >
                Edit brief
              </button>
            </>
          ) : (
            <>
              <Field label="Positioning">
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
              <Field label="Canonical phrasings (one per line)">
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
              <Field label="Key claims (one per line)">
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
              <Field label="Narrative spine">
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
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="btn btn-primary !py-1.5 text-xs"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="btn btn-secondary !py-1.5 text-xs"
                >
                  Cancel
                </button>
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
