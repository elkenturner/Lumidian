# Stream 2 — Model Research: Perplexity (sonar / sonar-pro)

**Research question:** How does Perplexity retrieve and cite sources as of 2026? Own crawler/index vs. third-party search API? What ranking and recency signals govern selection? How many sources per answer? What on-page traits correlate with citation? Does it favor social/UGC (Reddit, Quora) vs. authority/news/primary sources?

**Compiled:** 2026-06-03. Today's date is used to flag staleness (anything older than ~2025-06 is flagged).

**Source-quality note:** Perplexity publishes very little hard technical detail. Official docs confirm *that* there is an index and *that* answers are cited, but not *how* ranking works or exact source counts. The richest "mechanism" claims come from SEO/GEO vendor blogs (secondary, incentivized) and one litigation record (Reddit v. Perplexity). Independent, large-N citation studies (Profound, Semrush) are the strongest evidence on *what* gets cited. Treat all vendor-blog mechanism numbers (weights, percentages) as **directional, not validated** — they are rarely reproducible and frequently cite each other circularly.

---

## 1. Retrieval architecture: own index or third-party API?

**This is the single most contested question, and the evidence genuinely conflicts.**

### Position A — Perplexity now runs its own crawler + index (vendor/secondary sources, recent)
- "Perplexity runs its own search engine. It has its own crawler, its own index, its own ranking signals." Cites only 49.6% domain-level overlap with Google and just 1.4% URL-level overlap across AI platforms for identical queries; 3.3x freshness advantage over Google (32.5 vs 108.2 days median page age). — aiplusautomation.com, *How Perplexity Search Works* (read 2026-06; internal undated claims) https://aiplusautomation.com/blog/how-perplexity-search-works
- "Perplexity ... now operates its own proprietary search infrastructure indexing hundreds of billions of webpages with tens of thousands of index updates per second," having started on the **Bing Web Search API in 2022** and migrated off it. Describes a 6-stage RAG pipeline (intent parse → embedding index → hybrid retrieval → L1–L3 ML reranking → prompt assembly → constrained synthesis), BM25 + dense + hybrid retrieval, and proprietary **pplx-embed** embedding models (0.6B/4B, released Feb 2025). — ziptie.dev (read 2026-06; some sub-claims undated) https://ziptie.dev/blog/how-perplexity-ai-answers-work/
- Independent-index framing (own PerplexityBot crawler, sitemap-first discovery, robots.txt independence). — primaryposition.com https://primaryposition.com/blog/perplexity-crawl-index/

### Position B — Perplexity's pipeline still pulls from Google/Bing SERPs (litigation evidence + earlier reporting)
- **Reddit v. Perplexity (filed 2025-10-22, SDNY, DMCA §1201).** Reddit planted a "honeypot" post indexable **only by Google's crawler** and not otherwise publicly accessible; "Perplexity's answer engine surfaced material portions of that post within hours," which Reddit asserts shows Perplexity "sourced data through Google rather than ... Reddit directly" — i.e., the retrieval pipeline **harvested Google SERPs** (allegedly via brokers Oxylabs/SerpApi). — National Law Review, 2025-10 https://natlawreview.com/article/anti-circumvention-reddits-case-against-perplexity ; corroborated https://www.ailawandpolicy.com/2025/10/anti-circumvention-reddits-case-against-perplexity/
- Earlier/ongoing reporting that Perplexity "takes keywords and sends them to a traditional search engine's API — most commonly Google or Bing." — surfaced in search summaries (hyperlinker.ai, contxto.com); **flagged as potentially stale and lower-quality**.

### Reconciliation [unverified inference]
The most defensible reading: Perplexity has **built genuine proprietary crawl/index/embedding infrastructure** (the pplx-embed Feb-2025 release and bot behavior are concrete), **but its live answer pipeline still appears to incorporate third-party SERP data** for coverage/freshness, which is exactly what the honeypot evidence implies. "Own index" and "uses Google/Bing SERPs" are **not mutually exclusive** — it is plausibly a hybrid where its index is enriched by/blended with brokered SERP results. The official docs only commit to "a continuously refreshed index" without disclosing provenance. **This conflict is unresolved and should be treated as such in strategy.**

