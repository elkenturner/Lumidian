# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Shared context across Claude surfaces.** This file holds *stable* architecture and conventions. *Volatile* state — what Ken is actively working on, recent decisions, open questions — lives in [`CURRENT_STATE.md`](./CURRENT_STATE.md). **Every Claude session (Claude Code, Cowork, Claude in Chrome) must read `CURRENT_STATE.md` at the start and update it before ending.** That file is the single source of truth for "where are we right now."

---

## What This App Does

Lumidian is a SaaS dashboard that tracks brand visibility in AI-generated responses across ChatGPT, Claude, Perplexity, and Gemini. Users configure brands + prompts, trigger tracking runs, and view visibility scores, per-model breakdowns, trend charts, raw response transcripts, content drafts, and competitor analysis.

---

## Development Commands

### Backend
```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
# Swagger UI: http://localhost:8000/api/docs
```

### Frontend
```bash
cd frontend
npm run dev        # http://localhost:3000
npm run build
npm run lint
```

### Tests (backend only — no frontend tests exist)
```bash
cd backend
pip install -r requirements-test.txt
pytest tests/                                                        # all tests
pytest tests/test_brands.py                                          # single file
pytest tests/test_brands.py::test_create_brand_success               # single test
pytest -k "brand" tests/                                             # keyword filter
```

`pytest.ini` sets `asyncio_mode=auto`. Tests use isolated SQLite; tables are truncated between tests (not dropped). Fixtures are in `tests/conftest.py`. Helpers: `register_user()`, `login_user()`, `register_and_login()`, `create_brand()`.

---

## Environment Variables

Copy `backend/.env.example` → `backend/.env`. **`JWT_SECRET` (≥32 chars) is required; app will not start without it.**

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | **Required.** 32+ char random string |
| `OPENAI_API_KEY` | ChatGPT queries |
| `ANTHROPIC_API_KEY` | Claude queries |
| `PERPLEXITY_API_KEY` | Perplexity queries |
| `GEMINI_API_KEY` | Gemini queries |
| `SERPER_API_KEY` | Web search (Serper.dev) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (optional) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing |
| `STRIPE_BASIC_PRICE_ID` / `STRIPE_STARTER_PRICE_ID` / `STRIPE_PRO_PRICE_ID` | Subscription tier price IDs (Starter / Growth / Pro — see tier naming convention below) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Transactional email via Resend HTTP API |
| `SUPPORT_EMAIL` | Inbox that receives in-app support form submissions |
| `SENTRY_DSN` | Backend error monitoring (optional) |
| `DATABASE_URL` | Default: `sqlite+aiosqlite:///./clarity_ai.db` |
| `FRONTEND_URL` | Default: `http://localhost:3000`; used for OAuth redirects |
| `ENVIRONMENT` | `development` (default) or `production`; controls cookie `secure` flag |
| `ALLOWED_ORIGINS` | CORS origins; supports ngrok URLs for remote dev |
| `ADMIN_EMAILS` | Comma-separated emails with admin bypass |
| `ADMIN_PASSWORD` / `ADMIN_NAME` | Seeded admin account on first startup |

---

## Architecture

### Stack
- **Backend:** Python 3.11+, FastAPI 0.115, SQLAlchemy 2.0 (async), SQLite + aiosqlite, APScheduler, bcrypt, PyJWT, Stripe, ReportLab, pyotp
- **Frontend:** Next.js 16 (Turbopack), React 18, TypeScript (strict), Tailwind CSS, Radix UI, Recharts, Axios, date-fns, lucide-react
- **LLM providers:** OpenAI (gpt-4.1-mini default, gpt-4o-mini + hosted web_search tool via Responses API for paid subscribers), Anthropic (claude-haiku-4-5-20251001 with web_search_20250305 — Pro tier only), Google GenAI (gemini-2.5-flash for all tiers), Perplexity (sonar default, sonar-pro for paid subscribers)

