# Content Generation Hardening — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the content surface honest and actionable: plain-language failure reasons, a sweep result summary, a preflight readiness check, a real sources page, and a profile form that can't wipe data.

**Architecture:** Next.js App Router surface at `frontend/app/content/[brandId]/` (board), `.../cluster/[clusterId]` (detail), plus `frontend/app/settings/page.tsx` (profile tab). Status logic centralized in `frontend/lib/clusterStatus.ts`; API client `frontend/lib/api.ts`. Backend contracts shipped earlier on this branch: `ContentClusterSummary.failure_reason`, `GET /api/content/{brand_id}/readiness`, `POST /api/content/{brand_id}/generate-now {retry_failed}`, brand-profile `clear_fields`/`target_audience`, existing `/api/brands/{brand_id}/sources` CRUD. Spec: `docs/audits/2026-07-04-content-generation-audit.md` §2 + §3 P2.

**Tech Stack:** Next.js 16, React 18, TypeScript strict, Tailwind. **No frontend test infra** — each task verifies with `cd frontend && npx tsc --noEmit && npm run build` (and lint on touched files).

## Global Constraints

- Failure-reason translation keys on machine PREFIXES: `insufficient_authority`, `insufficient_T1_sources`, `search_unavailable`, `no_sources_found`, `brief_llm_failure`, `no_brief_to_reuse`, `timeout`; unknown → generic "Generation failed".
- Respect the design system in the repo (page chrome, tokens, status colors are an app-wide convention — read neighboring components before inventing styles; no new hex values without a matching token/neighbor precedent).
- Plain-language copy: "posts"/"questions", never "cluster"/"brief"/"T1/T2" in user-facing text.
- Never remove existing affordances; additive UX only unless a task says otherwise.
- Verify each task: `npx tsc --noEmit` + `npm run build` green from `frontend/`.
- Commit per task on `fix/audit-sweep`, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The working tree may contain a concurrent session's changes (dashboard/reports files) — stage ONLY files you touched.

---

### Task F1: Failure translation + honest status chips + failed-card rendering

**Files:**
- Modify: `frontend/lib/clusterStatus.ts` (chip logic ~:31-63)
- Modify: `frontend/lib/api.ts` (`ContentClusterSummary` type ~:2056 — add `failure_reason: string | null`)
- Modify: `frontend/components/content/cluster/ClusterCard.tsx` (progress dots/footer ~:74-176; `isShell` ~:18)
- Modify: `frontend/components/content/cluster/PieceCard.tsx` (failure line ~:153-157)

**Interfaces:**
- Produces: `translateFailureReason(reason: string | null | undefined): string | null` in `clusterStatus.ts` — null in → null out; prefix-matched plain-language strings:
  - `insufficient_authority` / `insufficient_T1_sources` → "Not enough credible sources found for this question"
  - `no_sources_found` → "No usable sources found for this question"
  - `search_unavailable` → "The search provider was busy — try again in a few minutes"
  - `brief_llm_failure` / `no_brief_to_reuse` → "Strategy generation failed — try again"
  - `timeout` → "Generation timed out — try again"
  - anything else non-null → "Generation failed"
- `clusterChip` differentiates the three current ambers: `briefing`/`generating` keep amber "Generating…"; `generation_partial`/`partial_failed` move to a distinct "needs review" tone; `ready_low_evidence` gets its own "Ready · thin sources" tone. Reuse existing token/utility classes found in the codebase (check how other surfaces color warning vs info states) — pick from what exists.

- [ ] **Step 1:** Read `clusterStatus.ts`, `ClusterCard.tsx`, `PieceCard.tsx`, and the `ContentClusterSummary` type. Add `failure_reason` to the type; implement `translateFailureReason` with the table above.
- [ ] **Step 2:** ClusterCard: when status is `briefing_failed`, render the translated reason as a one-line subtext under the chip, and suppress the "0 of 0 posts live" progress row (render the reason line instead). When `generation_partial`, if the summary exposes piece counts, keep counts but ensure no "0 of 0".
- [ ] **Step 3:** PieceCard: replace raw `Failed: {draft.failure_reason || "unknown error"}` with `Failed: {translateFailureReason(draft.failure_reason) ?? "unknown error"}`; also remove/replace any copy telling users to "add sources in the brand's source library" with a real link to `/content/[brandId]/sources` (route exists after Task F4 — use it).
- [ ] **Step 4:** Chip-tone split per the Interfaces block.
- [ ] **Step 5:** Verify: `npx tsc --noEmit && npm run build`. Commit `feat(content-ui): plain-language failure reasons + honest status chips`.

