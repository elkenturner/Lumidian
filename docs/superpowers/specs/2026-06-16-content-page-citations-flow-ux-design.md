# Content Creation Page — Citation Logic, Flow & UX Pass

**Date:** 2026-06-16
**Branch:** `feat/aio-content-strategy-layer-a`
**Status:** Approved (Ken, 2026-06-16) — one combined pass

## Goal

Fix the content creation surface (`/content/[brandId]` + cluster detail) across three areas Ken flagged: (a) citation logic, (b) flow, (c) UI/UX "silly things." Driven by a code audit (15 findings) plus one root-cause discovered during code-tracing.

## Part A — Citation logic (core)

### Root cause (discovered in tracing, not in the original audit)

The cluster path runs its citation safeguards **after** citations are already rendered, making them dead code:

1. `_generate_with_new_pipeline` (`drafting_service.py:794`) renders `[SN]` markers into links/footers via `render_citations`, returns the rendered `body`.
2. `clustering_service.py:418` then calls `critique_citations(text=body)` on that rendered body. `citation_critic.py:73` early-returns `if not _MARKER_RE.search(text)` — and there are **no `[SN]` markers left** post-render. So the Pro-tier citation critic is a **guaranteed no-op**. `claim_verifier` (`clustering_service.py:~426`) has the same fate.
3. `render_citations` maps out-of-range `[S7]` → `""` silently (`citations.py:80`); `extract_used_refs` has no bounds check (`citations.py:34`). Fabricated markers vanish with no trace.

### Fix — single citation-integrity stage, inside the pipeline, pre-render

Order becomes: `generate prose (markers) → anti-AI gate → CITATION INTEGRITY → render_citations`. All entry points (cluster, gap, opportunity, owned-site) inherit it identically. Remove the now-dead post-render critic/verifier calls from `clustering_service`.

Integrity stage, on raw marked-up text:
1. **Bounds-drop (deterministic, all tiers):** drop `[SN]` where N is out of source range; **count** drops (no LLM, no silent loss).
2. **Support critic (all tiers, not Pro-only):** existing `critique_citations` logic, now actually reached because it runs pre-render. Drops markers the source snippet doesn't support.
3. **Low-evidence decision:** after drops, if retained real citations are too few relative to factual claims, or the pack was a brand-authority soft-fail pack → `low_evidence=True`.
4. **Regenerate once:** if `low_evidence`, regenerate the piece once with feedback listing the unsupported claims; re-run the stage. Still thin → keep but flag.
5. **Persist** the flag for UI badging.

### Correctness fixes (from audit)
- Brand-authority soft-fail pack gets a real `snippet` (`cluster_evidence.py:~316`).
- Close prompt-injection hole: escape the embedded draft text in the critic template (`citation_critic.py:23`).
- `ContentDraftCitation` gains a `tier` column so UI can show source quality.

### Out of scope
- X strips all citations (intentional, char-limit) — kept; noted in unified UI so it doesn't read as a bug.

## Part B — Flow

- **Retire legacy orphan-draft path from the live page.** Clusters become the only creation surface on `/content/[brandId]`. Drop `getDrafts()`-based orphan loading from the live view; legacy posted drafts stay **read-only** in archive + ImpactStrip (history preserved). Opportunity replies untouched.
- **Fix status terminology.** Code's `scheduled` renders as "Approved" while the button says "Mark as Posted." Align on one vocabulary: **Draft → Approved → Posted** in labels and chips.
- **Make missing pieces visible.** Remove `cluster.pieces.length || 5` fallback (`ClusterCard.tsx:94`); not-yet-generated platform shows a "not generated" slot instead of vanishing.
- **Surface low-evidence flag** (Part A) as a PieceCard badge ("thin sourcing — regenerate?").

## Part C — UI/UX

- **De-hardcode platform list** — `PLATFORMS` (`ClusterDetailPage:28`) + `|| 5` fallback drive off API enabled-platforms.
- **Unify citation display** — one view shared by PieceCard, cluster SourceSpinePanel, Wikipedia drafts: source + tier badge (new column) + which piece used it. Today three divergent UIs.
- **Real error states** — SourceSpinePanel + cluster status poll get explicit error UI instead of stale-forever on failed fetch.
- **Stale-copy cleanup** — remove "Drafts tab" references in `ContentHub` (~1105/1830/2105).

## Non-goals
No change to visibility measurement, no auto-posting, no new platforms.

## Verification
- Backend: new tests for bounds-drop, pre-render critic reachability, low-evidence flag + regenerate-once, snippet on soft-fail pack, tier column. Full `pytest` suite green.
- Frontend: `tsc --noEmit` + `npm run build` clean; manual smoke of cluster detail (missing-piece slot, low-evidence badge, unified citations, error states).