### Backend Layout
```
backend/app/
  main.py           # FastAPI app, lifespan context, CORS, router mounts
  database.py       # Async SQLAlchemy engine; create_tables() + run_migrations() on startup
  models.py         # 20+ ORM models
  schemas.py        # Pydantic request/response validators
  scheduler.py      # APScheduler jobs
  dependencies.py   # get_current_user, AllowUnverifiedUser, shared deps (JWT decode, rate limit)
  routers/          # 18 router modules
  services/         # 14 service modules
tests/
  conftest.py       # Fixtures, test helpers
  test_auth.py      test_brands.py  test_tracking.py
  test_content.py   test_rate_limits.py
```

### Router Mounts (all at `/api` prefix)

| Router file | Prefix | Responsibility |
|-------------|--------|----------------|
| auth.py | /api/auth | Register, login, logout, OAuth, 2FA, password reset, email verify |
| brands.py | /api/brands | Brand + prompt CRUD, competitor management, suggested prompts |
| brand_profile.py | /api/brand_profile | Brand knowledge base (tone, publications, context) |
| tracking.py | /api/tracking | Trigger, monitor & cancel tracking runs |
| results.py | /api/results | Per-run analytics + raw query responses |
| dashboard.py | /api/dashboard | SOV, sentiment, position, competitor overview |
| content.py | /api/content | Drafts, posts, settings, platform guidelines, attribution |
| gaps.py | /api/gaps | Content gap analysis |
| opportunities.py | /api/opportunities | Reddit/Quora/LinkedIn/X opportunity management |
| analytics.py | /api/analytics | Event tracking |
| reports.py | /api/reports | PDF generation + history |
| billing.py | /api/billing | Stripe subscriptions, portal, webhooks |
| team.py | /api/team | Invite, accept, remove team members |
| notifications.py | /api/notifications | In-app notifications (read/delete) |
| accounts.py | /api/accounts | Connected account management |
| settings.py | /api/settings | Scheduler pause, API key status |
| errors.py | /api/errors | Frontend error logging |
| support.py | /api/support | Support ticket handling |
| site_audit.py | /api/site-audit | Trigger audits; surface findings/recommendations/citations; generate llms.txt + robots.txt snippets |
| clusters.py | /api/clusters | Cluster lifecycle: list, detail, regenerate (full or per-piece), edit brief, pillar propose/accept/reject |
| wikipedia.py | /api/wikipedia | Wikipedia surface: candidate list, scan trigger, on-demand draft, status update |
| main.py | /api/health | Liveness check |

### Frontend Layout
```
frontend/
  app/              # Next.js App Router — all routes below
  components/       # Shared UI components
  contexts/         # AuthContext (user state, login/logout/refresh)
  lib/api.ts        # Typed Axios client with request deduplication
  proxy.ts          # Cookie-based auth routing (Next 16 middleware convention)
```

### Frontend Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing page (→ /dashboard if authenticated) |
| `/login` `/register` | Auth flows |
| `/onboarding` | First-time setup wizard |
| `/forgot-password` `/reset-password` | Password reset |
| `/verify-email` | 6-digit code email verification |
| `/team/accept` | Team invite acceptance |
| `/dashboard` | Home — all brands + stats |
| `/tracker` | Redirects to `/settings` (consolidated) |
| `/tracker/new` | Create brand wizard |
| `/tracker/[brandId]` | Redirects to `/settings` (consolidated) |
| `/tracker/[brandId]/profile` | Redirects to `/settings` Brand Profile tab |
| `/results/[brandId]` | Redirects to `/dashboard` (consolidated) |
| `/methodology` | How we measure AI visibility |
| `/content` | Content drafts dashboard |
| `/content/[brandId]` | Brand-specific drafts, opportunities, gaps |
| `/reports` | PDF report history |
| `/account` | User profile |
| `/settings` | App settings |
| `/settings/billing` | Subscription + payment |
| `/settings/accounts` | Connected social accounts |
| `/team` | Team member management |
| `/admin` | Admin-only superuser dashboard |
| `/terms` `/privacy` | Legal pages |

---

## Database Models

No Alembic. Migrations are embedded in `database.py:run_migrations()` and applied on every startup after `create_tables()`. **Add new migrations as new `ALTER TABLE` steps at the bottom — never modify existing steps.**

### Model Summary

