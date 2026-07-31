# Lumidian Agency Go-To-Market Plan — Local Businesses

**Date:** 2026-07-30 (rev. 2, same day — ICP changed to local businesses per Ken)
**Status:** Approved direction, execution pending
**Ken's decisions locked in this revision:**
- **Market: local businesses — any local business.** We have the capability to service any of them; we don't turn anyone away.
- **Price: $1,000/mo.** Raise later, once proven.
- **SaaS: kept for select accounts (MSC and similar), not actively sold.** Agency selling is the only sales motion.

---

## Part 1 — Business-readiness audit (as of 2026-07-30)

### 1.1 What we have

**Product surface:**
- Multi-model AI visibility tracking (ChatGPT + web search, Claude + web search, Perplexity sonar-pro, Gemini grounding), 3 runs/prompt/model, RVI competitive metric, citation extraction, sentiment. Prompts are free text, so location-qualified prompts ("best invisalign dentist in Scottsdale") work today with zero changes.
- Rebuilt content engine: owned-site anchor + cluster model, evidence packs, anti-AI gate, voice directives, FTC-aligned disclosure, Reddit thread routing. For local, the relevant subset is owned-site + Reddit + Quora.
- Site AIO audit with paste-ready fix artifacts (JSON-LD, llms.txt, robots.txt) — local business websites are typically in terrible shape, so this module produces dramatic, visible wins.
- Agency cockpit: client playbook (kickoff → SOW → audit → strategy → weekly execution), 7 Typst PDF document kinds, weekly auto-reports, per-client staff assignment.
- **Prospect audit PDF** (committed on main, designed for cold email) — the sales wedge. For a local owner it is devastating in the best way: their real numbers, their named competitors, "you're invisible when customers ask ChatGPT."
- Read-only client portal (built, unmerged — decision pending).

**Proof / revenue:**
- MRR ~$300: Manhattan Street Capital (Growth tier, via Afzal Iqbal / try agi). Stays on SaaS-select track — grandfathered, not part of the local motion, but proves the delivery loop end to end.
- RoxStart comped demo (logistics) — proves the engine adapts to a new vertical (source tiers, competitor narrative) in days.
- Methodology page with peer-reviewed citations — credibility asset.

### 1.2 Why local is the right market for where we are

1. **The concept explains itself.** Our hardest problem is that AI visibility is difficult to explain — and we are unproven. With a local owner the pitch is a 30-second live demo: *"Ask ChatGPT 'best [what you do] in [your city].' You're not there. Your competitor is."* No methodology education, no GEO jargon.
2. **Greenfield competition.** The funded GEO tools (Peec, Otterly, AthenaHQ, etc.) are all B2B-focused. Nobody is systematically selling AI visibility to local businesses yet. In B2B we'd be the 9th pitch in their inbox; locally we're the 1st.
3. **Fastest visible results.** Local-intent prompts are low-competition. A well-structured service page, clean LocalBusiness schema, and a few real Reddit/Quora mentions can plausibly flip an AI answer in weeks — impossible against entrenched B2B incumbents. Fast before/afters are exactly what an unproven agency needs to mint case studies.
4. **Volume + standardization.** Local businesses are a dense, listable market, and one playbook (local prompt set → audit → fix artifacts → owned-site Q&A content → weekly report) reuses across every client with light per-client customization. That's what a solo operator can actually scale.

### 1.3 What we're honest about (mechanism + risks)

- **Two kinds of local queries, two different levers.** Pure "near me" discovery answers draw heavily on review infrastructure (Google Business Profile, Yelp, listicles, Reddit threads). *Question/comparison/cost queries* ("does Invisalign fix an overbite," "how much does a roof replacement cost in Denver," "best coffee roaster in Austin reddit") are answered from content — which is exactly what we produce. Our reports should track both, and our content targets the second while our site-audit fixes (schema, structure) plus Reddit/Quora presence support the first. We do NOT do review management or GBP optimization — say so plainly; it keeps us out of commodity-local-SEO comparisons.
- **Owners judge on "did the phone ring."** Set expectations in the SOW: we measure and grow AI visibility; we report it weekly with their competitors named. The kickoff doc states what success looks like at 30/60/90 days.
- **Budget reality varies wildly across "any local business."** A dental practice pays $1–3K/mo to agencies routinely; a coffee shop's whole marketing budget may be $500/mo. We serve anyone who says yes at $1K — but we aim *outreach* where budgets and ticket sizes make yes likely (see Part 3).
- **Attribution is unproven.** Founding clients are the experiment; case-study rights are part of the founding deal.

### 1.4 What blocks selling (ranked)

