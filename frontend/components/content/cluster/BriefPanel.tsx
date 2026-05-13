"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { editClusterBrief, type ContentBrief } from "@/lib/api";

interface Props {
  brandId: number;
  clusterId: number;
  brief: ContentBrief | null;
  onUpdated: (b: ContentBrief) => void;
}

export function BriefPanel({ brandId, clusterId, brief, onUpdated }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [positioning, setPositioning] = useState(brief?.positioning ?? "");
  const [keyClaims, setKeyClaims] = useState((brief?.key_claims ?? []).join("\n"));
  const [phrasings, setPhrasings] = useState((brief?.canonical_phrasings ?? []).join("\n"));
  const [narrative, setNarrative] = useState(brief?.narrative_spine ?? "");
  const [saving, setSaving] = useState(false);

  if (!brief) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
        No brief yet. Regenerate this cluster to produce one.
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await editClusterBrief(brandId, clusterId, {
        positioning,
        key_claims: keyClaims.split("\n").map((s) => s.trim()).filter(Boolean),
        canonical_phrasings: phrasings.split("\n").map((s) => s.trim()).filter(Boolean),
        narrative_spine: narrative,
      });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50"
      >
        <span className="flex items-center gap-2 font-semibold text-slate-900">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Brief · v{brief.version}
        </span>
        <span className="text-xs text-slate-500">Generated {new Date(brief.created_at).toLocaleString()}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-4 text-sm">
          {!editing ? (
            <>
              <Field label="Positioning">{brief.positioning}</Field>
              <Field label="Canonical phrasings (appear verbatim across pieces)">
                <ul className="list-disc list-inside text-slate-700">
                  {brief.canonical_phrasings.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </Field>
              <Field label="Key claims">
                <ul className="list-disc list-inside text-slate-700">
                  {brief.key_claims.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </Field>
              <Field label="Stats">
                <ul className="list-disc list-inside text-slate-700">
                  {brief.stats.map((s, i) => (
                    <li key={i}>
                      {s.label}: {s.value}
                    </li>
                  ))}
                </ul>
              </Field>
              <Field label="Narrative spine">{brief.narrative_spine}</Field>
              <Field label="Tone notes">{brief.tone_notes}</Field>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sky-700 hover:text-sky-900 font-medium"
              >
                Edit brief
              </button>
            </>
          ) : (
            <>
              <Field label="Positioning">
                <textarea
                  value={positioning}
                  onChange={(e) => setPositioning(e.target.value)}
                  className="w-full border rounded p-2"
                  rows={2}
                />
              </Field>
              <Field label="Canonical phrasings (one per line)">
                <textarea
                  value={phrasings}
                  onChange={(e) => setPhrasings(e.target.value)}
                  className="w-full border rounded p-2 font-mono text-xs"
                  rows={4}
                />
              </Field>
              <Field label="Key claims (one per line)">
                <textarea
                  value={keyClaims}
                  onChange={(e) => setKeyClaims(e.target.value)}
                  className="w-full border rounded p-2"
                  rows={4}
                />
              </Field>
              <Field label="Narrative spine">
                <textarea
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  className="w-full border rounded p-2"
                  rows={2}
                />
              </Field>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 rounded border text-sm"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-slate-900">{children}</div>
    </div>
  );
}
