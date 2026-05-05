# Lumidian — Current State

> **This file is the shared brain across all Claude surfaces working on Lumidian.**
> Claude Code, Cowork, and Claude in Chrome should all (a) read this file at the start of every session and (b) update it before ending the session. Stable architecture lives in `CLAUDE.md`; this file holds volatile state only.

**Last updated:** 2026-05-05 by Claude Code

---

## Current Task / WIP

**Agency portal MVP shipped.** Pivoting from self-serve SaaS toward agency model: Lumidian app stays running but is no longer the focus; new internal cockpit at `agency-frontend/` is where Ken + contractors run client retainers. Tracking offloaded to Peec (link per client), content production stays on Lumidian's existing pipeline.

- **Goal achieved this session:** Agency portal MVP — Today / Clients / Client detail (Overview / Brand & Prompts / Pipeline tabs). New `/api/agency/*` router. New Next.js app at `agency-frontend/` (port 3003 dev). 7 backend tests passing.
- **Branch:** chore/remove-target-audience (agency work committed here; consider merging once smoke-tested in browser)
- **Next concrete step:** Ken to run end-to-end browser smoke test: start backend (port 3001), apex frontend (3002), agency frontend (3003 with `NEXT_PUBLIC_API_URL=http://localhost:3001 NEXT_PUBLIC_APEX_LOGIN_URL=http://localhost:3002/login`), log in as `ken@lumidian.ai` (already seeded as agency staff), create a test client, walk through tabs.
- **Blockers / waiting on:** Browser verification before deciding deployment (new Railway service + DNS for `agency.lumidian.ai` + setting `COOKIE_DOMAIN=.lumidian.ai`).

---

## Recent Decisions

_Append-only log. Newest first. Each entry: date — decision — rationale (1 line)._

- **2026-05-05** — Pivot: Lumidian SaaS is no longer the focus (no real users yet); building an AI visibility agency. Differentiator is content creation (where Lumidian's pipeline beats competitors); tracking is outsourced to Peec via per-client dashboard URL. Internal admin portal built at `agency-frontend/` — separate Next.js app, same FastAPI backend. MVP scoped to Today / Clients / Client detail (Overview / Brand & Prompts / Pipeline). Studio, Notes, Reports, Settings deferred to V1.
- **2026-05-04** — Updated 2026 evidence shifts the channel mix: LinkedIn long-form, G2/Capterra/TrustRadius reviews, and YouTube optimization become Tier 1 deliverables. Reddit drops a notch (ChatGPT downweighted it Sept 2025). Wikipedia removed entirely. Per [5W Citation Index 2026](https://www.prnewswire.com/news-releases/5w-releases-ai-platform-citation-source-index-2026-the-50-websites-that-now-decide-what-brands-are-visible-inside-chatgpt-claude-perplexity-gemini-and-google-ai-overviews-302759804.html) and [DerivateX 2026](https://derivatex.agency/report/ai-visibility-b2b-saas-2026/).
- **2026-05-04** — Selected Path D over Path B as primary direction. Rationale: energy-adjusted best fit for solo tired founder. Reuses 100% of code, triples ARPU ($300 → $2,500), familiar buyer (B2B SaaS founders), service-shape resists Semrush/HubSpot bundling. Path B (compliance) parked as stage-2 expansion. See `docs/strategy-2026-05.md` and `docs/service-offering-v1.md`.
- **2026-05-04** — Pause feature development on generalist self-serve GEO. Rationale: 7–8 direct competitors in the same $79–$800/mo slot (Peec, Otterly, AthenaHQ, Goodie, Scrunch, Rankability, Writesonic, Surfer); Semrush/Ahrefs/HubSpot bundling threat; Peec at $4M ARR with 18-month head start. Self-serve mid-market GEO is the worst-EV path.

---

## Open Questions

_Things to figure out. Move to "Recent Decisions" once resolved with the resolution noted._

- **Path A vs B vs C?** — Awaiting validation outcome. If 3+ regulated-industry buyers say yes with budget, commit to Path B (compliance pivot). If not, fall back to Path A (niche-down + agency white-label).
- **Which vertical for Path A fallback?** — B2B SaaS, e-commerce, or agencies-as-customers. Defer until/unless Path B validation fails.
- **Agency white-label channel** — separate decision from main path; could complement either A or B. Probably worth piloting with 2–3 agency contacts in parallel with Path B validation.

---

## Recently Changed (last session)

- **Spec + plan:** `docs/superpowers/specs/2026-05-05-agency-portal-mvp-design.md`, `docs/superpowers/plans/2026-05-05-agency-portal-mvp.md`
- **Backend:** `app/models.py` (+ AgencyClient, AgencyStaff, ClientNote, plus 3 new fields on User/Brand/ContentDraft); `app/database.py` (+7 migration steps); `app/schemas.py` (+ agency schemas); `app/dependencies.py` (+ require_agency_staff); `app/routers/agency.py` (new — clients CRUD, today, draft assign); `app/main.py` (mount + CORS); `app/routers/auth.py` (COOKIE_DOMAIN env var support); `tests/test_agency.py` (7 tests passing); `seed_agency_staff.py` (CLI to flip is_agency_staff)
- **Frontend:** new `agency-frontend/` Next.js app (port 3003), 3 screens, sidebar, auth context, middleware (redirects to apex login)
- `ken@lumidian.ai` seeded as agency staff (owner) in local DB

---

## How to update this file

1. **At session start:** read this file. Whatever is in "Current Task / WIP" is the focus unless Ken redirects.
2. **During work:** if you make a meaningful design decision, add a one-liner to "Recent Decisions". If a new uncertainty surfaces, add it to "Open Questions".
3. **At session end:** update "Current Task / WIP" with where things stand and what's next. Replace "Recently Changed" with the files/areas you touched. Bump the "Last updated" timestamp and note which surface (Claude Code / Cowork / Chrome) you were.
4. **Don't** put stable architecture, schema, or conventions here — those live in `CLAUDE.md`.
