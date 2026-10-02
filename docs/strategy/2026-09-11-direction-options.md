# Lumidian direction options, September 2026

**Date:** 2026-09-11
**Status:** Options and a recommendation. Nothing decided.
**What Ken said:** the agency direction is blurred, not fun, and not what he started Lumidian to do. He wants to build software, possibly an app, with hard structure. Explore everything.

Evidence in this doc comes from pages fetched on 2026-09-10 and 2026-09-11 (pricing pages, product pages, GitHub, Product Hunt) plus the studies gathered in `docs/strategy/research/2026-09-10-agency-landscape-evidence-attribution.md`. Items I could not verify are marked as such.

---

## 1. What you have to build with

| Asset | State | Reusable for |
|---|---|---|
| Multi-engine sampler | ChatGPT with web search, Gemini grounded, Perplexity, Claude with web search; N runs per prompt; concurrency guards; cancel | Everything below |
| Mention detection + RVI | Substring and fuzzy matching, peer-pool relative index, contested/owned segmentation | Tracker, index ranking |
| Citation extraction | Every URL each engine cited, classified own / competitor / third party | Source maps, "what AI reads" pages |
| Site audit crawler | Sitemap and BFS crawl, Playwright render check, five parsers, findings, fix artifacts | "Why the AI can't read you" diagnostic |
| Content engine | Briefs, evidence packs, anti-AI writing gate, owned-site generator | Service-page generator (keep small) |
| Prospect audit PDF, Typst reports | Working | Claim upsell, weekly report card |
| Auth, billing, teams, notifications, Railway deploy | Working | Any SaaS |
| Research | Measurement science (how many runs, CIs), what AI cites, local evidence | Methodology page, credibility |

Cost to sample, verified on the pricing pages on 2026-09-11:

| Engine | Per query | Note |
|---|---|---|
| ChatGPT gpt-4o-mini + web search | about $0.012 | $10 per 1k tool calls plus an 8k-token block |
| Gemini 2.5 Flash grounded | about $0.037 | $35 per 1k grounded prompts; 500 per day free |
| Perplexity sonar, medium context | about $0.010 | $8 per 1k requests plus tokens |
| Claude Haiku + web search | about $0.02 | $10 per 1k searches plus tokens |

One prompt sampled five times on three engines costs about $0.30. One city with 100 categories and 3 prompt shapes is 300 prompts, about $90 per sweep. Fifty metros is about $4,500 per sweep. This is what makes a public index affordable for a solo founder.

---

## 2. The candidates

### A. Public "what AI recommends" index, with claim-your-listing

A public website (and app) where anyone can browse what ChatGPT, Gemini and Perplexity recommend for any category in any city, sampled repeatedly, with agreement between engines, confidence, the sources each engine read, and the date. Every business named gets a page. A business claims its page and pays for daily tracking, its own prompts, the source map, and accuracy alerts.

What exists: nothing consumer-facing was found. Evertune, Ahrefs Brand Radar, Semrush and Local Falcon all sell B2B dashboards or gated reports. HubSpot's free AEO Grader is per business, not browsable. Scope.online sells a $25 to $79 self-serve tracker to 5,000 local businesses (self-reported), which proves the paid tier. Nobody publishes browsable city-by-category pages with methodology.

Why it is fun: it is a data product with a public face. Every page is a small piece of journalism ("ChatGPT's favorite taco shop in Pacific Beach, sampled 15 times this week"). It has a consumer side, an owner side, and an app with push notifications.

Why now: 45% of US consumers used AI to find a local business this year (BrightLocal), and only 1.2% of locations are recommended by ChatGPT (SOCi). Owners do not know where they stand and there is no public record.

Risks: businesses ranked low may complain (mitigate by publishing dated quotes and methodology, never opinion); entity resolution (which business did the AI name) is new work; scale cost if you sweep too many cities too early; will owners pay to influence a ranking they cannot directly control (Scope says yes at $25 to $79).

