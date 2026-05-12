# Site Audit Redesign — Fix Factory + Expanded Coverage

**Status:** spec
**Author:** Claude Code (brainstormed with Ken, 2026-05-12)
**Branch target:** TBD (new branch `feat/site-audit-fix-factory`)

---

## Problem

The `/site-audit/[brandId]` page (shipped 2026-05-11) is functional but unappealing and shallow:

- Visual language uses generic Tailwind borders, not Lumidian's design system. Looks like a different product.
- Headline metrics (Bot/Content/Schema/Technical 0-100) are arbitrary — users don't know what 67 means or how to move it.
- Recommendations are flat text. No paste-ready artifacts, no per-rec call-to-action beyond reading.
- Coverage is thin for AI-search: bots + semantic HTML + schema + llms.txt + robots.txt + citations. Missing E-E-A-T, internal linking, Q&A format, statistical density.

## Goal

Turn the site-audit surface into a **fix factory**: every recommendation becomes a draftable artifact (JSON-LD block, FAQ section, rewritten paragraph, etc.) that the user can produce, paste into their site, and mark as applied — without leaving the audit page.

Match Lumidian's design system (`.card`, `.card-elevated`, CSS tokens, framer-motion patterns from `lib/motion.ts`).

Expand audit coverage with four new check categories alongside the redesign.

## Non-goals (phase 1)

- Tying audit findings to specific losing tracking-prompts ("fixing this would win prompts X/Y/Z"). The data is available via `linked_prompt_ids`, but surfacing it well requires its own UX pass. Plumb the existing chip; defer richer integration.
- Auto-applying fixes (writing to the customer's CMS). The user pastes the artifact themselves; we just produce it.
- A new scoring model. We keep the existing 0-100 axes; we contextualize them with letter-grade bands.
- Pre-generating every recommendation's artifact at audit time. Lazy on click.
- Visual companion-style mockups. Text spec only.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js / React)                                          │
│                                                                       │
│  /site-audit/[brandId]                                                │
│    └── <SiteAuditView>                                                │
│         ├── <AuditHeader>          (last-run + Run-new-audit btn)    │
│         ├── <Tabs>                                                    │
│         │    ├── Overview                                            │
│         │    │   ├── <RenderModeBanner>                              │
│         │    │   ├── <OverviewHero>     (top 5 FixCards)             │
│         │    │   ├── <ScoreStrip>       (overall + 4 categories)     │
│         │    │   └── <HistorySparkline>                              │
│         │    ├── Fixes                                                │
│         │    │   ├── <FixFilters>                                    │
│         │    │   └── <FixGrid>          (all recs as FixCards)       │
│         │    ├── Pages                                                │
│         │    │   ├── <PageTable>                                     │
│         │    │   └── <PageDetail>       (drill-down)                 │
│         │    ├── Schema & Bots                                        │
│         │    │   ├── <SchemaMatrix>                                  │
│         │    │   ├── <BotGrid>                                       │
│         │    │   └── <FilesStatusRow>                                │
│         │    └── Citations                                            │
│         │        ├── <CitationStackedBar>                            │
│         │        ├── <CitationTopDomains>                            │
│         │        └── <AuditHistoryList>                              │
│                                                                       │
│  All cards use .card / .card-elevated / .card-hover classes.         │
│  Motion via existing lib/motion.ts staggerContainer + useCountUp.    │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Backend (FastAPI / SQLAlchemy)                                       │
│                                                                       │
│  app/services/site_audit/                                             │
│    ├── auditor.py             (orchestrator — adds 4 new parser calls)│
│    ├── parsers/                                                       │
│    │    ├── eeat.py           NEW — author / dates / outbound cites  │
│    │    ├── linking.py        NEW — orphan / depth / weak-hub        │
│    │    ├── qa.py             NEW — Q&A format detection             │
│    │    └── semantic.py       (+ stats-density check_ids)            │
│    ├── recommendations.py     (+ priority_score; static _RECS updates)│
│    └── artifact_generator.py  NEW — type → generator dispatch        │
│                                                                       │
│  app/routers/site_audit.py                                            │
│    ├── POST /recommendation/{id}/draft     NEW                       │
│    └── PATCH /recommendation/{id}/status   NEW                       │
│                                                                       │
│  app/models.py                                                        │
│    └── WebsiteAuditRecommendation                                    │
│         + artifact, artifact_type, artifact_generated_at,            │
│           artifact_regen_count, status, expected_lift_pp, target_url │
│                                                                       │
│  app/database.py:run_migrations()                                     │
│    └── append migration: ALTER TABLE audit_recommendations …          │
└──────────────────────────────────────────────────────────────────────┘
```

## Data flow — fix-factory click

```
User clicks [Draft this] on a FixCard
   │
   ▼
