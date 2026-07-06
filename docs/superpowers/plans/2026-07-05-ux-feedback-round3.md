# UX Feedback Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five approved fixes from Ken's round-3 feedback: honest audit staleness banner, correct 30-day sentiment, "Most to gain" sort, in-context posting guidance, and the content-section friendliness pass.

**Architecture:** Frontend-heavy pass with two additive backend changes (sentiment SQL aggregate + counts; `effective_angle` on cluster drafts). Spec: `docs/superpowers/specs/2026-07-05-ux-feedback-round3-design.md`.

**Tech Stack:** FastAPI + SQLAlchemy async (pytest, TDD), Next.js 16 / React 18 / TS strict, existing design tokens.

## Global Constraints
- No new dependencies. Additive schemas only.
- Copy never surfaces internal jargon ("cluster", "brief", "T1/T2").
- Verify per task: backend `pytest tests/<file> -q`; frontend `npx tsc --noEmit`. Full: targeted suites + build at the end.
- Commit after each task.

---

### Task 1: Backend — exact sentiment aggregate + counts
**Files:** Modify `backend/app/routers/dashboard.py` (sentiment section ~324-353), `backend/app/schemas.py` (SentimentBreakdown). Test: `backend/tests/test_dashboard.py` (or wherever dashboard analytics tests live).
- [ ] Failing test: brand with 2 runs in-window where mentions exist beyond the 400-row cap pattern (create >100 rows/model spread, or simpler: mentions across runs where per-model cap would truncate) → assert `sentiment.classified_mentions` equals ALL mentioned+classified rows in window and new `positive_count`/`neutral_count`/`negative_count` are exact; unclassified counted from NULL-sentiment mentions.
- [ ] Implement: SQL `select(QueryResult.sentiment, func.count()).where(tracking_run_id.in_(run_ids), mentioned.is_(True), error.is_(None)).group_by(sentiment)`; build counts dict; unclassified = rows whose sentiment not in the 3 labels (incl. NULL). Add counts to `SentimentBreakdown` (default 0). Remove the row-loop sentiment computation.
- [ ] Run tests; commit.

### Task 2: Frontend — sentiment card copy (count-first, window label, bridge line)
**Files:** Modify `frontend/app/dashboard/page.tsx` (~415-450 headline logic + card render ~800-830), `frontend/lib/api.ts` (SentimentBreakdown type + counts).
- [ ] `<10` classified → headline "X of N mentions positive" (dominant sentiment wording; negative-dominant → "X of N mentions negative"); no %.
- [ ] `>=10` → keep % headline; sub-line "from N mentions · last 30 days" always.
- [ ] Bridge line when latest run score is 0 and classified_mentions > 0.
- [ ] Remove obsolete `<3` low-sample state. `tsc` clean; commit.

### Task 3: Audit banner honesty + site-wide chip
**Files:** Modify `frontend/components/site-audit/StaleAuditBanner.tsx`, `frontend/components/site-audit/FixCard.tsx` (WhereBlock ~360-397, InsertionHintRow ~401-429).
- [ ] StaleAuditBanner: delete recs fetch + nullTargetPct; show iff `auditAgeDays > 14`; copy: "This audit is N days old" / "AI answers move fast — re-run it to refresh your scores and recommendations." (no more `siteAudit.recommendations` call).
- [ ] FixCard: when no `target_url`, render "Site-wide — applies to your whole site" line (Globe icon) where the page path would appear, in both WhereBlock and InsertionHintRow.
- [ ] `tsc` clean; commit.

### Task 4: "Most to gain" sort
**Files:** Modify `frontend/app/content/[brandId]/page.tsx` (SortKey/SORT_LABEL ~51-58, comparator ~309-323, default ~202).
- [ ] Key `visibility` → `gain`, label "Most to gain", default stays `gain`. Comparator: `hasWork = status !== 'ready' || posted_count < pieces.length` (pending/failed/partial all count as work remaining; guard `pieces.length === 0` on non-generated clusters → work remaining); sort `(hasWork ? 0 : 1)` then `visibility_pct` asc.
- [ ] `tsc` clean; commit.

### Task 5: Backend — `effective_angle` on cluster drafts
**Files:** Modify `backend/app/schemas.py` (ContentClusterDraft), `backend/app/routers/clusters.py` (draft serialization). Test: `backend/tests/` cluster router test file.
- [ ] Failing test: cluster detail returns `effective_angle` per draft — insider default for linkedin/medium/x on `angle='auto'`, neutral for quora, None for owned_site, explicit angle respected; reddit resolves via subreddit classification from `content_brief` (reuse the same classifier used at generation — find it in `drafting/` and reuse, do not duplicate the list).
- [ ] Implement via `drafting.angle.effective_angle` at serialization. Commit.

### Task 6: "How to post this" block in PieceCard read modal
**Files:** Modify `frontend/components/content/cluster/PieceCard.tsx`, `frontend/lib/api.ts` (guidelines fetch method if missing + ContentClusterDraft type).
- [ ] Fetch platform guidelines lazily on modal open (cache per platform, module-level Map is fine given lib/api dedup).
- [ ] Block renders: Account line (from `effective_angle`), Where line (existing routing + guidelines `workflow`), Disclosure line (guidelines `disclaimer`, only reddit/quora/insider).
- [ ] `tsc` clean; commit.

### Task 7: Mark-posted confirm + owned-site URL dialog
**Files:** Create `frontend/components/content/cluster/MarkPostedDialog.tsx`; modify `PieceCard.tsx` (~141-153 window.prompt, ~323-335 mark posted).
- [ ] One shared styled dialog: for reddit/quora → confirm with 2-line account/disclosure reminder; for owned_site → URL input (validated http(s)) replacing `window.prompt`; other platforms unchanged (direct flip).
- [ ] `tsc` clean; commit.

### Task 8: Friendliness punch list
**Files:** Modify `frontend/app/content/[brandId]/cluster/[clusterId]/page.tsx`, `frontend/components/content/cluster/ClusterCard.tsx`, `frontend/components/content/OpportunitiesPanel.tsx`, `frontend/lib/clusterStatus.ts`, `frontend/app/content/[brandId]/page.tsx` (platforms filter label).
- [ ] Detail eyebrow "Cluster" → "Tracked question"; remove duplicated "Status {label}" text (keep chip).
- [ ] Voice control: render selected angle's tip as visible sentence below the control.
- [ ] Regen verbs: detail "Rewrite all posts"/"Start fresh" get a styled confirm dialog explaining the difference (replaces window.confirm); ClusterCard "Push v2" → "Rewrite posts", kebab item wording matched.
- [ ] Lift numbers: caption "percentage points" once per surface (detail header sub-caption; card tooltip already exists — make visible caption where headline lift shows).
- [ ] Opportunities "% match" → clarified label ("Fit: 72%" with subtitle already explaining, plus title attr).
- [ ] Thin-sources chip/badge: tooltip "Written from fewer credible sources than we'd like — add sources to strengthen it" + link to sources page where layout allows.
- [ ] `clusterChip` default → capitalized humanized text, unknown → "Processing".
- [ ] Platforms filter → "Show in view".
- [ ] `tsc` clean; commit.

### Task 9: Verification pass
- [ ] Backend: full targeted suites (`pytest tests/test_dashboard.py tests/test_clusters*.py -q` + full suite if time allows). Frontend: `tsc`, `npm run build`, lint on changed files.
- [ ] Browser: dashboard sentiment card (MSC brand), content board sort + read modal + mark posted, site-audit page banner absence.
- [ ] Update CURRENT_STATE.md; commit.