### B. AI accuracy alerts for small businesses

"Google Alerts for AI answers." The owner fills in a fact sheet (hours, address, phone, prices, halal, open or closed). The tracker samples the engines and diffs what they say against the sheet. Push or email: "Gemini says you close at 7 on Sundays. You close at 9." "Perplexity stopped naming you for 'best shawarma in PB' this week."

What exists: Bluefish shipped "AI Accuracy" for Fortune 500 in May 2026, no public price. Waikay has a Fact Tracker at $69.95 a month aimed at brand managers, with a $24.95 early-adopter tier. Nothing under $100 aimed at a single-location business. Legal backdrop: defamation suits over AI answers (Walters v. OpenAI, Wolf River Electric v. Google) show the pain is real.

Why it is fun: it is a clear, small, useful app with a notification at its heart. The Pitenin census found AI recommending 93 defunct venues; owners will feel this.

Risks: on its own it has no distribution; the price ceiling is low; it needs A to find customers.

### C. Sampling API and MCP server

Expose the engine: send a prompt, N runs, engines; get mention rates with intervals and cited URLs. Usage priced.

What exists: Gumshoe $99 to $299 a month with a read API on Pro; Profound and Scrunch gate their APIs to Enterprise; LLMrefs $79 with API included; AmICited and Knowatoa ship MCP servers. GitHub trackers top out at 255 stars (geo-aeo-tracker). No usage-priced per-call sampling API with confidence intervals exists.

Why it is fun: pure developer product, small surface, honest math.

Risks: demand is modest and price pressure is severe. A second revenue line, not a business.

### D. Multi-AI "second opinion" consumer app

Ask one question, get answers from several assistants merged into an agreement and disagreement view with sources.

What exists: ChatHub has 200k to 300k users at $19 to $39 a month, Mammouth from EUR 10, Poe. All show side-by-side panes; none merge answers. Consensus.app proves people pay for synthesized answers, in science only.

Why it is fun: it is a consumer app.

Risks: per-query API cost on free users, incumbents at $10 to $19, no edge from your assets, and OpenAI or Google can ship it natively any week. The merged-answer idea survives better as the presentation layer of A than as a chatbot.

### E. Self-serve local tracker with a free scanner

The Scope.online model: free 60-second "what does AI say about you" scan, then $25 to $79 a month. Same paid tier as A without the public pages.

What exists: Scope (5,000 businesses claimed), HubSpot AEO Grader to a $50 product, Knowatoa $59, LLMrefs $79, Gumshoe $99. Crowded at $50 to $99. No one generates city-level prompt sets automatically.

Risks: without the public pages you are one more scanner competing on ads and SEO against HubSpot.

### F. Keep the local agency

Covered in the previous two docs. It is a service business, it tops out around $10k a month solo, and Ken does not want to run it.

---

## 3. Scorecard

1 is worst, 5 is best. "Reuse" is how much existing code carries over. "Gap" is how empty the space is.

| | Fun to build | Reuse | Demand evidence | Gap | Path to $10k MRR | Solo feasible | Cost risk |
|---|---|---|---|---|---|---|---|
| A. Public index + claim | 5 | 4 | 4 | 5 | 4 | 4 | 3 |
| B. Accuracy alerts | 4 | 4 | 3 | 5 | 2 alone, 4 inside A | 5 | 5 |
| C. Sampling API | 3 | 5 | 2 | 4 | 2 | 5 | 5 |
| D. Second-opinion app | 4 | 2 | 3 | 3 | 2 | 3 | 2 |
| E. Scanner + tracker | 2 | 5 | 4 | 2 | 3 | 5 | 4 |
| F. Agency | 1 | 3 | 3 | 3 | 3 | 3 | 5 |

A, B and E are the same product seen from three sides. A is the front door, E is the paid tier, B is the retention feature. C is an add-on you can ship in a week once A exists. D is a different company.

---

