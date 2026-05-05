# Agency Portal MVP — Design

**Date:** 2026-05-05
**Status:** Approved (verbal). Build authorized in one go without checkpoint reviews.
**Domain:** `agency.lumidian.ai`

---

## Context

Ken is shifting Lumidian from a self-serve SaaS to an AI visibility agency. Lumidian's customer-facing app stays running but is no longer the focus. The agency uses **Peec** for visibility tracking (better than Lumidian's tracker) and **Lumidian's content creation pipeline** as the differentiator. Day-1 shape: solo + 1–2 contractors, 3–10 clients.

This portal is the internal cockpit for that agency. No client login, no marketing site, no billing logic.

## Architecture

- **New Next.js app** at `agency.lumidian.ai`. Lives at `agency-frontend/` next to existing `frontend/`.
- **Same FastAPI backend.** New router `app/routers/agency.py` mounted at `/api/agency/*`. Reuses existing services (`drafting_service`, `llm_service`, `brand_profile`).
- **Same Postgres/SQLite database.** New tables added via the existing `run_migrations()` flow.
- **Auth:** reuses existing `User` table + JWT cookie. New `User.is_agency_staff` boolean. Cookie domain set to `.lumidian.ai` so JWT works across subdomains.
- **CORS:** add `https://agency.lumidian.ai` (and a localhost dev origin) to `ALLOWED_ORIGINS`.

## Data Model

### New tables

**`AgencyClient`**
- `id` (PK)
- `name` (str)
- `slug` (str, unique)
- `status` (enum: onboarding, active, paused, churned)
- `retainer_amount_usd` (int, nullable)
- `retainer_started_at` (datetime, nullable)
- `peec_dashboard_url` (str, nullable)
- `primary_contact_name` (str, nullable)
- `primary_contact_email` (str, nullable)
- `created_at`, `updated_at`

**`AgencyStaff`**
- `id` (PK)
- `user_id` (FK → User, unique)
- `role` (enum: owner, contractor)
- `active` (bool, default True)
- `created_at`

**`ClientNote`**
- `id` (PK)
- `agency_client_id` (FK → AgencyClient)
- `author_user_id` (FK → User)
- `body` (text)
- `created_at`

### Existing models, extended

- **`User.is_agency_staff`** — bool, default False. Set True for staff users.
- **`Brand.agency_client_id`** — FK → AgencyClient, nullable. NULL = legacy SaaS brand.
- **`ContentDraft.assigned_to_user_id`** — FK → User, nullable.

### Reused as-is
`Brand`, `BrandProfile`, `Prompt`, `ContentDraft`, `ContentPost`, `ContentOpportunity`, `ContentGap`. All accessed through their existing service modules; the agency router calls into those services with the agency client's brand id.

## Screens (MVP)

1. **Today** — landing page. Three columns: Drafts to review (across all clients), Scheduled this week, Recent activity. Skeleton wiring with real "drafts to review" count; the other two columns can ship as placeholder cards in MVP.
2. **Clients** — table list (name, status, retainer, drafts in queue, link to Peec). Click into one. Add Client button.
3. **Client detail** — tabs:
   - *Overview* — retainer, contacts, Peec link, status
   - *Brand & Prompts* — wraps existing BrandProfile + Prompt CRUD for that client's brand
   - *Pipeline* — Kanban (Draft → Approved → Posted), filterable by platform, draft assignment dropdown

Studio screen, Notes tab, ClientReport, and Settings page are V1, not MVP.

## Auth Flow

- Add `is_agency_staff` column to `User`.
- Existing login flow works; agency frontend calls `GET /api/auth/me`, blocks render if `is_agency_staff !== true`.
- Agency frontend middleware redirects unauthenticated requests to `https://lumidian.ai/login`.
- Staff users created manually (seed script or admin endpoint). No invite flow in MVP.

## Cookie / CORS Changes

- Update `set_auth_cookie` in `auth.py` to set `domain=".lumidian.ai"` in production. Localhost behavior unchanged.
- Add `https://agency.lumidian.ai` to `ALLOWED_ORIGINS`.
- Add `http://localhost:3003` (or chosen port) for agency-frontend local dev.

## Backend Endpoints (new, all under `/api/agency`)

- `GET  /clients` — list (with draft counts, statuses)
- `POST /clients` — create
- `GET  /clients/{id}` — detail
- `PATCH /clients/{id}` — update
- `DELETE /clients/{id}` — soft delete (set status=churned)
- `POST /clients/{id}/brand` — create or attach a Brand to this client (returns brand_id)
- `GET  /today` — dashboard aggregation (drafts pending review, etc.)
- `PATCH /drafts/{draft_id}/assign` — set `assigned_to_user_id`

For brand profile, prompts, drafts, the agency frontend calls existing `/api/brands`, `/api/brand_profile`, `/api/content` endpoints with the brand id resolved from the agency client. No duplication.

## Out of Scope (MVP)

- Studio bulk-generate UI (V1)
- Notes tab and `ClientNote` writes (V1)
- ClientReport / monthly Peec snapshot / PDF export (V1)
- Staff settings UI (V1 — for MVP, manage staff via DB)
- Opportunity & Gap surfaces in agency UI (V2 — backend already runs them)
- Peec API sync (V2)
- Email digests (V2)
- Railway service deployment (Ken does this; plan documents the steps)
- DNS for `agency.lumidian.ai` (Ken does this)

## Build Sequence

1. Backend: schema migrations + `is_agency_staff` flag + agency router skeleton
2. Backend: agency endpoints (clients CRUD, today, draft-assign)
3. Auth: cookie domain update + CORS additions
4. Seed script: create one staff user + flip `is_agency_staff` on existing admin user
5. Agency frontend: scaffold Next.js app, copy Tailwind/Radix config, set up auth context + middleware
6. Agency frontend: API client (typed)
7. Agency frontend: Today, Clients, Client detail (Overview / Brand & Prompts / Pipeline tabs)
8. Local end-to-end smoke test on dev ports

## Risks / Notes

- **Cookie domain change** affects existing Lumidian users — current cookies are scoped to the apex/lumidian-frontend domain. Setting `.lumidian.ai` is safe (broader scope), but existing sessions will need to be reissued. Acceptable since user base is minimal.
- **Reusing `Brand` model** — when the agency UI creates a "client", we also create a `Brand` row owned by the agency-staff user with `agency_client_id` set. Existing `Brand.user_id` semantics are preserved.
- **Schema migrations** are append-only in `database.py:run_migrations()` per project convention. MVP adds 4 new columns + 3 new tables in one new migration block.
