# AI visibility agencies, public evidence, and attribution: what to do next

**Date:** 2026-09-10
**Status:** Research and recommendation. No decisions made yet.
**Question Ken asked:** What are other AI visibility agencies doing right and wrong, what do they measure, which public studies can Lumidian cite to sell the work, and how do we get numerical evidence that our work moves visibility.

Three parallel web research passes (agencies, public studies, measurement tools and attribution methods) plus a read-only pull of the production database. Every external number below carries a source in the appendix. Numbers marked (snippet) were seen only in search results, not on the source page.

---

## 1. Short answer

1. **Our own data does not yet show the work moves visibility.** The Manhattan Street Capital content push of August 2026 (about 30 pieces across owned site, Medium, LinkedIn, Reddit, Quora and X) shows no lift on the target prompts. The two prompts that dropped fell because Perplexity stopped mentioning MSC in the week of Aug 3, before the content for those prompts was posted. None of the new URLs has been cited yet. The one positive signal (Gemini on the cost prompt rising after the cost guide went up) rests on 3 responses per week and is not evidence.
2. **The measurement design cannot currently detect an effect.** Weekly runs at 3 per prompt per model give 9 responses per prompt per week. The literature puts the noise floor on a single prompt at 5 to 7 percentage points even with hundreds of responses. Fixing the design is a prerequisite for ever having a number.
3. **Nobody in the market publishes honest numbers either.** Of eight published case studies reviewed, only Ahrefs used a control group, and its result was null (schema markup did not move citations). Every positive case shipped several tactics at once and reported percent gains on tiny bases. A small but controlled report from Lumidian would be more credible than anything the incumbents publish. That is the opening.
4. **The evidence points to different levers than the current offer leads with.** Across a 75,000-brand correlation study, a pre-registered census of 4,776 local venues, a 6.8 million citation dataset and the Whitespark expert survey, the things that predict local AI recommendation are: third-party web mentions and best-of lists, directory and review-platform presence, having your own website with prices and recent dates, and review volume. Schema markup, llms.txt and copywriting tricks do not hold up under controlled tests. The GTM plan currently excludes review and listings work and leads with schema fixes plus cross-platform content. That should change.
5. **There are enough third-party studies to sell with today.** Ten are listed in section 5 with the exact numbers and a caution for each.

---

## 2. What Lumidian's own data says (MSC, brand 2)

Source: read-only query of `/data/lumidian.db` on 2026-09-10. 155 completed runs since April 7, 2026. Daily scheduled runs through Aug 20, weekly since (Aug 24, Aug 31, Sep 7). MSC is on Growth so there is no Claude data.

### 2.1 The August content push, prompt by prompt

Content was posted between Aug 1 and Aug 20 for prompts 14, 20, 66, 68, 69, 70 and 78, then again Sep 8 and 9 for 70 and 77. Mention rate is share of non-errored responses across ChatGPT, Gemini and Perplexity.

| Prompt | Content posted | July rate (n=351) | Aug 17 onward (n=72) |
|---|---|---|---|
| 14 cost of a Reg A+ offering | 7 pieces, Aug 17 to 18 | 21.1% | 5.6% |
| 20 how long approval takes | 7 pieces, Aug 18 to 20 | 18.2% | 0.0% |
| 66 raise up to $75M | 8 pieces, Aug 4 | 0.3% | 0.0% |
| 68 Reg A+ vs Reg D | 6 pieces, Aug 5 | 0.0% | 0.0% |
| 69 SEC regulations for startups | 6 pieces, Aug 6 to 14 | 0.0% | 0.0% |
| 70 best advisory service | 7 pieces, Aug + Sep 8 | 88.6% | 94.4% |
| 78 will Reg A+ work for my business | 4 pieces, Jul 29 to Aug 1 | 0.3% | 0.0% |
| 19, 75, 76, 77, 79 (no August content) | none | 0 to 90% | flat or slightly down |

### 2.2 Why the drops on 14 and 20 are not about our content

By model, prompt 14 on Perplexity went 50, 48, 67, 58, 40, 43% across weeks 26 to 31, then 0% from the week of Aug 3 onward. Prompt 20 on Perplexity went 76, 67, 73, 48% then 0%. ChatGPT was already at 0% on both. The fall began two weeks before the content for those prompts was posted. Whatever changed was on Perplexity's side (index refresh, model change, or the old MSC page dropping out of retrieval). Across all 13 prompts Perplexity fell from 25 to 36% in July to 15 to 23% in late August, while ChatGPT and Gemini were flat.

Gemini on prompt 14 went from about 10% in July to 33, 33, 67% in the three weekly runs after the cost guide was posted. That is 3 responses per week. It is the only place the data leans positive.

