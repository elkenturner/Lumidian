# Stream 2 — Platform Research: Does Medium Get Cited by AI Answer Engines?

**Research question:** As of 2026, do AI answer engines cite Medium articles, and how? Does Medium's domain authority help, or do models prefer original/owned domains over republished Medium content? What article traits correlate with citation? Is publishing on Medium **better or worse** than publishing the same content on an owned domain for AI citation specifically? Does Medium's paywall/metering affect crawlability?

**Date of research pass:** 2026-06-03
**Internal context being tested:** Lumidian's own production data (B2B finance vertical) shows ZERO Medium citations across ChatGPT and Perplexity; models instead cite owned/authority domains and Wikipedia.

---

## TL;DR / Bottom Line

For Lumidian's use case (**B2B finance, getting cited in ChatGPT + Perplexity answers**), the external evidence supports the production-data signal: **publishing on an owned/authority domain is generally as good or better than Medium, and Medium is a weak-to-irrelevant citation channel specifically in finance.** Medium *is* cited by AI engines in aggregate (it is a "tier-2" source, ~5.9% of citations in *unbranded* B2B queries), but its strength is concentrated in **developer/technical verticals (dev.to, GitHub, Medium cluster)**, not finance — where comparison/authority sites (NerdWallet, Bankrate) and Wikipedia dominate ([Foundation, Dec 2025–Feb 2026](https://foundationinc.co/lab/ai-citation-b2b-saas)). The single biggest documented citation lever is **third-party distribution to news/authority outlets** (+325% citation lift), *not* Medium republishing ([Stacker/Scrunch, Dec 9 2025](https://stacker.com/blog/how-earned-media-distribution-expands-ai-visibility-first-look-at-citation-lift)).

**Verdict: For AI citation in B2B finance, an owned/authority domain is BETTER than Medium for content you control; earned placement on third-party *news/industry* outlets beats both. Medium is, at best, a low-priority secondary channel and a poor fit for this vertical.** `[supported inference — see conflicts section]`

---

## 1. Do AI answer engines cite Medium at all? (Yes, but it is mid-tier and concentrated)

**Yes — Medium appears in AI citations, but as a secondary/"tier-2" source whose share is reportedly declining.**

