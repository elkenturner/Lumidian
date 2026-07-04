# Content Generation Deep Audit — 2026-07-04

Triggered by: Roxstart (brand 10, Pro, 25 prompts) bulk content generation "failed" on production.
Method: production forensics (Railway logs + prod DB) + 4 parallel code audits (evidence pipeline, concurrency/persistence, brand profile, frontend UX). All audited code is byte-identical to `origin/main` = production (verified via `git diff origin/main` — empty for both backend and frontend paths).

---

## 1. What actually happened (verified, not hypothesized)

Final prod state for brand 10 after the 2026-07-04 05:38–05:42 UTC sweep:

| Outcome | Count | Cause |
|---|---|---|
| `briefing_failed` | 14/25 | Authority gate: `insufficient_authority: T1+T2 < 3` / `insufficient_T1_sources: 0` |
| `generation_partial` | 6/25 | **All 30 draft rows empty** (`content_text=''`, `title=NULL`, `generation_state='failed'`, `failure_reason=PendingRollbackError`) |
| `pending` (never ran) | 5/25 | Sweep session poisoned → silent cascade |

**Net usable content produced: zero.** The only real content the brand has is 20 legacy onboarding drafts (avg 3,250 chars) orphaned outside clusters (`cluster_id=NULL`), visible only behind the "Earlier drafts" archive link.

### Failure chain A — 14 briefs killed by the authority gate

1. Gate: `cluster_evidence.py:89-135` — `MIN_T1=1`, `MIN_T1_PLUS_T2=3`, module constants, **not tier- or brand-configurable** (the `tier` param is passed in but never consulted).
2. Tiering: `source_authority.py:16-61` — **hardcoded exact-match domain lists** (~50 T1, ~55 T2), US tech/consumer-press-centric. For "agentic AI for mid-market trucking," legitimately authoritative trade press (FreightWaves, Transport Topics, JOC, FMCSA subpaths) all classify **T3**. `altexsoft.com` sources that were found were T3 → gate fail.
3. Serper throttling is invisible: `_serper_search` (`drafting/evidence.py:168-231`) detects the HTTP-400 "Query not allowed" throttle and retries 3×, but after exhaustion **returns `[]` instead of raising** — a throttled sweep is indistinguishable from "no authoritative sources exist." A 25-prompt sweep fires up to 125 Serper calls through `Semaphore(3)` with no pacing/circuit breaker — prime throttle territory.
4. The soft-fail fallback (`build_cluster_pack_from_brand_authority`, `cluster_evidence.py:292`) requires `profile.company_description or profile.key_stats` or a completed WebsiteAudit. Brand 10's profile was **completely empty** → fallback returned `None` → hard fail.
5. **Users cannot help the gate.** The `BrandSource` library (real CRUD at `routers/brand_profile.py:284-355`) feeds only the per-piece drafting pack (System B) — **the cluster gate never sees user-supplied sources.** No path exists for a user to inject a source that counts toward T1/T2.

### Failure chain B — 6 clusters generated 30 empty drafts (the worst bug)

Verified mechanism (predicted from code, confirmed against prod rows):

1. Each of 5 platform pieces gets its own DB session (`clustering_service.py:472` — commit `4783307`, which fixed the old shared-session bug but created this one).
2. On a cold evidence cache, all 5 pieces race `write_cache → db.commit()` INSERTs into `evidence_cache` (`drafting/evidence.py:299,361`). SQLite has one writer; waiters exceed `busy_timeout=5000` → `OperationalError: database is locked`.
3. The lock error is **swallowed** at `drafting_service.py:673` (logged "Evidence pack build failed" — a cache failure treated as survivable), but the piece session is now rollback-pending.
4. The next statement, `_load_voice_directive` (`drafting_service.py:701`), is the **only unguarded query** in the sequence → raises `PendingRollbackError` → the whole piece fails **before any LLM writer call**.
5. Failed pieces still persist a draft row with empty content (`clustering_service.py:522-528`); all 5 rows bulk-committed → `generation_partial` + 5 "drafts" that are empty shells. UIs count them as pieces (`clusters.py:159`).
6. The ~90s per cluster was briefing + evidence retrieval; **zero content-generation LLM calls ever happened.**

Contributing writers during the sweep: the polled `GET /api/tracking/background-status` performs a **write on the read path** (`fail_stale_runs_for_brand`, `database.py:969-984`, called from `tracking.py:810`) — it also 500'd on the same lock.

### Failure chain C — 5 clusters silently never ran

`_bg_generate_drafts` (`routers/content.py:86-148`) opens **one session for the whole sweep** and its `except` arms `continue` **without `db.rollback()`**. Once poisoned, every remaining cluster fails at its first `db.execute` and stays `pending`. No resume exists: `generating_brands` is in-process only (`state.py:12`); restart loses the task; `skip_ready` doesn't pick up `pending`/`partial`.

### Failure chain D — the empty brand profile

- The July-1 monthly Jina refresh did NOT wipe it (that job writes only `internal_brand_context` + timestamp — both present).
- Onboarding only ever attempts `company_description` (dropped when LLM returns null) and **silently discards `internal_brand_context`** (not in `BrandProfileUpdate` schema, `schemas.py:646-654`). Tone/stats/publications are never set at onboarding. The profile was likely **born empty**.
- **AI-fill persists nothing** — `POST /profile/ai-fill` returns suggestions into React state; nothing saves until the user clicks Save (`settings/page.tsx:1206-1224`).
- **Blank-overwrite is live:** the PUT guards with `is not None`, but the frontend sends `""`/`[]`, which pass the guard and overwrite filled fields. If the profile GET fails (e.g. 503 during a lock), the Settings form initializes empty and one Save wipes everything (`settings/page.tsx:954-966`, `brand_profile.py:162-177`).
- `target_audience` is **read by 5 generators but has no write path anywhere** (not in schema, PUT, or AI-fill). Permanently NULL for every brand.
- **No preflight anywhere** warns that generation is about to run with an empty profile.