**P0 — blocks the sales motion itself:**
1. **Site-audit crawler bug (only 1 page ever crawled).** The audit is both a paid deliverable and the sales demo. Must fix first.
2. **Prospect-audit end-to-end verification** — run the pytest suite in the real 3.11 venv + one live audit on a real local business; eyeball the PDF.
3. **Repo/deploy hygiene** — `feat/cluster-detail-overhaul` ahead-4 unpushed, ~74 uncommitted files. Land it, deploy, make prod the only reality.

**P1 — blocks delivering credibly:**
4. **Local adaptation pack** (new since rev. 1 — see Part 2.2): local prompt templates, local platform preset, LocalBusiness JSON-LD, local source tiers.
5. **Pro-only tiering flattening** (spec committed) — owed to MSC on the SaaS-select track.
6. **Cited-as-source metric** — promised to Afzal by email; small scope, big trust cost.
7. **Manual runs skip citation extraction** (known bug) — agency runs are manual.
8. **Client portal: fix+merge or park** — decide, don't drift. A live link is strong retention for local clients ("open this anytime, see where you rank in AI").
9. **Typst PDF Phase 6 visual review** — one pass over the 7 doc kinds before client eyes.

**P2 — frozen.** Everything else (stale branches, 2FA, tokens, og-image) waits until 5 paying local clients exist.

---

## Part 2 — The offer

### 2.1 One plan, one price

**Lumidian AI Visibility — $1,000/mo** (founding pricing; rises once proven)

What every client gets, monthly:
- **Tracked AI visibility** on up to 10 local prompts across ChatGPT, Claude, Perplexity, and Gemini, with named local competitors (RVI).
- **Weekly visibility report** (auto-generated PDF) + monthly summary.
- **Site fixed for AI**: initial AIO audit + implemented fix artifacts (LocalBusiness/service schema, structure, llms.txt/robots.txt), refreshed quarterly.
- **2 content pieces/mo** built to win question-and-comparison queries: owned-site Q&A/service pages (anchor) + supporting Reddit/Quora presence where authentic.
- **Live client link** (portal, if merged) or emailed reports.

Terms: 3-month minimum, case-study rights for founding clients, cancel anytime after. Optional $500 one-time setup only if closes come easily without friction — drop it otherwise.

**Explicitly not included:** review management, Google Business Profile optimization, paid ads, guaranteed rankings, social-media community management. One sentence in the SOW: "We make AI assistants recommend you; your existing marketing keeps doing the rest."

**SaaS-select track (separate, passive):** MSC stays at $300 grandfathered until Pro flattening + cited-as-source ship; then a value conversation with Afzal, no pressure. New SaaS signups remain possible but get zero sales effort. Afzal remains a referral channel for any business he brings (10–15% recurring).

### 2.2 Product adaptation for local (the "local pack" — ~1 week of work)

1. **Local prompt templates** — suggested-prompt generation tuned for local: "best [service] in [city]", "[service] cost in [city]", "is [procedure/service] worth it", "[brand] reviews", "[service] near [neighborhood]". Curation layer only; tracking already handles free text.
2. **Local platform preset** — per-client platform defaults (the already-scoped B2 Phase 6 config): owned_site + reddit + quora ON; wikipedia, medium, linkedin, x OFF by default for local clients.
3. **LocalBusiness JSON-LD** (+ subtypes: Dentist, Restaurant, HomeAndConstructionBusiness, etc.) in the site-audit artifact generators alongside existing Organization/Article/FAQPage.
4. **Local source tiers** for the evidence gate — consumer/health/home/city sources instead of trade press (same adaptation already done once for logistics).
5. **Caveat check:** mention detection is substring-based — flag generic business names ("The Coffee Shop") at onboarding and use distinctive name variants in prompts.

---

## Part 3 — Market and targeting

**We serve any local business.** Nobody who says yes at $1K is turned away — the playbook is standardized enough to deliver for a bakery or a law firm alike.

**We aim outreach where a yes is most likely.** Effort-weighting, not exclusion:

