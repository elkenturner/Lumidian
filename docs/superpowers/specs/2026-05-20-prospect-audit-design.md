# Prospect Audit — cold-email AI visibility report

**Status:** Approved
**Date:** 2026-05-20
**Author:** Claude Code (with Ken)

## Problem

Lumidian Agency staff (Ken + 1–2 contractors) cold-email B2B prospects. There is no on-brand artifact to attach to those emails that demonstrates concrete AI-visibility gaps and frames Lumidian as the fix. Generic "we do AI visibility" pitches don't convert; a prospect-specific audit with their own numbers does.

We need a sales-tool feature inside the agency cockpit that takes a business name + website (plus optional location for local businesses), runs a small AI-visibility audit, and produces a polished PDF report suitable for cold-email attachment. The PDF must feel professionally designed — this is the first impression Lumidian makes on the prospect.

## Goals

1. Agency staff can generate a complete prospect audit from `business_name + website_url` (+ optional `location` if local) in under three minutes.
2. The audit runs 10 auto-generated prompts on ChatGPT, Perplexity, and Gemini (3 runs each = 90 queries total) and produces a per-prompt visibility score, peer-average score, and RVI (Relative Visibility Index).
3. The PDF deliverable is print-grade: prospect logo on the cover, Lumidian wordmark as "prepared by", clean typography, one-glance executive summary, per-prompt scorecard, named competitor analysis, LLM-tailored recommendations, and a CTA.
4. For local businesses, every generated prompt is geographically sensitive (mentions the city/region or "near me"-style framing).
5. Audits live under `/agency/prospects` (staff-only) and auto-delete after 60 days. No intermediate query data persisted — only the final PDF + summary stats survive.

## Non-goals

- No "convert prospect to paying client" feature. Audits are sales artifacts; if a prospect converts later, staff create them as a new agency client via the existing flow at `/agency/clients`. (Earlier design considered carrying prompts/competitors forward — explicitly cut to keep the data model minimal.)
- No shareable public URL for the audit. Cold-email use case is "attach the PDF"; no need to host or track opens.
- No client-supplied logo upload. Logo is auto-fetched from the prospect's website (og:image → favicon → text-tile fallback). If staff want a different logo, they can re-host the og:image at the prospect's site.
- No SaaS-customer access. Agency staff only.
- No scheduled or recurring audits. Manual trigger only.

## Background — RVI definition

RVI (Relative Visibility Index) is the methodology Ken proposed in his April 13 internal report. Formula per prompt:

```
own_v(p)     = (queries mentioning prospect)     / (total queries for p)        × 100
peer_v(p, c) = (queries mentioning competitor c) / (total queries for p)        × 100
peer_avg(p)  = mean(peer_v(p, c) for c not is_subject)
rvi(p)       = own_v(p) / peer_avg(p)
```

Subject exclusion: if a generated prompt is phrased as "alternative to X" and X is in the detected competitor list, X is marked `is_subject=true` and excluded from the peer-average denominator (X is essentially the question itself).

Edge cases:
- `peer_avg == 0` and `own_v > 0` → `rvi = ∞` stored as null, band = `dominant`
- `own_v == 0` and `peer_avg > 0` → `rvi = 0`, band = `invisible`
- both `== 0` → `rvi = 1.0`, band = `even` (untracked territory — peer also absent)

Aggregate RVI is the arithmetic mean of finite per-prompt RVIs across the 10 prompts.

RVI bands:
| Band | Aggregate RVI |
|---|---|
| `dominant` | ≥ 2.0 |
| `winning` | 1.2 ≤ RVI < 2.0 |
| `even` | 0.8 ≤ RVI < 1.2 |
| `losing` | 0.2 ≤ RVI < 0.8 |
| `invisible` | < 0.2 |