| Model | Key Fields |
|-------|-----------|
| `User` | id, email, password_hash, google_id, name, subscription_tier/status/trial_end, stripe_customer_id, is_admin, is_paused, totp_secret/enabled, email_verified, email_verification_code/expires_at |
| `Brand` | id, name, slug (unique), user_id FK, tier (basic/standard/premium), website_url, brand_type (standard/pitch), pitch_expires_at, last_manual_draft_at |
| `Prompt` | id, brand_id FK, text, prompt_type (standard/pitch) |
| `TrackingRun` | id, brand_id FK, status (pending/running/completed/failed), run_type (manual/scheduled/prompt), schedule_slot (morning/evening), overall_score, total_queries, total_mentions, has_content_influence |
| `QueryResult` | id, tracking_run_id FK, prompt_id FK, model (chatgpt/claude/perplexity/gemini), run_number, response_text, mentioned (bool), sentiment, latency_ms, error |
| `RunModelScore` | id, tracking_run_id FK, model, total_queries, total_mentions, score |
| `Competitor` | id, brand_id FK, name, website_url |
| `CompetitorMention` | id, tracking_run_id FK, competitor_id FK, prompt_id FK, model, mentioned |
| `BrandProfile` | id, brand_id FK (unique), company_description, key_stats, tone_of_voice, what_not_to_say, target_audience, approved_language, publications, internal_brand_context, website_context_last_fetched |
| `ContentOpportunity` | id, brand_id FK, platform, thread_url, thread_title, subreddit, relevance_score, status (new/drafted/dismissed) |
| `ContentGap` | id, brand_id FK, prompt_id FK, tracking_run_id FK, model, severity_score, opportunity_score, gap_score, competitor_mentions (JSON), platforms_lacking (JSON), quora_questions (JSON) |
| `ContentDraft` | id, brand_id FK, prompt_id FK, opportunity_id FK, cluster_id FK (nullable), platform, status (draft/approved/posted/failed), title, content_text, content_brief (routing URL/subreddit), target_title (routed thread/question label), source (onboarding/manual/cluster), approved_at, posted_at, posted_url |
| `ContentCluster` | id, brand_id FK, prompt_id FK (unique), status (pending/briefing/generating/ready/partial_failed), pillar_mode (none/proposed/attached/rejected_tone), pillar_url, angle (auto/insider/neutral), last_brief_id FK, version, last_generated_at |
| `ContentBrief` | id, cluster_id FK, version, positioning, key_claims (JSON), canonical_phrasings (JSON), stats (JSON), competitor_context (JSON), narrative_spine, tone_notes, created_by |
| `WikipediaScan` | id, brand_id FK, status (running/completed/failed), triggered_by FK, prompts_searched, total_candidates_found, candidates_persisted, error_message, started_at, completed_at |
| `WikipediaCandidate` | id, brand_id FK, prompt_id FK (nullable), scan_id FK, article_title, article_url, pageid, article_summary, legitimacy_score, legitimacy_reasoning, status (new/drafted/submitted/accepted/reverted/dismissed), suggested_wikitext, suggested_section, suggested_insert_location, evidence_pack_used (JSON), last_drafted_at, last_status_change_at — UNIQUE(brand_id, article_title) |
| `ContentPost` | id, draft_id FK, platform, post_url, platform_post_id, posted_at |
| `ContentAttribution` | id, content_post_id FK, tracking_run_id FK, brand_id FK, visibility_before, visibility_after, improvement_pct |
| `DraftAttribution` | id, draft_id FK, brand_id FK, prompt_id FK, score_at_posting, current_score, delta, runs_since_posting |
| `TeamMember` | id, account_owner_id FK, invited_email, user_id FK (nullable), role, invite_token (unique), expires_at |
| `Notification` | id, user_id FK, type (report_ready/visibility_drop/draft_ready/info), title, body, link, read |
| `PasswordResetToken` | id, user_id FK, token (unique), expires_at, used |
| `AnalyticsEvent` | id, event_type (indexed), brand_id FK, user_id FK, data (JSON) |
| `SystemSetting` | key (PK), value |
| `AccountConnection` | id, platform (unique), status, credentials, display_name |
| `BrandContentSettings` | id, brand_id FK, platform, enabled, auto_post — UNIQUE(brand_id, platform) |
| `WebsiteAudit` | id, brand_id FK, status, triggered_by, started_at/completed_at, total_pages, overall_score, bot_access_score, content_score, schema_score, technical_score, render_mode, sitemap_url, robots_txt_raw, llms_txt_present/valid, error_message |
| `WebsiteAuditPage` | id, audit_id FK, url, depth, http_status, fetch_ms, page_type, word_count, title, h1_text, h2/h3_count, table/list_count, fact_density, links, image_alt_pct, has_jsonld, schema_types, is_js_rendered, per-page scores |
| `WebsiteAuditFinding` | id, audit_id FK, page_id FK (nullable for site-level), check_id, severity, category, message, evidence (JSON) |
| `WebsiteAuditRecommendation` | id, audit_id FK, page_id FK (nullable), priority, effort, category, title, body, linked_prompt_ids (JSON), expected_impact, llm_generated |
| `CitationSource` | id, brand_id FK, tracking_run_id/prompt_id/query_result_id FKs, model, url, domain (indexed), kind (own/competitor/third_party/unknown), competitor_id FK — UNIQUE(query_result_id, url) |

