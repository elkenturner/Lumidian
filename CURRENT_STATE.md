# Lumidian — Current State

> **This file is the shared brain across all Claude surfaces working on Lumidian.**
> Claude Code, Cowork, and Claude in Chrome should all (a) read this file at the start of every session and (b) update it before ending the session. Stable architecture lives in `CLAUDE.md`; this file holds volatile state only.

**Last updated:** 2026-05-11 by Claude Code (Website AIO build session)

---

## Current Task / WIP

**Direction committed: Lumidian runs as agency + SaaS — both, layered on one codebase.** Not a pivot away from SaaS; both offerings coexist.

1. **Lumidian SaaS** — the self-serve product (Starter / Growth / Pro tiers) stays available for whoever wants it. Existing app at `frontend/`, backend at `backend/`.
2. **Lumidian Agency** — Ken + 1–2 contractors deliver client retainers using the **same app** as the internal cockpit. Agency-staff users (`User.is_agency_staff=True`) get access to `/agency/*` routes inside the main frontend. Tracking offloaded to Peec per client; Lumidian's content pipeline is the differentiator.

One FastAPI backend, one Next.js frontend. The `/agency/*` routes are staff-only; everything else is the customer-facing SaaS. SaaS customers and agency clients share the same DB — agency clients are scoped via `AgencyClient → Brand` link.

- **Most recent work:** **Website AIO module shipped on branch `feat/website-aio`** (worktree at `/tmp/lumidian-website-aio-wt`). Backend: `services/site_audit/*` package with crawler (httpx + sitemap + BFS), Playwright render-mode detection, 5 parsers (semantic / schema / robots / llms_txt / meta), scoring, citation extraction with backfill script, page↔prompt linking, rule-based + LLM-rewrite recommendations, llms.txt / robots.txt generators. 5 new tables; 13 API endpoints under `/api/site-audit/*`. Frontend: `/site-audit/[brandId]` with 5 tabs (Overview / Pages / AI Bots & Files / Citations / Recommendations) + agency portal view at `/agency/clients/[id]/audit`. Manual trigger only; Free tier excluded. 95+ tests passing. Specs: `docs/superpowers/specs/2026-05-11-website-aio-design.md`. Plan: `docs/superpowers/plans/2026-05-11-website-aio.md`.
- **Branch:** `feat/website-aio` (built in worktree, branched off `feat/agency-portal-shell`)
- **Next concrete step:** Merge `feat/website-aio` to `main`. Then run `python -m scripts.backfill_citations` once to populate citation data from existing TrackingRun history.
- **Blockers / waiting on:** None known.

---

## Recent Decisions

_Append-only log. Newest first. Each entry: date — decision — rationale (1 line)._

