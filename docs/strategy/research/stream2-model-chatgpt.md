# Stream 2 — Model Research: ChatGPT `web_search` Tool (Responses API)

**Research question:** How does OpenAI's ChatGPT `web_search` tool (Lumidian uses `gpt-4o-mini` via the Responses API, `search_context_size=medium`) retrieve and cite web pages as of 2026? Which backend/index, what recency window, what ranking signals, how are citations selected/formatted, full pages vs. snippets, and what on-page traits make a page more likely to be cited?

**Compiled:** 2026-06-03
**Source-quality note:** OpenAI's own API docs and bots page are the only true primary sources for tool *mechanics*. OpenAI does **not** publish its ranking weights, recency window, or source-selection algorithm. All ranking/citation-selection claims below come from secondary citation-index studies (Writesonic, Semrush, Peec AI) or controlled GEO experiments (Princeton). Each is tagged. Treat anything not from `developers.openai.com` / `openai.com` as inference or third-party measurement.

---

## 1. What index / backend does it use?

**This is the most-changed and least-officially-documented area. Sources conflict and the picture shifted materially in late 2025.**

- **Official OpenAI docs say nothing about the backend.** The Responses API web-search guide only says the tool accesses "up-to-date information from the internet" and returns "sourced citations." No mention of Bing, OAI-SearchBot, or any index. — https://developers.openai.com/api/docs/guides/tools-web-search (current as of 2026-06)

- **Historically: Bing + content partners + OpenAI's own crawler.** Multiple secondary sources state ChatGPT Search launched on Bing's link index plus a dedicated crawler (`OAI-SearchBot`), with a fine-tuned GPT model re-ranking and summarizing. — https://yoast.com/chatgpt-search/ ; https://rankstudio.net/articles/en/openai-ranking-algorithm (2025-10-11)

- **`OAI-SearchBot` is the search crawler (primary source).** OpenAI's bots page: "Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers, though can still appear as navigational links." It is distinct from `GPTBot` (model training) and `ChatGPT-User` (real-time, user-triggered page visits). UA string: `...compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot`. Note: "it can take ~24 hours from a site's robots.txt update for our systems to adjust." — https://developers.openai.com/api/docs/bots (current 2026-06)
  - **Implication:** OpenAI maintains its **own** search index/crawler, not purely a Bing passthrough. `OAI-SearchBot` builds the index that powers display citations; `ChatGPT-User` fetches live when a user/agent triggers a page open.

- **CONFLICT — Bing dependency in 2026.** Some 2026 secondary sources still assert "Bing indexing is not optional" and that being absent from Bing means absence from ChatGPT. — https://yoast.com/chatgpt-search/ ; https://seooneclick.com/what-connection-ranking-factors-bing-chatgpt-search/ . Others say OpenAI is "completing their transition away from using Bing as the primary search index," with OAI-SearchBot supplementing/replacing it. — search-result summary of https://scrunch.com/blog/2025-03-significant-updates-to-chatgpt-search-are-coming/ . **Unresolved:** the relative weight of Bing vs. OpenAI's own index as of mid-2026 is not officially confirmed. `[unverified inference]` Most likely a hybrid: OpenAI's own index for primary retrieval, with residual third-party/Bing signal and content-partner feeds (Reddit, news partners).

- **The Sept 2025 "num=100" event strongly suggests an external Google-SERP dependency in the retrieval pipeline.** Around 2025-09-11, Google removed the `num=100` parameter (which let scrapers pull 100 results per page). Coincident with that date, LLM-tracking tools observed ChatGPT's Reddit citations collapse from ~60% of responses to ~10%, and Wikipedia from ~55% to <20% — a shift "isolated to ChatGPT" (AI Mode and Perplexity stayed stable). — https://www.semrush.com/blog/most-cited-domains-ai/ (2025-11-10) ; Lily Ray, https://x.com/lilyraynyc/status/1973328231844794748 (2025-09). The leading hypothesis: ChatGPT's retrieval could previously pull URLs ranking in positions 20–100 (where many Reddit/Wikipedia threads sit); losing deep-SERP access truncated retrieval to ~top-10/20. — https://www.indexlab.ai/blog/does-chatgpt-cite-reddit (updated 2025-12). Semrush later questioned whether num=100 is the *sole* cause. — https://x.com/semrush/status/1998755354834874740
  - **Takeaway for us:** ChatGPT's retrieval depth is shallow (effectively top-10/20 organic) and the candidate pool is sensitive to upstream SERP infrastructure changes. Ranking on the **first page** of organic results for a query matters far more than deep ranking.

---

## 2. Recency / freshness window