**Practical takeaway:** Because retrieval is at minimum partly SERP-derived, **classic SEO indexability still matters for Perplexity** — being crawlable and ranking in Google/Bing organic remains a meaningful prerequisite, not a bypassed one. [unverified inference, but supported by honeypot evidence]

---

## 2. What the official Perplexity sources actually confirm

- Perplexity Search/Sonar "provides developers with real-time access to **ranked web search results from a continuously refreshed index**." Search API returns structured `results[]` (`title, url, snippet, date, last_updated`); **Sonar returns prose with built-in inline citations**. Temporal fields (`date`, `last_updated`) exist but ranking algorithm is undisclosed. — docs.perplexity.ai (read 2026-06; living doc) https://docs.perplexity.ai/docs/search/quickstart
- **Sonar Pro** "shares the same foundational architecture as Sonar, running a **live web search on every inference call**," but "retrieves and processes significantly more sources per query" and provides **"double the number of citations per search as Sonar on average."** — Perplexity Sonar Pro announcement (official; ~Jan 2025; page now returns 403 to automated fetch, claim corroborated across mirrors) https://www.perplexity.ai/hub/blog/introducing-the-sonar-pro-api

**Official position summarized:** every Sonar call does live web search against a refreshed index and returns inline citations; Sonar Pro ≈ 2× Sonar's citation count. No official number for "citations per answer," no official ranking-signal disclosure.

---

## 3. How many sources per answer?

Conflicting figures by surface (consumer app vs. API tier vs. measurement method):

| Source | Figure | Notes / date |
|---|---|---|
| Official | Sonar Pro ≈ **2× Sonar** citations (relative, no absolute) | perplexity.ai blog, ~2025-01 |
| ziptie.dev | "60+ sources" *retrieved* per standard query; "hundreds" for Deep Research | secondary; conflates retrieved vs. cited |
| BlueJar AI | **21.87 citations per query** (vs ChatGPT 7.92) | 2026-02-02; **no methodology disclosed** https://bluejar.ai/blog/how-to-rank-in-perplexity-ai/ |
| Search-summary estimate | 5–8 sources consumer; 8+ Pro/Deep Research | low-confidence aggregate |
| aiplusautomation.com | "typically **3 to 5 sources per answer**" (cited, visible) | secondary |

**Reconciliation [unverified inference]:** Distinguish **retrieved** (tens–hundreds, internal) from **cited/displayed** (single digits to ~low-20s depending on query complexity and Pro/Deep Research mode). A reasonable planning range for *displayed* citations on a standard consumer answer is **~5–10**, climbing well beyond 20 for Deep Research / complex multi-step queries. The "3–5" and "21.87" figures likely measure different surfaces/query types. **Citation slots are scarce relative to retrieved candidates — the binary "make the cut or be invisible" dynamic is the strategically important fact, more than the exact count.**

---

## 4. Ranking & recency signals

**Recency is consistently reported as Perplexity's strongest differentiator — across multiple sources this is the most robust qualitative finding.**