---

## Frontend UI Conventions & Known Traps

Recurring defect classes that have each shipped to production more than once. Check every frontend change against this list before calling it done.

1. **`position:fixed` dies inside transformed ancestors.** Most page/tab wrappers are framer-motion elements; a transform silently converts `fixed` to `absolute`, dumping modals/bars at the wrong scroll position. Any `fixed` overlay (modal, floating bar, drawer) MUST be portaled: `createPortal(..., document.body)`. Bitten twice: PieceCard read modal (Jul 4), settings save bar (Jul 5).
2. **Count platforms/entities, never draft rows.** After regeneration a platform carries both its posted piece and a fresh replacement draft, and prompt-keyed posted counts include legacy/Wikipedia drafts outside the cluster. Any "X of Y" must have numerator and denominator from the SAME source, deduped by platform (`new Set(pieces.map(p => p.platform))`). Bitten: "5 of 11 posts live" (Jul 5).
3. **Save/feedback must be visible from the field being edited.** On long forms, the submit button and dirty indicator at the page bottom read as "this field can't be edited". Use the floating unsaved-changes pill pattern (settings profile) for any form taller than a viewport.
4. **Every piece of content the user can see truncated must be openable.** No state (posted, failed, archived) may remove the only way to read the full text. Card bodies should open the same modal as the Read button.
5. **Tooltips never carry must-know information alone.** `title=` is invisible on touch and undiscoverable. The meaning of a number, unit ("pts" = percentage points), or destructive-action consequence needs visible text; tooltips only add detail.
6. **No `window.confirm` / `window.prompt` / `window.alert`.** Use `components/ui/dialog.tsx` (Radix) or a purpose-built dialog (e.g. `MarkPostedDialog`).
7. **Sample caps must not masquerade as totals.** If a stat is computed from a capped row load (`_MAX_QUERY_ROWS`) but labeled with a time window, either aggregate exactly in SQL or label the actual sample. Bitten: "100% positive · 3 mentions" from a 100-row cap posing as a 30-day window (Jul 5).
8. **Copy hygiene:** conditional plurals on every count (`{n !== 1 && 's'}`), one unit app-wide ("pts"), no internal jargon in UI copy ("cluster"/"brief"/"T1" → "tracked question"/"strategy"/"major press"), parse DB timestamps with `parseUTCISO` before formatting.

---

## Key Patterns

### Async-first
All DB calls use `async/await` with `AsyncSessionLocal`. Never use sync SQLAlchemy calls.

### Multi-tenancy
All queries filter by `user_id`. Tests verify ownership isolation — users must not see each other's brands/runs/drafts.

### Authentication
JWT issued with 7-day expiry, stored in httpOnly `clarity_token` cookie. Companion non-httpOnly `clarity_session=1` cookie for Next.js middleware detection. Cookie `secure` flag only set when `ENVIRONMENT=production`. The `AllowUnverifiedUser` dependency (in `dependencies.py`) allows unverified users through certain endpoints (e.g., `/auth/me`, `/verify-email`).