---

### Task F2: Sweep result summary + Retry failed

**Files:**
- Modify: `frontend/app/content/[brandId]/page.tsx` (sweep polling ~:129-151, generating banner ~:338-343, generateAll ~:199-217, toolbar ~:238-321)
- Modify: `frontend/lib/api.ts` (`generateNow` ~:516-525 — add optional `retryFailed` param mapping to `retry_failed`)

**Interfaces:**
- Consumes: `failure_reason` on summaries (F1), `translateFailureReason`.
- Produces: when polling observes `generating` flip true→false, compute from the fresh `listClusters` result: `succeeded` (ready/ready_low_evidence), `failed` (briefing_failed), `partial` (generation_partial/partial_failed), `pending`. Render a persistent dismissible callout (not a toast):
  - all good: "All N questions have posts."
  - mixed: "X of N questions got posts. F couldn't be written — most because {dominant translated reason}. P still queued."
  - includes a "Retry failed" button when `failed + partial + pending > 0` → `generateNow(brandId, N, {retryFailed: true})`, and a "Fix brand profile" link when the last readiness check (Task F3 stores it in state) flagged `profile_empty`.
- The callout must also appear if the user LOADS the page while not generating and failures exist from a previous sweep (compute on initial fetch too, but only show the retry affordances — phrase as "F questions failed last time" without pretending a sweep just finished).

- [ ] **Step 1:** Read the board page fully. Implement the true→false transition detection (a ref holding previous `generating` value).
- [ ] **Step 2:** Implement the counts + callout component (inline in page.tsx unless a sibling pattern says otherwise); dominant reason = most common translated `failure_reason` among failed clusters.
- [ ] **Step 3:** Add `retryFailed` to `generateNow` and wire the button; disable while generating.
- [ ] **Step 4:** Verify tsc + build. Commit `feat(content-ui): sweep result summary + retry failed`.

---

### Task F3: Preflight readiness check before bulk generate

**Files:**
- Modify: `frontend/lib/api.ts` — add `getContentReadiness(brandId: number)` typed to the backend shape `{profile_completion_pct, profile_empty, source_count, has_completed_run, warnings: {code, message}[]}` for `GET /content/{brandId}/readiness`.
- Modify: `frontend/app/content/[brandId]/page.tsx` (generateAll ~:199, first-run hero button ~:377-384)

