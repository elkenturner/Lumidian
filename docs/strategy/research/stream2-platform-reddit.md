# Stream 2 — Platform Research: Reddit as an AI Citation Source (2026)

**Research date:** 2026-06-03
**Author:** Internal AIO research pass (Lumidian)
**Scope:** How often and how ChatGPT, Claude, Perplexity, and Gemini cite Reddit; the September 2025 ChatGPT downweight; licensing deals (Google / OpenAI / others); what kind of Reddit content gets cited; and whether Reddit's AI-citation value is rising or falling and how it varies by vertical (consumer vs B2B/finance).

> **Source quality note:** The strongest evidence comes from three large-N citation panels — **Profound** (680M–4B citations, multi-engine), **Ahrefs** (1.4M ChatGPT prompts, retrieval *and* citation logging), and **Semrush** (217K prompts / 248K Reddit URLs). These are the closest things to controlled GEO studies. Much of the surrounding commentary is vendor SEO blogspam re-reporting those three panels; I have tried to trace claims back to the panels and flag where a number is only a vendor restatement. Citation share is **volatile on a weekly basis** — treat any single percentage as a snapshot, not a constant.

---

## TL;DR for Lumidian's "0% Reddit citations" finding

**The external evidence SUPPORTS Lumidian's production observation that Reddit citations are effectively absent in its B2B-finance data — it does not contradict it.** Three independent mechanisms converge to make near-zero Reddit citations the *expected* outcome for a B2B/finance vertical on ChatGPT + Perplexity in 2026:

