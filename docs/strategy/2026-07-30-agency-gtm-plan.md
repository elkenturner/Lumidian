# Lumidian Agency Go-To-Market Plan

**Date:** 2026-07-30
**Status:** Draft for Ken's review
**Decision context:** Ken has chosen to pursue the agency route as the primary revenue motion ("I wanna sell this stuff"). This resolves the long-standing open question in `CURRENT_STATE.md` ("Which track gets attention first?"). The SaaS stays alive as a self-serve surface (Pro-only flattening already spec'd), but active selling effort goes to agency retainers. This document contains (1) a business-readiness audit and (2) the sales plan.

---

## Part 1 — Business-readiness audit (as of 2026-07-30)

### 1.1 What you actually have (assets)

**Product surface — genuinely strong for an agency cockpit:**
- Multi-model AI visibility tracking (ChatGPT + web search, Claude + web search, Perplexity sonar-pro, Gemini grounding), 3 runs/prompt/model, RVI competitive metric, citation extraction, sentiment.
- Content engine rebuilt on research-grounded strategy (Layer A/B): owned-site anchor + cluster model, evidence packs with full-text enrichment, anti-AI gate, voice directives, FTC-aligned disclosure logic, Reddit thread routing. This is the differentiator — no competitor connects tracking → content production this tightly.
- Site AIO audit module with paste-ready fix artifacts (llms.txt, robots.txt, JSON-LD), page↔prompt linking.
- Wikipedia surface (candidate discovery + legitimacy gate + constrained drafting).
- **Agency cockpit** (`/agency/*`): client playbook (milestones: kickoff → SOW → audit → strategy), 7 Typst-typeset PDF document kinds (SOW, kickoff, initial audit, weekly report, monthly report, wikipedia plan, site plan), weekly auto-report sweep, per-client staff assignment.
- **Prospect audit** — the sales wedge — committed on main: staff pick prompts, editorial research-report PDF designed specifically for cold email (credibility-guarded, RVI reframed, positions both software and done-for-you).
- Read-only token-gated client portal (built, on branch — see blockers).

**Proof / traction:**
- 1 paying client: Manhattan Street Capital ($300/mo, managed via Afzal Iqbal of "try agi"). SEC-adjacent content, drafts reviewed by Ken before posting. This is agency-shaped delivery already happening — just underpriced by ~10x.
- RoxStart: comped Pro demo account (logistics/freight vertical), full remediation done — 25 clusters, 125 drafts, 22 trusted sources, competitor SOV narrative built for their demo.
- Methodology page with peer-reviewed citations — a real credibility asset for sales calls.

### 1.2 What's working commercially

- **MRR: ~$300** (MSC only, after the July brand purge). That's the honest number. Everything else is product.
- The MSC relationship proves the delivery loop: track → report → content → client review → post. It also surfaced the exact confusions prospects will have (mention vs. citation).

### 1.3 What blocks selling (ranked by revenue impact)

**P0 — blocks the sales motion itself:**
1. **Site-audit crawler bug: MSC audits only ever crawl 1 page** (score 45.6 both runs, untriaged). The initial audit is a core deliverable and part of the pitch; a 1-page crawl produces garbage. Must fix before running audits for prospects.
2. **Prospect-audit end-to-end verification.** The staff-picked-prompts flow shipped but its pytest run was blocked at build time (Python 3.14 sandbox). Run the suite + one real end-to-end audit against a real prospect before sending any PDF to a stranger.
3. **Repo/deploy hygiene:** `feat/cluster-detail-overhaul` is ahead-4 unpushed with ~74 uncommitted working-tree files across parallel sessions. Anything demo-critical that only exists locally is at risk. Triage → commit → merge → deploy, then treat main-on-prod as the only reality.

**P1 — blocks delivering credibly to paying clients:**
4. **Pro-only tiering flattening: spec'd, not implemented.** MSC is promised full Pro (Claude tracking, Opus writer, unlimited wiki scans) at $300. Until implemented, the tier system keeps silently degrading the one paying client (the exact breakage that triggered the spec).
5. **"Cited as source" dashboard metric — promised to Afzal in email, not built.** A paying client was told this is coming. Small scope (citation_sources data already exists), big trust cost if it never lands.
6. **Manual tracking runs skip citation extraction** (known bug). Agency runs are largely manual; citations feed the audit and reports.
7. **Client portal v1 is unmerged** (`agency-strays-extended`) with `test_client_portal` red. Decide: fix + merge (clients get a live link — strong retention) or explicitly park it and deliver via PDF + email only. Don't leave it ambiguous.
8. **Typst PDF Phase 6 visual review** — eyeball all 7 document kinds against real client data once, before they go to clients.

**P2 — noise to stop paying attention to (feature freeze):**
- ~20 stale local branches; three "recovery" branches from session-mixing; dead 2FA half-feature; accent-token migration; og-image. None of it earns revenue. Freeze all product work not on the P0/P1 list until 3 paying clients exist.

### 1.4 Honest strategic risks (carry into positioning, don't hide)

- **The core tension (documented in Layer A):** we sell visibility improvement; the mechanism with real evidence is owned-site content + Wikipedia + trade press, not social posting. The offer below is built around that — owned-site-first — so the deliverable matches the evidence.
- **Attribution is unproven.** No controlled publish-and-measure result yet showing Lumidian content lifts mention rate. Sell the process and the measurement, not a guaranteed lift; the founding clients ARE the experiment (case-study rights in exchange for founding pricing).
- **Solo capacity.** Weekly reports are automated, but content review, client comms, and posting support are not. Cap at ~5 retainer clients before hiring a contractor.

---

## Part 2 — The offer

One retainer, sold at two levels. Everything is delivered through the cockpit; no bespoke work outside it.

**Lumidian AI Visibility Retainer**

| | **Core — $2,500/mo** | **Plus — $4,500/mo** |
|---|---|---|
| Tracked prompts | up to 15 | up to 30 |
| Weekly visibility report (auto, PDF) | ✓ | ✓ |
| Monthly strategy report + call | ✓ | ✓ |
| Content clusters/mo (owned-site anchor + supporting pieces) | 2 | 5 |
| Site AIO audit + fix artifacts | initial + quarterly | initial + monthly |
| Wikipedia plan + drafting | plan only | active drafting |
| Competitor/RVI tracking | ✓ | ✓ |

- **Founding-client deal (first 3 only): $1,500/mo for Core**, 3-month minimum, in exchange for case-study rights and a testimonial. This validates pricing with real money without anchoring low forever.
- **MSC:** grandfather at $300 through September while the Pro flattening ships, then a re-price conversation with Afzal ($1,500 founding rate) backed by the new cited-as-source metric and full Pro entitlements. Worst case they stay at $300 — they're still the reference client.
- Client onboarding = the existing cockpit playbook: kickoff → SOW (Typst PDF) → initial audit → strategy locked → weekly execution. It's already built; use it verbatim.

**What's explicitly NOT in the offer:** earned media/PR outreach (out of scope per Layer A), guaranteed rankings/visibility numbers, auto-posting (doesn't exist — posting is manual/assisted).