RVI shares the underlying primitives with the existing `services/competitive_gap.py` (own visibility%, per-competitor visibility%, peer average). The difference is presentation: dashboard "Competitive gap" expresses the comparison as a difference in percentage points (`brand_pct − comp_avg_pct`); prospect-audit RVI expresses it as a ratio (`own_pct / peer_avg`). The new code imports `_normalize` and `_mention_matches` from `competitive_gap.py` so mention detection stays consistent across both surfaces.

## Design

### Architecture overview

Module name: **Prospect Audits**. Lives entirely under the agency surface (`/agency/prospects`), staff-only via `require_agency_staff`.

Approach: **standalone runner with its own tables** (Approach A from brainstorming). Does not touch `Brand`, `TrackingRun`, or `tracking_service.py`. Reuses the LLM-query primitives (`llm_service.py`) and the PDF-render pattern (`services/site_audit/pdf_renderer.py`).

The orchestrator fans out 90 LLM queries directly to the existing model wrappers (`query_chatgpt`, `query_perplexity`, `query_gemini`), accumulates results in memory, scores them, generates recommendations, renders the PDF, persists summary stats + PDF path on a single row, and discards everything else.

### Data model

One new table:

```
ProspectAudit
  id                       INTEGER PRIMARY KEY
  staff_user_id            INTEGER FK → users(id)
  business_name            TEXT NOT NULL
  website_url              TEXT NOT NULL
  is_local                 BOOLEAN NOT NULL DEFAULT FALSE
  location                 TEXT NULL        -- free-text "Austin, TX" — required if is_local
  status                   TEXT NOT NULL DEFAULT 'pending'
                           -- pending | scraping | generating_prompts | detecting_competitors
                           -- | running_queries | scoring | drafting_recs | rendering_pdf
                           -- | completed | failed | canceled
  status_message           TEXT NULL        -- progress note for UI ("queries: 47/90")
  error_message            TEXT NULL
  cancel_requested         BOOLEAN NOT NULL DEFAULT FALSE
  overall_visibility_pct   REAL NULL        -- summary stat for list view + headline
  aggregate_rvi            REAL NULL        -- summary stat
  rvi_band                 TEXT NULL        -- dominant | winning | even | losing | invisible
  pdf_path                 TEXT NULL        -- relative path: prospect_audits/{audit_id}.pdf
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  started_at               DATETIME NULL
  completed_at             DATETIME NULL
```

All intermediate data (prompts, competitors, raw query results, competitor mentions, recommendations markdown) lives in memory during the pipeline run and is discarded once the PDF finishes rendering. Only summary stats + PDF survive.

Migration added as new ALTER step at the bottom of `database.py:run_migrations()` (per codebase rule — never modify existing migration steps).

### End-to-end flow

**Create form** at `/agency/prospects/new`:

```
Business name:   [____________________]   *required
Website URL:     [____________________]   *required, URL-validated
[ ] This is a local business
    ↓ when checked:
    Location:    [____________________]   *required if local
                 "City, State/Region — e.g. Austin, TX"
[Generate audit]
```

On submit → `POST /api/agency/prospects` returns `{id, status: 'pending'}` immediately and schedules a `BackgroundTasks` job. Frontend redirects to `/agency/prospects/{id}` which polls every 2s.

**Background pipeline state machine** (each state writes back to `status` and an optional `status_message`):

