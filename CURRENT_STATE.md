# Lumidian — Current State

> **This file is the shared brain across all Claude surfaces working on Lumidian.**
> Claude Code, Cowork, and Claude in Chrome should all (a) read this file at the start of every session and (b) update it before ending the session. Stable architecture lives in `CLAUDE.md`; this file holds volatile state only.

**Last updated:** 2026-05-12 by Claude Code (Content Clusters merged to main)

---

## Current Task / WIP

**Direction committed: Lumidian runs as agency + SaaS — both, layered on one codebase.** Not a pivot away from SaaS; both offerings coexist.

1. **Lumidian SaaS** — the self-serve product (Starter / Growth / Pro tiers) stays available for whoever wants it. Existing app at `frontend/`, backend at `backend/`.
2. **Lumidian Agency** — Ken + 1–2 contractors deliver client retainers using the **same app** as the internal cockpit. Agency-staff users (`User.is_agency_staff=True`) get access to `/agency/*` routes inside the main frontend. Tracking offloaded to Peec per client; Lumidian's content pipeline is the differentiator.

One FastAPI backend, one Next.js frontend. The `/agency/*` routes are staff-only; everything else is the customer-facing SaaS. SaaS customers and agency clients share the same DB — agency clients are scoped via `AgencyClient → Brand` link.

- **Most recent work:** **Content Clusters shipped on `feat/content-quality-rebuild`.** Replaces per-prompt one-off drafts with coordinated 5-piece cross-affirming clusters (linkedin, medium, reddit, quora, x) generated from a shared `ContentBrief`. Wikipedia carved into its own placeholder tab. Optional own-site **pillar** with LLM tone gate (default off — promotional pillars hurt AIO). Clean-slate migration deletes unposted drafts; posted drafts retained with `cluster_id` null. 2 new tables + 1 column on `ContentDraft`; 8 new endpoints under `/api/clusters/*`; new tabbed `/content/[brandId]` UX + dedicated cluster detail page at `/content/[brandId]/cluster/[clusterId]`. **24/24 cluster tests pass.** Specs: `docs/superpowers/specs/2026-05-11-content-clusters-design.md`. Plan: `docs/superpowers/plans/2026-05-12-content-clusters.md`. **Task 15 (hook generate_now into cluster pipeline) deferred** — the existing `auto_draft_top_gaps` flow is too entangled (response analysis + gap scoring + Serper lookups) to safely replace inline; clusters work standalone via the dedicated endpoints and the new `/content/[brandId]` UI.
- **Branch:** `feat/content-quality-rebuild`
- **Next concrete step:** Merge to main when ready; communicate the clean-slate draft wipe to existing users; monitor first wave of cluster regenerations for brief quality. Optionally tackle deferred Task 15 (route `_bg_generate_drafts` through cluster pipeline) as a follow-up.
- **Blockers / waiting on:** None known.

---

## Recent Decisions

_Append-only log. Newest first. Each entry: date — decision — rationale (1 line)._

- **2026-05-12** — Merged **Content Clusters** to `main` (deploys live via Railway). Replaces per-prompt one-off drafts with coordinated 5-piece cross-affirming clusters (linkedin, medium, reddit, quora, x) from a persisted `ContentBrief`. Wikipedia carved out into its own placeholder tab. Optional own-site pillar gated by LLM tone check (default off — promotional pillars hurt AIO). Clean-slate migration: unposted drafts deleted on first deploy, posted retained with `cluster_id` null. 24 dedicated cluster tests; 882-test full backend suite green. New tabbed `/content/[brandId]` surface + cluster detail route. Task 15 (route `_bg_generate_drafts` through cluster pipeline) deferred — clusters live behind dedicated endpoints; replacing the legacy flow would entangle with response analysis + Serper lookups for negligible gain.
- **2026-05-12** — **Site Audit Fix-Factory redesign shipped** on `feat/site-audit-fix-factory` (merged to main). Backend: 18 artifact generators (5 rule-based + 13 LLM-backed via Claude Haiku 4.5), 4 new audit check categories (E-E-A-T, internal linking, Q&A format, agents.md + stats density), priority-score ranking, 8 new ORM cols on `website_audit_recommendations`, `POST /recommendation/{id}/draft` + `PATCH /status` endpoints with tier gating. Frontend: 21-component redesign matching Lumidian's design system — FixCard 3-state centerpiece (collapsed → drafting → drafted with copy/regen/apply), letter-grade ScoreStrip, SchemaMatrix heatmap, BotGrid with family colors, CitationStackedBar, full motion polish via existing `lib/motion.ts` (Emil-style easings, framer-motion `layout` springs). Backfill script enriched all 110 existing Rhythm recs. Verified visually: Organization JSON-LD generates paste-ready artifact with brand data pulled from BrandProfile.
- **2026-05-12** — Website AIO smoke-tested + two UX polish commits (brand picker on /site-audit index, Site Audit tab on agency client detail) shipped to main earlier this session.
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

