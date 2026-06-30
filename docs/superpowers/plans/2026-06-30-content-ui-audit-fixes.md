# Content-Creation UI Audit Fixes — Implementation Plan

**Goal:** Fix the content-creation UX so a first-time user understands the surface, can generate content without ~50 clicks, and is never shown a finished-looking wall of empty shells.

**Baseline:** `main` (the deployed branch). Working branch `feat/content-ui-audit-fixes` off `main`. (The earlier audit read a stale branch; main already wired Opportunities/Gaps inputs, so the "dead Inputs rows" finding is dropped.)

**Architecture:** Mostly frontend (Next.js/React/Tailwind) on the `/content/[brandId]` surface + its cluster components. One small, backwards-compatible backend addition (`skip_ready` on `generate-now`) so the bulk-generate doesn't overwrite already-generated clusters. Bulk generation **reuses the existing backgrounded `generate-now` flow** (202 + `generating_brands` + draft-status polling) rather than a new subsystem — this is robust against the frontend 30s Axios timeout and inherits the per-tier draft-cap clamp.

**Tech Stack:** Next.js 15 / React 18 / TS strict / Tailwind / lucide-react. Backend FastAPI + pytest (asyncio_mode=auto). No frontend test harness — frontend verified by typecheck/build/lint + visual.

## Global Constraints
- Implement against `main`. Don't touch unrelated subsystems.
- User-facing noun for the deliverable is **"post"** (not "piece"/"cluster"/"draft" in body copy).
- Verb rule: **"Generate"** when a cluster has no content (`version===0` / no drafts); **"Regenerate"/"Rewrite"** only when content exists.
- Don't remove cost controls. Bulk generate must stay backgrounded + cap-clamped.
- No new external deps. Match existing design tokens (`var(--text-*)`, `var(--bg-*)`, status hex `#4ade80`/`#fb7185`).

---

## Key decisions (made deliberately, multiple angles)

1. **Bulk generate = reuse `generate-now`.** Lowest risk, backgrounded (survives >30s), guarded against concurrent runs, already clamps to the per-tier draft cap. Add `skip_ready` so it only targets unstarted/failed clusters (safe for returning users). Accept that Pro clamps to 20 prompts/run — communicate honestly; remaining cards keep a per-card "Generate".
2. **First-run state replaces the wall.** When no cluster has content, render a plain-language hero (what this does + visibility gap + one primary "Generate all posts" CTA) above the prompt cards, and hide the Sort/Filter bar. This fixes the dead empty-state AND the "controls over an empty set" in one move.
3. **Status chip on every card; suppress lift "—" on shells.** Removes the "is it broken?" read and gives the missing per-card status.
4. **State-aware verbs everywhere.** Pending → "Generate"; content exists → "Rewrite/Start fresh/Regenerate".
5. **Filters:** drop "Latest version" sort; rename "Visibility ↑" → "Lowest visibility"; add "Not started"; redefine "Needs attention" to include failed+pending. Only shown in the started/mixed state.
6. **Archive shows draft orphans** (not just posted) so onboarding drafts aren't lost; relabel "Earlier drafts".
7. **Confirm before destructive regen** when content exists. Skip in-flight cancel (no backend support — out of scope).
8. **Cookie banner** fixed so it never overlaps content. **Nav** "Content Hub" → "Content" for consistency. Skip the deeper ContentHub IA rework (Opportunities now live in the cluster, likely intentional deprecation).
9. **A11y** folded into each touched component (distinct card aria-labels, textual +/- on lift already non-color, labeled controls).

---