---

## Part 3 — ICP and positioning

**Beachhead verticals (pick from proof, not theory):**
1. **Capital-raising / fintech platforms** (Reg A+/CF portals, investor marketplaces) — MSC is the case study; the compliance-aware content process (drafts reviewed before posting) is a differentiator here that generic agencies can't match.
2. **Logistics/freight SaaS** — RoxStart demo built the whole narrative (DAT at 28% SOV vs. them at 0.9%); the vertical trade-press source library already exists in the product.

**Company shape:** B2B, $2M–$50M revenue, has a marketing lead or founder who owns growth, sells a considered purchase where buyers ask ChatGPT/Perplexity for recommendations. Big enough that $1.5–2.5K/mo is a line item, small enough that Semrush-tier enterprise tools ignore them.

**Positioning line:** "When buyers ask ChatGPT who to use, you're invisible. We measure exactly where you're losing, and we build the content that AI models actually cite — then prove it week over week." Backed by: the prospect-audit PDF (their real numbers), the methodology page (peer-reviewed citations), and the MSC/RoxStart narratives.

---

## Part 4 — Sales motion: the prospect-audit wedge

The motion is already productized — the prospect-audit PDF was literally redesigned for cold email. The loop:

1. **List** 25 companies in one beachhead vertical (LinkedIn Sales Nav / trade-press advertiser lists / competitor-of-MSC style lookalikes).
2. **Audit**: run a prospect audit per company (staff-picked prompts, ~15 min each including prompt curation). Only send audits with a real story (visible gap vs. named competitors).
3. **Send**: short cold email to the founder/CMO — 3 sentences + the PDF attached. Subject shaped like "How [Company] shows up when buyers ask ChatGPT about [category]". No pitch in email #1; the artifact is the pitch.
4. **Call**: 20-min teardown of their audit → propose founding retainer → SOW PDF from the cockpit same day.
5. **Follow-up**: one bump at day 4, one breakup at day 10. Done.