| State | Action | Failure handling |
|---|---|---|
| `pending` | Row inserted, task queued | — |
| `scraping` | Jina fetches homepage; parse `<head>` for `og:image`/favicon; resolve `prospect_logo_uri` as data URI for the PDF render | If Jina fails, continue with empty homepage excerpt. If logo fails, use text-tile fallback. Neither halts the run. |
| `generating_prompts` | Claude Haiku call with business name + website excerpt + (location if local). Output = 10 questions. Geo-aware system prompt when local. | Hard fail if < 8 valid questions returned. `status='failed'`, `error_message='Failed to generate audit prompts.'` |
| `detecting_competitors` (in parallel with prompt gen) | Claude Haiku call: website excerpt + business name. Output = 3–5 peer brand names + websites + `is_subject` flag where applicable. | Hard fail if 0 returned (RVI undefined without peers). |
| `running_queries` | Fan out 10 × 3 × 3 = 90 queries via `asyncio.gather` with `MAX_CONCURRENT=10` semaphore. Per-model semaphores from `llm_service.py` already enforce sub-limits. As each query result lands, detect competitor mentions in memory and update `status_message` ("queries: 23/90"). | Per-query errors logged in-memory on the result struct but don't halt. If > 40% query errors → hard fail (`'Too many query failures.'`). |
| `scoring` | Compute `own_visibility_pct`, `peer_avg_visibility_pct`, `rvi`, `rvi_band` per prompt; aggregate. | Pure-math step, only fails if all queries errored (caught earlier). |
| `drafting_recs` | Claude Sonnet call with scored data + top 3 worst prompts + who's beating them. Output = markdown with 3–5 prescriptive recommendations. | Retry once with Haiku on Sonnet failure. If both fail, leave `recommendations_md=null`; PDF substitutes a static "Lumidian fixes this by…" block. Non-fatal. |
| `rendering_pdf` | Render Jinja2 HTML template → Playwright headless Chromium → PDF bytes → write to `data/prospect_audits/{audit_id}.pdf`. Set `pdf_path`. | Hard fail. PDF is the deliverable; no PDF = no audit. |
| `completed` | Set summary stats on the row. UI flips to results panel with "Download PDF" button. | — |
| `failed` | `error_message` populated. UI shows error + "Retry" button. | — |
| `canceled` | Set if staff hit Cancel. UI offers "Retry". | — |

**Cancellation:** `asyncio.Event` stored in `app/state.py` under key `prospect_audit:{id}`. Checked at the start of each pipeline step and between query batches inside the fan-out loop. `POST /api/agency/prospects/{id}/cancel` sets the event + writes `cancel_requested=true` so a process restart still observes the cancel intent.

Expected runtime: 90–150 seconds total, dominated by the LLM fan-out (~60–120s).

**Auto-cleanup:** existing 06:00 UTC daily scheduler job (`scheduler.py` — same job that handles pitch-brand cleanup) gets a new step: hard-delete `ProspectAudit` rows where `created_at < NOW() - 60 days`. PDF file on disk deleted in the same step. Missing-file errors are logged but don't crash the job. No daily digest email — silent cleanup, matches existing pitch-brand cleanup behavior.

### Backend module layout

**New files:**

```
backend/app/services/prospect_audit/
  __init__.py                  # public surface: run_audit(), cancel_audit()
  scoring.py                   # RVI math, peer-avg, banding (~60 lines)
  prompt_gen.py                # Claude Haiku → 10 questions (geo-aware system prompt)
  competitor_detect.py         # Claude Haiku → 3–5 peer brands + is_subject flag
  logo_fetch.py                # og:image → favicon → text-tile data URI resolver
  recommendations.py           # Claude Sonnet → markdown recs (Haiku retry fallback)
  pdf_render.py                # Jinja2 → HTML → Playwright headless Chromium → PDF bytes
  templates/
    prospect_audit.html.j2     # the report template
    prospect_audit.css         # print-tuned styles
  runner.py                    # the orchestrator (state machine driver)

backend/app/routers/
  prospect_audit.py            # NEW router mounted under /api/agency/prospects
```

**Modified files (additive only):**

```
backend/app/models.py          # +1 ORM model: ProspectAudit
backend/app/schemas.py         # +5 Pydantic schemas: ProspectAuditCreate, ProspectAuditOut,
                               #   ProspectAuditListItem, ProspectAuditStatus, ProspectAuditUpdate
backend/app/database.py        # +1 ALTER step at the bottom: CREATE TABLE prospect_audits
backend/app/main.py            # mount the new router under /api
backend/app/scheduler.py       # add prospect-audit cleanup to the 06:00 UTC job
backend/app/state.py           # +cancel_events keyed by "prospect_audit:{id}"
```