| Outreach priority | Segments | Why |
|---|---|---|
| **Tier 1 — chase** | Dentists, med spas, cosmetic/elective health, PI & immigration law, vets, HVAC/roofing/plumbing (big-ticket), fertility/chiro/physio | Already pay agencies $1–3K/mo; one new customer worth $1K–$20K; heavy question/cost/comparison query surface (our engine's sweet spot) |
| **Tier 2 — opportunistic** | Restaurants, gyms, salons/barbers, auto repair, real-estate agents, wedding vendors | Real budgets exist but smaller; "near me"-dominant queries; close when warm (referral, inbound, local network) |
| **Tier 3 — serve inbound only** | Coffee shops, retail boutiques, low-ticket food | Deliverable works, but $1K strains their budget — take the yes, don't spend outreach hours |

**Geography:** start with one metro (Ken's own or an adjacent one) — "I'm local too" converts, referrals compound inside a metro, and city-level Reddit/source knowledge reuses across clients. Expand metro #2 only when metro #1 has 3+ clients.

**Positioning line:** *"Your next customer is asking ChatGPT who to call. We track exactly what AI says about you and your competitors — and we build the content and site fixes that get you recommended. $1,000/mo, see your numbers weekly."*

---

## Part 4 — Sales motion: the prospect-audit wedge, local flavor

1. **List** 25 businesses/week in the chosen metro, Tier-1 weighted (Google Maps + "best X in [city]" AI answers themselves — whoever ISN'T in the answer is the list).
2. **Audit** ~10/week: staff-picked local prompts, prospect-audit PDF. Only send when there's a story (named competitor winning the AI answers they're absent from).
3. **Reach the owner** — email with PDF attached, subject "What ChatGPT says when people search for a [dentist] in [city]". For local, layer channels B2B doesn't have: a phone call to the owner ("I ran a free report on your practice, can I send it?"), walk-ins for storefront businesses, chamber-of-commerce / BNI / local business groups, and local Facebook groups. The live demo on their own phone is the close.
4. **20-min teardown** → founding offer at $1K → SOW PDF from cockpit same day.
5. **Follow-up:** bump day 4, breakup day 10.
6. **Referral engine from day one:** every client, at first visible win, gets asked "which two business owners do you know who'd want this?" Local businesses refer constantly — this becomes the primary channel by month 3 if it works.

**LinkedIn/content flywheel:** 2 posts/week of anonymized local findings ("We checked 20 [metro] med spas in ChatGPT — 17 are invisible. The 3 that show up all do this…"). Doubles as SaaS-passive lead capture.

**Pipeline math at $1K:** 10 audits/wk → local reply rates run higher than B2B cold (personal, their own numbers, small pond) — assume 20–30% response, 2–3 conversations/wk → first close inside 3 weeks, then ~1–2/mo compounding with referrals. **Capacity: ~8 local clients solo** (local delivery is lighter than MSC-style compliance review) → $8K MRR ceiling before the first contractor hire.

---

## Part 5 — Six-week execution plan

**Week 1 — Stabilize + localize (feature-frozen to this list):**
- Fix the site-audit crawler bug (P0.1).
- Verify prospect audit end-to-end; run one live audit on a real Tier-1 local business in the target metro (P0.2).
- Land/merge/deploy the working tree and branch (P0.3).
- Start the local pack (Part 2.2): prompt templates + platform preset first.

**Week 2 — Finish local pack + package:**
- LocalBusiness JSON-LD + local source tiers.
- Pro flattening implementation + cited-as-source metric (SaaS-select promises to MSC — timeboxed to ~2 days combined; slip to week 3 if the local pack needs the time).
- Pick metro; build the first 25-business Tier-1 list; write the cold email + one-page founding offer; decide client-portal fix-vs-park.
- Run 3 practice audits; eyeball PDFs against the "would an owner understand this in 60 seconds?" bar.

**Weeks 3–4 — Outreach sprint 1:**
- 10 audits + 10 sends/week, phone-follow every send within 48h. Track in a sheet: business, segment, sent, replied, call, outcome, objection verbatim.
- 2 LinkedIn posts/week from findings. Attend 1 local business group meeting.
- Close on the call at $1K founding; SOW same day; kickoff within a week.

**Weeks 5–6 — Read the data and adjust:**
- Replies <10%: artifact or list problem — rework the email/audit story before adding volume.
- Calls but no closes: capture objections; test $750 founding vs. adding a concrete deliverable, don't silently discount.
- 1+ close: onboard through the cockpit playbook verbatim; ask for 2 referrals at first visible win; start metro list #2 only if #1 is producing.

**Standing rule:** no product work outside P0/P1 + client-fulfillment bugs until 5 paying clients. Every session starts from this doc.

---

## Part 6 — Targets and review gates

| Date | Gate | Adjust signal |
|---|---|---|
| Aug 7 | P0 done, prod stable, local pack started, metro picked | — |
| Aug 21 | ≥20 audits sent, reply rate known | <10% replies → rework artifact/email |
| Sep 15 | ≥2 founding clients (~$2K local MRR + MSC) | 0 closes after 10+ conversations → offer/price rethink |
| Oct 15 | 4–5 clients, weekly delivery loop humming, first before/after case study drafted | Hire contractor at client #6–8 |

**The one metric: signed local retainer MRR.** Secondary: time-to-first-visible-AI-answer-change per client (the case-study clock).

---

## Part 7 — Decisions log + remaining opens

**Decided (Ken, 2026-07-30):** local businesses — any local business — as the market; $1,000/mo; SaaS kept for select accounts (MSC) with no sales focus.

**Still open:**
1. Which metro first?
2. Client portal: fix+merge (~estimate first) or park?
3. Setup fee: $500 or zero-friction?
4. Greenlight Week 1 engineering (crawler bug first).