- **No official recency window is published.** Docs only promise "up-to-date information" and demonstrate "positive news from today"-style queries working. — https://developers.openai.com/api/docs/guides/tools-web-search
- `OAI-SearchBot` continuously crawls and re-crawls; `ChatGPT-User` can fetch live at query time, so genuinely fresh pages can surface. — https://developers.openai.com/api/docs/bots
- Secondary sources describe recency as an explicit ranking signal ("prioritizes keywords, recency, credibility..."), with news partners feeding fresh content. — https://rankstudio.net/articles/en/openai-ranking-algorithm (2025-10-11) `[secondary]`
- **`[unverified inference]`** There is no fixed cutoff; freshness is a *ranking signal*, not a hard filter. New pages must still be crawled by OAI-SearchBot (≈24h robots lag noted) or fetched live to be eligible.

---

## 3. Ranking signals (which sources get surfaced)

OpenAI publishes **no ranking weights**. Secondary/third-party signal evidence:

- **Internal re-ranking by a fine-tuned GPT model** over the retrieved candidate set, scored on "relevance, trust, and context" — can promote sources Bing didn't rank first. — https://rankstudio.net/articles/en/openai-ranking-algorithm `[secondary]`
- **Authority / E-E-A-T:** favors "well-known authoritative sites (e.g. government or major news)" and deprioritizes low-trust content; mirrors E-E-A-T. — https://rankstudio.net/articles/en/openai-ranking-algorithm `[secondary]`
- **Recency, credibility, author expertise, trustworthiness** named as factors. — same source `[secondary]`
- **Retrieval eligibility gate:** must be in the candidate pool (Bing/own index/partners) and not blocked via robots for OAI-SearchBot. — https://developers.openai.com/api/docs/bots `[primary]`
- **`search_context_size`** changes how much retrieved context the model sees before answering (low/medium/high). It "does not set an exact token count or guarantee a specific number of sources or citations." Higher = more candidates considered = more chances for a given page to be surfaced. Lumidian runs `medium` (balanced default). — https://developers.openai.com/api/docs/guides/tools-web-search `[primary]`

---

## 4. Citations: how selected and formatted

**Primary-source mechanics (Responses API):**

- **Two distinct reference sets:**
  1. `url_citation` **annotation objects** — inline, attached to spans of the answer text; contain the **URL, title, and start/end character location** of the cited source. These are the *visible* citations.
  2. `sources` field — the **complete list of URLs the model consulted**. "The number of sources is often greater than the number of citations." Available with both `web_search` and `web_search_preview`.
  — https://developers.openai.com/api/docs/guides/tools-web-search ; https://community.openai.com/t/organizing-inline-web-search-citations-in-the-response-api/1363325 `[primary + dev-forum]`

- **Critical distinction for strategy: consulted ≠ cited.** A page can be in `sources` (used to form the answer) without appearing as a `url_citation`. Conversely, the model selects only "the most relevant references" for inline citation. So a page can influence the answer invisibly. — same sources. Independently corroborated: "visible citation ≠ actual usage. The model might still draw from Reddit content 'internally' but not expose a link." — https://www.indexlab.ai/blog/does-chatgpt-cite-reddit (2025-12) `[secondary]`

- **Search context window capped at 128k tokens**, even on larger-context models. Caps how much retrieved text the model can weigh. — https://developers.openai.com/api/docs/guides/tools-web-search `[primary]`

- **Domain controls (primary):** up to **100 `allowed_domains`** or **100 `blocked_domains`** (omit `http(s)://`). `user_location` (country ISO / city / region / IANA timezone) refines results geographically. — same source `[primary]`