### 2.3 The new URLs are not being cited

Citation extraction only runs on scheduled runs, so there are 3 data points since the push. The own-domain URLs Perplexity and Gemini cite for MSC are the same pages as in May: the 2019-era cost blog post (236 citations), the "12 tips" post (233), the IPO FAQ (229), the Reg A vs VC post (209). None of the August owned-site guides (`/guides/reg-a-plus-cost-breakdown`, `/guides/reg-a-plus-timeline`, the four new `/blog/rod-turner/` posts) appears in citations. Own-domain share of all citations has been flat at 7 to 8.5% since June.

This matches the literature: Ahrefs' 17 million citation dataset puts the average AI-cited page at about 3 years old, and the SIGIR 2026 controlled study finds that being retrieved at all is the gate. New pages on an already-cited domain compete with the domain's established pages for the same slot.

### 2.4 What is broken in the measurement itself

- **Sample size.** 13 prompts times 3 models times 3 runs is 117 responses per sweep, 9 per prompt. Per-prompt claims are impossible. Portfolio-level claims at ±5 to 6 points need roughly 300 responses per period.
- **Cadence change mid-experiment.** Daily runs to Aug 20, weekly after. The pre period has 5 to 7 times the data of the post period.
- **The draft attribution table is misleading.** It shows +22.22 for six prompt-14 drafts because score at posting was 0 and one later run hit 22%. It compares single runs.
- **Citations skip manual runs** (known bug). Agency runs are manual, so agency clients will have no citation data at all.
- **No controls are tagged.** Nothing in the schema marks which prompts a piece was meant to move versus which were left alone.

---

## 3. What agencies are selling, measuring and charging

### 3.1 Price bands

| Tier | Monthly | Who |
|---|---|---|
| "Monitor and maintain" | $1,000 to $2,500 | Digital Elevator's floor tier: 1 to 2 platforms tracked, quarterly schema and FAQ refresh |
| Local productized | $999 to $2,800 plus one-time builds | PatientGain med spa bundles (snippet), RankOps $997 fix and $1,500/mo, ShowUpWithAI from $2,800, KailxLabs $4,995 build plus $2,000/mo |
| Mid-market GEO | $3,000 to $8,000 | WebFX from $3,000, Optimist $3,000 to $4,000, Embarque range, Discovered Labs from €5,495 |
| Enterprise | $8,000 to $25,000+ | First Page Sage, Siege, Animalz, Omniscient, Skale |

$1,000/mo sits at the very bottom of every published band. It is defensible only as an honest presence-plus-measurement retainer, not as a "get you into ChatGPT" promise.

### 3.2 What the local shops promise a dentist or roofer