**Interfaces:**
- Produces: before firing `generateNow` from EITHER the hero button or the toolbar "Generate N not started", call `getContentReadiness`. If `warnings.length > 0`, show a confirm layer (use the codebase's existing dialog/confirm pattern — check how other destructive confirms are built on this surface) listing each warning message with an action link per code: `profile_empty` → settings profile tab; `no_sources` → `/content/[brandId]/sources`; `no_tracking_run` → `/dashboard`. Buttons: "Generate anyway" (proceeds) / "Cancel". If readiness call FAILS, proceed without blocking (log console.warn) — preflight must never brick generation. Store the readiness result in page state for F2's "Fix brand profile" link.

- [ ] **Step 1:** Add the api method + type.
- [ ] **Step 2:** Implement the confirm layer + wiring on both generate entry points.
- [ ] **Step 3:** Verify tsc + build. Commit `feat(content-ui): readiness preflight before bulk generation`.

---

### Task F4: Sources page (`/content/[brandId]/sources`)

**Files:**
- Create: `frontend/app/content/[brandId]/sources/page.tsx`
- Modify: `frontend/lib/api.ts` — check for existing brand-source methods; if absent add `getBrandSources(brandId)`, `addBrandSource(brandId, {url, title, snippet?})`, `deleteBrandSource(brandId, sourceId)` against the backend routes in `backend/app/routers/brand_profile.py:284-355` (verify exact paths/response shapes there first: they are mounted under the brand-profile router prefix).
- Modify: `frontend/app/content/[brandId]/page.tsx` — toolbar link "Sources" to the new page.

**Interfaces:**
- Consumes: backend BrandSource CRUD (already live).
- Produces: a simple list+form page following the board's page chrome (read the board page + archive page for layout conventions): list of sources (title, domain, added date, delete button), an add form (URL required, title required, optional note/snippet), empty state explaining WHY sources matter: "Sources you add here count toward the credibility check when we write posts. Add articles, studies, or trade press you trust." Back-link to the board.

- [ ] **Step 1:** Verify backend routes/shapes in `backend/app/routers/brand_profile.py:284-355`; add/confirm api.ts methods.
- [ ] **Step 2:** Build the page (match archive page structure `frontend/app/content/[brandId]/archive/page.tsx` for chrome).
- [ ] **Step 3:** Add the toolbar link. Verify tsc + build. Commit `feat(content-ui): brand sources page`.

---

### Task F5: Cluster detail — actionable failure state

**Files:**
- Modify: `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx` (status line ~:236-238, failure banner ~:321-325)

**Interfaces:**
- Consumes: `translateFailureReason` (F1), sources page route (F4).
- Produces: for `briefing_failed`, the banner shows the translated reason and REPLACES "Edit the brief or try rebuilding" with remedies matched to the reason prefix: `insufficient_*`/`no_sources_found` → "Add sources you trust or fill in your brand profile, then retry." with links to `/content/[brandId]/sources` + settings profile tab + a Retry button (existing regenerate action); `search_unavailable` → "This usually clears in a few minutes." + Retry; other → Retry. The raw machine string moves to a `title=` tooltip for debugging, not visible copy.

- [ ] **Step 1:** Read the detail page; implement the banner remap.
- [ ] **Step 2:** Verify tsc + build. Commit `feat(content-ui): actionable failure remedies on cluster detail`.

---

### Task F6: Settings profile form safety + target_audience + AI-fill persistence UX

**Files:**
- Modify: `frontend/app/settings/page.tsx` (profile load else-branch ~:954-966, `handleAiFill` ~:1206-1224, `handleProfileSave` ~:1226-1250, CompletionBar ~:1660-1669, AI-fill button ~:1674-1682)
- Modify: `frontend/lib/api.ts` (`updateBrandProfile` payload type — add `target_audience`, `clear_fields`; `aiFillProfile` response type — add `target_audience`, `persisted_fields`)

**Interfaces:**
- Consumes: backend Task 10/11 contracts (blank-overwrite guard + clear_fields; ai-fill persists + returns persisted_fields).
- Produces:
  1. **Failed-load safety:** when `getBrandProfile` fails, do NOT clear the form fields to empty — keep last-known values if any, set an error state that disables Save with copy "Couldn't load the profile — saving is disabled to protect your data. Retry." + a retry button.
  2. **clear_fields wiring:** keep a ref of the loaded (server) values; on save, compute fields where server value was non-empty and the form value is now empty → send them in `clear_fields` so intentional clearing still works against the backend guard.
  3. **target_audience field:** add a labeled textarea ("Target audience — who buys from you?") in the profile form, wired through load/save; include in the completion display (backend already counts it).
  4. **AI-fill UX:** after `aiFillProfile` returns, refresh the profile from the server (it now persists into empty fields) and show which fields were auto-saved (e.g. small confirmation text listing `persisted_fields`); still populate unsaved suggestions into the form for filled fields ONLY if the corresponding form field is empty.

- [ ] **Step 1:** Read the settings page regions + api.ts profile methods; implement 1-4.
- [ ] **Step 2:** Verify tsc + build + lint on settings/page.tsx. Commit `fix(settings): profile form can no longer wipe data + target audience + ai-fill persistence UX`.

---

## Final verification (after all tasks)

- [ ] `cd frontend && npx tsc --noEmit && npm run build && npm run lint` — no NEW lint errors (35 pre-existing agency-component errors are known).
- [ ] Manual smoke via dev server if feasible: board renders with translated failure chips against local data.