## File map
- `backend/app/schemas.py` — add `skip_ready` to `GenerateNowRequest`.
- `backend/app/routers/content.py` — thread `skip_ready` through `generate_now` → `_bg_generate_drafts`; skip ready clusters.
- `backend/tests/test_content.py` — test skip_ready skips ready clusters.
- `frontend/lib/api.ts` — `generateNow(brandId, maxGaps, skipReady?)`.
- `frontend/lib/clusterStatus.ts` (new) — shared status → {label,tone} + `clusterHasContent()` helper (DRY across card/list/detail).
- `frontend/app/content/[brandId]/page.tsx` — first-run hero, Generate-all + polling, status-aware grid, filter fixes, copy.
- `frontend/components/content/cluster/ClusterCard.tsx` — status chip, suppress lift on shell, state-aware CTA, a11y label.
- `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` — state-aware header buttons + confirm.
- `frontend/components/content/cluster/PieceCard.tsx` — "Generate" when empty.
- `frontend/components/content/cluster/BriefPanel.tsx` / `SourceSpinePanel.tsx` — state-aware empty copy.
- `frontend/app/content/[brandId]/archive/page.tsx` — include draft orphans, relabel.
- `frontend/components/content/cluster/PlatformFilter.tsx` — "View:" + persistent note + a11y.
- `frontend/components/CookieConsent.tsx` — non-overlapping layout.
- `frontend/components/Sidebar.tsx` — nav label.

---

## Tasks (in order)

### Task 1 — Backend: `skip_ready` on generate-now (TDD)
- Add `skip_ready: bool = False` to `GenerateNowRequest`.
- `generate_now` passes `skip_ready` to `_bg_generate_drafts`.
- `_bg_generate_drafts(brand_id, max_gaps, source, skip_ready=False)`: when `skip_ready`, skip prompts whose cluster status is in {`ready`,`ready_low_evidence`,`generation_partial`} (already has content) — only (re)generate pending/failed.
- Test: seed a brand with 2 prompts, one cluster `ready` + one `pending`; call with skip_ready → only the pending one is processed. (Mock `regenerate_cluster` to record calls.)
- Verify: `pytest backend/tests/test_content.py -k skip_ready`.

### Task 2 — Shared cluster-status helper (frontend)
- `frontend/lib/clusterStatus.ts`: `clusterHasContent(c)` (`version>0 || drafts/pieces>0 || status not in {pending}`), and `statusChip(status, postedCount, enabledCount)` → `{label, tone}` mapping: pending→"Not started" (faint), briefing/generating→"Generating" (amber, pulse), briefing_failed→"Failed" (rose), generation_partial/ready_low_evidence→"Needs review" (amber), ready→ posted===enabled&&enabled>0 ? "All posted" : "Ready" (green). Pure, unit-trivial.

### Task 3 — ClusterCard: status chip, shell CTA, suppress lift (frontend)
- Render a status chip (Task 2) top-left near the title.
- Shell (`isShell`): hide the "AI visibility lift —" block; primary CTA label "Generate posts" (still routes to detail). Non-shell unchanged except chip + lift only when `hasDelta`.
- Card root `aria-label` = `"${prompt_text} — ${chip.label}"` so SR users get distinct context.
- Keep "Push v2"/kebab only on populated cards (unchanged).

### Task 4 — List page: first-run hero + Generate-all + polling + filters + copy (frontend)
- Compute `started = clusters.some(clusterHasContent)`.
- New subtitle (goal-oriented, plain): "Each tracked question gets a set of posts — for LinkedIn, Medium, Reddit, Quora, and X — written to get **{brand}** mentioned in AI answers." Drop "cluster"/"pieces" from body.
- **First-run (`!started && clusters.length>0`):** render hero card: headline "Create your first posts", a line "Your brand appears in {appearsIn} of {total} tracked AI answers." (appearsIn = visibility_pct>0 count), primary button **"Generate posts for all prompts"**, helper "or open any prompt below to generate it on its own." Hide Sort/Filter/Show bar. Still render the prompt cards (with "Not started" chips) below.
- **Started state:** keep controls but: remove `version` sort; rename `visibility` label → "Lowest visibility"; add `not_started` filter (status pending); redefine `needs_attention` to `status in {briefing_failed,generation_partial} || (status pending) || (ready && visibility<50)`. Add a header **"Generate remaining"** button when any pending exists.
- **Generate-all handler:** `generateNow(brandId, clusters.length, true)`; set `generating=true`; poll `getDraftStatusFresh` + `listClusters` every 4s; on each tick `setClusters(fresh)`; stop when `generating===false`; cleanup on unmount; catch 402/403 → show upgrade message, 409 → just start polling.
- Footer link relabel "Earlier drafts ↗".

