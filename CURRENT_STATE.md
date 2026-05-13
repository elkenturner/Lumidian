# Lumidian — Current State

> **This file is the shared brain across all Claude surfaces working on Lumidian.**
> Claude Code, Cowork, and Claude in Chrome should all (a) read this file at the start of every session and (b) update it before ending the session. Stable architecture lives in `CLAUDE.md`; this file holds volatile state only.

**Last updated:** 2026-05-12 by Claude Code (Content Clusters build session)

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

- **2026-05-12** — Shipped **Content Clusters** on `feat/content-quality-rebuild`. Each prompt → one cluster of 5 cross-affirming platform pieces from a persisted `ContentBrief`. Wikipedia carved out into its own tab (no more marketing-coded Wiki drafts). Optional own-site pillar gated by LLM tone check (default off — promotional pillars hurt AIO). Clean-slate migration: unposted drafts deleted, posted retained. Backend half drove TDD; frontend was inline-verified (no fe test suite). Task 15 deferred: replacing `_bg_generate_drafts` would entangle clusters with response analysis + Serper lookups for negligible gain — clusters live behind their own endpoints + UI.
- **2026-05-12** — Website AIO validated end-to-end against Rhythm (real crawl, real findings/recommendations). Citation backfill confirmed idempotent and effective. Surfaced Site Audit as a tab on the agency client detail page (was previously only reachable via direct URL) and replaced the auto-redirect on `/site-audit` index with a brand picker.
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

- **Website AIO smoke-test + UX polish (current branch `feat/agency-activity-log`):**
  - `frontend/app/site-audit/page.tsx`: replaced auto-redirect with a brand picker for multi-brand users (single-brand auto-redirect preserved).
  - `frontend/app/agency/clients/[id]/page.tsx`: 5th "Site Audit" tab embeds `SiteAuditView` inline (committed via the agency-tasks branch alongside `TaskList`).
  - `frontend/components/agency/ClientStrategyTab.tsx`: removed the stale "AIO website audit" mention from the placeholder copy now that audit has its own tab.
  - Verified end-to-end via Playwright: 5-tab `/site-audit/[brandId]` renders live data; new brand picker works; new agency Site Audit tab loads `SiteAuditView`.
- **Local DB seeded:** `python -m scripts.backfill_citations` populated **962 `citation_sources` rows** from 57 completed `tracking_runs`. First live audit (`website_audits.id=1`, Rhythm, brand_id=4) captured 50 pages, 146 findings, 110 recommendations.
- **Side observation (not addressed):** `POST /api/agency/clients` with an existing `brand_id` returns a different `brand_id` in the response — looks like the handler auto-creates/clones a new brand instead of linking the one passed. Worth a follow-up bug if intentional.

---

## How to update this file

1. **At session start:** read this file. Whatever is in "Current Task / WIP" is the focus unless Ken redirects.
2. **During work:** if you make a meaningful design decision, add a one-liner to "Recent Decisions". If a new uncertainty surfaces, add it to "Open Questions".
3. **At session end:** update "Current Task / WIP" with where things stand and what's next. Replace "Recently Changed" with the files/areas you touched. Bump the "Last updated" timestamp and note which surface (Claude Code / Cowork / Chrome) you were.
4. **Don't** put stable architecture, schema, or conventions here — those live in `CLAUDE.md`.