**Frontend middleware** (`proxy.ts`) reads the `clarity_session` cookie:
- Public paths: `/`, `/login`, `/register`, `/onboarding`, `/forgot-password`, `/reset-password`, `/team/accept`
- Authenticated users on `/login` or `/register` → redirect `/dashboard`
- Unauthenticated users on any other path → redirect `/login?from={path}`

### LLM Model Selection
All four models query the live web:
- **ChatGPT** (`gpt-4o-mini` + hosted `web_search` tool via Responses API, paid tiers only) — OpenAI hosted web search with `search_context_size="medium"`
- **Claude** (`claude-haiku-4-5-20251001` + `web_search_20250305` tool, Pro tier only) — Anthropic server-side web search
- **Perplexity** (`sonar` free, `sonar-pro` paid) — search-native model
- **Gemini** (`gemini-2.5-flash` with `google_search` grounding tool) — Google search grounding

Per-tier model lists are computed by `models_for_tier(brand_type, tier)` in `llm_service.py`.

Concurrency guards: Perplexity `Semaphore(2)`, Claude `Semaphore(1)` (serialized via `_RatePacer` at 2 RPM to stay under Anthropic's 50k input-tokens/min org cap), Gemini `Semaphore(2)`.

### Tier-Based Query Counts
All tiers use 3 runs per prompt per model (see `RUNS_PER_PROMPT` in `llm_service.py`).

### Tier-Based Model Lists
| Internal tier | UI name  | Models queried                                                |
|---------------|----------|---------------------------------------------------------------|
| `None`        | Free     | Perplexity, Gemini                                            |
| `basic`       | Starter  | ChatGPT search, Perplexity, Gemini                            |
| `starter`     | Growth   | ChatGPT search, Perplexity (sonar-pro), Gemini                |
| `pro`         | Pro      | ChatGPT search, Claude + web_search, Perplexity (sonar-pro), Gemini |

Pitch brands (`brand_type='pitch'`) always receive the Free list regardless of subscription.

### Visibility Score & Mention Detection
Score = `(queries with mention) / (total queries) × 100`. Mention detection: case-insensitive substring check (`brand_name.lower() in response.lower()`) **plus** fuzzy normalized check (lowercase + strip non-alphanumeric). `mentioned = exact OR fuzzy`. Queries with errors are excluded from the denominator.

### Tracking Run Flow (tracking_service.py)
1. Load brand + prompts; look up tier → runs_per_prompt
2. Insert `TrackingRun` with status=running
3. Build task matrix: prompt × model × run_number; execute concurrently (MAX_CONCURRENT=10 semaphore)
4. Bulk-insert `QueryResult` rows; calculate per-model scores; insert `RunModelScore` rows
5. Update `TrackingRun` → status=completed, overall_score
6. Non-fatal post-processing: sentiment classification, competitor mentions, content attribution, gap analysis, notification creation, report-ready email

### Rate Limiting
In-memory `_rate_store` with per-user/per-endpoint tracking. Resets between tests. Key limits: 5 register/min/IP, 10 login/min/IP, 3 resend-verification/min/IP.

### Graceful API Key Handling
Missing LLM API key → placeholder response returned; user prompted to configure in settings.

### Pitch Brands
Free-only temporary brands (brand_type=pitch). Auto-upgraded to standard when user subscribes. Expire 30 days after creation. Auto-cleaned at 06:00 UTC daily. Expiry warning emails sent beforehand. Limited to 1 manual draft regen per week.

### Tier Naming Convention
Internal database keys differ from UI display names. See `TIER_DISPLAY_NAMES` in `billing.py` for the canonical mapping.

| Internal key | Display name | Price |
|-------------|-------------|-------|
| `None` | Free | $0 |
| `"basic"` | Starter | $100/mo |
| `"starter"` | Growth | $300/mo |
| `"pro"` | Pro | $500/mo |

### Content Draft Caps
| Tier | Draft queue (unreviewed) | Scheduled queue (approved) |
|------|--------------------------|----------------------------|
| Free (pitch) | 5 | 10 |
| Starter (basic) | 10 | 25 |
| Growth (starter) | 20 | 50 |
| Pro | 20 | 100 |

Caps defined in `routers/content.py` (`TIER_SCHEDULED_CAPS`) and `services/drafting_service.py` (`TIER_DRAFT_CAPS`). Frontend reads caps dynamically from `GET /api/content/{brand_id}/draft-status` — no hardcoded values in UI.

### Content Drafting Flow
Drafts are generated on brand creation (onboarding) and manually via "Regenerate Drafts". No recurring auto-draft job. Opportunity scanning is fully manual/on-demand (triggered by user or during onboarding) and is separate from drafting. Draft platforms: owned_site, reddit, quora, medium, wikipedia, linkedin, x.

### Content Clusters (`services/clustering_service.py`)
Per-prompt coordinated content. Each tracked prompt can have one `ContentCluster` with a shared `ContentBrief` (positioning, canonical phrasings, stats, narrative spine, tone notes). Drafts inside a cluster are generated in parallel via `asyncio.gather` from the brief; cross-references are semantic — no hard URLs at generation time (exception: once an own-site pillar is attached, siblings get a deterministic post-generation link via `append_pillar_reference`, resolved-platform-keyed; Reddit is excluded — never gets outbound links). Cluster platforms are **owned_site (anchor, first), linkedin, medium, reddit, quora, x** — Wikipedia is excluded (own surface). The owned_site anchor is generated by the dedicated `drafting/owned_site.py` generator fed by the **cluster evidence pack** + brief (`_gen_owned_site_piece`); marking it posted with a `posted_url` auto-attaches it as the cluster pillar (`pillar_mode='attached'`). The legacy tone-gated `cluster_pillar.propose_pillar()` proposal flow survives inside the frontend `OwnedSiteCard` ("Use existing page" vs "Write a new page"). **Reddit thread routing:** `_resolve_post_targets` prefers a real `ContentOpportunity` thread (same prompt, `status='new'`, relevance ≥ 60) — the piece is then written as a `reddit_comment` (100-300w top-level reply) with the thread URL in `content_brief` and title in `target_title`; falls back to a standalone post in a validated subreddit. Opportunities are marked `drafted` only when generation succeeds. **Angle control:** `ContentCluster.angle` (`auto`/`insider`/`neutral`, `PATCH /api/clusters/{brand_id}/{cluster_id}`) resolves per piece via `drafting/angle.py:effective_angle` (auto → insider for LinkedIn/Medium/X, neutral for Quora and non-"allowed" subreddits; owned_site is always first-party) and injects a persona directive into `build_prompt`. Disclosure rules are conditional on endorsement (FTC-aligned): casual inline phrasing when a piece recommends the brand, none for neutral factual mentions; fake-customer voice is hard-banned. Citation rendering (`drafting/citations.py`): Medium/LinkedIn-article/Quora get footers, Reddit variants render linkless (prose attribution only), X strips markers. Evidence pack sources are **full-text enriched** at persist time (`cluster_evidence.enrich_pack_snippets`: fetches each http(s) source, first ~1800 chars of page text replaces shorter snippets; 512KB parse cap, 1.5s connect timeout, best-effort). The owned-site anchor supports a **deep** variant (`depth="deep"` on the per-piece regenerate body: 1800-3000 words, FAQ section → FAQPage JSON-LD, 8000-token cap) — per-request, not persisted. Single-piece regen has full parity with cluster regen (thread routing, subreddit-aware angle, opportunity consumption). The `/content/[brandId]` board also hosts the **Live threads panel** (`OpportunitiesPanel`): draft replies to / dismiss `ContentOpportunity` threads via the existing `/api/opportunities/*` endpoints. Model selection routes through `drafting/models.py:CROSS_REF_SUMMARY_MODEL` (brief + tone gate) and `writer_model_for_tier(tier)` (piece generation). API surface is `/api/clusters/*` (8 endpoints). Cluster regeneration is triggered by the `/content/[brandId]` tab.

### LLM Concurrency & Resilience
Per-model semaphores in `llm_service.py`: Perplexity=2, Claude=1 (paced to 2 RPM), Gemini=2. Overall tracking concurrency: `MAX_CONCURRENT=10` in `tracking_service.py`. Model fallbacks on overload (503): `sonar-pro` → `sonar`. Rate limit errors get 65s retry delay. Auth errors (invalid API key) are not retried. Timeouts: Claude draft generation 30s, sentiment classification 15s, Reddit scanner relevance 10s.

### Run Cancellation
`POST /api/tracking/run/{run_id}/cancel` force-cancels stuck runs. Cancellation propagates to in-flight LLM queries via `asyncio.Event`, interrupting retry backoff sleeps immediately. Cancel events cleaned up in `tracking.py:cleanup_cancel_event()`. Stale runs auto-failed after 15 minutes (dynamic threshold based on brand size).

### Security Hardening
- Swagger/OpenAPI disabled in production (`openapi_url=None`)
- IP-based rate limiting uses `X-Forwarded-For` header (Railway proxy)
- Input validation: name length limits, HTML tag rejection, strict email regex
- DB file permissions tightened to 600 in `start.sh`
- Auth rate limits: 5 register/min/IP, 10 login/min/IP, 3 resend-verification/min/IP
- Frontend: 30s Axios timeout, 401 interceptor auto-redirects to login

### Request Deduplication (frontend)
`lib/api.ts` Axios client deduplicates concurrent GET requests by URL — a second identical in-flight GET returns the same promise rather than making a second network call.

### Website AIO (`services/site_audit/`)
Site audit module — manual trigger only, no scheduled job. Crawler uses sitemap.xml-first discovery with BFS fallback, Playwright for render-mode detection on a 5-page sample, BeautifulSoup4 + lxml for parsing. Five parser modules (`semantic`, `schema`, `robots`, `llms_txt`, `meta`) each emit `Finding` records keyed by stable `check_id`. Citation extractor runs as a non-fatal post-processing hook in `tracking_service.py`, classifying URLs from `QueryResult.response_text` as own / competitor / third-party / unknown via `tldextract`. Page↔prompt linker matches own-domain audit pages to losing prompts via slug + title token Jaccard. Recommendations engine has a static `_RECS` template registry (rule-based) plus an LLM rewrite pass (Growth/Pro tiers only, gated by `TIER_AUDIT_LIMITS`). Generators produce spec-compliant `llms.txt` and a robots.txt AI-bot snippet (two modes: `allow_all` or `search_only`). Free tier (no subscription) is excluded; per-tier audit limits live in `services/site_audit/constants.py`.

### Wikipedia Surface (`services/wikipedia/`)
Dedicated `/wiki/[brandId]` surface for discovering existing Wikipedia articles where a brand could legitimately contribute. Manual scan via `POST /api/wikipedia/{brand_id}/scan` queries the Wikipedia REST API for each tracked prompt, pre-filters obvious non-starters (disambiguation, list pages, brand-self, competitors, thin summaries), then runs `services/wikipedia/legitimacy_gate.py:score_candidate()` (one haiku call per candidate) and persists survivors above the 0.55 threshold as `WikipediaCandidate` rows. On-demand drafting via `POST /api/wikipedia/{brand_id}/candidates/{id}/draft` reuses `build_wikipedia_prompt()` with new `locked_article_title` / `article_section_list` / `citation_needed_hints` kwargs to constrain the LLM to a verified article. Status lifecycle is user-recorded (`new` → `drafted` → `submitted` → `accepted` / `reverted`); we never edit Wikipedia ourselves. Growth + Pro tier only, with rolling-30-day caps (Growth: 4 scans + 30 drafts; Pro: unlimited). Caps live in `services/wikipedia/caps.py`.

---

## Scheduled Jobs (APScheduler, all UTC)

| Time | Frequency | Job |
|------|-----------|-----|
| 02:00 | Daily | SQLite backup |
| 04:00 | Monthly (1st) | Website context refresh via Jina |
| 06:00 | Daily | Pitch expiry warnings & cleanup |
| 08:00 | Weekly (Mon) | Visibility tracking sweep (standard/pro brands) |
| 21:00 | Daily | Visibility drop alerts (email if ≥15pp drop) |

Scheduler can be paused via `SystemSetting` key `"scheduler_paused"`.

---

## Frontend API Client (`lib/api.ts`)

All methods are typed. Key groups:

- **Brands:** `getBrands`, `getBrand`, `createBrand`, `updateBrand`, `deleteBrand`, `getBrandsWithStats`, `refreshWebsiteContext`
- **Prompts:** `addPrompt`, `deletePrompt`, `getSuggestedPrompts`, `getSuggestedPromptsPreview`
- **Tracking:** `triggerRun`, `triggerPromptRun`, `getRunStatus`, `getRecentRuns`, `cancelRun`
- **Analytics:** `getOverview`, `getTrends`, `getResponses`, `getDashboardAnalytics`
- **Competitors:** `getCompetitors`, `addCompetitor`, `removeCompetitor`, `getCompetitorAnalysis`
- **Content:** `getDrafts`, `generateDraft`, `updateDraft`, `postDraft`, `deleteDraft`, `generateNow`, `getDraftStatus`
- **Opportunities:** `getOpportunities`, `dismissOpportunity`, `draftOpportunity`, `triggerScan`
- **Gaps:** `getContentGaps`, `getGapSummary`, `refreshGaps`
- **Brand Profile:** `getBrandProfile`, `updateBrandProfile`, `aiFillProfile`
- **Auth:** `authRegister`, `authLogin`, `authLogout`, `authMe`, `authGoogle`, `authVerifyEmail`, `authResendVerification`, `forgotPassword`, `resetPassword`
- **Billing:** `getBillingStatus`, `createCheckoutSession`, `createCustomerPortalSession`, `getInvoices`, `cancelSubscription`
- **Team:** `getTeamMembers`, `inviteTeamMember`, `resendInvite`, `removeTeamMember`, `acceptTeamInvite`, `rejectTeamInvite`
- **Notifications:** `getNotifications`, `markNotificationAsRead`, `deleteNotification`
- **Reports:** `getReportsList`, `getReport`, `generateReport`
- **Settings:** `getApiKeyStatus`, `getSchedulerStatus`, `setSchedulerStatus`

---

## Claude Code Workflow Skills

The following skills are installed and must be used when applicable. Always check if a skill applies before starting any task.

| Skill | When to Use |
|-------|------------|
| `superpowers:brainstorming` | **Before any creative work** — new features, components, behavior changes. Explores intent and design before touching code. |
| `superpowers:writing-plans` | When given a spec or multi-step task. Run before touching code. Produces a structured implementation plan. |
| `superpowers:executing-plans` | When executing a written plan in a separate session. Adds review checkpoints. |
| `superpowers:subagent-driven-development` | When executing plans with independent parallel tasks in the current session. |
| `superpowers:dispatching-parallel-agents` | When 2+ independent tasks can be worked without shared state or sequential dependencies. |
| `superpowers:test-driven-development` | When implementing any feature or bugfix. Write tests before implementation code. |
| `superpowers:systematic-debugging` | When encountering any bug, test failure, or unexpected behavior. Before proposing fixes. |
| `superpowers:verification-before-completion` | Before claiming work is complete, fixed, or passing. Run verification commands; evidence before assertions. |
| `superpowers:requesting-code-review` | After completing tasks, implementing features, or before merging. |
| `superpowers:receiving-code-review` | When receiving code review feedback, especially if unclear or technically questionable. |
| `superpowers:finishing-a-development-branch` | When implementation is complete and tests pass — guides merge/PR/cleanup decisions. |
| `superpowers:using-git-worktrees` | Before feature work needing isolation from current workspace, or before executing plans. |
| `code-review:code-review` | To review a pull request. |
| `impeccable` | For frontend design — distinctive, production-grade interfaces with context gathering, anti-AI-slop rules, and detailed design references. Use `craft` for full flow, `teach` for project context setup. |
| `emil-design-eng` | For UI animation and interaction polish — Emil Kowalski's philosophy on easing, springs, gestures, component feel, and performance. |
| `simplify` | After writing code — review changed code for reuse, quality, and efficiency. |
| `update-config` | To configure Claude Code behaviors via `settings.json` (hooks for automated tasks). |
| `schedule` | To create/manage scheduled remote agents running on a cron schedule. |
| `loop` | To run a prompt or slash command on a recurring interval. |
| `claude-api` | When building with the Claude API or Anthropic SDK. |
| `keybindings-help` | To customize Claude Code keyboard shortcuts. |
| `superpowers:writing-skills` | When creating or editing skills. |

> **Rule:** If there is even a 1% chance a skill applies, invoke it before taking any action. Skills override default behavior. User instructions override skills.