POST /api/site-audit/recommendation/{rec_id}/draft
   │
   ├── Auth: _ensure_brand_access(rec.brand_id, user)
   ├── Tier gate: rule-based artifacts → basic+; LLM artifacts → starter+
   ├── If rec.artifact already exists AND no regenerate_notes → return cached
   ├── Else: artifact_generator.generate_artifact(rec_id, notes)
   │        ├── Load rec + audit + page + BrandProfile
   │        ├── Dispatch by artifact_type:
   │        │    ├── jsonld_org → fill template from BrandProfile + audit
   │        │    ├── jsonld_faq → Claude Haiku w/ FAQ-section system prompt
   │        │    ├── meta_title → Claude Haiku w/ title system prompt
   │        │    ├── section_rewrite → Claude Haiku w/ rewrite system prompt
   │        │    ├── … (one generator per type)
   │        │    └── new_page_draft → Claude Haiku w/ page-draft system prompt
   │        ├── Persist artifact + artifact_type + artifact_generated_at
   │        └── Increment artifact_regen_count if regenerating
   │
   ▼
Frontend stores artifact in component state, renders State C of FixCard
```

## Component / module specs

### Frontend

Each component lives at `frontend/components/site-audit/<Name>.tsx`.

**`<SiteAuditView>`** — top-level orchestrator. Fetches latest audit, polls while in-flight, renders header + tabs. State: `{ audit, activeTab, recsCache }`. Reuses 4-second poll from current implementation.

**`<AuditHeader>`** — last-audit timestamp, page count, overall grade pill, Run-new-audit button. Uses `.card-elevated`.

**`<OverviewHero>`** — top-5 ranked `<FixCard>`s with `status='pending'`, sorted by `priority_score` desc. Stagger animation on entry. Below the list: link "See all 110 fixes →" deep-linking to Fixes tab. If <5 pending recs, fill with `status='applied'` recs.

**`<ScoreStrip>`** — 5 cards: Overall (large `.card-elevated`) + Bot/Content/Schema/Technical (`.card-hover`). Each card shows letter grade + numeric. Tooltips with definitions. Sparkline on each. Click → opens popover with top 3 contributing findings + "Jump to fixes" deep link.

**`<FixCard>`** — three states (A collapsed / B drafting / C drafted). Props: `rec: WebsiteAuditRecommendationOut`. Internal state: `{ artifact, draftStatus: 'idle'|'drafting'|'done'|'error' }`. On `[Draft this]` click, POSTs to `/draft`, sets state. Framer Motion `layout` prop animates height. On `[Mark applied]` / `[Dismiss]`, PATCHes status, slides out (200ms ease-out). On `[Regenerate]`, opens `<RegenPopover>`.

**`<FixCardCodeBlock>`** — monospace block with copy button. Syntax highlight (lazy — Prism or Shiki) for JSON/HTML/Markdown. Copy button shows checkmark for 1.5s on success.

**`<FixCardImplSteps>`** — numbered list (1, 2, 3) of implementation steps. Comes from the static `_RECS` registry per `check_id`, or from the LLM-generated artifact when available.

**`<RegenPopover>`** — inline (not a modal) popover with a textarea for optional regenerate notes + Cancel/Regenerate buttons. Closes on outside click.

**`<FixGrid>`** — virtualized list of FixCards (if >50). Otherwise plain `.space-y-4`. Filters above.

**`<FixFilters>`** — chips for category/priority/status, search input for title. Filter state in URL (`?cat=schema&pri=high&q=organization`).

**`<PageTable>`** — sortable table replacing current `PageList`. Columns: URL, type icon, words, JS?, score, top-issue chip. Click expands `<PageDetail>` inline.

**`<PageDetail>`** — re-skinned current `PageDetail` using `.card` classes. Embeds `<FixCard>`s for that page's recs.

**`<SchemaMatrix>`** — Recharts heatmap-style grid: rows = page types (homepage / product / article / hub / other), columns = schema types (Organization / Product / Article / FAQ / BreadcrumbList / etc.). Cell value = page count. Missing = highlighted red. Click → opens Fixes tab filtered to that schema type.

**`<BotGrid>`** — 10 rows (one per AI bot), each: bot name + status chip (allowed/blocked) + "what this bot does" tooltip + per-bot allow/disallow hints if blocked.

**`<FilesStatusRow>`** — three rows: llms.txt / robots.txt / agents.md. Each shows status (present / missing / invalid) + "Generate →" button linking to the existing generators.

**`<CitationStackedBar>`** — horizontal stacked bar: own % / competitor % / third-party % / unknown %. Counts above the bar.

**`<CitationTopDomains>`** — top-10 list with per-model breakdown chips and a "kind" badge.

**`<AuditHistoryList>`** — table of past audits with score deltas: `prev_score → curr_score (±N)`. CTA "Run new audit".

**`<RenderModeBanner>`** — only renders if homepage page has `is_js_rendered=true`. Yellow warning banner explaining CSR risk for AI crawlers + a "Schedule a render-mode fix" CTA (which is itself a FixCard).

### Backend

**`artifact_generator.py`** — single entrypoint:

```python
async def generate_artifact(
    rec_id: int,
    *,
    regenerate_notes: str | None = None,
) -> ArtifactResult:
    """Dispatch by rec.artifact_type. Returns artifact string + type.

    Rule-based types: jsonld_org, jsonld_breadcrumb, llms_txt,
                      robots_snippet, agents_md
    LLM-backed types: jsonld_faq, jsonld_article, jsonld_product,
                      jsonld_howto, meta_title, meta_description,
                      h1_text, og_tags, faq_section, section_rewrite,
                      new_page_draft, alt_text_batch,
                      internal_link_suggestions
    """