- To be one of the two or three businesses named for "best X in [city]" (KailxLabs, one client per city, refund if not cited in 45 days).
- A count of tracked prompts that cite the client: "23 of 50 prompts in 90 days" (Intleacht), "0 to 9 AI citations in 45 days, owner-verified" (RankOps), "11 of 15 target queries" (i-call).
- A 0 to 100 score: "23 to 91 in 30 days" (Scope, $25/mo self-serve).
- Freedom from lead platforms: Angi spend $12k to $4k/mo (i-call).
- Fear stats without methodology: "94.7% of dental practices never reach AI's top 5" (Avante's own unpublished study).

Deliverables are almost identical everywhere: Google Business Profile cleanup, NAP consistency, LocalBusiness schema, FAQ-structured service pages, review velocity, directory profiles (Healthgrades, Zocdoc, Yelp, Avvo), some Reddit or YouTube presence, and a prompt tracker. Timelines quoted: 4 to 8 weeks for technical layers, 6 to 12 months for citation building.

### 3.3 What the credible operators do differently

- Run each prompt multiple times per engine and report ranges with confidence labels ("high confidence", "directional", "unstable"). Surface Labs' rule: never report single-run visibility as market share, never blend mentions, citations and recommendations into one score, never hide volatility.
- Report AI metrics next to organic traffic, brand search, calls and pipeline so an organic decline cannot hide behind a visibility gain. Lily Ray has seen vendor case studies with rising AI visibility and 66% organic traffic loss.
- Sell GEO as an extension of a local SEO base, since the local evidence says that is what drives inclusion.
- Refuse hard outcome guarantees (Siege, Go Fish) or scope them to controllable activity.
- Say plainly what is overhyped: schema-only, llms.txt, AI article farms.
- Offer client-verifiable proof: GA4 referral sources, call tracking, "owner-verified" tracker screenshots.

### 3.4 What the critics call snake oil

- Position or rank tracking in AI answers. SparkToro's 2,961-run study: under 1% chance two runs give the same list.
- Guarantees keyed to "cited" or "visibility up" within 45 to 60 days, which non-determinism makes cheap to hit.
- Percent gains on tiny bases ("ChatGPT mentions grew from 7 to 12", "+5,556% AI traffic").
- Fake or seeded Reddit threads, warmed accounts, self-published "best agencies in [city]" listicles at scale. Google and Microsoft now treat these as spam.
- "$99/mo AI search" offers that are baseline SEO relabeled.
- Setup fees of $2,500 to $12,000 and 6 to 12 month lock-ins for what is mostly content volume.
- Tools disagreeing with each other: one client ran four visibility tools and got materially different answers (Adweek). IAB says programs under 50 queries lack directional credibility.

### 3.5 What tracking tools measure

No two tools share a definition. The same data can produce a "50" meaning half of all answers, half of brand-mentioning answers, an impression-weighted share, or a normalized composite. Profound's own help pages disagree on the denominator. Lumidian's definition (share of non-errored responses mentioning the brand) matches Peec, Evertune, Gumshoe and the academic "citation prevalence" definition. It is defensible; it just is not comparable to a Profound or Semrush number, and reports should say so.

Run counts: Profound 1x per day per prompt across a large portfolio; Evertune 100 runs per prompt per model; Gumshoe sizes each audit to ±5 points at 95% confidence; cloro.dev's rule of thumb is about 300 answers per period for ±5 points.

Location-aware prompting: only SE Ranking's SE Visible (per-city prompt assignment, from $99/mo) and Local Falcon (geo-grid, from $24.99/mo) offer city-level tracking. Neither discloses the mechanism. For an API-based tracker the options are city text in the prompt plus a location statement in the system message, disclosed as an approximation of consumer-app geolocation. Sanbi reports the top recommended product changed in 41% of US metros for the same query (snippet).

---

## 4. What the evidence says actually moves local AI visibility

Ordered by strength of evidence. Effect sizes are as reported by the source.

| Lever | Evidence | Strength |
|---|---|---|
| **Third-party web mentions of the brand name** | Ahrefs, 75,000 brands: Spearman 0.664 with AI Overview mentions vs 0.218 for backlinks; top-quartile brands by mentions get about 10x the AI mentions. Holds across ChatGPT (0.664), AI Mode (0.709), AIO (0.656). Pitenin census: odds ratio 1.44 | Large-sample correlational, plus a pre-registered audit |
| **Presence on review platforms and directories** | Yext, 6.8M citations: 42% of citations are listings, 52.6% in healthcare. SE Ranking, 129K domains: review-platform presence 2.5 to 3.5x the ChatGPT citations. BrightLocal audit: ChatGPT built dentist answers entirely from ten dental directories (snippet). Whitespark expert survey: "best of" lists scored highest of 187 factors for AI visibility | Large-sample, vendor-motivated (Yext) but consistent across sources |
| **Own website exists, with prices and recent dates** | Pitenin census of 4,776 venues: own website OR 1.92, listed pricing OR 1.54. SIGIR 2026 controlled study of 252,000 trials: explicit price and recent timestamps consistently raise citation. SE Ranking: updated within 3 months, 6.0 vs 3.6 citations | Peer-reviewed plus pre-registered |
| **Review volume** | Pitenin: OR 1.64 for volume; star rating does not get you in (OR 0.89) but decides who is first (OR 1.17). Incumbent Advantage paper: a small real rating edge flips a 100% incumbent monopoly | Pre-registered audit plus controlled experiment |
| **Dedicated service pages, fact-dense, structured** | Citation Absorption study, 21,143 citations: influential pages are longer, structured, with extractable facts. Whitespark experts: dedicated service pages second-highest factor | Observational plus expert opinion |
| **YouTube presence** | Ahrefs: YouTube mentions 0.737 correlation with ChatGPT visibility, the strongest single correlate | Large-sample correlational, large-brand skew |
| **Reddit and Quora answers** | Semrush 248K Reddit URLs: cited posts are small (80% under 20 upvotes, median 80 words), Q&A threads, about 900 days old. But ChatGPT's Reddit share fell from about 60% of responses to about 10% in September 2025. Yext: Reddit is 2% of citations in location-based searches | Real but volatile and small for local |
| **Schema markup** | Ahrefs matched control test, 1,885 pages: AIO −4.6%, AI Mode +2.4%, ChatGPT +2.2%, the positives indistinguishable from zero. SE Ranking: FAQ schema pages cited less (3.6 vs 4.2). Otterly's own experiment: competitors who changed nothing moved in parallel | **Best-designed test in the field, and it is null** |
| **llms.txt** | SE Ranking 300K domains: negligible. Adoption about 6% | Null |
| **Copywriting tactics (add statistics, quotes, citations)** | C-SEO Bench, NeurIPS 2025: existing methods "largely ineffective" and frequently negative; ranking higher in retrieved context is far more effective; gains go to zero as competitors adopt. Martinez survey of 45 studies: no technique shows stable cross-platform causal effect | Peer-reviewed, negative |

Two more facts that shape the offer:

- **Blocking AI crawlers removes you.** SIGIR 2026 (Grossman et al., 11,500 real queries): sites blocking Google's AI crawler are substantially less likely to appear in AI Overviews. The site audit's robots check is the right first step; the schema fix is not.
- **Query intent decides which lever applies.** Whitespark, 540 hand-run local queries: pure local intent ("PI lawyers in Phoenix") triggers an AI Overview 15% of the time and a map pack 93%; hybrid intent ("cost of hiring a PI lawyer in Houston") triggers an AI Overview 97% of the time and a map pack 17%, and 40% of the sources cited there are individual local businesses. The GTM plan's split between discovery queries and question/cost queries is right. The cost and comparison queries are where owned content can win.

### 4.1 Implication for the offer

The current plan says "We do NOT do review management or GBP optimization" and leads the deliverable with schema, llms.txt and robots artifacts plus cross-platform content clusters. The evidence ranks those levers backwards. A $1,000 local retainer that the evidence supports looks like:

1. Robots and crawler access check (keep).
2. Listings and directory presence in the vertical's directories (Healthgrades, Zocdoc, Yelp, Avvo, Angi, Houzz, the ten dental directories) with consistent name, address, phone, and prices where the directory allows. New.
3. Placement on local "best of" lists and local press mentions. This is the highest-scored expert factor and the strongest correlate. New; it is outreach work, not content generation.
4. Dedicated service pages on the client's own site with prices, dates, FAQs and concrete facts. Keep, and make the owned-site anchor the only content piece by default.
5. Review velocity guidance (not review management: a script and a cadence the owner runs). Cheap to add and the evidence says it decides who is named first.
6. Reddit and Quora answers only where a real thread exists for a cost or comparison question. Keep, deprioritize.
7. Schema as Google hygiene, described that way. Stop selling it as an AI visibility lever.
8. Medium, LinkedIn and X: drop from the local offer. No evidence they are cited for local queries, and MSC's posts on them were never cited.

This is a real change to the offer and the product presets. It is Ken's call.

---

## 5. Studies you can cite in a sales deck today

Ranked for a local audience. Quote the number and the caveat together.

| # | Study | The number | Caveat |
|---|---|---|---|
| 1 | BrightLocal Local Consumer Review Survey 2026, 1,002 US adults | 45% used AI to find a local business this year, up from 6%; ChatGPT 31%, Google AI Mode 23%; 63% trust the result, 88% verify it | Self-reported; the jump is large enough that question wording may have changed (snippet, primary page blocked) |
| 2 | SOCi Local Visibility Index 2026, 350,000 locations | Locations appear in the Google 3-pack 35.9% of the time, are recommended by ChatGPT 1.2% and Gemini 11.0%; only 45% overlap between map-pack winners and AI winners | Multi-location chains, not solo practices; vendor |
| 3 | Whitespark, AI Overviews in local search, 540 queries, 6 industries | "Cost of X in [city]" queries: AI Overview 97%, map pack 17%; 40% of sources cited are individual local businesses | Hand-collected, small, transparent |
| 4 | Ahrefs, 75,000 brands | Branded web mentions correlate 0.664 with AI Overview visibility; backlinks 0.218; YouTube 0.737 for ChatGPT | Correlational, brands with DR over 40 |
| 5 | Pitenin, "Invisible to the Machine", census of 4,776 venues, 2,208 responses, pre-registered | 85.6% of venues never recommended by any system; own website OR 1.92, review volume 1.64, listed pricing 1.54, third-party mentions 1.44 | One geography (Bali), restaurants, preprint |
| 6 | Vishwakarma et al., SIGIR 2026, 252,000 controlled trials | Explicit prices and recent timestamps consistently raise citation; formatting-only edits do little | Peer-reviewed; B2B-style testbed |
| 7 | Yext, 6.8M citations, 1.6M responses | 42% of citations are listings; healthcare 52.6% listings | Yext sells listings |
| 8 | Pew Research, Feb 2026, 5,119 US adults | 49% of adults use AI chatbots; top use is searching for information (42%); 60% read the AI summaries at the top of Google | Gold standard |
| 9 | Seer Interactive, 3,119 queries, 42 clients, 25M impressions | Inside AI Overview queries, cited brands get 35% higher organic CTR and 91% higher paid CTR than uncited brands | Informational queries only |
| 10 | Iannelli and Ai, "From Prompt to Purchase", clickstream panel, event study | After an AI names a brand, branded Google searches rise 4.3 points (CI 3.1 to 5.5) and brand site visits 2.4 points | Preprint; check panel size before quoting an N |

Also usable: Local Falcon restaurant index (74.9% of 10,000 restaurants never appear in Google AI picks even with 1,000+ reviews), Semrush topic-authority study (53.7% of categories have no AI answer owner; leaders keep leads 90% of the time), SE Ranking 129K-domain factors (review-platform presence 2.5 to 3.5x citations, updated within 3 months 67% more).

### 5.1 Claims to stop using or never start

- "AI visitors convert 4.4x better" (Semrush): no sample, sites or definition published. Use Adobe (+54%, trillion retail visits) or Visibility Labs (+31%, 94 stores, GA4) instead, with the retail caveat.
- "23x conversion" (Ahrefs): one company's own site.
- "95% of ChatGPT citations are under 10 months old": contradicted by Ahrefs' 17M-citation average of 2.9 years.
- "Schema helps AI citation": the controlled test says no.
- "Foursquare supplies 70% of ChatGPT local results": no primary source exists.
- "74% of users pick the top AI result": from a 70-person qualitative study; the percentage cannot be verified on the primary page.
- "Reddit is in 40% of AI answers": true for one mid-2025 window, then fell to about 10%.
- The original GEO paper's "40% visibility boost": conditional on already being retrieved and does not replicate under competition (C-SEO Bench, Martinez).

### 5.2 Deck hygiene

Prospects who search "does GEO work" will find the NeurIPS and survey papers saying the copywriting tactics do not. Cite them first. It positions the retainer as presence and retrieval work, which is what the evidence supports, and it is the honesty the critics say the market lacks.

---

## 6. How to get a number of our own

### 6.1 Design principles from the literature

- A single prompt run once is worth nothing. Żatuchin's variance decomposition: single-answer reliability about 0.01; reliability comes from spreading across prompts and models more than repeating one prompt; repeats beyond 5 add almost nothing per prompt.
- The Dice Roll protocol tiers: 5 iterations exploratory (G=0.58), 10 confirmatory (0.74), 15 rigorous (0.81). Our 3 is below exploratory for any single prompt.
- Week-to-week retest variance equals same-day rerun variance (Pitenin; Schulte et al.), so week-to-week "changes" in a small sample are noise, not drift.
- Confidence interval widths of 5 to 7 points on citation share are normal (Sielinski, arXiv 2603.08924); improvements that size cannot be attributed without repeated sampling.
- Every credible attribution design uses a control that experiences the same platform drift: holdout prompts, competitors on the same prompts, or other clients who have not yet shipped the change.

### 6.2 Attribution methods ranked

1. Randomized page-group split tests (SearchPilot). Needs hundreds of templated pages. Not feasible for local.
2. Matched difference-in-differences across many units (Ahrefs schema study). Feasible for Lumidian once there are 6 to 10 clients: each client that ships change X is treated, clients who have not are controls.
3. Treatment and holdout prompt panels with competitors as a second control, frozen for 30 days, baseline taken on 3 to 5 separate days. Feasible now. Decision rule: treatment up and both controls flat is an effect; everything moving together is platform drift.
4. CausalImpact-style interrupted time series with competitor and holdout series as controls. Cheap, composes with 3.
5. Leading indicators: AI fetcher hits in server logs (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot on the new URLs), Google Search Console's generative AI report (worldwide since Aug 31, 2026, impressions only), a GA4 channel group for AI referrers. Not causal, but they show fetch-before-citation and make a later visibility change plausible.
6. Uncontrolled before and after on one brand. What every published case study does. Do not do this.

### 6.3 A 30-day protocol Lumidian can run with the current tracker

1. **Freeze the panel.** Lock prompt set, brand lexicon (with name variants; substring matching misses synonyms), model list and settings for the window. Report per engine, never pooled.
2. **Tag prompts as treatment or holdout before shipping anything.** Treatment prompts are the ones the page or fix addresses. Holdout prompts are same-client prompts the work does not touch. Record every competitor's rate on both sets.
3. **Baseline on 3 to 5 separate days**, so there is a within-client standard deviation before the change.
4. **Raise runs on treatment prompts from 3 to 6** for the window. Cheap, and it roughly halves the interval on the arm that matters.
5. **Ship one change per client per window and stagger across clients.** Two clients get it in week 2, two in week 4. The unshipped clients are cross-client controls.
6. **Estimate as difference in differences with a bootstrap** over prompt-by-run responses, per engine, against both the holdout prompts and the competitor set.
7. **Wire leading indicators the same week**: server or CDN log grep for AI fetchers on the new URLs, GA4 AI channel group, GSC generative AI report.
8. **For local prompts**, put the city in the prompt and a location statement in the system message, and disclose it as an approximation.
9. **Report ranges, holdout and competitor lines on the same chart, and state that effects under about 5 points are inside the noise floor.** Do not report position.

What this cannot do in 30 days: prove a small effect, or separate two tactics shipped together. With 25 prompts, 3 models and 3 runs, one sweep is 225 responses, so the portfolio-level interval is about ±6 points at 20% visibility. Daily sweeps during the window are what make it work.

### 6.4 Product changes this implies

- Fix citation extraction on manual runs (known bug; agency runs are manual).
- Daily cadence for clients inside a test window, or a per-prompt run multiplier for treatment prompts.
- `Prompt.experiment_role` (treatment / holdout / none) and a per-client experiment window record.
- A difference-in-differences card with bootstrap intervals in the weekly PDF, showing treatment, holdout and peer-pool lines. RVI already does the competitor-relative part.
- Retire or rebuild the draft attribution table; it compares single runs.
- Optional city context for prompts (prompt text plus system-message location).
- A place to record log-file fetcher hits and GSC AI impressions per URL, even if entered by hand at first.
- Fix URL matching for citations to ignore the www prefix when comparing posted URLs.

### 6.5 Re-run the MSC analysis properly

Before any of the above, one cheap step: reclassify MSC's 13 prompts into treated (14, 20, 66, 68, 69, 70, 78) and untreated (19, 75, 76, 77, 79), use July daily data as the baseline, and compute the per-engine difference in differences with a bootstrap. The answer will almost certainly be "no detectable effect at this sample size", which is itself a number Ken can stand behind, and it produces the code the weekly report needs.

---

## 7. Decisions for Ken

1. Reshape the local offer toward presence work (listings, best-of lists, service pages with prices, review velocity) and demote schema, llms.txt and cross-platform posting. Section 4.1.
2. Adopt the 30-day protocol as the standard client onboarding, including daily runs in the window and treatment/holdout tagging. Section 6.3.
3. Build the sales deck from the ten studies in section 5 with the caveats attached, and lead with the negative papers.
4. Decide whether to tell Afzal that the August MSC push shows no measurable lift yet and why (Perplexity shift, new URLs not yet retrieved, sample size), and propose the controlled window as the next step.

---

## Appendix A: Sources (fetched unless marked snippet)

**Agencies and market**
- Digital Elevator pricing guide: https://thedigitalelevator.com/blog/aeo-and-geo-pricing-guide/
- Discovered Labs pricing critique: https://discoveredlabs.com/blog/aeo-agency-pricing-what-10k-20k-month-buys-you-in-ai-visibility-leads
- Optimist agency list: https://www.yesoptimist.com/best-geo-agencies/
- WebFX GEO cost: https://www.webfx.com/blog/ai/generative-engine-optimization-cost/
- ShowUpWithAI med spa: https://showupwithai.com/medspa/
- KailxLabs / HouseofMVPs: https://houseofmvps.com/best-aeo-agencies-for-local-business
- RankOps: https://rankops.net/
- Avante Visibility dentists: https://avantevisibility.com/dentists
- i-call.ai local services: https://i-call.ai/en/aeo-for-local-services
- Intleacht case studies: https://intleacht.ai/case-studies/
- Scope dentists: https://scope.online/for/dentists
- Semrush agency tools roundup: https://www.semrush.com/blog/ai-visibility-tracking-tools-for-agencies/
- 5WPR dental AI index: https://www.5wpr.com/research/dental-ai-visibility-index-2026/
- Courtyard dentists: https://getcourtyard.ai/state-of-ai-visibility/dentists
- OpenLens law firms: https://openlens.com/blog/en/ai-visibility-1000-law-firms-2026
- Seal Global dental case: https://www.sealglobalholdings.com/blog/dental-seo-services-case-study-2026
- PatientGain pricing (snippet): https://healthcare.wowbix.com/best-seo-agencies-for-med-spas/

**Critiques**
- SparkToro / Gumshoe inconsistency study: https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/
- Search Engine Land 5-layer framework: https://searchengineland.com/the-5-layer-framework-for-measuring-geo-performance-477742
- Search Engine Land hard truths (snippet): https://searchengineland.com/measuring-ai-visibility-geo-performance-hard-truths-467197
- Adweek on GEO scores: https://www.adweek.com/media/why-geo-scores-arent-the-solution-to-your-brands-ai-engine-visibility/
- Digiday GEO cottage industry: https://digiday.com/media/media-briefing-as-ai-search-grows-a-cottage-industry-of-geo-vendors-is-booming/
- Lily Ray via PPC Land: https://ppc.land/lily-ray-what-the-seo-industry-is-getting-dangerously-wrong-about-ai-search/
- Seer, visibility is a vanity metric: https://www.seerinteractive.com/insights/ai-visibility-is-a-vanity-metric-prepare-your-execs
- Surface Labs reporting rules: https://www.withsurface.com/blog/ai-visibility-measurement-is-messy-how-to-report-geo-without-fak
- authoritytech noise and CI: https://authoritytech.io/curated/ai-visibility-rankings-noise-confidence-interval
- authoritytech platform methodology audit: https://authoritytech.io/blog/ai-visibility-scores-not-comparable-platform-methodology-audit
- authoritytech 30-day test protocol: https://authoritytech.io/curated/brand-mentions-ai-visibility-30-day-test
- Matt Tutt on Reddit abuse: https://matttutt.me/how-seos-and-marketers-are-abusing-reddit-for-seo-geo-ai-visibility/
- Radiant Elephant evidence review: https://www.radiantelephant.com/geo-tactics-what-works-evidence-based-research-review/
- NP Digital 100 campaigns: https://neilpatel.com/blog/aeo-geo-profitability/

**Academic**
- Martinez, critical survey of GEO: https://arxiv.org/abs/2607.14035
- Vishwakarma et al., SIGIR 2026: https://arxiv.org/abs/2605.25517
- C-SEO Bench, NeurIPS 2025: https://arxiv.org/abs/2506.11097
- Chu and Hou, Incumbent Advantage: https://arxiv.org/abs/2606.17443
- Filandrianos et al., EMNLP 2025: https://arxiv.org/abs/2502.01349
- Kumar and Palkhouski, GEO16: https://arxiv.org/abs/2509.10762
- Zhang et al., Citation Absorption: https://arxiv.org/abs/2604.25707
- Iannelli and Ai, From Prompt to Purchase: https://arxiv.org/abs/2606.10907
- Grossman et al., SIGIR 2026: https://arxiv.org/abs/2604.27790
- Pitenin, Invisible to the Machine: https://arxiv.org/abs/2608.07069
- Żatuchin, variance decomposition: https://arxiv.org/abs/2607.13304
- Żatuchin, Dice Roll Method: https://arxiv.org/abs/2609.04047
- Żatuchin, repeated queries exhaust brands: https://arxiv.org/abs/2609.05059
- Sielinski, uncertainty in AI visibility: https://arxiv.org/pdf/2603.08924
- Schulte et al., Don't Measure Once (already cited on methodology page): https://arxiv.org/pdf/2604.07585

**Industry data**
- Ahrefs 75K brand correlations: https://ahrefs.com/blog/ai-overview-brand-correlation/
- Ahrefs cross-platform correlations: https://ahrefs.com/blog/ai-brand-visibility-correlations
- Ahrefs 12% overlap: https://ahrefs.com/blog/ai-search-overlap/
- Ahrefs AIO citations top 10: https://ahrefs.com/blog/ai-overview-citations-top-10/
- Ahrefs schema test: https://ahrefs.com/blog/schema-ai-citations/ and https://www.searchenginejournal.com/schema-markup-didnt-move-ai-citations-in-ahrefs-test/574568/
- Ahrefs freshness: https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content
- Ahrefs conversions: https://ahrefs.com/blog/ai-search-traffic-conversions-ahrefs/
- Ahrefs Brand Radar methodology: https://ahrefs.com/blog/brand-radar-methodology/
- Semrush AI Mode study: https://www.semrush.com/blog/ai-mode-comparison-study/
- Semrush most-cited domains: https://www.semrush.com/blog/most-cited-domains-ai/
- Semrush Reddit study: https://www.semrush.com/blog/reddit-ai-search-visibility-study/
- Semrush topic authority: https://www.semrush.com/blog/chatgpt-topic-authority-study/
- Semrush ghost citations: https://www.semrush.com/blog/the-ghost-citations-study/
- Semrush 4.4x claim: https://www.semrush.com/blog/ai-search-seo-traffic-study/
- Semrush metric definitions: https://www.semrush.com/kb/1594-ai-seo-metrics
- Semrush own case via PPC Land: https://ppc.land/semrush-triples-ai-visibility-in-one-month-with-systematic-optimization/
- SE Ranking ChatGPT citation factors: https://seranking.com/blog/how-to-optimize-for-chatgpt/
- SE Ranking AI Mode volatility: https://seranking.com/blog/ai-mode-research/
- SE Visible local: https://visible.seranking.com/local-ai-visibility/
- Profound citation patterns: https://www.tryprofound.com/blog/ai-platform-citation-patterns
- Profound once-a-day study: https://www.tryprofound.com/blog/is-once-a-day-enough
- Profound metric definitions: https://help.tryprofound.com/articles/3443229936-answer-engine-insights-overview
- Evertune sample size: https://www.evertune.ai/resources/insights-on-ai/the-geo-opportunities-that-small-prompt-samples-miss
- Gumshoe methodology: https://gumshoe.ai/resources/gumshoe-methodology/
- cloro.dev sample size: https://cloro.dev/blog/ai-visibility-sample-size/
- Yext 86% brand-managed: https://www.yext.com/blog/ai-citations-86-percent-of-sources-are-brand-managed
- Seer AIO CTR: https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-september-2025-update
- Similarweb gen-AI stats: https://aisearch.similarweb.com/blog/gen-ai-stats/
- Similarweb definitions: https://aisearch.similarweb.com/blog/track-ai-visibility/
- Adobe AI retail traffic via Digital Commerce 360: https://www.digitalcommerce360.com/2026/06/17/adobe-ai-referred-traffic-to-retail-sites-doubles-in-a-year/
- Visibility Labs / 180 Marketing conversion: https://www.180marketing.com/chatgpt-vs-organic-search-conversion-rates/
- Goodie AI traffic report: https://higoodie.com/blog/ai-search-traffic-report-2026/
- Pew Americans and AI 2026: https://www.pewresearch.org/internet/2026/06/17/
- Bain zero-click: https://www.bain.com/insights/goodbye-clicks-hello-ai-zero-click-search-redefines-marketing/
- Conductor benchmarks (snippet): https://www.conductor.com/academy/aeo-geo-benchmarks-report/

**Local**
- BrightLocal LCRS 2026 (snippet, primary blocked): https://www.brightlocal.com/research/lcrs-ai-trust/
- BrightLocal listings sources (snippet): https://www.brightlocal.com/blog/ai-search-using-listings-sources/
- Whitespark AIO in local search: https://whitespark.ca/blog/case-study-the-prevalence-of-ai-overviews-in-local-search/
- Whitespark 2026 Local Search Ranking Factors: https://whitespark.ca/local-search-ranking-factors/
- SOCi Local Visibility Index: https://www.soci.ai/blog/the-challenge-of-ai-visibility-for-brands-part-1/
- Local Falcon research index: https://www.localfalcon.com/research
- Local Falcon ChatGPT tracking: https://www.localfalcon.com/features/chatgpt
- Sanbi geographic variance (snippet): https://sanbi.ai/blog/ai-answers-change-by-location-geographic-dominance

**Attribution methods and case studies**
- SearchPilot math: https://www.searchpilot.com/resources/blog/the-math-behind-searchpilot-how-seo-a/b-testing-actually-works
- CausalImpact for SEO: https://www.jcchouinard.com/causalimpact-for-seo/
- AI crawler log study: https://dev.to/achiya-automation/i-logged-every-ai-crawler-for-34-days-chatgpt-outreads-googlebot-369o
- GSC generative AI reports: https://www.searchenginejournal.com/google-search-console-ai-reports-rolled-out-worldwide/587836/
- Go Fish Digital case: https://gofishdigital.com/blog/generative-engine-optimization-geo-case-study-driving-leads/
- HubSpot AEO case roundup: https://blog.hubspot.com/marketing/answer-engine-optimization-case-studies
- Presenc.ai agency case: https://presenc.ai/research/ai-visibility-case-study-agency
- Search Engine Land fake brand experiment: https://searchengineland.com/fake-brand-ai-search-experiment-475947
- Search Engine Land 4 experiments: https://searchengineland.com/what-4-ai-search-experiments-reveal-about-attribution-and-buying-decisions-468702
- Otterly schema experiment (snippet, TLS error): https://otterly.ai/blog/schema-markup-real-impact-ai-search/

## Appendix B: Internal data pulled

Read-only queries against `/data/lumidian.db` on 2026-09-10 via `railway ssh`. Tables: `tracking_runs`, `query_results`, `content_drafts`, `draft_attributions`, `citation_sources`, `prompts`. Analysis scripts are in the session scratchpad, not committed. Weekly per-prompt, per-model mention-rate table is reproducible from `query_results` joined to `tracking_runs` grouped by `strftime('%Y-%W', started_at)`.