- **Freshness / temporal signals dominate.** A 2026 SE Ranking analysis of **216,524 pages** reportedly found **temporal freshness ≈ 44.2%** of Perplexity's selection weighting — described as the strongest recency bias of any major AI search engine. Boost for content updated within ~30 days; breaking-topic window compresses to 48–72 hours. — via authoritytech.io / leadwalnut.com summaries, 2026; **primary SE Ranking study not directly fetched — treat 44.2% as directional**.
- ziptie.dev: "70% of top citations updated within 12–18 months"; content can decay "2–3 days after publication" for time-sensitive queries; `dateModified` schema and sitemap `<lastmod>` drive recrawl priority; FAQ pages get ~2× recrawls.
- Reported multi-signal weighting (vendor, **directional only**): relevance ~30%, visual/SERP placement ~20%, domain authority ~15%, freshness ~15%, source diversity ~10%, structured data ~10%. — stackmatix/ailabsaudit, 2026. (Note: this ~15% freshness figure **conflicts** with SE Ranking's ~44% — vendors disagree on freshness weight; both agree freshness is top-tier.)
- Reranking: an L1–L3 ML reranker with ~0.7 quality threshold keeping ~top 30% of candidates; "if insufficient results meet quality thresholds, the entire result set is discarded and retrieval restarts." — ziptie.dev (mechanism plausible, **unverified**).

**Conflict logged:** freshness weight ≈ 44% (SE Ranking) vs. ≈ 15% (stackmatix). Direction (freshness is critical) is consistent; magnitude is not.

---

## 5. On-page traits correlated with being cited

Most-repeated, cross-source patterns (correlational, vendor-measured — **not causal**):

- **Answer-first / BLUF.** "90% of top-cited sources answered the core question within the first 100 words." — multiple (ziptie, stackmatix), 2026.
- **Structured data (JSON-LD).** Schema-enabled pages ~**47% Top-3 citation rate vs. ~28% without** (≈19pp lift); Person/Article schema with author credentials ~**2.3× higher** citation rate. — ziptie / stackmatix, 2026 (BrightEdge-style "structured data +44%" also cited). Treat as **correlation**.
- **Topical depth > raw domain authority.** Niche/in-depth pages outrank big domains; "92.78% of cited pages have <10 referring domains" (i.e., backlinks are *not* a strong Perplexity gate, unlike Google). — ziptie, 2026.
- **Freshness signals on-page** (recent publish/update dates, visible timestamps, `dateModified`).
- **Clear factual, well-structured prose** that semantically matches specific query intent; fast-loading, properly indexed pages.
- **Internal linking** reported as strongest positive structural predictor (r ≈ 0.127 — a *weak* correlation; note the small effect size). — aiplusautomation, 2026.

**Strategic note for Lumidian [unverified inference]:** the BLUF + JSON-LD + freshness + topical-depth cluster is consistent enough across independent sources to be actionable, even though individual percentages are unreliable. These map cleanly onto content-draft guidance (answer-first openings, schema, dated/maintained pages, narrow topical focus).

---

## 6. Social/UGC (Reddit, Quora) vs. authority / news / primary sources

**This is the best-evidenced area — large-N independent studies converge.**

- **Reddit is (or was) Perplexity's single most-cited domain.** Profound (Aug 2024–Jun 2025, **680M citations**): Reddit **46.7% share among Perplexity's top-10 sources**; **6.6% of all Perplexity citations**; YouTube #2 (~2.0%); then Gartner 1.0%, Yelp 0.8%, LinkedIn 0.8%, Forbes 0.7%. **Wikipedia essentially absent** from Perplexity's top tier (vs ChatGPT where Wikipedia ~47.9%). — https://www.tryprofound.com/blog/ai-platform-citation-patterns
- Semrush (Jul 14–Oct 12 2025, **13 weeks, 230K prompts, >100M citations**): Perplexity's leading domains = **Reddit, LinkedIn, NIH, Microsoft, Google**; "balanced mix" of UGC + institutional/professional; **Wikipedia only ~0.8%** of Perplexity responses (vs ChatGPT ~55% early). — https://www.semrush.com/blog/most-cited-domains-ai/

  **Cross-study agreement:** both rank Reddit #1 and both find Wikipedia near-absent for Perplexity — a notably robust, replicated finding.

- **Verdict:** Perplexity **strongly favors conversational/community UGC (Reddit foremost, plus YouTube, LinkedIn, Quora-type forums)**, *blended with* selective institutional authority (NIH, Gartner, Microsoft) and review sites (Yelp). It does **not** lean on Wikipedia the way ChatGPT does. UGC presence is heavier than on any other major AI surface.

- **Major caveat — the Reddit relationship is unstable and time-sensitive (flag this hard):**
  - Reddit sued Perplexity **2025-10-22** for "industrial-scale" scraping (DMCA §1201; honeypot evidence — see §1). https://natlawreview.com/article/anti-circumvention-reddits-case-against-perplexity
  - A widely repeated claim holds Perplexity's **Reddit citation share dropped ~86% almost immediately post-lawsuit, with YouTube filling the gap** (via stackmatix/brandonleuangpaseuth summaries, 2026) — **could not be confirmed against a primary dataset; treat as unverified and volatile.**
  - Implication: any strategy weighting Reddit heavily for Perplexity carries **legal/availability risk**; the citation mix is actively shifting and the Profound (pre-lawsuit) numbers may already be stale for Reddit specifically.

---

## 7. Net answer to the research question

1. **Retrieval:** Perplexity has built real proprietary crawl/index/embedding infrastructure (pplx-embed, Feb 2025; bot + index claims), **but litigation evidence (Reddit honeypot, Oct 2025) indicates the live pipeline still ingests Google/Bing SERP data**, likely a hybrid. Official docs only confirm "a continuously refreshed index" + inline citations. **Conflict unresolved; classic indexability/organic ranking still matters.**
2. **Ranking/recency:** **Freshness is the dominant, most-replicated signal** (window ~12–18 months, far tighter for news); relevance, on-page structure, structured data, and topical depth follow. Backlinks/domain authority matter *less* than in Google. Exact weights conflict across vendors (freshness 15% vs 44%).
3. **Citations per answer:** Official = Sonar Pro ≈ 2× Sonar (relative only). Displayed citations realistically **~5–10 standard, 20+ for Deep Research**; retrieved candidates number in the tens–hundreds. Binary "cited or invisible" dynamic.
4. **On-page traits:** BLUF answer-first (first 100 words), JSON-LD/author schema, recent/maintained dates, deep niche-topical relevance, clean structured prose. (Correlational.)
5. **UGC vs authority:** **Strongest UGC tilt of any major AI engine — Reddit #1, plus YouTube/LinkedIn/forums — blended with selective institutional authority (NIH, Gartner); Wikipedia near-absent.** But the **Reddit channel is legally contested and shifting** post-Oct-2025; do not over-index on it.

---

## Source ledger (quality / date)

| Source | Type | Date | Confidence |
|---|---|---|---|
| docs.perplexity.ai/docs/search/quickstart | **Primary (official)** | living | High (limited detail) |
| perplexity.ai Sonar Pro blog | **Primary (official)** | ~2025-01 | High (limited detail; 403 on fetch, mirrored) |
| Reddit v. Perplexity (Nat. Law Review / AILaw&Policy) | **Primary (litigation)** | 2025-10 | High for *allegation*; claims unproven in court |
| Profound, AI Platform Citation Patterns | Independent large-N study | covers Aug 2024–Jun 2025 | High for *what's cited* (pre-lawsuit, partly stale) |
| Semrush, Most-Cited Domains in AI | Independent large-N study | Jul–Oct 2025 | High for *what's cited* |
| ziptie.dev pipeline writeup | Vendor/secondary | 2026 (some sub-claims undated) | Medium (mechanism plausible, unverified) |
| aiplusautomation.com | Vendor/secondary | 2026 | Medium |
| SE Ranking 216K-page study (via authoritytech/leadwalnut) | Study, **not directly fetched** | 2026 | Medium-low (44.2% figure directional) |
| BlueJar (21.87 citations) | Vendor blog | 2026-02-02 | Low (no methodology) |
| stackmatix / ailabsaudit / brandonleuangpaseuth | GEO vendor blogs | 2026 | Low (incentivized, circular) |

**Staleness flags:** Profound window ends Jun 2025 (>12mo old for some data, and pre-lawsuit → Reddit numbers likely outdated). Sonar Pro blog ~Jan 2025 (>12mo). Reddit-share-drop "86%" claim unverified. SE Ranking 44.2% not fetched at primary source.