- **Model support nuance:** Docs list current web-search models as `gpt-5.5`, `gpt-4.1`, `gpt-4.1-mini` (Responses) and `gpt-5-search-api` (Chat Completions). **`gpt-4o-mini` (Lumidian's configured model) is not in the current docs' supported list** — it was supported earlier; OpenAI rotates supported models. `[unverified inference — flag for verification]` Worth confirming `gpt-4o-mini` + web_search still works in production or whether it silently falls back. — https://developers.openai.com/api/docs/guides/tools-web-search (2026-06)

---

## 5. Full page content vs. snippets

- **Non-reasoning models (incl. `gpt-4o-mini`): closer to snippet/summary behavior.** A dev-forum technical description: the non-reasoning model "sends the user's query to the web search tool, which returns the response based on top results, with no internal planning... simply passing along the search tool's responses." You receive the generated answer plus cited URLs/titles — not raw full-page text. — https://community.openai.com/t/return-web-search-results-as-plaintext/1230008 `[dev-forum]`
- **Reasoning models** can additionally "open pages" and read more deeply (agentic browsing via `ChatGPT-User`-style fetches). — https://developers.openai.com/api/docs/guides/tools-web-search `[primary, partial]`
- **`[unverified inference]`** For Lumidian's `gpt-4o-mini` + `search_context_size=medium` config, the tool likely operates on retrieved **summaries/snippets of top results** rather than fetching and reading each full page. This means **the answer-bearing content must appear high on the page and in a form that survives snippet extraction** (see §6). Reinforced by the trait finding that "44% of ChatGPT citations come from the first third of content." — https://searchengineland.com/ai-search-engines-cite-reddit-youtube-and-linkedin-most-study-473138 (2026-03-31) `[secondary]`

---

## 6. On-page traits that increase citation likelihood

### Controlled experimental evidence (strongest tier) — Princeton GEO paper
"GEO: Generative Engine Optimization," Aggarwal, Murahari, Rajpurohit, Kalyan, Narasimhan, Deshpande. arXiv Nov 2023; **ACM SIGKDD 2024**. GEO-bench: 10,000 queries × 25 domains. — https://www.getfancy.ai/article-princeton-geo-decoded (decode) `[secondary-of-primary; underlying paper is peer-reviewed primary]`

- **Add statistics** → citation/visibility lift **~30–40%+** (one of the three strongest single tactics).
- **Add quotations** from named/relevant sources → strong lift (~28% per derivative summaries).
- **Cite external authoritative sources** within your content → strong lift; **+115% for lower-ranked (SERP pos ~5) pages**, while top-ranked pages *lost* ~30% — GEO disproportionately helps the underdog. — https://www.getfancy.ai/article-princeton-geo-decoded
- **Fluency + statistics combined** = best combo (~+5.5% over individual).
- **No/negative effect:** keyword stuffing, "authoritative tone" wording changes, excessive meta-tag manipulation.

### Structural/positional evidence (measurement studies, weaker tier)
- **Front-load the answer:** "44% of ChatGPT citations come from the first third of content." — https://searchengineland.com/ai-search-engines-cite-reddit-youtube-and-linkedin-most-study-473138 (2026-03-31) `[secondary]`
- **Section length sweet spot ~120–180 words** between headings cited ~70% more than <50-word sections; stats in **tables / bold standalone claims** extract better than the same stat buried in prose; expert-quote pages avg 4.1 vs 2.4 citations. — search summaries of https://machinerelations.ai/research/content-structure-ai-citation-rates-2026 and derivative GEO write-ups `[secondary, single-vendor — treat as directional]`
- **Structured / FAQ-style, direct-answer formatting** is preferred. — https://rankstudio.net/articles/en/openai-ranking-algorithm `[secondary]`
- **Domain authority / E-E-A-T** correlates with surfacing (esp. for ChatGPT, which leans editorial + canonical post-Sept-2025). — multiple secondary sources.

### Synthesis of high-confidence on-page levers (for AIO drafting)
1. **Lead with the direct answer** in the first ~100–150 words (front-third dominance + snippet-mode retrieval).
2. **Embed concrete statistics with numbers**, ideally in tables or bold standalone claims (highest controlled lift).
3. **Quote named experts/sources** verbatim.
4. **Cite reputable external sources** inline — especially valuable if the page isn't already a top authority.
5. **Use clear H2/H3 structure with ~120–180-word answer blocks** and FAQ patterning.
6. **Ensure crawlability:** allow `OAI-SearchBot` in robots.txt and be indexable (Bing + likely OpenAI's own index). Without this, none of the above matters.
7. Avoid keyword stuffing / meta manipulation (neutral-to-negative).

---

## 7. Does ChatGPT cite social/UGC (Reddit, Quora) vs. authority domains?

**Short answer: historically UGC-dominated, but ChatGPT specifically pivoted toward authority/editorial/canonical sources in Sept 2025. Reddit is still *used* internally far more than it is *visibly cited*.**

- **Aggregate (all AI engines), May–Oct 2025, 2.38M domains, ~680M citations:** top cited = **Reddit (7.3M), Wikipedia (4.3M), YouTube (2.7M), Google, LinkedIn, G2, Medium, Forbes, NIH, Zapier**. 7 of top 10 are UGC/platform, not publishers. — https://writesonic.com/blog/llm-ai-search-citation-study-dominant-domains (2025) `[secondary, large-N]`
- **ChatGPT-specific pre-September:** Reddit appeared in ~60% of responses, Wikipedia ~55% — UGC-dominant. — https://www.semrush.com/blog/most-cited-domains-ai/ (2025-11-10) `[secondary, 230k prompts, 13 weeks]`
- **ChatGPT-specific post-September 2025:** Reddit collapsed to ~10% (one tracker: visible Reddit links fell to ~2% by 2025-09-30), Wikipedia to <20%. **Winners: PR Newswire, Forbes, Medium** (editorial/publisher). Decline was **isolated to ChatGPT** — Perplexity and Google AI Mode stayed UGC-heavy. — https://www.semrush.com/blog/most-cited-domains-ai/ ; https://www.indexlab.ai/blog/does-chatgpt-cite-reddit `[secondary]`
- **2026 measurement (Peec AI, 30M sources, Mar 2026):** ChatGPT still "favored Wikipedia, Reddit, and editorial sites like Forbes," while Google leaned Facebook/Yelp and Perplexity leaned Reddit/LinkedIn/G2. So Reddit/Wikipedia remain in ChatGPT's mix but alongside strong editorial weighting. — https://searchengineland.com/ai-search-engines-cite-reddit-youtube-and-linkedin-most-study-473138 (2026-03-31) `[secondary]`
- **Mechanism caveat (important):** the Reddit drop is largely a **visible-citation** phenomenon tied to retrieval depth (num=100 / top-10–20 truncation) and "canonicalization" toward fewer trusted sources — **not** necessarily reduced internal use. Reddit content remains contractually available via the **May 2024 OpenAI–Reddit data partnership**. — https://www.indexlab.ai/blog/does-chatgpt-cite-reddit ; https://openai.com/index/openai-and-reddit-partnership/

**CONFLICT to record:** Aggregate/2026 studies (Writesonic, Peec) keep Reddit at or near #1 *across engines*; ChatGPT-specific trackers (Semrush, IndexLab) show a sharp ChatGPT-only Reddit/Wikipedia *visible-citation* decline from Sept 2025. Both can be true: Reddit dominates the aggregate (driven by Perplexity/Google/Gemini) while ChatGPT specifically demotes it in **displayed** citations.

**Strategic implication for Lumidian AIO (ChatGPT target specifically):**
- Don't over-index on Reddit/Quora threads as the path to **visible** ChatGPT citations — ChatGPT now under-displays UGC relative to other engines.
- For ChatGPT visibility, weight toward **authoritative editorial/owned content** that ranks on page 1 organically, plus **Wikipedia** (still a canonical favorite) and **PR-distribution/Forbes/Medium-style** placements that gained post-Sept-2025.
- Reddit/Quora may still **influence** ChatGPT answers invisibly and remain valuable for *other* engines (Perplexity, Gemini, Google AI Mode) — so they're not worthless, just lower-leverage for ChatGPT *display* citations.

---

## 8. Open questions / verify-before-relying

1. **Does `gpt-4o-mini` + `web_search` still function** on the Responses API, or has OpenAI dropped it from supported models (current docs list `gpt-4.1`, `gpt-4.1-mini`, `gpt-5.5`)? — directly affects Lumidian's config. `[verify in prod]`
2. **Bing vs. OpenAI-own-index weighting in mid-2026** — unresolved; sources conflict.
3. **Whether `search_context_size=medium` materially changes which of our target pages get surfaced** vs. `high` — not documented; would need an A/B in our own tracking harness.
4. Most ranking-signal claims are secondary; **none of the EEAT/structured-data weights are OpenAI-confirmed.**

---

## Source inventory (with dates & quality)

| Source | Date | Tier |
|---|---|---|
| OpenAI Web Search guide — developers.openai.com/api/docs/guides/tools-web-search | current 2026-06 | **Primary** |
| OpenAI Bots/crawlers — developers.openai.com/api/docs/bots | current 2026-06 | **Primary** |
| OpenAI–Reddit partnership — openai.com/index/openai-and-reddit-partnership/ | 2024-05 | **Primary** (stale-ish) |
| Princeton GEO paper (via getfancy decode) | KDD 2024 / arXiv 2023-11 | Primary research, secondary summary |
| Semrush most-cited-domains study | 2025-11-10 | Secondary, large-N |
| Writesonic 2.4M-domain study | 2025 (May–Oct data) | Secondary, large-N |
| Search Engine Land / Peec AI 30M-source study | 2026-03-31 | Secondary, large-N |
| IndexLab "Has ChatGPT stopped citing Reddit?" | updated 2025-12 | Secondary |
| RankStudio OpenAI ranking algorithm | 2025-10-11 | Secondary, low-rigor |
| Lily Ray / Semrush on num=100 (X) | 2025-09 | Practitioner observation |
| OpenAI dev-forum threads (sources field, plaintext) | 2025 | Dev-forum (semi-primary) |

**Staleness flags:** OpenAI–Reddit partnership announcement (2024-05, >12mo). RankStudio (2025-10) pre-dates and partly contradicts the Sept-2025 shift it discusses. Bing-dependency claims vary by source date; treat any pre-Sept-2025 backend claim as possibly superseded.