**Why a separate router file (not adding to `routers/agency.py`)?** `agency.py` is already 1092 lines and 30+ endpoints across clients/drafts/tasks/documents/activity. Adding 7 more endpoints would push it past comprehension. Dedicated `routers/prospect_audit.py` keeps the concept self-contained, matches the codebase's existing `routers/agency_video.py` precedent.

**Router surface** (all `require_agency_staff`):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/agency/prospects` | Create audit, kick off background task, return `{id, status}` |
| `GET` | `/api/agency/prospects` | List staff member's audits, newest first |
| `GET` | `/api/agency/prospects/{id}` | Full audit state for the detail page polling |
| `POST` | `/api/agency/prospects/{id}/cancel` | Set cancel event + DB flag |
| `POST` | `/api/agency/prospects/{id}/retry` | Re-run a failed/canceled audit in place. Resets status → `pending`, clears `error_message`, `cancel_requested`, summary stats, and deletes the old PDF from disk if any. Returns 409 if current status is non-terminal. Kicks fresh background task. |
| `GET` | `/api/agency/prospects/{id}/pdf` | Stream PDF with `Content-Disposition: attachment` |
| `DELETE` | `/api/agency/prospects/{id}` | Hard-delete row + PDF file |

**Orchestrator (`runner.py`) shape:**

```python
async def run_audit(audit_id: int) -> None:
    """Background task. Loads audit, walks the state machine, persists status updates,
    discards intermediates after rendering. Never raises — failures persist to
    ProspectAudit.error_message + status='failed'."""

    # Outer try/except — catches any uncaught error
    # 1. load row; set status='scraping'; commit
    # 2. asyncio.gather(scrape_homepage, generate_prompts, detect_competitors)
    # 3. run_queries(prompts, competitors)  -> in-memory list[QueryDict]
    # 4. score(results, competitors)        -> summary dict per prompt + aggregate
    # 5. draft_recommendations(summary)     -> markdown str (or None on fallback)
    # 6. render_pdf(summary, recs, logos)   -> bytes; write to data volume
    # 7. persist summary stats + pdf_path; status='completed'; commit
    # Cancellation checked at top of each step.
```

**LLM-cost rate limit:** `POST /api/agency/prospects` is rate-limited to **10 audits/hour per staff user** via the existing in-memory `_rate_store` pattern from `auth.py`. Soft guardrail against runaway cost (each audit is ~$0.50–$1.50 in API charges, dominated by web-search-tool queries).

### Frontend layout

**New routes:**

```
frontend/app/agency/prospects/
  page.tsx                  → list of all prospect audits, newest first
  new/page.tsx              → create form (NewProspectForm)
  [id]/page.tsx             → detail page with status polling + summary + PDF download