**Pipeline math (conservative):** 10 audits/week → ~15–20% reply (personalized artifact, real data) → 1–2 calls/week → close 1 founding client per 3–4 weeks. That's 3 founding clients (~$4.5K MRR + MSC) by roughly week 10–12.

**Parallel channels (cheap, secondary):**
- **Afzal / try agi referral deal:** he already manages MSC's account and emails questions — offer 10–15% recurring referral on clients he brings. He is effectively a distribution partner for the fintech vertical.
- **LinkedIn**: 2 posts/week from anonymized audit findings ("We audited 10 freight-tech companies; 8 are invisible in ChatGPT. Here's the pattern."). Feeds inbound while cold motion runs.

---

## Part 5 — Six-week execution plan

**Week 1 — Stabilize (engineering, feature-frozen to this list):**
- Fix the site-audit 1-page crawl bug (P0.1).
- Verify prospect audit end-to-end: pytest suite in the real 3.11 venv + one live audit on a real company, PDF eyeballed (P0.2).
- Repo triage: commit/land the 74-file working tree, merge `feat/cluster-detail-overhaul`, push, confirm Railway deploy green (P0.3).
- Implement Pro-only flattening from the committed spec (P1.4) — it's a migration + price-ID mapping, already designed.

**Week 2 — Package + first pipeline:**
- Ship the cited-as-source metric (P1.5) and email Afzal that it's live (promise kept → opens the re-price conversation).
- PDF Phase 6 visual pass on the 7 doc kinds against MSC data (P1.8).
- Build the first 25-company list (pick ONE vertical: recommend fintech/capital-raising, since MSC is referenceable).
- Write the 3-sentence cold email + the founding-client one-pager. Decide client-portal fate (P1.7): recommend fix+merge only if it's <2 days, else park.

**Weeks 3–4 — Outreach sprint 1:**
- 10 audits + 10 sends/week. Track in a simple sheet (company, sent, replied, call, outcome).
- 2 LinkedIn posts/week from findings.
- Take every call; propose founding deal on the call; SOW PDF same day.

**Weeks 5–6 — Iterate or double down:**
- If replies <10%: the artifact or the list is wrong — rework email/audit story before adding volume.
- If calls happen but no closes: pricing/offer objection — capture verbatim objections, adjust.
- Start vertical #2 (logistics) list only if vertical #1 is producing calls.
- MSC re-price conversation once Pro entitlements + cited-as-source are live.

**Standing rule for the 6 weeks:** no product work outside the P0/P1 list and client-fulfillment bugs. Every session starts from this plan, not from the backlog.

---

## Part 6 — Targets and review gates

| Date | Gate | Bail/adjust signal |
|---|---|---|
| Aug 7 | P0 list done, prod stable, first list built | — |
| Aug 21 | ≥20 audits sent, reply rate known | <5% replies → rework artifact/email before continuing |
| Sep 15 | ≥2 founding clients signed (~$3K+ MRR incl. MSC) | 0 closes after 8+ calls → offer/pricing rethink |
| Oct 15 | 3 founding clients, delivery loop running weekly | Capacity check: hire contractor at client #4 |

**The one metric:** signed retainer MRR. Not features shipped, not audit scores.

---

## Part 7 — Open items for Ken

1. Approve founding price ($1,500/mo) and the two-tier card ($2,500 / $4,500) — or set different numbers.
2. Pick the first vertical (recommendation: capital-raising/fintech).
3. Approve the MSC plan (grandfather → re-price after entitlements ship).
4. Client portal: fix+merge or park?
5. Greenlight Week 1 engineering list so it can start immediately.
