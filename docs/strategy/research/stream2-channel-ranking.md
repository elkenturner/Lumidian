# Stream 2 — Writable-Text Channel Ranking for AI Citability (2026)

**Research question:** As of 2026, rank writable-text publishing channels by how reliably their content gets *cited* by AI answer engines (ChatGPT, Claude, Perplexity, Gemini). Identify the structural traits that make a channel citable, and produce a Tier 1 / 2 / 3 ranking with per-channel rationale.

**Scope note:** Video (YouTube) and review sites (G2 / Capterra / TrustRadius) are explicitly OUT of scope per the brief. They appear in the source data and are referenced only as context, never ranked.

**Research date:** 2026-06-03. Each source is date-stamped; sources older than ~12 months (i.e. before ~2025-06) are flagged as possibly stale.

---

## 0. How to read this report (the big caveats first)

Three caveats dominate everything below. Internalize them before the tier list.

1. **Citation share is volatile and platform-specific.** The single biggest finding across every credible study is that there is **no universal top source**. ChatGPT, Perplexity, Gemini, and Google AI Overviews cite *different* domains, and the mix shifts month to month — sometimes violently. Two independent audits put the **domain overlap between ChatGPT and Perplexity at only ~11%** ([AuthorityTech, 680M-citation audit, 2026](https://authoritytech.io/curated/ai-citation-11-percent-platform-overlap-per-engine-audit-2026); [SearchEngineLand: "no universal top source," 2026](https://searchengineland.com/ai-citation-data-no-universal-top-source-brands-471285)). Any single ranking is a blended average that hides large per-engine variance.

2. **Aggregate citation share ≠ citability of YOUR content.** Reddit/Wikipedia "win" aggregate counts because they have billions of pages covering everything. That does not mean a *new* page you publish there will be cited for *your* commercial query. SearchEngineLand's B2B analysis found Reddit/Wikipedia barely influence bottom-of-funnel software queries, where owned + niche content dominates ([SearchEngineLand, 2026-03-27](https://searchengineland.com/reddit-wikipedia-what-drives-ai-recommendations-472580)). **This report ranks "how reliably content YOU publish on this channel gets cited," not "which domains appear most in aggregate."** That distinction reorders the list substantially.

3. **The earned-media-vs-owned conflict is real and unresolved — see §3.** Headlines say "94% of AI citations are earned media, brand blogs are invisible." The underlying data says owned sites are *disadvantaged on some engines and dominant on others* (Gemini sources ~52% from brand-owned sites with schema). Both can be true; the framing is misleading. Detailed below.

---

## 1. Primary / controlled sources (highest weight)

| Source | What it is | Date | Staleness |
|---|---|---|---|
| [Princeton GEO paper (Aggarwal et al.), arXiv 2311.09735 / ACM KDD 2024](https://arxiv.org/abs/2311.09735) | The only peer-reviewed controlled GEO study. Tested 6 content modifications across 10 engines on 10,000 queries (GEO-bench). | KDD 2024 (paper 2023–24) | **STALE on specifics** (pre-dates current models) but its *causal* findings on content structure still cited as foundational. Treat method as durable, model-specific numbers as outdated. |
| [Profound — 680M citations, Aug 2024–Jun 2025](https://www.tryprofound.com/blog/ai-platform-citation-patterns) | Largest longitudinal citation dataset; per-platform domain shares. | mid-2025 | Borderline (≥12mo for early data). ChatGPT numbers here (Wikipedia-dominant) were **superseded** by the Sept 2025 shift below. |
| [Semrush — 230k prompts / 100M+ citations, Jul 14–Oct 12 2025](https://www.semrush.com/blog/most-cited-domains-ai/) | 13-week weekly tracking of top-25 domains per engine. Captured the September 2025 ChatGPT collapse of Reddit/Wikipedia share. | 2025-10 | Fresh-ish (~8mo). High weight. |
| [5W AI Platform Citation Source Index / Q1 2026 Audit](https://www.prnewswire.com/news-releases/wikipedia-and-reddit-now-drive-over-25-of-chatgpt-citations-in-the-us-new-5w-research-finds--wsj-nyt-and-bloomberg-do-not-appear-in-the-top-20-302768339.html) | Meta-synthesis of 9 datasets (Similarweb, Semrush, Peec, Ahrefs). Jan 2025–Apr 2026. | 2026 Q1/Q2 | Fresh. **Caveat: 5W is a PR firm** publishing via PR Newswire — directionally useful, commercially motivated (it sells earned-media services). |
| [Muck Rack generative-AI citation analysis](https://everything-pr.com/94-of-ai-citations-come-from-earned-media-brand-blogs-are-invisible/) | "94% of citations from non-paid, non-brand-owned sources." | Dec 2025 (reported 2026) | Fresh. **Caveat: PR-industry source**, see §3 for the reconciliation. |
| [Tinuiti Q1 2026 AI Citation Trends](https://searchengineland.com/ai-citation-data-no-universal-top-source-brands-471285) | High commercial-intent prompts, 9 verticals, 7 engines, 4 months to Jan 2026. Best source for *per-engine divergence*. | 2026 Q1 | Fresh. |
| [Discovered Labs — per-platform citation mechanics](https://discoveredlabs.com/blog/chatgpt-claude-perplexity-and-google-ai-overviews-how-each-platform-cites-sources-differently) | Best breakdown of *structural* citability traits (speed, schema, recency, format) per engine. | 2026-01-29 | Fresh. Vendor blog — corroborated by others, medium weight. |

> **Vendor-bias flag:** Most fresh data comes from GEO/AEO vendors (Profound, Semrush, 5W, Tinuiti, Discovered Labs, Otterly) who sell visibility tools or PR. The only truly independent peer-reviewed source is the Princeton paper, which is now stale on model specifics. Treat all percentages as directional, not precise.

---

## 2. The data, by channel (what the studies actually show)

### Reddit
- Most-cited *domain* in several aggregate studies; **Perplexity ~46.7% of top-10 citations; ~6.6% of all citations** ([Profound, 2025](https://www.tryprofound.com/blog/ai-platform-citation-patterns)). On ChatGPT, Reddit was ~60% of citations in early Aug 2025 then **collapsed to ~10% within two weeks in September 2025** ([Semrush, 2025-10](https://www.semrush.com/blog/most-cited-domains-ai/)).
- Extreme per-engine variance: **Perplexity ~24% of citations from Reddit vs Gemini ~0.1%** in Jan 2026 ([Tinuiti via ZipTie, 2026](https://ziptie.dev/blog/why-reddit-dominates-chatgpt-perplexity-and-google-ai-overviews/)).
- Nuance that matters for *publishing strategy*: cited Reddit threads are mostly **old and low-engagement** — up to 80% have <20 upvotes, average cited post ~900 days old ([SearchEngineLand, 2026-03-27](https://searchengineland.com/reddit-wikipedia-what-drives-ai-recommendations-472580)). **Implication: you cannot reliably "publish a Reddit post and get cited" — engines surface aged, organically-validated threads, not fresh self-posts.** High aggregate share, *low controllability*.

### Wikipedia
- ChatGPT's single most-cited domain: **~7.8% of all citations, ~47.9% of top-10 factual citations** ([Profound, 2025](https://www.tryprofound.com/blog/ai-platform-citation-patterns); [5W, 2026](https://www.prnewswire.com/news-releases/wikipedia-now-accounts-for-nearly-half-of-chatgpts-top-citations-5w-releases-the-pr-industrys-first-practitioner-guide-to-wikipedia-brand-authority-302774728.html)). Per the Sept 2025 shift, ChatGPT Wikipedia share also fell (from ~55% of top sources to ~20%) but remains #1–2 ([Semrush, 2025-10](https://www.semrush.com/blog/most-cited-domains-ai/)).
- **Asymmetric across engines:** heavily cited by ChatGPT, comparatively *ignored by Google AI Overviews* (~7%) ([BrightEdge](https://www.brightedge.com/resources/weekly-ai-search-insights/how-google-ai-overviews-and-chatgpt-cite-wikipedia-differently); [qvery.ai, 2026](https://qvery.ai/blog/wikipedia-ai-citations-statistics)).
- Why citable: structured, factually dense, entity-rich, fully crawlable, no login wall, treated as a "baseline truth layer" ([qvery.ai, 2026](https://qvery.ai/blog/wikipedia-ai-citations-statistics)). **Controllability caveat:** notability/COI rules make brand-driven publishing hard and risky — already handled as a gated, placeholder surface in Lumidian's own product.

### Owned blog / brand site
- The contested one. **Profound found first-party sites ~44% of citations** in one cut ([via search synthesis, 2025](https://www.tryprofound.com/blog/ai-platform-citation-patterns)); **Gemini sources ~52.15% from brand-owned sites with structured data** ([Muck Rack synthesis, 2025-12](https://everything-pr.com/94-of-ai-citations-come-from-earned-media-brand-blogs-are-invisible/)). But **Perplexity "rarely" cites brand-owned domains directly**, and the "94% earned media" headline frames owned content as disadvantaged ([Muck Rack, 2025-12](https://everything-pr.com/94-of-ai-citations-come-from-earned-media-brand-blogs-are-invisible/)).
- **Where owned wins decisively: bottom-of-funnel / category-specific queries**, where deep human-written owned content + niche citations beat Reddit/Wikipedia ([SearchEngineLand, 2026-03-27](https://searchengineland.com/reddit-wikipedia-what-drives-ai-recommendations-472580)).
- **Highest controllability of any channel** — you own crawlability, schema, speed, freshness, structure (the exact levers that drive citation, §4). Princeton's controlled study showed owned-content modifications (stats +41%, citing sources +115% for low-ranked pages) directly lift visibility ([arXiv, KDD 2024](https://arxiv.org/abs/2311.09735)).

### LinkedIn
- Rising fast: **Google AI Mode ~15% (top domain); ChatGPT Search moved #11→#5 in three months (~14.3%)** ([Semrush, 2025-10](https://www.semrush.com/blog/most-cited-domains-ai/); [5W, 2026](https://www.prnewswire.com/news-releases/wikipedia-and-reddit-now-drive-over-25-of-chatgpt-citations-in-the-us-new-5w-research-finds--wsj-nyt-and-bloomberg-do-not-appear-in-the-top-20-302768339.html)). Top-3 on Perplexity for B2B.
- **Crawlability caveat:** much of LinkedIn sits behind a login/soft wall; cited LinkedIn URLs tend to be public company pages / public articles. Controllability is moderate (you can publish, but indexability is inconsistent).
- ⚠️ Conflicts with Lumidian's own production data (LinkedIn = 0% citations). Likely explained by: (a) public-vs-walled indexability, (b) B2B-query skew in the studies, (c) Lumidian's brand set. Flagged as a genuine conflict to validate internally.

### Industry / trade publications
- **The compounding winner across all five engines per the trade-press meta-study.** Engines reward "bylined editorial coverage, analyst-grade independent research, and high-credibility category publications" ([Trade Press AI Index 2026, 5W, 2026-05-19](https://www.prnewswire.com/news-releases/the-trade-press-ai-index-2026-trade-publications-the-engines-actually-cite-302775942.html)).
- Specific winners: **PCMag, Skift, STAT, Bloomberg, Axios; one Bloomberg article ≈ recall of ~50 mid-tier placements**. Legacy prestige titles (TechCrunch, parts of WSJ/NYT) *losing* ground — WSJ/NYT/Bloomberg absent from ChatGPT top-20 in one cut ([5W, 2026](https://www.prnewswire.com/news-releases/wikipedia-and-reddit-now-drive-over-25-of-chatgpt-citations-in-the-us-new-5w-research-finds--wsj-nyt-and-bloomberg-do-not-appear-in-the-top-20-302768339.html)).
- **Controllability: earned, not owned** — you pitch/contribute, you don't publish at will. High citability *if placed*, but placement is the bottleneck.

### PR newswires (PR Newswire / GlobeNewswire / Business Wire / Yahoo Finance syndication)
- **PR-release citations grew ~5x Jul→Dec 2025**; releases landing on **Yahoo Finance `/news/` paths got confirmed ChatGPT citation status**, while identical content on `/press-releases/` paths elsewhere was "rarely" cited ([5W Trade Press Index, 2026](https://www.prnewswire.com/news-releases/the-trade-press-ai-index-2026-trade-publications-the-engines-actually-cite-302775942.html)).
- **Key structural lesson: the syndication *path/host* determines citability more than the content** — same release, different host = different citation rate. Useful in time-sensitive coverage. Self-serve and controllable (you can issue releases), but citability depends entirely on which authority host picks it up.

### Quora
- Moderate on Google AI Overviews (**~1.5% overall, top-3 in AIO top-10**) ([Profound, 2025](https://www.tryprofound.com/blog/ai-platform-citation-patterns)); a top-domain class for Gemini ([Asklantern via search, 2026](https://searchengineland.com/ai-citation-data-no-universal-top-source-brands-471285)). **Declining on ChatGPT/AI Mode** ([Semrush, 2025-10](https://www.semrush.com/blog/most-cited-domains-ai/)).
- Crawlable, no hard login wall, Q&A structure aligns with answer-engine retrieval. Controllable (you can answer questions) but trending down and engine-specific.

### Medium
- Appears in ChatGPT's top-5 post-September-2025 reshuffle ([Semrush, 2025-10](https://www.semrush.com/blog/most-cited-domains-ai/)) but **declining on Google AI Mode**. Fully crawlable, clean HTML, decent domain trust, but increasingly soft-paywalled (member-only stories) which hurts indexability. Controllable self-publish; middling and volatile.

### Substack
- No strong direct citation-share data in the controlled studies; absent from top-domain lists ([Semrush](https://www.semrush.com/blog/most-cited-domains-ai/), [Profound](https://www.tryprofound.com/blog/ai-platform-citation-patterns) — both list it without rankings). Individual high-authority Substacks (e.g. Simon Willison) get cited on merit. Crawlable, clean, but **email-first + per-newsletter subdomain dilutes domain trust**, and rising paywalling. `[unverified inference]` Treat as roughly equivalent to a low-authority owned blog unless the author already has entity authority.

### Hacker News, dev.to, Stack Overflow, GitHub (developer channels)
- Grouped because the only concrete signal is qualitative: "AI systems pull heavily from Reddit, **Hacker News, Stack Overflow**, and niche community forums" for practitioner content ([AI Magicx / search synthesis, 2026](https://www.aimagicx.com/blog/generative-engine-optimization-chatgpt-perplexity-2026)). **Stack Exchange/Hugging Face** named among most-cited community sources for technical queries.
- None appear with measurable % shares in the major controlled datasets — meaning citation is **real but narrow (technical/developer queries only)**.
- **GitHub & docs:** heavily *fetched in real time by coding assistants* (Cursor, Copilot, Claude) and the primary use case for `llms.txt` ([dev.to, 2025](https://dev.to/matthewhou/llmstxt-is-the-new-robotstxt-why-every-developer-should-care-3c2e)). This is retrieval-for-coding, not general answer-engine citation. Highly crawlable, no login wall, but domain relevance is narrow.
- **dev.to:** crawlable, clean, decent for technical SEO; no measurable citation share in studies. Niche.

### X (Twitter)
- **Largely absent from citation studies.** Gemini's social citations are dominated by YouTube/Reddit/LinkedIn/TikTok — **X not among measurable sources** in the Gemini dataset ([Tinuiti via search, 2026](https://searchengineland.com/ai-citation-data-no-universal-top-source-brands-471285)). Login wall + aggressive anti-scraping + restricted API make X **structurally hostile to crawling**, which is the most likely cause. Lowest citability of the writable-text channels. Matches Lumidian's 0% production signal.

---

## 3. The earned-vs-owned conflict (recorded explicitly)

| Claim | Source | Implication |
|---|---|---|
| "94% of AI citations come from non-paid, non-brand-owned sources; brand blogs are invisible" | [Muck Rack, Dec 2025](https://everything-pr.com/94-of-ai-citations-come-from-earned-media-brand-blogs-are-invisible/) | Owned content is heavily disadvantaged. |
| "85.5% of citations from earned media, not brand websites" | [5W, 2026-05](https://www.prnewswire.com/news-releases/85-5-of-ai-citations-come-from-earned-media--not-brand-websites-5w-releases-ai-and-the-israeli-brand-mapping-the-new-discovery-funnel-302771336.html) | Same direction. |
| First-party sites ~44% of citations | [Profound, 2025](https://www.tryprofound.com/blog/ai-platform-citation-patterns) | Owned content is roughly *half* of citations. |
| Gemini sources ~52% from brand-owned sites with structured data | [Muck Rack synthesis, 2025-12](https://everything-pr.com/94-of-ai-citations-come-from-earned-media-brand-blogs-are-invisible/) | Owned content *dominates* on Gemini. |
| Owned + niche content dominates bottom-of-funnel software queries | [SearchEngineLand, 2026-03](https://searchengineland.com/reddit-wikipedia-what-drives-ai-recommendations-472580) | Owned wins where it matters commercially. |

**Reconciliation (`[unverified inference]`, but well-supported):** The "94% earned" figure measures *brand-promotional* citations (does ChatGPT cite YOUR domain when describing YOUR brand) — there, third parties dominate. The "44–52% owned" figures measure *all* citations including informational queries, where well-structured owned pages win, especially on Gemini and for BOFU queries. **Both are real; they answer different questions.** Also note: every "earned media wins" headline traces to **PR firms (5W, Muck Rack) who sell earned-media services** — directional, commercially motivated. Net takeaway for Lumidian: owned content is necessary and controllable; earned/third-party coverage is the multiplier, not a replacement.

---

## 4. Structural traits that make a channel/page citable

Synthesized across [Discovered Labs (2026-01-29)](https://discoveredlabs.com/blog/chatgpt-claude-perplexity-and-google-ai-overviews-how-each-platform-cites-sources-differently), [Megrisoft/Otterly (2026)](https://otterly.ai/blog/the-ai-citations-report-2026/), [Princeton GEO (KDD 2024)](https://arxiv.org/abs/2311.09735), and the 5W/Semrush studies. Ranked by evidentiary strength:

1. **Crawlability without JS dependency / no login wall** — clean static HTML, explicit robots.txt permissions. JS-rendered or walled content (X, much of LinkedIn) is structurally penalized. *(Strong, multi-source.)*
2. **Structured data / schema markup** — pages with schema see ~2.8x higher citation rates; Gemini explicitly favors schema-rich owned sites (~52%). *(Strong.)*
3. **Freshness / recency** — content updated within ~30 days gets ~3.2x more citations (Otterly); "updated in past 3 months averages ~6 citations vs ~3.6 for stale" (Discovered Labs). *(Strong, but note Reddit paradox — aggregate-authority pages cited despite age.)*
4. **Extractable, block-structured format** — answer-first paragraphs, 200–400 word sections, clear H2/H3, bullets, FAQ schema, definitions up top. Claude especially: clear definitions + bullets up to ~30% more likely selected. *(Strong.)*
5. **Page speed** — FCP <0.4s averaged ~6.7 citations vs ~2.1 for >1.13s (Discovered Labs). *(Medium — single-source.)*
6. **Entity clarity + factual density** — stats, named entities, citing external sources. Princeton: adding statistics +41%, citing sources +115% for low-ranked pages. *(Strong + peer-reviewed.)*
7. **Domain/entity trust & third-party corroboration** — consistent facts across owned + earned surfaces. **Crucially, traditional SEO authority (Domain Authority, Domain Rating, backlink counts) shows WEAK-to-NEGATIVE correlation with AI citation** ([Discovered Labs, 2026](https://discoveredlabs.com/blog/chatgpt-claude-perplexity-and-google-ai-overviews-how-each-platform-cites-sources-differently)). Entity recognition, not link equity, drives citability. *(Strong, counterintuitive, multi-source.)*
8. **Syndication host/path** — same content cited or ignored based on which authority domain/path hosts it (Yahoo Finance `/news/` example). *(Medium — single strong example.)*

> LLMs cite only **~2–7 domains per answer** ([Otterly, 2026](https://otterly.ai/blog/the-ai-citations-report-2026/)) vs Google's 10 blue links — citation is far more competitive/winner-take-most than classic SEO.

---

## 5. RANKED TIER LIST

Ranking criterion = **reliability that content YOU publish on this channel gets cited by AI answer engines**, weighting: controllability + crawlability + cross-engine breadth + corroborated citation evidence. (This deliberately *down-weights* pure aggregate share, which over-credits Reddit/Wikipedia where you can't reliably publish-to-cite.)

### TIER 1 — Reliably citable AND controllable
| Channel | Rationale |
|---|---|
| **Owned blog / brand site** | Only channel where you fully control the 8 citability levers (crawlability, schema, speed, freshness, structure, entity density). Wins BOFU/category queries; ~44–52% of citations on some engines (Gemini, informational). Necessary foundation. Confirmed by Lumidian's own data (owned/authority domains cited). |
| **Wikipedia** | #1 ChatGPT source (~7.8% all / ~47.9% top-10); structural ideal (crawlable, structured, no wall, "truth layer"). Tier 1 on *citability*, but **controllability is gated** by notability/COI rules — Lumidian already treats it as a constrained surface. Confirmed by Lumidian data. |
| **Industry / trade publications** | The compounding cross-engine winner (all 5 engines); one Bloomberg-tier placement ≈ ~50 mid-tier. Highest citation value *per placement*. Earned (placement is the bottleneck), so Tier 1 on citability, not on self-serve volume. Matches Lumidian's PR/authority-domain signal. |

### TIER 2 — Citable but conditional (engine-specific, partially walled, or earned)
| Channel | Rationale |
|---|---|
| **PR newswires (esp. Yahoo Finance syndication)** | 5x citation growth H2-2025; citability hinges on syndication host/path. Self-serve and controllable, but unreliable unless picked up by an authority host. |
| **LinkedIn** | Rising hard on Google AI Mode (~15%) and ChatGPT Search (#5). But login/soft-wall hurts indexability and it **conflicts with Lumidian's 0% data** — engine- and query-dependent. |
| **Reddit** | Huge aggregate share (Perplexity ~24–47%), but **near-zero controllability** — engines cite aged, low-upvote, organically-validated threads, not fresh self-posts; ~0.1% on Gemini. High ceiling, unreliable floor. Conflicts with Lumidian's 0% data. |
| **Quora** | Moderate on AI Overviews/Gemini, Q&A structure helps, controllable — but declining on ChatGPT/AI Mode. |
| **Stack Overflow / Hacker News / GitHub (developer surfaces)** | Genuinely cited, but **only for technical/practitioner queries**; GitHub is real-time-fetched by coding assistants (llms.txt) more than answer-cited. Tier 2 *only* for dev-relevant brands; Tier 3 otherwise. |

### TIER 3 — Weak, declining, or structurally hostile
| Channel | Rationale |
|---|---|
| **Medium** | In ChatGPT top-5 post-Sept-2025 but volatile and declining on Google; growing soft-paywall hurts crawlability. Controllable but unreliable. |
| **Substack** | No measurable citation share in controlled studies; cited only when author already has entity authority. Effectively a low-authority owned blog with weaker domain trust. `[unverified inference]` |
| **dev.to** | Crawlable and clean but no measurable citation share; narrow technical niche. |
| **X (Twitter)** | Structurally hostile — login wall + anti-scraping + API restrictions; absent from citation datasets including Gemini's social mix. Lowest citability. Matches Lumidian's 0% data. |
| **Niche/industry forums** | Real but unpredictable citation (named generically alongside Reddit/Stack Exchange). High expertise-fit for specialized subreddits (50K–300K subs) but no reliable publish-to-cite path. Tier 3 by reliability; can spike to Tier 2 in a specific vertical. |

---

## 6. Conflicts & open questions to validate internally
- **LinkedIn / Reddit:** studies rank these top-5; Lumidian production data shows 0%. Reconcile via (a) public-vs-walled URL indexability, (b) B2B-query skew in studies, (c) brand-set differences. **Action: re-check Lumidian's citation extractor against public LinkedIn/Reddit URLs specifically.**
- **Earned vs owned %:** unresolved by framing, not by data (see §3). Lumidian's "owned + PR + Wikipedia + primary sources" observed mix actually *aligns better with the BOFU/owned-wins camp* than the "94% earned" headline — worth noting the headline is PR-firm-sourced.
- **Volatility:** the Sept-2025 ChatGPT reshuffle proves any ranking can flip in weeks. Re-run this scan quarterly.
- **Staleness flags:** Princeton paper (model-specific numbers stale); Profound early-2024 data borderline; all 5W/Muck Rack figures fresh but PR-vendor-sourced.

---

## 7. Bottom line for Lumidian's AIO content strategy
Lumidian's production signal (owned/authority + Wikipedia + primary sources + PR cited; Reddit/Quora/Medium/LinkedIn/X at 0%) is **strongly corroborated** by the independent research once you rank by *publish-to-cite reliability* rather than aggregate share. Double down on **Tier 1: owned site (schema-rich, fast, fresh, fact-dense), Wikipedia (gated), and trade-press/PR placement.** Treat Tier 2 social/UGC as opportunistic and engine-specific, not core. Treat X/Substack/dev.to as Tier 3. The single highest-leverage owned-site lever per the only peer-reviewed source: **add statistics, cite primary sources, and structure for extraction** (Princeton: up to +115% visibility).