```

**Sidebar:** add a "Prospects" entry to `AgencySidebar.tsx`, between **Clients** and **Opportunities**. Icon: `Crosshair` from lucide-react.

**New components (`frontend/components/agency/`):**

| Component | Used in | Purpose |
|---|---|---|
| `ProspectsList.tsx` | `prospects/page.tsx` | Table — business name, website, status pill, visibility%, RVI band badge, inline "Download PDF" icon (when completed), created-at relative time. Click row → detail. |
| `NewProspectForm.tsx` | `prospects/new/page.tsx` | Form with name + URL + `is_local` checkbox + conditional location field. Submit → POST → redirect to detail page. |
| `ProspectDetailView.tsx` | `prospects/[id]/page.tsx` | Polls `GET /api/agency/prospects/{id}` every 2s while status is non-terminal. Renders one of three states based on `status`. |
| `ProspectRunningPanel.tsx` | inside detail view | Status pending → rendering_pdf. Progress indicator + `status_message`. Cancel button. |
| `ProspectResultsPanel.tsx` | inside detail view | Status `completed`. Three summary cards (Visibility %, Aggregate RVI, RVI Band) + business header + "Download PDF" primary + "Delete" secondary. |
| `ProspectErrorPanel.tsx` | inside detail view | Status `failed` / `canceled`. Shows `error_message` + "Retry" + "Delete". |
| `RviBandBadge.tsx` | list + detail | 5-state colored pill: dominant / winning / even / losing / invisible. |

**API client additions in `lib/api.ts`:**

```ts
listProspectAudits(): Promise<ProspectAuditListItem[]>
getProspectAudit(id: number): Promise<ProspectAuditOut>
createProspectAudit(data: ProspectAuditCreate): Promise<ProspectAuditOut>
cancelProspectAudit(id: number): Promise<void>
retryProspectAudit(id: number): Promise<ProspectAuditOut>
deleteProspectAudit(id: number): Promise<void>
prospectAuditPdfUrl(id: number): string   // URL builder; browser handles download
```

**UX call:** the completed-state detail page is intentionally minimal — three summary numbers and a "Download PDF" button. **The PDF is the deliverable.** No per-prompt scoring or recommendation text in the web UI; those live only inside the PDF.

### PDF deliverable

**Format:** US Letter (8.5″ × 11″), 0.75″ margins, ~6 pages. Generated via Playwright headless Chromium (already used by `site_audit/pdf_renderer.py` — reuse the same `async_playwright` import + render pattern).

**Typography:**
- Body: `-apple-system, BlinkMacSystemFont, "Inter", sans` at 10.5pt
- Hero numbers + headlines: `Georgia, serif` (matches site-audit cover treatment — gives gravitas)
- Mono (for quoted prompt text): `"SF Mono", Menlo, monospace`

**Color palette (print-tuned, light):**
- Background `#fafafa`; card surface `#fff`
- Text: slate-900 `#0f172a` primary / slate-500 `#64748b` label / slate-700 `#334155` body
- Lumidian accent `#5f7ea6` (sparingly — divider lines, link hints)
- RVI band colors: `dominant` `#059669` · `winning` `#16a34a` · `even` `#475569` · `losing` `#d97706` · `invisible` `#e11d48`
- Model dots: ChatGPT `#10a37f` · Perplexity `#8b5cf6` · Gemini `#4285f4`

**Page-by-page structure:**

**Page 1 — Cover.** Prospect logo top-left (~140px), centered hero with "AI VISIBILITY AUDIT" label (letterspaced 11pt), business name in Georgia serif 48pt, audit date in 16pt slate-500, prominent centered RVI band badge with aggregate RVI numeric below. Footer line: "Prepared by Lumidian" + generation date.

**Page 2 — Executive Summary** (the "money" page). Georgia-serif headline: *"{Prospect} is **{band-verb}** on AI search."* (band-verb = "dominant"/"winning"/"even"/"losing"/"invisible"). Three score cards in a row: Your Visibility %, Peer Average %, RVI ratio with "you're at X% of peer avg" caption. One-paragraph narrative (~80 words) walking through the 90 queries, the peer set, and the takeaway. Tiny methodology footnote at the bottom (90 queries, model list, RVI in one sentence).

**Page 3 — Per-prompt scorecard.** All 10 prompts as cards, sorted **worst RVI first**. Each card shows the prompt text, the RVI dot-bar + numeric, two horizontal bars (Your % vs Peer Avg %), and a small band pill. `page-break-inside: avoid` on each card so they don't split.

**Page 4 — Who's winning, where.** Three call-out blocks for the worst three prompts. Each names a top competitor by name: *"**{Competitor X}** dominates this question with **{Y}%** visibility — you sit at **{Z}%**."* Per-model dots showing which models cite that competitor. One inferred-cause sentence.