1. **ChatGPT retrieves Reddit constantly but almost never cites it.** Ahrefs (1.4M prompts) found Reddit pages are *cited only 1.93% of the times they are retrieved*, and 67.8% of all retrieved-but-uncited pages were Reddit. So Reddit can be shaping ChatGPT's answer with **zero visible citation** — exactly the pattern Lumidian's citation extractor would log as "0 Reddit." [Ahrefs via SEJ, 2026-04-16](https://www.searchenginejournal.com/chatgpt-often-retrieves-but-rarely-cites-reddit-pages-data-shows/572243/)
2. **The Sept 2025 ChatGPT collapse was real** — Reddit's *visible* ChatGPT citation share fell ~95% (from ~14% to ~0.2–2%) in weeks, recovering only partially to ~3%. [Spotlight, 2026-02-18](https://www.loamly.ai/blog/reddit-as-ai-citation-source); [Spotlight via get-spotlight, 2025-10-29](https://www.get-spotlight.com/articles/chatgpt-stopped-citing-reddit-in-september-what-this-means-for-your-ai-visibility-strategy/)
3. **Reddit citation is heavily concentrated in consumer/transactional verticals, not B2B/finance.** Vertical splits show Apparel ~10% vs Transportation/logistics ~2%, and Reddit sole-source citations skew transactional/commercial (70% combined). Finance/SaaS are repeatedly named as *gap* verticals, not strongholds. [SaaS Intelligence / Tinuiti Q1 2026, 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew); [Conductor, 2026-03-05](https://www.conductor.com/academy/reddit-ai-citation-decline/)

So a B2B-finance brand seeing **0 visible Reddit citations across ChatGPT + Perplexity is consistent with the published panels.** It is *partly* vertical-specific (finance is a low-Reddit vertical) and *partly* a structural ChatGPT behavior (retrieve-don't-cite) that generalizes beyond finance.

---

## 1. How often do AI engines cite Reddit? (baseline, all verticals)

Headline "Reddit is #1" stats are **aggregate, consumer-weighted, and engine-dependent.** Disaggregated:

| Engine | Reddit citation share | Source / date |
|---|---|---|
| **Perplexity** | #1 source; ~3.5% of *answers* (Semrush) / 6.6% of *citations* (Profound) / "24% of citations Jan 2026" (Tinuiti restatement) — wide spread, see conflict note | [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/); [Profound 2025-08](https://www.tryprofound.com/blog/ai-platform-citation-patterns); [SaaS Intelligence 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew) |
| **ChatGPT / SearchGPT** | #2 source (behind Wikipedia); ~10–12.6% of answers post-recovery, but only ~1.8–3% of total citations | [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/); [Profound 2025-08](https://www.tryprofound.com/blog/ai-platform-citation-patterns) |
| **Google AI Overviews / AI Mode** | #1–2 social source; ~9% of answers; "44% of *social* citations" Jan 2026 | [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/); [Tinuiti via SaaS Intelligence 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew) |
| **Gemini** | **~0.1% of citations** (Jan 2026) — effectively does not surface Reddit despite Google's licensing deal | [Tinuiti via SaaS Intelligence 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew) |
| **Claude** | Not meaningfully reported as a Reddit citer; Profound notes Claude prefers legacy journalism (NYT, Atlantic, Economist). Reddit on Anthropic's crawl blocklist + active litigation (see §3). | [Profound via TechEdge 2026](https://www.tryprofound.com/blog/ai-platform-citation-patterns) |

**Conflict logged — the "% of answers" vs "% of citations" trap.** A lot of the spread above is unit confusion. "Reddit cited in X% of *answers*" (Semrush) and "Reddit is X% of *all citations*" (Profound) are different denominators. Profound's "Reddit = #1 at ~3.1% of all citations" and Semrush's "Perplexity cites Reddit in 3.5% of answers" are *not* contradictory — they measure different things. The widely-quoted "Reddit ~40% of AI citations" figure appears to be a vendor over-summary and is **[unverified inference]** as a literal share — Profound's own raw number is ~3.1% of *all* citations (Reddit as the single largest domain in a very long tail). [Profound 2025-08](https://www.tryprofound.com/blog/ai-platform-citation-patterns); [Profound "Data on Reddit" 2025-2026](https://www.tryprofound.com/blog/the-data-on-reddit-and-ai-search)

---

## 2. The September 2025 ChatGPT downweight — REAL, large, partial recovery

**Verdict: Real and large.** Multiple independent panels agree on the direction and rough magnitude; they disagree on the exact floor.

| Metric | Value | Source |
|---|---|---|
| Pre-drop ChatGPT Reddit share (early Aug 2025) | **14.29%** of cited sources | [Spotlight via get-spotlight, 2025-10-29](https://www.get-spotlight.com/articles/chatgpt-stopped-citing-reddit-in-september-what-this-means-for-your-ai-visibility-strategy/) |
| Post-drop floor (mid-Sept 2025) | **0.21%** ("near-zero", ~95% decline in one month) | [Spotlight, 2025-10-29](https://www.get-spotlight.com/articles/chatgpt-stopped-citing-reddit-in-september-what-this-means-for-your-ai-visibility-strategy/) |
| Alternative framing | "~60% of responses → under 10% overnight" | [Loamly/Spotlight, 2026-02-18](https://www.loamly.ai/blog/reddit-as-ai-citation-source) |
| Profound framing | "~7% → ~1%, rebounded to ~3%" | [Profound "Data on Reddit"](https://www.tryprofound.com/blog/the-data-on-reddit-and-ai-search) |
| Market confirmation | Reddit stock fell 14.4% ($240.11 → $205.50) Sept 26 → Oct 2, 2025 | [g2/learn, 2025](https://learn.g2.com/reddit-chatgpt-citations) |

**Conflict logged — the floor.** Spotlight says ~0.2% (essentially zero); Profound says ~1%; "60%→10%" framings imply a higher floor. The discrepancy is mostly denominator (% of citations vs % of answers vs % of responses-mentioning-Reddit) and which ChatGPT surface (SearchGPT vs base ChatGPT). All agree: **a step-change drop in September 2025, only partial recovery to ~3% by early 2026.**

### Cause — two competing explanations (both may be true)

1. **Mechanical (the dominant explanation): Google killed the `num=100` parameter ~Sept 10, 2025.** OpenAI reportedly doesn't crawl Google directly — it buys SERP data from third-party scrapers that relied on `num=100` to pull the top 100 results in one request. Reddit ranks *outside the top 20* for >50% of its keywords, so when deep-SERP scraping broke, Reddit "virtually vanished" from ChatGPT's retrieval surface while top-ranked, canonical sources (Wikipedia) rose. [TreDigital, 2025](https://tredigital.com/google-just-killed-num100-heres-what-it-means-for-seo-ai-search-and-reddit/); [g2/learn, 2025](https://learn.g2.com/reddit-chatgpt-citations)
2. **Intentional (OpenAI anti-over-citation): OpenAI deliberately reduced over-reliance on a small set of domains** "to be less biased toward them" / "more resilient to manipulation" (attributed to Lily Ray). [Loamly/Spotlight, 2026-02-18](https://www.loamly.ai/blog/reddit-as-ai-citation-source)

**[Unverified inference]** Neither Google nor OpenAI has officially confirmed the causal chain; the `num=100` timing correlation is strong and widely reported but circumstantial. Treat as *highly probable mechanism, not confirmed*.

**Important nuance:** Perplexity did **not** show the same collapse — it held steady through the disruption (peaks ~8.89% on Sept 13), consistent with Perplexity using its own retrieval rather than OpenAI's third-party SERP pipeline. [Loamly/Spotlight, 2026-02-18](https://www.loamly.ai/blog/reddit-as-ai-citation-source)

---

## 3. Licensing deals & legal status — who can legally surface Reddit

This is the cleanest predictor of *which models cite Reddit*:

| Company | Deal status | Effect on Reddit citation surfacing |
|---|---|---|
| **Google (Gemini / AI Overviews)** | **Licensed** — ~$60M/yr, announced Feb 2024; reportedly renegotiating for more. | Reddit dominant in **AI Overviews / AI Mode** — but **Gemini chatbot surfaces Reddit at only ~0.1%** (Jan 2026). Licensing ≠ citation. [SearchEngineLand 2024](https://searchengineland.com/reddit-google-ai-content-licensing-deal-437782); [Tinuiti 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew) |
| **OpenAI (ChatGPT)** | **Licensed** — ~$50–70M/yr, announced May 2024, via Reddit Data API. | Reddit is #2 cited domain *but* retrieve-don't-cite behavior + Sept 2025 SERP-pipeline break dominate actual visible citations. [OpenAI 2024](https://openai.com/index/openai-and-reddit-partnership/); [CJR 2025-10-02](https://www.cjr.org/analysis/reddit-winning-ai-licensing-deals-openai-google-gemini-answers-rsl.php) |
| **Anthropic (Claude)** | **No deal — being sued.** Reddit sued Anthropic (N.D. Cal., June 12 2025) for scraping "millions, if not billions" of posts; Reddit on Anthropic's crawl blocklist since ~mid-May 2024 (Reddit's logs allege 100K+ accesses afterward). | Claude is **not a meaningful Reddit citer**; prefers legacy journalism. Expect ~0 Reddit citations from Claude. [PPC.land 2025](https://ppc.land/reddit-files-lawsuit-against-anthropic-over-unauthorized-claude-ai-training/); [Profound](https://www.tryprofound.com/blog/ai-platform-citation-patterns) |
| **Perplexity** | **No deal — being sued.** Reddit sued Perplexity + scrapers (Oxylabs, AWMProxy, SerpApi) Oct 23 2025 for "industrial-scale" scraping; Reddit alleges Perplexity *increased* Reddit citations "forty-fold" after a cease-and-desist. | Despite litigation, Perplexity remains the **highest** Reddit-citing chatbot (#1 source). Legal risk to this pipeline is a forward-looking threat. [CNBC 2025-10-23](https://www.cnbc.com/2025/10/23/reddit-user-data-battle-ai-industry-sues-perplexity-scraping-posts-openai-chatgpt-google-gemini-lawsuit.html); [SearchEngineLand 2025](https://searchengineland.com/reddit-sues-perplexity-serpapi-scraping-google-463681) |

**RSL (Really Simple Licensing):** industry framework launched Sept 2025 (modeled on ASCAP/BMI), backed by Reddit, Yahoo, Medium. "No major AI companies have yet committed to honoring the standard" as of late 2025 — so it does not yet change who can surface Reddit. [CJR 2025-10-02](https://www.cjr.org/analysis/reddit-winning-ai-licensing-deals-openai-google-gemini-answers-rsl.php)

**Takeaway for Lumidian's stack (ChatGPT + Claude + Perplexity + Gemini):** Of the four, only **ChatGPT and Perplexity** would ever plausibly emit a *visible* Reddit citation; **Claude (litigated/blocklisted) and Gemini chatbot (~0.1%)** structurally won't. So Lumidian's citation extractor is effectively measuring Reddit on a 2-of-4-models basis to begin with — reinforcing the plausibility of a 0% reading.

---

## 4. What kind of Reddit content actually gets cited (when it is)

Convergent across Semrush (248K URLs), Profound, and the SEJ/Ahrefs panel:

- **Format:** Q&A threads = **>50%** of citations; comparison + discussion posts bring the top formats to **~75%**. Problem → direct-solution structure dominates. [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/); [Profound](https://www.tryprofound.com/blog/the-data-on-reddit-and-ai-search)
- **Votes / engagement DON'T matter:** **80% of cited posts have <20 upvotes; 70% have <20 comments;** median upvotes 5–8, median comments 11–19. LLMs weight **topical/semantic alignment over popularity.** [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/)
- **Age:** Cited posts are **old** — average ~900 days (~2.5 yrs); ~4% predate 2019. Reddit threads are evergreen for retrieval. [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/); [Profound](https://www.tryprofound.com/blog/the-data-on-reddit-and-ai-search)
- **Length:** Short — median ~80 words. [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/)
- **Subreddit:** Niche, query-specific communities treated as SME authorities (r/whatcarshouldIbuy, r/BuyItForLife, r/4kTV, r/TravelHacks). These are **consumer-product communities** — note the absence of B2B/finance equivalents in the cited examples. [Profound](https://www.tryprofound.com/blog/the-data-on-reddit-and-ai-search)
- **Semantic behavior:** AI paraphrases rather than quotes Reddit (AI-to-Reddit cosine sim ~0.53–0.54; raw prompt-to-Reddit sim only ~0.04–0.05) — consistent with "Reddit shapes the answer invisibly." [Semrush 2025-11-10](https://www.semrush.com/blog/reddit-ai-search-visibility-study/)

---

## 5. Rising or falling? And vertical variation (the part that matters most for Lumidian)

**Direction is genuinely contested — and the conflict is mostly a date/denominator artifact:**

- **"Rising 73%"** — Tinuiti Q1 2026 report: Reddit citation share **grew ≥73% Oct 2025 → Jan 2026 across all tracked commercial categories**, doubling in some (tech/electronics). This is the bullish headline. [SaaS Intelligence / Tinuiti 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew)
- **"Falling ~50%"** — Conductor, *same period* (Oct 2025 → Jan 2026): Reddit's overall share **fell from 2.02% → 1.01%, ~50% decline.** [Conductor 2026-03-05](https://www.conductor.com/academy/reddit-ai-citation-decline/)

**Conflict logged & reconciled [partly unverified inference]:** Tinuiti measures *category-relative* Reddit share among social/commercial sources (where Reddit grew); Conductor measures *Reddit's absolute share of all citations* (which fell as the long tail and Wikipedia grew). Both can be true: **Reddit is consolidating into a narrower but more dominant role** — Conductor's data shows Reddit **sole-source** citations rose **+31%** Oct 2025→Jan 2026 even as total share fell. When Reddit *is* cited, it's increasingly the *only* source; but it's cited in a shrinking slice of queries. [Conductor 2026-03-05](https://www.conductor.com/academy/reddit-ai-citation-decline/)

**Vertical variation — the decisive evidence for Lumidian's finance case:**

- **Consumer/transactional verticals are where Reddit lives.** Reddit sole-source queries split **Transactional 36.5% / Commercial 33.5% / Informational 25.6% / Navigational 4.4%** — i.e. ~70% commercial/transactional. [Conductor 2026-03-05](https://www.conductor.com/academy/reddit-ai-citation-decline/)
- **Hard category spread:** **Apparel ~10%** Reddit share vs **Transportation/logistics ~2%** (Jan 2026). Order-of-magnitude vertical variance. [Tinuiti via SaaS Intelligence 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew)
- **Finance/SaaS explicitly named as a GAP, not a stronghold.** Conductor frames "Financial/SaaS sectors" under *messaging-gap identification* (i.e. where Reddit citation is thin and brands must build it), distinct from the consumer verticals (Retail/D2C/Travel) where Reddit already dominates. No source provided a positive finance-vertical Reddit citation percentage — the available evidence is the *absence* of finance from every "Reddit wins here" list. [Conductor 2026-03-05](https://www.conductor.com/academy/reddit-ai-citation-decline/); [SaaS Intelligence 2026-03-18](https://saasintelligence.substack.com/p/reddits-ai-citation-share-just-grew)
- **B2B generally:** For professional/B2B queries, **LinkedIn — not Reddit — is the #1 cited domain across all six major platforms** (Profound). B2B SaaS citations concentrate on outlets like TechRadar (8.86% of B2B-SaaS-CRM citations). [Profound via TechEdge 2026](https://www.tryprofound.com/blog/ai-platform-citation-patterns)

---

## 6. Direct implications for Lumidian

1. **The 0% reading is credible, not a bug.** Given (a) Claude + Gemini structurally don't cite Reddit, (b) ChatGPT retrieves-but-doesn't-cite Reddit ~98% of the time, (c) finance is a documented low-Reddit vertical — **0 visible Reddit citations in a B2B-finance brand across ChatGPT + Perplexity is the expected outcome.** Lumidian should *not* treat this as a data pipeline failure.
2. **Distinguish retrieval from citation in product framing.** Reddit may still be *influencing* ChatGPT answers about a finance brand invisibly (Ahrefs: 67.8% of retrieved-uncited pages are Reddit). Lumidian's "0 Reddit citations" is accurate but is a **visibility** metric, not an **influence** metric — worth caveating to customers. [Ahrefs/SEJ 2026-04-16](https://www.searchenginejournal.com/chatgpt-often-retrieves-but-rarely-cites-reddit-pages-data-shows/572243/)
3. **Don't generalize "Reddit is worthless" beyond finance.** For consumer/transactional verticals (e.g. if Lumidian serves D2C/SaaS-consumer brands), Reddit is a top-1/top-2 surface — the finding is vertical-specific *in addition to* the structural ChatGPT/Gemini/Claude effects.
4. **If pursuing Reddit GEO for finance clients, the lever is format+relevance, not virality** — old, short, Q&A-format, topically-precise threads in niche subreddits, optimized for Perplexity (the one engine that reliably cites Reddit and held through Sept 2025). But expect low ROI in finance vs LinkedIn/owned authority sources.
5. **Forward risk:** Perplexity is the strongest Reddit citer *and* the one being actively sued for scraping. If Reddit wins / forces a deal, Perplexity's Reddit surfacing could change abruptly. Monitor.

---

## Source quality & staleness flags

| Source | Type | Date | Staleness flag |
|---|---|---|---|
| Ahrefs (1.4M prompts) via SEJ | Primary panel (retrieval+citation) | 2026-04-16 | Current |
| Semrush (217K prompts / 248K URLs) | Primary panel | 2025-11-10 | Current (data refreshed Oct 2025) |
| Profound (680M–4B citations) | Primary panel | 2025-08 → 2026 updates | Mostly current; some sub-figures from Aug 2024–Jun 2025 window (>12mo, **flagged stale** for absolute %) |
| Conductor (vertical/sole-source) | Aggregator analysis | 2026-03-05 | Current |
| Tinuiti Q1 2026 via SaaS Intelligence | Aggregator analysis | 2026-03-18 | Current |
| Spotlight / Loamly | Vendor panel restatement | 2025-10-29 / 2026-02-18 | Current; floor figure disputed |
| CJR (licensing/legal) | Journalism | 2025-10-02 | ~8mo; licensing terms may have shifted — **re-check Google renegotiation** |
| CNBC / SearchEngineLand / PPC.land (lawsuits) | Journalism | Jun–Oct 2025 | Litigation ongoing — **status may have changed** |
| OpenAI / SearchEngineLand (deals) | Primary / journalism | 2024 | >12mo old, **flagged stale** for current deal terms |

**Unverified-inference tags used above:** the literal "Reddit ~40% of citations" figure; the exact causal chain for the Sept 2025 drop (correlation, not confirmed); and the Tinuiti-vs-Conductor reconciliation (my synthesis, not stated by either source).