- **Site Audit Fix-Factory redesign (branch `feat/site-audit-fix-factory`, merged to main):**
  - Backend: `app/services/site_audit/artifact_generator.py` (dispatcher); `generators_artifact_rule.py` (5 rule-based); `generators_artifact_llm.py` (13 LLM types); `parsers/{eeat,qa,linking,agents_md}.py` (4 new check categories); `recommendations.py` (+priority_score, +_RECS_META with 43 entries covering all existing + new check_ids); `auditor.py` (wires new parsers, persists new fields); `routers/site_audit.py` (POST /draft, PATCH /status, tier gates, monthly LLM cap); `models.py` (+8 cols on WebsiteAuditRecommendation); `database.py` (+8 ALTER TABLE migrations); `schemas.py` (+3 schemas, +8 fields on output); `scripts/backfill_rec_metadata.py` (idempotent enrichment of existing recs).
  - Frontend: 21 new components under `components/site-audit/` matching app design tokens. FixCard (3-state, framer-motion layout springs, Emil-style easings), ScoreCard/ScoreStrip with letter grades (A-F), AuditHeader, OverviewHero, HistorySparkline (recharts), RenderModeBanner (pulse-on-mount), FixFilters/FixGrid, PageTable (re-skinned), PageDetail (re-skinned), SchemaMatrix (heatmap), BotGrid (10 bots, family colors), FilesStatusRow, CitationStackedBar, CitationTopDomains, AuditHistoryList, CitationsTab, SiteAuditView (orchestrator), AuditTriggerButton (restyled), RegenPopover, FixCardCodeBlock, FixCardImplSteps. `lib/grade.ts` for score→letter mapping. `lib/api.ts` +8 fields on WebsiteAuditRecommendationOut, +draftRec/setRecStatus methods.
  - Deleted: BotAccessPanel, LlmsTxtPanel, GeneratorsCard, CitationDomainList, RecommendationsList, PageList — replaced by the above.
  - Tests: 50+ new tests across artifact generators, parsers (eeat/qa/linking), priority_score, migration, status/draft endpoints. Full site_audit suite green.
  - Verification: end-to-end Playwright run on Rhythm audit — Overview hero shows ranked top-5 fixes with paste-ready JSON-LD on click; Schema & Bots heatmap renders gap analysis; Pages tab worst-first sorted with type icons + grade badges; 0 console errors.
- **Side observation from earlier (not addressed):** `POST /api/agency/clients` with an existing `brand_id` returns a different `brand_id` in the response — looks like the handler auto-creates/clones a new brand instead of linking the one passed. Worth a follow-up bug if intentional.

---

## How to update this file

1. **At session start:** read this file. Whatever is in "Current Task / WIP" is the focus unless Ken redirects.
2. **During work:** if you make a meaningful design decision, add a one-liner to "Recent Decisions". If a new uncertainty surfaces, add it to "Open Questions".
3. **At session end:** update "Current Task / WIP" with where things stand and what's next. Replace "Recently Changed" with the files/areas you touched. Bump the "Last updated" timestamp and note which surface (Claude Code / Cowork / Chrome) you were.
4. **Don't** put stable architecture, schema, or conventions here — those live in `CLAUDE.md`.