**Page 5 — What we'd do about it.** The LLM-generated recommendations (Claude Sonnet, 3–5 bullets) rendered as numbered priority cards. Matches the existing `.rec` card pattern from site-audit PDF (big Georgia-serif numbered watermark right-aligned). Each card: bold one-line claim, two-sentence justification tied to actual gaps, expected-impact footer.

**Page 6 — CTA + methodology.** Big Georgia-serif: *"Want to be the answer instead?"* Two-line CTA with Ken's email and a calendar URL (config var, see Environment additions below). Lumidian wordmark. Full methodology block at bottom (small slate-500): 90 queries breakdown, RVI definition, model list, timestamp.

**Anti-patterns explicitly avoided:** cover with 4-paragraph intro, "About Lumidian" page in the first half, Recharts/Chart.js (heavier than inline SVG/CSS bars and look generic), repeating confidentiality footer on every page, gradient bar fills.

**Playwright print conventions honored** (matching `site_audit/pdf_renderer.py`):
- `page-break-inside: avoid` on each card and section
- `@page { size: Letter; margin: 0 }` + per-section padding
- Logos embedded as data URIs (avoids any in-flight fetch during render)
- System-font fallback chain so the PDF renders consistently across environments
- `page.emulate_media(media="print")` before `page.pdf(...)` so screen-media-only rules don't sneak in

### Error handling

| Step | Failure mode | Handling |
|---|---|---|
| Scrape homepage | Network / 5xx / timeout | Continue with empty `homepage_excerpt`; non-fatal |
| Generate prompts | Missing ANTHROPIC_API_KEY / < 8 valid / parse fail | Hard fail with specific `error_message` |
| Detect competitors | Returns 0 / parse fail | Hard fail — RVI undefined without peers |
| Fetch logo | All three fallbacks fail | Skip; PDF uses text-tile fallback. Non-fatal. |
| Run 90 queries | Per-query LLM error → result struct gets `error` field, continues | Soft tolerance: > 40% query errors → hard fail. Provider 429 → existing `llm_service` retry logic |
| Score | Math step; only fails if all queries errored (caught earlier) | — |
| Recommendations | Sonnet API error | Retry once with Haiku. Both fail → null recs, PDF uses static fallback block. Non-fatal. |
| Render PDF | Template error / disk write fail | Hard fail. PDF is the deliverable. |

**Cancellation:** `asyncio.Event` per audit in `app/state.py`. Set by `/cancel` endpoint and also persisted as `cancel_requested=true` so a process restart still observes the intent.

**Auth:** every endpoint goes through `require_agency_staff`. PDF download endpoint also rate-limits to 10 audits/hour per staff user (in-memory `_rate_store` from `auth.py`).

### Environment additions

```
PROSPECT_AUDIT_CTA_URL    # e.g. https://cal.com/ken-turner/intro — appears on page 6 of the PDF
PROSPECT_AUDIT_CTA_EMAIL  # e.g. ken@lumidian.ai — appears in the same CTA block
```

Defaults if unset: `PROSPECT_AUDIT_CTA_URL` falls back to `https://lumidian.io` (just the marketing site); `PROSPECT_AUDIT_CTA_EMAIL` falls back to whatever `SUPPORT_EMAIL` is set to. Both are read at render time, not boot time, so changes don't require restart.

## Testing

```
backend/tests/
  test_prospect_audit_scoring.py        # RVI math — pure unit tests
  test_prospect_audit_runner.py         # Orchestrator with mocked LLMs
  test_prospect_audit_router.py         # Endpoints — auth, multi-tenancy, rate limit
  test_prospect_audit_logo.py           # Logo fallback chain
  test_prospect_audit_cleanup.py        # 60-day scheduler cleanup
```

**Test cases (selected):**