- **2026-05-11** — Shipped **Website AIO** module on branch `feat/website-aio`. Manual-trigger site audits with: crawler (sitemap + BFS + Playwright render-mode detection), 5 parsers, page scoring, citation extraction from existing AI responses, page↔prompt linking (the wedge — no competitor connects audit findings to specific losing prompts), rule-based recommendations + LLM rewrites (Growth/Pro), llms.txt + robots.txt generators. 5 new tables, 13 endpoints, 5-tab frontend + agency portal view. Specs and plan committed; 95+ tests green.
- **2026-05-11** — Direction committed: dual-track agency + SaaS on one codebase. Lumidian SaaS stays available to anyone who wants it; the same app doubles as the internal tool for Ken + contractors delivering agency work. Closed-loop roadmap features (auto-posting, G2 wizard, scheduler) serve BOTH self-serve users and agency operators. The "Managed tier" from the earlier Path D′ framing collapses into the agency offering — done-for-you clients become agency clients, not a SaaS tier.
- **2026-05-05** — Agency portal MVP shipped. Differentiator is content creation (Lumidian's pipeline beats competitors); tracking is outsourced to Peec via per-client dashboard URL. Implemented as `/agency/*` routes inside the existing Next.js frontend (NOT a separate `agency-frontend/` app as initially scoped). Same FastAPI backend with `/api/agency/*` router. MVP scope: Today / Clients / Client detail (Overview / Brand & Prompts / Pipeline). Studio, Notes, Reports deferred to V1.
- **2026-05-04** — Updated 2026 evidence shifts the channel mix: LinkedIn long-form, G2/Capterra/TrustRadius reviews, and YouTube optimization become Tier 1 deliverables. Reddit drops a notch (ChatGPT downweighted it Sept 2025). Wikipedia removed entirely. Per [5W Citation Index 2026](https://www.prnewswire.com/news-releases/5w-releases-ai-platform-citation-source-index-2026-the-50-websites-that-now-decide-what-brands-are-visible-inside-chatgpt-claude-perplexity-gemini-and-google-ai-overviews-302759804.html) and [DerivateX 2026](https://derivatex.agency/report/ai-visibility-b2b-saas-2026/).
- **2026-05-04** — Selected Path D over Path B as primary direction. Rationale: energy-adjusted best fit for solo tired founder. Reuses 100% of code, triples ARPU ($300 → $2,500), familiar buyer (B2B SaaS founders), service-shape resists Semrush/HubSpot bundling. Path B (compliance) parked as stage-2 expansion. See `docs/strategy-2026-05.md` and `docs/service-offering-v1.md`.
- **2026-05-04** — Pause feature development on generalist self-serve GEO. Rationale: 7–8 direct competitors in the same $79–$800/mo slot (Peec, Otterly, AthenaHQ, Goodie, Scrunch, Rankability, Writesonic, Surfer); Semrush/Ahrefs/HubSpot bundling threat; Peec at $4M ARR with 18-month head start. Self-serve mid-market GEO is the worst-EV path.

---

## Open Questions

_Things to figure out. Move to "Recent Decisions" once resolved with the resolution noted._

- **Which track gets attention first?** — Agency client acquisition vs continuing SaaS roadmap (`docs/build-plan-2026-q2.md`). Both can run, but solo founder bandwidth forces an ordering. Likely answer: pursue whichever shows faster signal — agency for revenue speed, SaaS for product compounding.
- **Agency pricing model** — retainer tiers (≈$2,500–$5K/mo) not yet validated with paying clients.
- **First agency clients** — pipeline of prospects, ICP, and outreach motion not yet defined.

---

## Recently Changed (last session)

- **Website AIO module (branch `feat/website-aio`, worktree `/tmp/lumidian-website-aio-wt`):**
  - Backend: `app/services/site_audit/` (new package — constants, fetcher, crawler, page_classifier, parsers/{semantic,schema,robots,llms_txt,meta}, scoring, citations, page_prompt_link, recommendations, generators, auditor); `app/routers/site_audit.py` (new — 13 endpoints); `app/models.py` (+5 ORM models); `app/database.py` (+migration step); `app/schemas.py` (+7 Pydantic response schemas); `app/services/tracking_service.py` (+citation extraction hook in post-run pipeline); `scripts/backfill_citations.py` (new, one-shot backfill).
  - Frontend: `app/site-audit/page.tsx` + `app/site-audit/[brandId]/page.tsx` (new); `app/agency/clients/[id]/audit/page.tsx` (new); `components/site-audit/*` (10 components: SiteAuditView, AuditTriggerButton, PageList, PageDetail, BotAccessPanel, LlmsTxtPanel, GeneratorsCard, CitationDomainList, RecommendationsList); `lib/api.ts` (+ siteAudit group + 6 type exports); `components/Sidebar.tsx` (+Site Audit nav item, tier-gated).
  - Tests: 95+ new tests across 13 test files; full site_audit suite green.
  - Docs: `docs/superpowers/specs/2026-05-11-website-aio-design.md` (design); `docs/superpowers/plans/2026-05-11-website-aio.md` (37-task implementation plan).

---

## How to update this file

1. **At session start:** read this file. Whatever is in "Current Task / WIP" is the focus unless Ken redirects.
2. **During work:** if you make a meaningful design decision, add a one-liner to "Recent Decisions". If a new uncertainty surfaces, add it to "Open Questions".
3. **At session end:** update "Current Task / WIP" with where things stand and what's next. Replace "Recently Changed" with the files/areas you touched. Bump the "Last updated" timestamp and note which surface (Claude Code / Cowork / Chrome) you were.
4. **Don't** put stable architecture, schema, or conventions here — those live in `CLAUDE.md`.
