# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
| `STRIPE_STARTER_PRICE_ID` / `STRIPE_PRO_PRICE_ID` | Subscription tiers |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | SMTP email |
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
- **Frontend:** Next.js 15, React 18, TypeScript (strict), Tailwind CSS, Radix UI, Recharts, Axios, date-fns, lucide-react
- **LLM providers:** OpenAI (gpt-4.1-mini), Anthropic (claude-haiku-4-5-20251001), Google GenAI (gemini-2.5-flash default, gemini-2.5-pro for paid subscribers), Perplexity (sonar default, sonar-pro for paid subscribers)

### Backend Layout
```
backend/app/
  main.py           # FastAPI app, lifespan context, CORS, router mounts
  database.py       # Async SQLAlchemy engine; create_tables() + run_migrations() on startup
  models.py         # 20+ ORM models
  schemas.py        # Pydantic request/response validators
  scheduler.py      # APScheduler jobs
  auth.py           # JWT helpers, get_current_user, AllowUnverifiedUser dependency
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
| opportunities.py | /api/opportunities | Reddit/Quora opportunity management |
| analytics.py | /api/analytics | Event tracking |
| reports.py | /api/reports | PDF generation + history |
| billing.py | /api/billing | Stripe subscriptions, portal, webhooks |
| team.py | /api/team | Invite, accept, remove team members |
| notifications.py | /api/notifications | In-app notifications (read/delete) |
| accounts.py | /api/accounts | Connected account management |
| settings.py | /api/settings | Scheduler pause, API key status |
| errors.py | /api/errors | Frontend error logging |
| support.py | /api/support | Support ticket handling |
| main.py | /api/health | Liveness check |

### Frontend Layout
```
frontend/
  app/              # Next.js App Router — all routes below
  components/       # Shared UI components
  contexts/         # AuthContext (user state, login/logout/refresh)
  lib/api.ts        # Typed Axios client with request deduplication
  middleware.ts     # Cookie-based auth routing
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
| `ContentDraft` | id, brand_id FK, prompt_id FK, opportunity_id FK, platform, status (draft/approved/posted/failed), title, content_text, source (onboarding/manual), approved_at, posted_at |
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

---

## Key Patterns

### Async-first
All DB calls use `async/await` with `AsyncSessionLocal`. Never use sync SQLAlchemy calls.

### Multi-tenancy
All queries filter by `user_id`. Tests verify ownership isolation — users must not see each other's brands/runs/drafts.

### Authentication
JWT issued with 7-day expiry, stored in httpOnly `clarity_token` cookie. Companion non-httpOnly `clarity_session=1` cookie for Next.js middleware detection. Cookie `secure` flag only set when `ENVIRONMENT=production`. The `AllowUnverifiedUser` dependency (in `auth.py`) allows unverified users through certain endpoints (e.g., `/auth/me`, `/verify-email`).

**Frontend middleware** (`middleware.ts`) reads the `clarity_session` cookie:
- Public paths: `/`, `/login`, `/register`, `/onboarding`, `/forgot-password`, `/reset-password`, `/team/accept`
- Authenticated users on `/login` or `/register` → redirect `/dashboard`
- Unauthenticated users on any other path → redirect `/login?from={path}`

### LLM Model Categories
- **LIVE_MODELS** (Perplexity, Gemini) — query the live web; changes reflected within days
- **INDEX_MODELS** (ChatGPT, Claude) — static training data; changes slowly
- Perplexity: limited to 2 concurrent requests via `asyncio.Semaphore(2)` to avoid 429s

### Tier-Based Query Counts
| Tier | Runs per prompt per model |
|------|--------------------------|
| basic | 5 |
| standard | 5 |
| premium | 5 |

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

### Content Draft Caps
| Tier | Draft queue (unreviewed) | Scheduled queue (approved) |
|------|--------------------------|----------------------------|
| Free (pitch) | 5 | 10 |
| Starter | 20 | 50 |
| Pro | 20 | 100 |

Caps defined in `routers/content.py` (`TIER_SCHEDULED_CAPS`) and `services/drafting_service.py` (`TIER_DRAFT_CAPS`). Frontend reads caps dynamically from `GET /api/content/{brand_id}/draft-status` — no hardcoded values in UI.

### Content Drafting Flow
Drafts are generated on brand creation (onboarding) and manually via "Regenerate Drafts". No recurring auto-draft job. Opportunity scanners (Reddit, Quora, LinkedIn, X) run weekly on Monday and are separate from drafting. Draft platforms: reddit, quora, medium, wikipedia, linkedin, x.

### LLM Concurrency & Resilience
Per-model semaphores in `llm_service.py`: Perplexity=2, Claude=3, Gemini=2. Overall tracking concurrency: `MAX_CONCURRENT=10` in `tracking_service.py`. Model fallbacks on overload (503): `gemini-2.5-pro` → `gemini-2.5-flash`, `sonar-pro` → `sonar`. Rate limit errors get 65s retry delay. Auth errors (invalid API key) are not retried. Timeouts: Claude draft generation 30s, sentiment classification 15s, Reddit scanner relevance 10s.

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

---

## Scheduled Jobs (APScheduler, all UTC)

| Time | Frequency | Job |
|------|-----------|-----|
| 02:00 | Daily | SQLite backup |
| 03:15 | Weekly (Mon) | Reddit opportunity scanner |
| 03:30 | Weekly (Mon) | Quora opportunity scanner |
| 03:40 | Weekly (Mon) | LinkedIn opportunity scanner (Pro only) |
| 03:50 | Weekly (Mon) | X opportunity scanner (Pro only) |
| 04:00 | Monthly (1st) | Website context refresh via Jina |
| 06:00 | Daily | Pitch expiry warnings & cleanup |
| 08:00 | Daily | Morning visibility tracking sweep |
| 21:00 | Daily | Visibility drop alerts (email if ≥10pp drop) |

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