*Scoring:*
- `rvi` when `peer_avg > 0`
- `rvi` when `peer_avg == 0` and `own > 0` → band = `dominant`, stored `rvi=null`
- `rvi` when `own == 0` and `peer_avg > 0` → `rvi=0`, band = `invisible`
- `rvi` when both `== 0` → `rvi=1.0`, band = `even`
- Aggregate ignores infinite-band rows
- Banding thresholds (dominant ≥ 2.0, winning ≥ 1.2, etc.)
- Subject competitor exclusion ("alternative to X" excludes X from peer denominator)

*Runner:*
- Happy path: pending → completed, all status transitions persisted
- Missing ANTHROPIC_API_KEY → `status='failed'` with specific `error_message`
- Cancel mid-query-batch → `status='canceled'`
- > 40% query errors → `status='failed'`
- Recommendations retry: Sonnet 500 → Haiku → success
- Recommendations both fail → `status='completed'`, `recommendations_md=null` (non-fatal)
- PDF render fail → `status='failed'`

*Router:*
- `POST` creates row + schedules task; non-staff returns 403
- `GET` list returns only the calling staff member's audits (multi-tenancy)
- `POST /cancel` sets event + DB flag
- `DELETE` removes row + PDF file from disk
- `GET /pdf` returns 404 when `status != 'completed'`
- `GET /pdf` 10/hour rate limit enforced

*Logo:*
- og:image present → returns og:image data URI
- og:image absent, favicon present → returns favicon data URI
- both absent → returns text-tile data URI
- network errors → returns text-tile

*Cleanup:*
- Audits older than 60 days → deleted (row + PDF file)
- Audits within 60 days → kept
- Missing PDF file on disk during cleanup → logged, doesn't crash

**Mocking approach:**
- `llm_service.query_chatgpt/perplexity/gemini` patched to return fixture responses (mix of prospect-mentioned and competitor-mentioned text)
- Claude calls patched via `anthropic.AsyncAnthropic` mock
- Playwright: in unit tests, swap to a no-op renderer that writes an empty file; in one end-to-end integration test, actually render (Playwright Chromium is already installed in the dev/CI environment for site-audit tests) to catch template syntax errors

**Smoke check before merging:** run the audit end-to-end against a real well-known brand from Ken's existing brands using real API keys. Open the PDF. Visually confirm it looks beautiful. Listed as the last item in the implementation plan.

## Risks / edge cases

- **Cost runaway:** each audit costs ~$0.50–$1.50 in API charges. The 10-audits/hour-per-staff rate limit is the soft guardrail. Log each audit start as an analytics event so usage is visible.
- **Playwright cold-start latency:** first-time Chromium launch can take 2–5 seconds. The PDF render step is the last in the pipeline so this latency just adds to the visible runtime (already ~90–150s overall). Reuse the same `async_playwright` import + browser-launch pattern from `services/site_audit/pdf_renderer.py` to avoid drift.
- **Prospect logo quality:** og:image is sometimes a banner, not a clean logo. Text-tile fallback ensures the PDF still looks intentional rather than broken. Acceptable trade-off for v1.
- **Local prompt geo-sensitivity:** the Claude Haiku prompt-gen step needs to actually inject location-aware phrasing. Validate during smoke check that local audits produce prompts like "best dentist in Austin?" and not generic "best dentist?". Adjust system prompt if needed.
- **Competitor mis-identification:** Claude Haiku may name competitors that aren't real or that the prospect would dispute. Since these names appear in the PDF, a wrong name is embarrassing. Mitigation: the LLM is constrained to "real, publicly-known competitor brands"; manual review by Ken before sending the PDF is the human gate.
- **PDF file accumulation:** 60-day retention + 10/hour rate cap = worst case ~14,400 PDFs on disk. At ~200KB each that's ~3GB. Acceptable on Railway's persistent volume.
- **Concurrent retry:** if a staff member hits Retry while the previous task is still running, we'd kick a second task on the same row. Mitigate: `retry` endpoint refuses if `status` is non-terminal (returns 409).

## Open questions

None — all decisions resolved during brainstorming.