---

## 2. What the user saw (UX walkthrough, prod = audited surface)

1. First-run hero: "Generate posts for all questions" — fires 25 jobs with **no preflight** (profile empty, no sources — no warning).
2. Amber "Generating posts…" banner; cards flip via 4s polling. No progress counter, no ETA.
3. On completion the banner **silently disappears**. Board shows 14 rose "Failed" chips, 6 amber "Needs review", 5 grey "Not started". **No summary, no toast, no aggregate reason** — `genError` only fires if the initial POST throws. Hence "it failed."
4. Discovering why requires clicking each failed card → detail page → raw string `insufficient_authority: T1+T2 = 2, need at least 3` (engineer jargon; T1/T2 explained nowhere). The board list payload (`ContentClusterSummary`) doesn't even include `failure_reason`.
5. The failure banner advises **"Edit the brief"** — but `briefing_failed` clusters have no brief. PieceCard copy tells users to "add sources in the brand's source library" — **no source-library route exists in the frontend.**
6. The 6 "Needs review" clusters open to 5 empty posts each showing raw `Failed: This Session's transaction has been rolled back…`.
7. Color collisions: `generating`, `generation_partial`, and `ready_low_evidence` are all amber. Failed cards render a nonsense "0 of 0 posts live" progress row.
8. The 20 real onboarding drafts are invisible except via the small "Earlier drafts ↗" archive link — two disconnected inventories.

---

## 3. Prioritized fix plan

### P0 — stop the bleeding (correctness; small diffs)
1. **Cache writes must never kill generation**: wrap `write_cache` commit in try/except + `rollback()` (`drafting/evidence.py:287-299`); guard `_load_voice_directive` (`drafting_service.py:701`) like its siblings.
2. **Serialize evidence-cache writes** (single writer after the gather, or `asyncio.Lock`) so 5 pieces don't collide on SQLite; raise `busy_timeout` 5000→15000; add a small jittered-retry helper for `database is locked` commits.
3. **Fresh session (or rollback) per cluster in `_bg_generate_drafts`** (`content.py:136-148`) — kills the silent cascade.
4. **Stop persisting empty failed pieces as `status='draft'` rows** — or exclude `generation_state='failed'` from piece counts/user-visible lists (`clustering_service.py:522-528`, `clusters.py:117`).
5. **Move `fail_stale_runs_for_brand` off the polled read path** (`tracking.py:810`) into the existing scheduler tick.
6. **Block blank-overwrite on profile PUT** (treat `""`/`[]` as "leave unchanged" unless explicit clear) + don't clear the Settings form when the profile GET fails.

### P1 — make generation succeed for real brands (product)
7. **Let users attach sources that count toward the gate** — route `BrandSource` into `build_cluster_pack` with user-source tier credit. Build the missing source-library UI the copy already references.
8. **Never hard-fail to nothing**: degrade to `ready_low_evidence` with brand-site grounding instead of `briefing_failed` when the gate can't be met; make the soft-fail net work without a filled profile (brand website is always available).
9. **Vertical-aware authority**: suffix/subdomain matching, per-vertical T1/T2 additions (or LLM-judged authority), configurable thresholds per brand/tier.
10. **Distinguish `search_unavailable` from `insufficient_authority`**: propagate `SerperRateLimitError`, pause/retry the sweep, distinct failure_reason. Add sweep-level Serper pacing.
11. **Persist AI-fill** (or auto-save), fix onboarding drops (`internal_brand_context`, tone/stats), wire up `target_audience`, add profile-completeness surfacing outside Settings.
12. **Sweep durability**: persist in-progress marker, reconcile on startup, `retry_failed` mode that re-runs `pending`/`briefing_failed`/`generation_partial`.

### P2 — UX clarity
13. **Sweep result summary** on completion: "6 of 25 questions got posts. 14 couldn't be written — not enough credible sources. 5 queued." + dominant-reason expander + "Fix brand profile" link.
14. **Preflight readiness check** before bulk generate (profile empty? sources? recent run?) with actionable links instead of firing 25 doomed jobs.
15. **Translate `failure_reason` to plain language** in `clusterStatus.ts`; add `failure_reason` to `ContentClusterSummary` so the board can show it.
16. Fix dead-end advice ("Edit the brief" on brief-less clusters), differentiate the three amber states, suppress "0 of 0" on failed cards, surface orphan onboarding drafts contextually, purge residual "cluster" jargon.

---

## 4. Systemic observations (beyond this incident)

- **SQLite single-writer is now the binding constraint.** Tracking runs, sweeps, evidence caches, backups, and read-path writes all contend on one file. P0 items buy time; medium-term either aggressively serialize all background writes through a single writer queue, or move to Postgres.
- **Two disconnected evidence systems** (cluster gate vs per-piece pack) with two different authority definitions — unify.
- **Two disconnected content pipelines** (onboarding legacy vs clusters) produce two disconnected inventories — pick one.
- **Silent-failure culture**: swallowed exceptions with `continue`, empty-list returns on provider errors, fire-and-forget tasks with no result surfacing. "Foolproof" requires every background job to end in an explicit, user-visible outcome (success / partial / failed-with-reason / retry).