### Task 5 — Detail page: state-aware buttons + confirm (frontend)
- `hasContent = cluster.drafts.length>0 || cluster.version>0`.
- Pending/no content: single primary **"Generate posts"** button → `onRebuild` (full generation). Hide "Rewrite all posts"/"Start fresh".
- Content exists: keep "Rewrite all posts" + "Start fresh", but wrap each in a confirm (`window.confirm` is fine; matches repo simplicity) — "This replaces the current posts. Continue?".
- Brief/Sources empty copy handled in Task 6.

### Task 6 — PieceCard + BriefPanel + SourceSpinePanel empty copy (frontend)
- PieceCard with no draft: body "Not generated yet." → keep, but button "Rewrite" → "Generate".
- BriefPanel empty: "No brief yet. Regenerate this cluster to produce one." → "No strategy yet — generate this cluster to create one."
- SourceSpinePanel empty: "No sources yet. Regenerate to build the cluster evidence pack." → "No sources yet — generate this cluster to gather them."

### Task 7 — Archive: include draft orphans + relabel (frontend)
- Fetch `getDrafts(brandId, undefined, undefined, 200)`; keep `cluster_id==null`; show all statuses; sort posted-first then created.
- Title "Earlier drafts"; subtitle "Drafts created before the cluster redesign or outside a cluster. Read-only."; show a small status tag per row.

### Task 8 — PlatformFilter relabel + a11y (frontend)
- Label "Show:" → "View:"; add a persistent (non-hover) faint note "(view only)" once. Keep `aria-pressed`.

### Task 9 — CookieConsent non-overlap + Sidebar label (frontend)
- CookieConsent: ensure fixed, full-width bottom bar with its own stacking + does not sit on top of content (add bottom padding via a spacer or raise z-index and make it a contained bar, not an absolutely-floating card overlapping panels).
- Sidebar: "Content Hub" → "Content".

### Task 10 — Verify
- `cd frontend && npx tsc --noEmit && npm run lint && npm run build`.
- `cd backend && pytest tests/test_content.py`.
- Visual: run frontend locally if feasible, else self-review screenshots/diffs.

---

## Self-review (as Ken, multiple angles)

**Product/UX:** Does this make a first-timer succeed? Yes — the hero names the goal, shows the gap, and a single button fills the board live. The wall-of-shells and the dead empty-state both disappear. ✅ Risk: the Pro 20/run clamp means a 25-prompt brand needs 2 clicks. Acceptable + honest (remaining cards show "Not started" + Generate). I considered raising the clamp but rejected it — cost control + out of audit scope.

**Cost/safety:** Bulk reuses the cap-clamped, guarded, backgrounded path; `skip_ready` prevents overwriting good clusters. No new uncapped fan-out. ✅ I rejected building a fresh batch endpoint (more surface, more risk).

**Scope discipline:** I'm NOT rewriting the ContentHub IA (Opportunities now live in the cluster — likely intentional), NOT adding a HelpModal (clear copy + tooltips suffice), NOT adding in-flight cancel (no backend support). These are judgment calls to avoid scope creep; noted as deliberate skips. Finding #10 dropped (already fixed on main).

**Reliability:** Using 202+poll sidesteps the 30s Axios timeout that makes the synchronous single-cluster path fragile. Polling is unmount-guarded. ✅

**Consistency:** A shared `clusterStatus.ts` keeps card/list/detail status logic DRY. Verb/noun rules applied uniformly. ✅

**Did I miss a finding?** Mapped each: #1→T3/T4, #2→T1/T3/T4, #3→T4 (visibility line; run-failure deliberately left to dashboard), #4→T7, #5→T3/T5/T6, #6→T4 copy, #7→T4, #8→T3/T4, #9→T6/T3, #10 dropped, #11→T5 confirm, #12→a11y in T3/T8, #13→T9, #14→T9. ✅

**One concern:** redefining `needs_attention` broadly may surprise users who knew the old meaning — but the old meaning was itself the bug (excluded everything needing attention), so the change is net-correct. Accept.