## 4. Recommendation: build the index

Working name: keep Lumidian. The product in one sentence: **the public record of what AI recommends, by city and category, and the tool a business uses to get on it.**

### 4.1 The product

**Public pages (free, no login).**
- City hub: /san-diego. Category page: /san-diego/dentists. Business page: /san-diego/dentists/akhis-authentic-shawarma-kebab (category-appropriate).
- Category page shows: the businesses each engine named, ranked by recommendation rate across the sample, with per-engine bars, an agreement score (how many engines agree), a confidence band, the prompts used, the sources each engine read (grouped by domain), quotes with dates, and "last sampled". Three prompt shapes per category: discovery ("best X in city"), question ("is X worth it in city" or "how much does X cost in city"), and comparison.
- Business page shows: recommendation rate per engine over time, the prompts it appears for, what the AI says about it (quotes), which sources mention it, and a "claim this page" button.
- Methodology page already exists. Every number links to it.

**Owner side (paid).**
- Claim: $29 a month. Daily sampling of the category prompts plus 10 custom prompts, the source map with presence marked, accuracy alerts from an owner fact sheet, a weekly report card, a share card and an embeddable badge ("Recommended by Gemini for shawarma in Pacific Beach, 12 of 15 samples, Sep 2026").
- Pro: $79. Three locations, 30 prompts, competitor set, site audit with the fix list.
- Agency: $199. Ten businesses, white-label report card, API.
- Prices sit where Scope has proven demand. Raise later.

**App.** A small mobile app (Expo or a PWA) for owners: push notifications from the alerts, the weekly report card, the share card. This is the "app" you wanted and it has a reason to exist: owners do not open dashboards, they open notifications.

**Consumer side.** The public pages are the consumer product. If they get traffic, a "near me" app view is a thin layer on the same data. Do not build a chatbot.

### 4.2 Why this is defensible

- The data compounds. Every sweep adds history nobody else has, per city, per engine, dated.
- The pages become sources. Semrush's 248k-URL study found AI cites small, specific, factual pages. A neutral, dated, methodology-backed page about "what AI recommends for dentists in Scottsdale" is exactly that. This is the legitimate version of the "publish our own lists" idea: everyone is listed, ownership is disclosed, and the content is data.
- The measurement science you already gathered is the credibility layer. Show intervals; show disagreement; show the noise. The critics say nobody does this. Do it in public.
- Distribution is built in: programmatic pages for search, share cards for owners, and local press ("ChatGPT's picks in Pacific Beach, by the numbers").

### 4.3 Unit economics

| Item | Number |
|---|---|
| Sweep cost, one city, 300 prompts, 5 runs, 3 engines | about $90 |
| Weekly sweep, one city | about $360 a month |
| Monthly sweep, 50 metros | about $4,500 a month |
| Claimed business, daily on 13 prompts, 3 runs, 3 engines | about $2.30 a month |
| Gross margin on a $29 claim | above 90% |
| Break-even on a 50-metro monthly sweep | about 160 claims |
| $10k MRR | about 300 claims at a $35 blend, or 200 claims plus 20 agency seats |

Start with San Diego only. Expand a metro when the previous one has 10 claims or 2,000 monthly visitors.

### 4.4 What is new engineering

Most of the stack carries over. The new pieces:

1. **Entity extraction and resolution.** For each response, extract the list of businesses named (one cheap LLM call), normalize names, and resolve them to a canonical business (Serper site-restricted search or Google Places text search, about $17 per 1,000). Cluster across runs. This is the core new component and the hardest.
2. **Prompt template engine.** Category by city by intent, with a curated category list (start with the 100 categories that matter locally).
3. **Public site.** Static-ish Next.js pages generated from the index, with sitemaps and structured data. Cache hard.
4. **Claim flow.** Email or phone verification against the listed business, Stripe, then the existing brand dashboard scoped to the claimed entity.
5. **Fact sheet and diff.** Owner fields; an LLM judge compares each response to the sheet and emits alerts; notification pipeline already exists.
6. **Share card and badge.** Image generation from the report data.
7. **Mobile shell.** Expo app or PWA wrapping the owner views with push.