```

LLM-backed generators share a helper that loads `Brand`, `BrandProfile`, target `WebsiteAuditPage`, and renders a per-type system prompt template (lives in `services/site_audit/prompts/artifact/<type>.md`). Calls Claude Haiku 4.5 via existing `llm_service`. 30s timeout, single retry on transient.

**Persistence:** result written back to `WebsiteAuditRecommendation.artifact` + `artifact_type` + `artifact_generated_at`. Regen increments `artifact_regen_count`.

**New endpoints** in `routers/site_audit.py`:

- `POST /api/site-audit/recommendation/{rec_id}/draft`
  - Body: `{ regenerate_notes?: string }`
  - Returns: `{ artifact: string, artifact_type: string, generated_at: datetime, regen_count: int }`
  - Auth via `_ensure_brand_access` on rec → audit → brand
  - Tier gate: rule-based types allowed on `basic`+; LLM types on `starter`+

- `PATCH /api/site-audit/recommendation/{rec_id}/status`
  - Body: `{ status: 'pending' | 'applied' | 'dismissed' }`
  - Returns: `204`

### New parsers

Each lives at `app/services/site_audit/parsers/<name>.py`, exports a single `parse_<name>(page: ParsedPage) -> list[Finding]` function (matches existing pattern in `parsers/semantic.py`).

**`parsers/eeat.py`** — checks per page:
- `missing_author_byline` (medium) — article/blog pages without `<author>`, `rel="author"`, `schema.org/Author`, or a `byline` class
- `missing_published_date` (high for articles, low otherwise) — no `<time>`, `datePublished`, or `lastmod` in sitemap
- `missing_outbound_citations` (medium for articles) — long-form article (≥500 words) with zero outbound links to non-self domains

**`parsers/linking.py`** — runs once at audit level (not per-page), produces per-page findings:
- `orphan_page` (medium) — page has zero internal inbound links
- `deep_page` (low) — page is >3 hops from homepage in the link graph
- `weak_hub` (medium) — page classified as `hub` with <5 internal outbound links

**`parsers/qa.py`** — checks per page:
- `no_qa_format` (low) — long content (≥800 words) with no `<dl>/<dt>/<dd>`, `<details>/<summary>`, FAQ schema, or question-headers
- `qa_without_schema` (medium) — Q&A markup present but no `FAQPage` JSON-LD
- `qa_thin` (low) — FAQ block with <3 question/answer pairs

**`semantic.py`** extension — two new check_ids:
- `no_tables_or_lists` (low) — long-form content (≥500 words) with zero `<table>`, `<ol>`, or `<ul>` (excluding nav)
- `low_stats_density` (low) — article-type page with <2 numeric facts per 500 words (uses existing `fact_density`)

**Auditor changes** — `auditor.py:_run_audit_inner` calls the four new parsers after existing ones; merges their findings into the same persistence step. Internal-linking runs once after the crawl with the link graph in memory.

**Recommendations** — `recommendations.py:_RECS` registry gets new entries keyed on each new check_id. Each entry now includes:
- `title` (action verb)
- `body` (the "why it matters" text)
- `category`
- `priority`
- `effort_minutes`
- `expected_lift_pp` (per-axis, e.g., `{"schema": 21}`)
- `artifact_type` (matches the generator enum, or `null` for read-only recs)
- `impl_steps` (numbered list)

### Priority score

Add `priority_score` (float, computed) to `WebsiteAuditRecommendation`. Formula:

```
priority_score = (expected_lift_pp * pages_affected) / sqrt(effort_minutes + 1)
```

Computed at audit time when recs are built. Hero pulls top 5 by `priority_score desc` filtered to `status='pending'`.

### Migrations

Append a single migration step to `database.py:run_migrations()`:

```sql
ALTER TABLE audit_recommendations ADD COLUMN artifact TEXT;
ALTER TABLE audit_recommendations ADD COLUMN artifact_type TEXT;
ALTER TABLE audit_recommendations ADD COLUMN artifact_generated_at TIMESTAMP;
ALTER TABLE audit_recommendations ADD COLUMN artifact_regen_count INTEGER DEFAULT 0;
ALTER TABLE audit_recommendations ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE audit_recommendations ADD COLUMN expected_lift_pp REAL;
ALTER TABLE audit_recommendations ADD COLUMN target_url TEXT;
ALTER TABLE audit_recommendations ADD COLUMN priority_score REAL;
```

Each guarded by an existing-column check (matches the pattern used elsewhere in `run_migrations`).

For existing recommendation rows: `status` defaults to `'pending'`. The Fixes tab can backfill `expected_lift_pp` lazily from the static `_RECS` registry on first read (one-pass migration on demand, or a `scripts/backfill_rec_metadata.py` companion script).

### Tier gating

| Tier | Audit caps (existing) | Fix factory access |
|------|------------------------|---------------------|
| Free | excluded | excluded |
| Pitch | excluded | excluded |
| Basic | 50pp / 4 per month / 0 LLM rewrites | Rule-based artifacts only (JSON-LD shells, llms.txt, robots, agents.md) |
| Starter | 100pp / 8 per month / 5 LLM rewrites | All artifact types, 5 LLM-backed drafts per month |
| Pro | 250pp / unlimited / 15 LLM rewrites | All artifact types, 15 LLM-backed drafts per month |

LLM-backed-draft cap is enforced in the `/draft` endpoint by counting rows where `artifact_generated_at >= start_of_month AND artifact_type IN (<llm types>)`. Returns 402 with a clear message when capped.

Regeneration counts against the cap.

### Error handling

- LLM transient failure (5xx, timeout): retry once, then return `503` with body `{ error: 'draft_failed', message: '…' }`. FixCard renders error state with `[Try again]`.
- LLM auth failure / missing API key: return `503` with body `{ error: 'api_key_missing' }`. FixCard renders a "Configure API keys in Settings" message.
- Tier cap exceeded: `402` with body `{ error: 'tier_cap', current: N, cap: M }`. FixCard renders "You've used 15/15 LLM drafts this month — upgrade or wait until {date}".
- Rec already drafted + no regen notes: return cached artifact, no LLM call.
- Brand profile incomplete (no `company_description`): LLM generators still run, but the per-type prompt notes the missing fields. We don't block.

### Motion

| Element | Motion | Timing |
|---------|--------|--------|
| Hero card list entry | Stagger fade-in + slide-up 8px | 80ms stagger, 200ms each, ease-out |
| Overall score number | Count-up | 800ms (existing `useCountUp`) |
| FixCard height (collapse↔drafted) | Framer Motion `layout` | Spring `stiffness:220, damping:26` |
| Applied / dismissed exit | Slide-fade (translateY 4 + opacity) | 200ms ease-out |
| Copy button confirm | Icon swap + success color | 1500ms hold |
| Tab switch | Cross-fade | 150ms |
| Score card hover | TranslateY(-1) + shadow lift | 200ms ease-out (existing `.card-hover`) |
| Tooltip open/close | Existing `HelpTooltip` | 200ms / 100ms |
| Render-mode banner first appear | Pulse twice | 600ms each |
| Drafting state | Skeleton shimmer + spinner | Until response |
| Trigger button press | Scale 0.97 → 1 | Spring `stiffness:400, damping:20` |

### Routes and tabs

5 tabs (renamed/restructured from current 5):

1. **Overview** — hero (top 5 FixCards), score strip, history sparkline, render-mode banner if applicable
2. **Fixes** — full rec list with filters
3. **Pages** — sortable page table + drill-down
4. **Schema & Bots** — combined schema-matrix, bot-grid, files-status row
5. **Citations** — stacked bar, top domains, audit history list

Tab state is URL-driven (`?tab=fixes`). The current `audit history` lives inside Citations rather than its own tab because it's a smaller surface.

### Testing

Existing 95 site_audit tests are preserved. New tests:

- `tests/test_site_audit_artifact_generator.py` — one test per artifact type, with LLM mocked. Validates: JSON-LD shape, BrandProfile pull-through, regenerate_notes appended verbatim.
- `tests/test_site_audit_draft_endpoint.py` — POST /draft auth, tier gate (basic vs starter vs pro), caching, regen behavior, error responses.
- `tests/test_site_audit_status_endpoint.py` — PATCH /status state transitions, auth.
- `tests/test_site_audit_parsers_eeat.py`
- `tests/test_site_audit_parsers_linking.py`
- `tests/test_site_audit_parsers_qa.py`
- `tests/test_site_audit_priority_score.py` — formula correctness, top-5 ordering.
- `tests/test_site_audit_migration.py` — new columns present after run_migrations on a fresh DB.

No frontend tests (the project has no frontend test infrastructure per CLAUDE.md).

Playwright smoke test added to existing `test_site_audit_integration.py` shape:
- Trigger audit on a fixture site
- Click "Draft this" on a rec via API
- Assert artifact saved, type matches
- PATCH status to "applied"
- Assert rec removed from top-5

### Risks / unknowns

- **LLM cost** — even lazy, if users click "Draft this" on most recs, monthly LLM spend balloons. Tier caps mitigate, but we should monitor: log a per-user counter via existing AnalyticsEvent.
- **Streaming** — SSE through FastAPI + Next.js dev proxy may need work. Phase 1 ships with JSON-only + skeleton; SSE phase 2.
- **Migration safety** — adding 8 columns to a hot table. Run during low-traffic window. SQLite ALTER TABLE on a row-count <10k is fast; production should verify.
- **Brand profile coverage** — generators lean on BrandProfile fields; if a brand has none filled, artifacts are still produced but generic. Phase 2 could nag the user to complete the profile before drafting.
- **Backfill of existing recs** — existing rows lack `expected_lift_pp`, `priority_score`. Hero ordering falls back to existing `priority` enum (high/medium/low) until first re-audit. Document in migration script.

---

## Out of scope (phase 2+)

- Tying audit findings to losing tracking prompts (the wedge). Plumb `linked_prompt_ids` chip, defer richer UX.
- SSE streaming.
- Auto-applying fixes (CMS write-through).
- Voice-of-brand consistency check.
- Topical-cluster / entity-coverage checks.
- Multilingual / hreflang checks.
- Custom audit cadence (weekly auto-runs).

---

## Files affected (estimated)

**Backend (new):**
- `app/services/site_audit/artifact_generator.py`
- `app/services/site_audit/parsers/eeat.py`
- `app/services/site_audit/parsers/linking.py`
- `app/services/site_audit/parsers/qa.py`
- `app/services/site_audit/prompts/artifact/*.md` (one per LLM type)
- `tests/test_site_audit_artifact_generator.py`
- `tests/test_site_audit_draft_endpoint.py`
- `tests/test_site_audit_status_endpoint.py`
- `tests/test_site_audit_parsers_eeat.py`
- `tests/test_site_audit_parsers_linking.py`
- `tests/test_site_audit_parsers_qa.py`
- `tests/test_site_audit_priority_score.py`
- `scripts/backfill_rec_metadata.py`

**Backend (modified):**
- `app/models.py` (WebsiteAuditRecommendation +8 cols)
- `app/database.py` (run_migrations append)
- `app/schemas.py` (WebsiteAuditRecommendationOut +cols, draft request/response)
- `app/routers/site_audit.py` (+2 endpoints)
- `app/services/site_audit/auditor.py` (call 4 new parsers)
- `app/services/site_audit/recommendations.py` (registry updates; priority_score computation)
- `app/services/site_audit/parsers/semantic.py` (+2 check_ids)

**Frontend (new):**
- `components/site-audit/AuditHeader.tsx`
- `components/site-audit/OverviewHero.tsx`
- `components/site-audit/ScoreStrip.tsx`
- `components/site-audit/ScoreCard.tsx`
- `components/site-audit/FixCard.tsx`
- `components/site-audit/FixCardCodeBlock.tsx`
- `components/site-audit/FixCardImplSteps.tsx`
- `components/site-audit/FixGrid.tsx`
- `components/site-audit/FixFilters.tsx`
- `components/site-audit/RegenPopover.tsx`
- `components/site-audit/PageTable.tsx` (replaces PageList)
- `components/site-audit/SchemaAndBotsTab.tsx`
- `components/site-audit/SchemaMatrix.tsx`
- `components/site-audit/BotGrid.tsx`
- `components/site-audit/FilesStatusRow.tsx`
- `components/site-audit/CitationsTab.tsx`
- `components/site-audit/CitationStackedBar.tsx`
- `components/site-audit/CitationTopDomains.tsx`
- `components/site-audit/AuditHistoryList.tsx`
- `components/site-audit/RenderModeBanner.tsx`
- `components/site-audit/HistorySparkline.tsx`
- `lib/grade.ts` (score → letter band helper)

**Frontend (modified):**
- `components/site-audit/SiteAuditView.tsx` (refactored — orchestrator only)
- `components/site-audit/PageDetail.tsx` (re-skin + embed FixCards)
- `components/site-audit/AuditTriggerButton.tsx` (restyle)
- `lib/api.ts` (+ draft / status methods; +new rec fields in type)

**Frontend (deleted):**
- `components/site-audit/BotAccessPanel.tsx` (merged into SchemaAndBotsTab)
- `components/site-audit/LlmsTxtPanel.tsx` (merged into FilesStatusRow)
- `components/site-audit/GeneratorsCard.tsx` (merged into FilesStatusRow)
- `components/site-audit/CitationDomainList.tsx` (replaced by CitationsTab)
- `components/site-audit/RecommendationsList.tsx` (replaced by FixGrid)
- `components/site-audit/PageList.tsx` (replaced by PageTable)

---

## Acceptance criteria

- Visiting `/site-audit/[brandId]` shows the new Overview hero with the top 5 fixes as `<FixCard>`s, using `.card-elevated` / `.card` / `.card-hover` styles.
- Clicking "Draft this" on a FixCard: shows shimmer ≤ 200ms, calls POST `/recommendation/{id}/draft`, renders the artifact in a monospace code block.
- Copy button copies the artifact to clipboard and shows a checkmark for 1.5s.
- Regenerate opens an inline popover, accepts notes, replaces the artifact, increments `artifact_regen_count`.
- Mark applied / dismiss PATCHes status; card slides out (200ms); next-ranked rec fills the slot.
- Score strip shows letter grades A–F with appropriate color tokens; each card has a tooltip explaining the score's contributors.
- Render-mode banner appears only when homepage is JS-rendered.
- New parsers fire during audit; new findings appear with new check_ids; new recommendations carry `artifact_type` set.
- Schema & Bots tab renders the page × schema-type matrix + 10-row bot grid + 3-row files row.
- Citations tab renders the stacked bar + top-10 domains + audit history list.
- Tier gating: basic users see "Draft this" on rule-based recs only; starter+ users see it on all. Cap exceeded returns 402.
- 95 existing audit tests still pass. New tests added per spec all pass.
- TypeScript strict mode: 0 errors.
- Playwright smoke: audit → draft → status flow works on Rhythm fixture.

---

## Self-review notes

- Scope is large but coherent (one user-facing feature: the fix factory). Implementation plan should phase it: ① migration + ORM + endpoints; ② generators (start with rule-based, then 4-5 LLM types); ③ frontend redesign; ④ new parsers + recs registry updates. Frontend can be developed against mocked endpoints once ORM is in place.
- "New page draft" artifact type is the most ambitious LLM-backed generator (could produce a 500+ word landing page). If it ships v0.1, mark it experimental and don't include it in the hero — only available via Fixes-tab filter.
- Eight new ORM columns is a lot. None are required at row-creation time; all default-safe. Migration is append-only ALTER TABLE — fine for SQLite.
- `agents.md` is in the artifact-type list but no parser detects it yet. Add to `llms_txt.py` parser (or create `parsers/agents_md.py` mirroring `llms_txt.py`). Spec note: this is a small addition, fold into phase 1.
- Backfill script `scripts/backfill_rec_metadata.py` is mentioned but not fully specced. It walks existing recommendations, looks up `expected_lift_pp` and `artifact_type` from the `_RECS` registry by `check_id`, fills them. Idempotent.
- The "Citations" tab now houses audit history, which is a slightly awkward bundling. Acceptable for phase 1 to avoid a 7th tab; could split later if user volume warrants.