- Contently's roundup of five vendor studies (Peec AI, SEMrush, Profound, Spotlight, SE Ranking) ranks Medium at **#9, a "tier-2 citation source" with declining share**, noting it "has lost share to Reddit and LinkedIn in 2025-2026, but remains a viable secondary publication channel." ([Contently, Apr 29 2026](https://contently.com/2026/04/29/top-sources-llms-cite/))
- **Medium does NOT appear in the top 10 most-cited domains** across ChatGPT/Perplexity/Gemini/Google AI in LLM Pulse's 28-day rolling window (top 10 are youtube 23.3%, reddit 20.4%, google 10.8%, instagram, facebook, linkedin 4.4%, tiktok, apple, wikipedia 2.35%, elpais). ([LLM Pulse, data through Jun 2 2026](https://llmpulse.ai/data-studies/top-cited-domains))
- In the largest vertical-specific study found (Foundation: **57.2M citations, 5.1M AI responses, 50 B2B brands, 5 platforms, Dec 2025–Feb 2026**), Medium reaches **5.9% of citations in *unbranded* B2B queries** but does **not** crack the top tier in branded queries. Reddit (28–31%), YouTube (15–20%), LinkedIn (8–15%), and Wikipedia (6.8%) lead. ([Foundation, Dec 2025–Feb 2026](https://foundationinc.co/lab/ai-citation-b2b-saas))

### CONFLICT — Medium's trend direction
- Contently and Foundation both frame Medium as **mid-tier / declining share.** ([Contently](https://contently.com/2026/04/29/top-sources-llms-cite/))
- An earlier WebSearch summary attributed to **AuthorityTech** a claim that Medium had **626 AI citations in 30 days (up +482), #2 behind PR Newswire (799)**, framing Medium as a rising "citation vehicle." **`[unverified inference]`** — When I fetched the AuthorityTech article directly, it contained **no such Medium citation-count data** ([AuthorityTech, 2026](https://authoritytech.io/curated/how-ai-answer-engines-choose-sources-to-cite-2026)). The "626 citations" figure could not be verified at source and conflicts with the broader picture; **treat it as unreliable.**

**Takeaway:** Medium is cited, but it is not a top-tier domain and the strongest independent sources call its share flat-to-declining.

---

## 2. Vertical matters: Medium is strong in DEV, weak in FINANCE

This is the most decision-relevant finding for Lumidian and it directly corroborates the production data.

- Foundation found **distinct per-vertical citation "fingerprints"** ([Foundation, Dec 2025–Feb 2026](https://foundationinc.co/lab/ai-citation-b2b-saas)):
  - **DevOps & Security:** developer platforms — **GitHub, Medium, dev.to — dominate.**
  - **Fintech:** **comparison sites (NerdWallet, Bankrate)** heavily influence citations. Medium is *not* called out as a fintech driver.
  - **Healthcare:** institutional sources (PubMed, Mayo Clinic).
- SearchEngineLand's fintech AI guide similarly emphasizes **comparison/affiliate sites (NerdWallet, Bankrate)** and a "trust-first" pattern for finance, not Medium. ([SearchEngineLand fintech guide, 2026](https://searchengineland.com/guide/fintech-ai); [Urban Geko fintech AI guide, 2026](https://www.urbangekodesign.com/industries/fintech/ai-search-optimization-fintech/))

**Takeaway:** Lumidian's zero-Medium / authority+Wikipedia result for B2B finance **generalizes.** Medium's citation strength lives in technical/developer content. For finance, models prefer authority/comparison domains and Wikipedia — exactly what Lumidian observed.

---

## 3. Owned domain vs Medium / republished content — does domain authority help?

Two distinct sub-questions; the evidence pulls in different directions depending on *what* the third party is.

### 3a. The "earned/syndicated beats owned" finding — but it's about NEWS outlets, not Medium
- **Stacker/Scrunch citation-lift study (Dec 9 2025):** 8 articles, **944 prompt-platform combinations, ~189 prompts, 5 LLM platforms.** Same story in two formats — brand-only vs distributed across "hundreds of third-party news outlets" with canonical tags to the original:
  - Brand-only citation rate: **7.6%**
  - Syndicated-only: **19.2%** (cited the third-party copy and **NOT** the brand original)
  - Co-citation: 8.3%; total with distribution ~34%
  - Net: **+325% citation lift** from distribution. ([Stacker/Scrunch, Dec 9 2025](https://stacker.com/blog/how-earned-media-distribution-expands-ai-visibility-first-look-at-citation-lift))
- Corroborating framing: "AI Overviews are **6.5x more likely** to cite content through third-party sources than a brand's own domain"; in ~**1 in 5 answers AI cited the third-party version and not the brand original.** Models weight **independent corroboration over self-assertion.** ([Machine Relations research summary, 2026](https://machinerelations.ai/research/earned-vs-owned-ai-citation-rates-2026); [Stacker](https://stacker.com/blog/how-earned-media-distribution-expands-ai-visibility-first-look-at-citation-lift))

**Critical nuance:** This lift comes from distribution to **news/industry publications** (earned media with their own authority), **NOT from Medium.** Medium is a self-publish platform where the *author* asserts content — it does **not** confer independent third-party corroboration the way a news outlet does. So the "earned beats owned" finding is **not** an argument for Medium; it's an argument for PR/news syndication. `[supported inference]`

### 3b. Canonical tags don't reliably steer AI to the original
- AI systems "analyze patterns of information rather than relying on canonical tags." Even with a canonical pointing to your owned post, "AI overviews and chat-style answers may still quote or link to the syndication partner" if the partner has stronger authority/citation history. ([Machine Relations, 2026](https://machinerelations.ai/research/earned-vs-owned-ai-citation-rates-2026); [Single Grain on canonical + LLMs, 2026](https://www.singlegrain.com/marketing-strategy/the-impact-of-canonical-tags-on-ai-content-selection/); [Siteimprove, 2026](https://www.siteimprove.com/blog/canonical-urls-for-ai-retrieval/))

**Implication for Medium republishing:** If you republish owned content on Medium with a canonical tag, AI may cite the **Medium copy instead of your owned domain** — meaning Medium can *cannibalize* the citation rather than reinforce your owned URL, **without** the corroboration benefit that a true news outlet provides. This is a downside specific to self-publish syndication. `[supported inference]`

### 3c. Brand-owned content is a minority of citations regardless
- Foundation: brand-owned content was "only a small fraction" of citations; **only ~2% of AI citations pointed to the brands themselves.** ~75% lived on third-party domains in Contently's framing. ([Foundation](https://foundationinc.co/lab/ai-citation-b2b-saas); [Contently](https://contently.com/2026/04/29/top-sources-llms-cite/))

**Takeaway on owned vs Medium:** For content **you control and want cited**, an owned/authority domain is at least as good as Medium and avoids canonical cannibalization. Medium does **not** give you the independent-corroboration boost that drives the documented citation lift — that boost requires genuine third-party *news/industry* placement. So **owned > Medium** for controlled content, and **earned news > both.** `[supported inference]`

---

## 4. What article traits correlate with being cited?

Strong convergence across sources: **structure, extractability, freshness, and demonstrated expertise — NOT length, NOT visual formatting.**

| Trait | Effect on citation | Source |
|---|---|---|
| **Topic relevance** | Dominant factor (odds ratio >>10,000) | [arXiv 2605.25517, May 25 2026](https://arxiv.org/html/2605.25517v1) |
| **Explicit pricing / concrete specifics** | Strong positive | [arXiv, May 2026](https://arxiv.org/html/2605.25517v1) |
| **Recency / fresh timestamp** | Strong positive | [arXiv](https://arxiv.org/html/2605.25517v1); [LLM Pulse / Perplexity favors <12mo content](https://llmpulse.ai/data-studies/top-cited-domains) |
| **List/first position in context** | Strong positive | [arXiv](https://arxiv.org/html/2605.25517v1) |
| **Evidence-backed, confident (not hedged) claims** | Positive (OR 2–243) | [arXiv](https://arxiv.org/html/2605.25517v1) |
| **Clear H2/H3 heading hierarchy + short answer block** | Positive — models map structure via headings; 100–300 word extractable passages favored | [Foundation](https://foundationinc.co/lab/ai-citation-b2b-saas); WebSearch synthesis of [whyshy](https://www.whyshy.co/blog/short-or-long-the-truth-about-content-length-and-ai-overview-citations) / [Ahrefs](https://ahrefs.com/blog/short-vs-long-content-in-ai-overviews/) |
| **Author expertise / E-E-A-T (first-hand experience)** | Positive — "300-word insight from a verified expert cited over a 3,000-word article by a non-expert" | WebSearch synthesis (vendor consensus); not isolated in controlled study `[weakly sourced]` |
| **Word count / length** | **Near-zero correlation** (Spearman ~0.04); >53% of cited pages <1,000 words. ChatGPT mildly favors length; AI Overviews indifferent | [Ahrefs](https://ahrefs.com/blog/short-vs-long-content-in-ai-overviews/); WebSearch synthesis |
| **Formatting / visual organization** | **Negligible** in controlled test | [arXiv, May 2026](https://arxiv.org/html/2605.25517v1) |

### Important caveat on the controlled study
The **arXiv 2605.25517** paper (252,000 trials, 18 factors, 6 LLMs, May 25 2026) is the strongest *causal* evidence here, but it used a **two-document RAG testbed** (injects exactly 2 sources) and explicitly states this is **non-generalizable** to real retrieval where 5–10+ pages compete. It tested **content factors with fictionalized brands/publishers — it did NOT test Medium or domain type at all.** ([arXiv, May 25 2026](https://arxiv.org/html/2605.25517v1)) So it tells us *which traits* matter, not *which domain wins.*

### CONFLICT — content length
- Some vendors claim "longer content tends to perform better" / "ChatGPT rewards longer content." ([Zyppy synthesis](https://signal.zyppy.com/p/ai-citation-ranking-factors))
- Stronger data (Ahrefs, whyshy) shows **near-zero length correlation** and most cited pages **under 1,000 words.** ([Ahrefs](https://ahrefs.com/blog/short-vs-long-content-in-ai-overviews/))
- **Resolution:** Length is not a driver; **extractability of self-contained passages** is. Write for extractability, not length.

---

## 5. Does Medium's paywall / metering hurt crawlability?

**Mostly NO for crawl-access, but with caveats.** Verified directly from Medium's live robots.txt.

- **Medium's `robots.txt` explicitly ALLOWS the major AI crawlers `GPTBot` and `ClaudeBot`** (with path-level allows for `/about`, `/business`, `/earn`, etc., and disallows only on edit/share/search endpoints — not article-read paths). ([medium.com/robots.txt, fetched 2026-06-03](https://medium.com/robots.txt))
  - **Not explicitly listed:** `OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Google-Extended`, `CCBot`. `[unverified inference]` — absence from explicit rules typically means they fall under default/`*` handling; I could not fully resolve the wildcard default block-vs-allow interaction for these search-citation bots from the fetch. This is a gap worth a direct re-check, because **OAI-SearchBot and Claude-SearchBot/Perplexity are the live-citation crawlers that actually matter for AI answers** (training bots GPTBot/ClaudeBot mainly affect training corpora). ([No Hacks AI user-agent reference, 2026](https://nohacks.co/blog/ai-user-agents-landscape-2026); [Mersel AI, 2026](https://www.mersel.ai/blog/how-to-block-or-allow-ai-bots-on-your-website))
- **Training vs citation is now two separate decisions** industry-wide: OpenAI/Anthropic/Google split bots into training-only (GPTBot, ClaudeBot, Google-Extended) vs live-citation (OAI-SearchBot, Claude-User/SearchBot, Googlebot). Allowing one does not allow the other. ([Coronium "Closing Web 2026"](https://www.coronium.io/blog/closing-web-ai-crawler-blocking-pay-per-crawl-2026); [AgentSurge](https://agentsurge.io/blog/ai-crawler-user-agents))
- **Metered paywalls generally remain crawlable:** standard metered/registration walls still let Google and AI crawl/index full pages; many bots also read raw HTML beneath JS paywalls. ([Leaky Paywall, 2026](https://leakypaywall.com/protecting-content-from-ai-circumvention-with-smart-paywalls/); WebSearch synthesis)

**Takeaway:** Medium's paywall is **not** the reason Lumidian sees zero Medium finance citations — Medium permits training crawlers and metered content is generally crawlable. The zero-result is better explained by **vertical fit (finance favors authority/comparison/Wikipedia, not Medium)** and Medium's mid-tier, declining standing. The one open risk is whether Medium lets the **live-citation search bots** (OAI-SearchBot, PerplexityBot) through — worth a direct verification. `[partially unverified]`

---

## 6. Source quality & staleness audit

| Source | Type | Date | Strength | Notes |
|---|---|---|---|---|
| [arXiv 2605.25517](https://arxiv.org/html/2605.25517v1) | Controlled academic study, 252k trials | May 25 2026 | **High (causal)** but 2-doc testbed, non-generalizable; doesn't test Medium/domain | Fresh |
| [Foundation B2B SaaS](https://foundationinc.co/lab/ai-citation-b2b-saas) | Large observational, 57.2M citations | Dec 2025–Feb 2026 | **High** for vertical patterns | Fresh; vendor but big sample |
| [Stacker/Scrunch citation lift](https://stacker.com/blog/how-earned-media-distribution-expands-ai-visibility-first-look-at-citation-lift) | A/B-style distribution test, 944 combos | Dec 9 2025 | **Medium-high**; small article N (8) | ~6mo old |
| [Machine Relations](https://machinerelations.ai/research/earned-vs-owned-ai-citation-rates-2026) | Meta-summary (cites xFunnel 40k responses, Moz 40k queries) | 2026 | Medium | Aggregator |
| [LLM Pulse top domains](https://llmpulse.ai/data-studies/top-cited-domains) | Live tracker, 28-day window | Jun 2 2026 | Medium-high | Very fresh |
| [Contently](https://contently.com/2026/04/29/top-sources-llms-cite/) | Roundup of 5 vendor studies | Apr 29 2026 | Medium | Secondary |
| [medium.com/robots.txt](https://medium.com/robots.txt) | Primary artifact | Live (2026-06-03) | **High** for crawl rules | Direct |
| [AuthorityTech](https://authoritytech.io/curated/how-ai-answer-engines-choose-sources-to-cite-2026) | Vendor blog | 2026 | **Low** — "Medium 626 citations" claim NOT found at source | Flagged unreliable |
| Ahrefs / whyshy (length) | Vendor analyses | 2026 | Medium | Convergent |

**Staleness flags:** Nothing critical is older than ~12 months. Crawler-policy details (robots.txt, bot splits) change fast — re-verify Medium's live-citation-bot access before acting. AI citation distributions shift monthly (LLM Pulse is a rolling window), so treat specific percentages as directional, not fixed.

---

## 7. Recommendations for Lumidian (AIO content strategy)

1. **Deprioritize Medium for B2B finance.** Production data + Foundation's vertical fingerprints agree: finance citations go to authority/comparison domains and Wikipedia, not Medium. `[supported]`
2. **Prefer owned/authority domains for content you control.** Avoids canonical cannibalization; owned ≥ Medium for controlled content. `[supported inference]`
3. **The real lever is earned third-party distribution to *news/industry* outlets (+325% lift), not Medium republishing.** Medium does not provide independent corroboration. `[supported]`
4. **Keep investing in Wikipedia** (already a top authority source for finance; matches Lumidian's own Wikipedia surface). `[supported]`
5. **Optimize traits, not length:** topic-tight, fresh-dated, structured H2/H3, short extractable answer blocks (100–300 words), concrete numbers/pricing, confident evidence-backed claims, visible author expertise. `[supported]`
6. **If Medium is used at all,** reserve it for technical/developer-adjacent content where its citation strength concentrates — minimal relevance to finance. `[supported]`
7. **Open verification item:** confirm whether Medium's robots.txt admits live-citation bots (OAI-SearchBot, PerplexityBot, Claude-SearchBot), not just training bots — this determines whether Medium content can even surface in live AI answers. `[unverified]`
