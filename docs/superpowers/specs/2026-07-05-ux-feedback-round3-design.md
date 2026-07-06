# UX Feedback Round 3 — Design

**Date:** 2026-07-05 · **Approved by Ken** ("do all of them and do them well")
**Source:** Ken's prod feedback session (audit banner screenshot, sentiment/visibility confusion, content hub sort, posting guidance, content-section friendliness). Root causes verified against prod data (Railway, brand 10 RoxStart) and code.

## A. Site-audit "missing data" banner — delete the obsolete heuristic

**Root cause (verified):** `StaleAuditBanner.tsx` shows when >50% of recommendations lack `target_url`. But schema recs (`missing_organization_schema`, `no_jsonld`) and all bot-access recs (robots.txt / llms.txt / agents.md) are created with `target_url=NULL` **by design** (`auditor.py` paths B/C — they are site-wide fixes). Roxstart: 5/7 recs null → 71% forever; the rule engine is deterministic so re-running reproduces it exactly. The heuristic existed for a mid-May auditor bug that is long fixed.

**Design:**
1. Remove the recommendation fetch + null-`target_url` check from `StaleAuditBanner` entirely (also kills a wasted network call on every audit view). Keep only the age check (>14 days) with honest copy: title "This audit is N days old", body about re-running for fresh data.
2. `FixCard` "Where it goes" block: when `target_url` is null, render a "Site-wide" indicator ("Applies to your whole site") instead of silently omitting the location line.

## B. Dashboard sentiment — fix the window, count-first copy, bridge line

**Root cause (verified on prod):** sentiment is computed from the capped row load (100 rows/model, newest-first — `dashboard.py:53,289`), which for a 300-query/day brand covers ~1.3 runs, not 30 days. Roxstart true 30-day window: 13 mentions (9 positive / 4 neutral); the cap window caught exactly the 3 positive from Jul 3 → "100% Positive · 3 mentions" next to a 0% (latest-run) headline.

**Design:**
1. **Backend:** compute sentiment with an exact SQL aggregate over all runs in the 30-day window (`GROUP BY sentiment` on mentioned, error-free rows) — sentiment is a stored label, no text needed. Add `positive_count` / `neutral_count` / `negative_count` to `SentimentBreakdown` (additive). `unclassified_mentions` = mentioned rows with sentiment NULL/other, same aggregate.
2. **Frontend card:**
   - `classified_mentions < 10` → count-first headline ("9 of 13 mentions positive"), no percentage. Replaces the old `<3` "not enough to gauge" state.
   - `>= 10` → keep percentage headline, always with sample+window sub-line: "from 13 mentions · last 30 days".
   - Bridge line when latest-run visibility is 0 but window has mentions: "You didn't appear in the latest report, but appeared N times in the last 30 days."

**Deferred follow-up (noted, not in scope):** SOV/position/domains still use the capped rows; SOV could aggregate persisted `CompetitorMention` rows instead.

## C. Content hub sort — "Most to gain" replaces "Lowest visibility"

Low visibility alone isn't upside — a 0% cluster with everything already posted has nothing left to give. Upside = low visibility **and** unshipped work. All signals already in the list payload.

**Design:** replace sort key `visibility` with `gain`, label **"Most to gain"**, and keep it the default. Ordering: clusters with remaining work (not started, or `posted_count < pieces.length`, or generation failed) first, sorted by `visibility_pct` ascending; fully-posted clusters sink to the bottom (also visibility-asc within). No opaque composite score. Backend list pre-sort untouched.

## D. "How to post this" — surface the guidance that already exists

`PLATFORM_GUIDELINES` (tone/rules/FTC disclaimer/workflow, live endpoint) renders nowhere; the Voice control's meaning lives in hover tooltips only; no account guidance exists at the copy-paste moment.

**Design:**
1. **Backend:** expose `effective_angle` (nullable string) on each cluster draft, computed server-side with the same `drafting/angle.py:effective_angle` resolution used at generation (reddit subreddit classification recomputed from `content_brief` where needed).
2. **PieceCard Read modal — "How to post this" block** (the moment of copy):
   - **Account** (from `effective_angle`): insider → post from your own real, clearly-affiliated account (text includes disclosure where it endorses); neutral → post from a personal account, don't add endorsements or independence claims; owned_site → publish on your site.
   - **Where**: existing routing info (thread/subreddit/question) + the platform's `workflow` line from `PLATFORM_GUIDELINES` (fetched on demand, cached per platform).
   - **Disclosure**: the platform `disclaimer` where relevant (reddit/quora/insider endorsement).
3. **Mark posted**: for reddit/quora, a styled confirm dialog with a 2-line account/disclosure reminder replaces the bare status flip. The owned-site `window.prompt` URL capture becomes a styled dialog (shared component).

## E. Content-section friendliness punch list

1. Cluster detail eyebrow "Cluster" → "Tracked question" (codebase's own rule: never surface "cluster"); drop the duplicated "Status {label}" free text (chip already shows it).
2. Voice control: selected angle's description rendered as a visible sentence under the control (tooltips stay).
3. Regeneration verbs consolidated: detail page keeps two actions but renamed/explained via one styled confirm dialog ("Rewrite posts — keeps existing research" vs "Start fresh — re-researches sources from scratch"); ClusterCard's "Push v2" / kebab "Regenerate all pieces" renamed to match the same two verbs.
4. Unexplained numbers get inline context: lift numbers labelled "percentage points"; opportunities "% match" clarified; "thin sources" chip/badge gets a plain-language tooltip + link to the sources page.
5. `clusterChip` default fallback humanized ("Processing" + capitalized, never raw snake_case).
6. "Platforms" filter relabeled as view-only ("Show in view").

## Constraints

- Match the existing design system (canonical page chrome, status hex conventions, `components/ui` primitives). No new deps.
- All backend changes additive (no schema field removals/renames).
- Tests: backend TDD for the sentiment aggregate + effective_angle exposure; `tsc` + lint + targeted pytest before each commit; browser verification at the end.