Things to remove or shelve: cluster content generation for Medium, LinkedIn, X, Wikipedia; the agency cockpit beyond a report export; pitch brands.

---

## 5. Ninety-day build plan

Ship in public from week 4. Every milestone has a number attached.

**Weeks 1 to 2: the index engine.**
- Category list (100), prompt templates (3 shapes), San Diego neighborhoods as city variants where it matters (Pacific Beach, La Jolla, North Park, downtown).
- Entity extraction and resolution on existing MSC and Akhis responses first, then a 300-prompt San Diego sweep at 5 runs.
- Output: a table of businesses by category with per-engine recommendation rates and cited sources. Milestone: the Pacific Beach shawarma page is correct by hand inspection, including Akhis under both spellings.

**Weeks 3 to 4: the public site.**
- City hub, category pages, business pages, methodology links, sitemaps, share images.
- Milestone: 100 category pages and 1,500+ business pages live for San Diego; Search Console verified; first sweep dated on every page.

**Weeks 5 to 6: claim and pay.**
- Claim flow, Stripe, the owner dashboard scoped to the entity, custom prompts, daily sampling for claimed businesses, source map with presence marks.
- Milestone: Akhis claims for free as the first listing. Five San Diego businesses that rank number one get a free claim by outreach, in exchange for feedback.

**Weeks 7 to 8: alerts and the app.**
- Fact sheet, diff judge, alert rules (dropped from a prompt, wrong hours, wrong price, competitor overtook you), email and push.
- Expo app or PWA with push and the weekly report card.
- Milestone: first alert delivered to a real owner's phone.

**Weeks 9 to 10: distribution.**
- Share card and badge for claimed businesses. A "San Diego by the numbers" post for local press and Reddit (data, everyone included). Outreach to the 100 businesses that rank first in their category ("you're number one, claim it").
- Second and third metros: Los Angeles and Phoenix.
- Milestone: 2,000 monthly visitors, 10 paying claims.

**Weeks 11 to 12: agency tier and API.**
- Ten-business plan, white-label report card, the sampling endpoint as a read API on Pro and Agency.
- Milestone: 25 paying claims or 2 agency seats; a written decision on the next 5 metros.

**Day-90 decision rule.** Continue if visitors are above 2,000 a month and paying claims are above 20 and growing. If pages get traffic but nobody claims, sell the data (agency tier, API, sponsorships) instead. If pages get no traffic, the index is not the front door and the product falls back to E with B as the hook.

---

## 6. What happens to what exists

- **MSC** stays on the SaaS as is. The index adds a "Reg A+ advisors" category page for free, which is a nice thing to show Afzal.
- **Akhis** becomes the first claimed listing, free, and the test of the claim flow and the alerts. The presence work from the pilot plan still helps him and takes a few hours; do it only as far as it teaches you what the product should automate.
- **Agency GTM plan** is parked. The agency tier of the product is how agencies get served.
- **Content engine** shrinks to the service-page generator inside the claim dashboard.

---

## 7. Honest counterpoints

- You will be publishing rankings of real businesses. Some will be angry. Publish quotes with dates and a methodology, never editorialize, and offer a free claim to anyone who asks. This is what Yelp and Glassdoor live with.
- Entity resolution will be messy for months. Ship with "possible match" states and let owners correct it at claim time.
- Programmatic SEO takes months to index and ranks slowly. Share cards and local press are the faster loop; do not wait for Google.
- Scope, HubSpot and Gumshoe could add public pages. Your edge is being first with data history and being the honest one about noise. Move fast on the public side.
- This is still adjacent to AI visibility. If the real problem is that the whole topic bores you now, none of A to E fixes that, and the answer is a different company. Say so if that is the case.
