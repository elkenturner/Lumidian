# Stream 2 — Model Research: Google Gemini (`gemini-2.5-flash`) + `google_search` Grounding

**Research date:** 2026-06-03
**Scope:** How Gemini's `google_search` grounding tool retrieves and cites web content as of 2026; how `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs are formed and whether they can be resolved to real source domains; what determines which sources ground a response; content traits that help a page get grounded/cited; authority vs. social/UGC bias.

**Sourcing rule:** Every claim carries an inline source URL or is tagged `[unverified inference]`. Conflicts are recorded. Sources are date-stamped; anything older than ~12 months (i.e. before ~2025-06) is flagged **[POSSIBLY STALE]**.

---

## TL;DR (most load-bearing findings)

1. **The redirect URLs CAN be resolved to real domains — by following the HTTP redirect.** The `uri` field in `groundingChunks` is always a `vertexaisearch.cloud.google.com/grounding-api-redirect/<token>` proxy URL, but issuing an HTTP request with redirect-following enabled returns the real destination URL. The community-standard one-liner is `requests.head(redirect_url, allow_redirects=True, timeout=5).url` ([Cennest, 2025-07-08, upd. 2025-10-06](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/); [googleapis/python-genai #1512](https://github.com/googleapis/python-genai/issues/1512)).
2. **The redirects are temporary** — they "expire after a few days," so resolution must happen at ingest time, not lazily on display ([Cennest, 2025-07-08](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/)).
3. **There is a cheaper partial signal already in the payload:** `groundingChunks[].web.title` typically contains the bare source domain (e.g. `aljazeera.com`, `reddit.com`), even though `.web.uri` is the redirect proxy and `.web.domain` is usually `None` ([python-genai #1512](https://github.com/googleapis/python-genai/issues/1512); [ai.google.dev grounding docs, upd. 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search)).

---

## 1. How grounding works mechanically

**Official pipeline.** Per Google's developer docs ([ai.google.dev/gemini-api/docs/google-search, last updated 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search)) and the ADK grounding docs ([adk.dev/grounding/google_search_grounding](https://adk.dev/grounding/google_search_grounding/), no date shown), grounding is a tool-call loop:

1. **Analysis / decision.** The model decides whether the prompt benefits from search. (Older models exposed an explicit `google_search_retrieval` tool with a *dynamic retrieval* threshold returning a 0–1 prediction score; **all current models use the simpler `google_search` tool** and the model decides internally — [ai.google.dev grounding docs, 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search).)
2. **Query generation (fan-out).** The prompt is **not** sent to Google verbatim. The model rewrites it into one or more search-optimized sub-queries ([ai.google.dev grounding docs, 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search)).
3. **Retrieval against the live Google Search index** — not a cached snapshot. Vendor analysis claims that because grounding hits the live index per query, citation lists shift within hours of a Google ranking change ([websearchapi.ai blog, undated](https://websearchapi.ai/blog/grounding-with-google-search-gemini-api)) `[treat as vendor inference — no primary confirmation]`.
4. **Context injection + synthesis.** Retrieved passages are injected into the model context; the model writes a grounded answer ([adk.dev grounding docs](https://adk.dev/grounding/google_search_grounding/)).
5. **Response + `groundingMetadata`** returned to caller.

**Query fan-out volume (measured).** A 501-prompt forced-grounding study via the Gemini 3 API found **avg 10.7 fan-out sub-queries per prompt (range 3–28)**, up 78% from Gemini 2.5's measured **6.01 avg**, and ~5× ChatGPT's volume ([Seer Interactive, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)). Note: that study is on Gemini 3, but it back-references a measured 2.5 baseline of ~6 sub-queries, which is the relevant number for `gemini-2.5-flash`. Other vendor sources cite a "2–12 sub-queries" range ([authoritytech.io, 2026](https://authoritytech.io/curated/how-to-get-cited-google-gemini-2026)) — **consistent with the measured ranges.**

### `groundingMetadata` structure (the citation payload)

From [ai.google.dev grounding docs (2026-05-18)](https://ai.google.dev/gemini-api/docs/google-search) and [adk.dev](https://adk.dev/grounding/google_search_grounding/):

| Field | Contents | Notes for us |
|---|---|---|
| `webSearchQueries` | Array of the actual search queries the model issued | Directly observable fan-out — useful for our prompt/competitor analysis |
| `groundingChunks[]` | Array of `{ web: { uri, title, domain } }` | `uri` = **redirect proxy URL**; `title` = usually the bare domain; `domain` usually `None` |
| `groundingSupports[]` | Maps response text spans (`segment.startIndex`/`endIndex`) → `groundingChunkIndices` | This is how you build inline citations |
| `searchEntryPoint` | Pre-formatted HTML/CSS "Search Suggestions" widget | **ToS:** Google requires this be displayed when showing grounded results ([ai.google.dev docs](https://ai.google.dev/gemini-api/docs/google-search); [adk.dev](https://adk.dev/grounding/google_search_grounding/)) |

**Known gotcha:** When you request **structured JSON output**, `groundingMetadata` frequently comes back **empty**, and the support offsets become invalid when the output format changes ([Cennest, 2025-07-08](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/)). **Implication for Lumidian:** if our tracking calls Gemini with a forced JSON schema, we may be silently losing citation metadata. **[unverified inference — worth checking our `llm_service.py` Gemini call config against this.]**

---

## 2. The `grounding-api-redirect` URLs — formation and resolution (KEY SECTION)

### Formation
- Format: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/<TOKEN>` where `<TOKEN>` is a long, random-looking, Base64-ish signed string ([python-genai #1512](https://github.com/googleapis/python-genai/issues/1512); [Cennest, 2025-07-08](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/); [Firstenberg/Medium, 2025-02-06](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d) **[POSSIBLY STALE — Feb 2025]**).
- Tokens are **signed**; a single-character mismatch makes the link useless ([Cennest, 2025-07-08](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/)).
- The proxy is intentional: Google returns a redirect through its own infra rather than the raw source URL. Google has **not** documented a way to get the raw URL directly, and a standing feature request asks them to ([discuss.ai.google.dev #107352, opened 2025-10-12, still open w/ +1s through 2026-01-10](https://discuss.ai.google.dev/t/feature-request-provide-actual-source-urls-in-grounding-metadata/107352)).

### CAN a developer resolve them to the real domain? **YES — by following the redirect.**

This is the answer to the data blind spot. Multiple independent sources confirm the only working method is an HTTP request that follows the redirect chain and reads the final URL:

```python
# Community-standard resolver (Cennest, 2025)
import requests
def resolve(redirect_url):
    r = requests.head(redirect_url, allow_redirects=True, timeout=5)
    return r.url   # final real source URL, e.g. https://www.reddit.com/r/...
```
([Cennest, 2025-07-08, upd. 2025-10-06](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/))

- The python-genai issue reporter independently states the only documented method is "performing another HTTP request to `vertexaisearch.cloud.google.com` and following the redirects" ([python-genai #1512](https://github.com/googleapis/python-genai/issues/1512)).
- `HEAD` is preferred (no body download); `GET` with `allow_redirects=True` also works. If `HEAD` is rejected by a destination, fall back to `GET`. **[unverified inference — standard HTTP practice, not stated by Google.]**

### Caveats / failure modes (these matter for a reliable pipeline)
- **Expiry:** redirects are temporary and "expire after a few days" — resolve **at ingest**, then cache the resolved domain. Do not store only the proxy URL for later resolution ([Cennest, 2025-07-08](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/)).
- **Gemini's own URL-context tool cannot follow these redirects** — if you feed a redirect URL back into Gemini's `url_context` tool it fails; you must resolve to the real URL first, then pass that ([python-genai #1322, opened 2025-09-01, closed P3/bug](https://github.com/googleapis/python-genai/issues/1322)). This confirms the proxy is opaque to Google's *own* fetch tooling, so external HTTP resolution is the sanctioned path.
- **Rate limits on resolution:** No primary source quantifies redirect-resolution throttling specifically. Separately, the grounding *generation* endpoint has been reported to 429 (`RESOURCE_EXHAUSTED`) after ~2,000 grounding calls even on "Unlimited" quota ([discuss.ai.google.dev #123549](https://discuss.ai.google.dev/t/429-resource-exhausted-when-using-grounding-tool-on-tier-3-api-key/123549)). For the *redirect-following* HTTP calls (which hit `vertexaisearch.cloud.google.com`, not the Gemini API), throttling risk under burst is plausible — **[unverified inference; mitigate with HEAD + small concurrency + retry, mirroring our existing Serper burst-throttle lesson.]**

### Cheap partial alternative (no extra HTTP call)
- `groundingChunks[].web.title` already carries the **bare domain** (e.g. `reddit.com`, `forbes.com`) in most cases, while `.web.uri` is the proxy and `.web.domain` is `None` ([python-genai #1512](https://github.com/googleapis/python-genai/issues/1512); [ai.google.dev docs, 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search)).
- **Recommendation for Lumidian's citation extractor:** use `title` for fast domain-level classification (own/competitor/third-party — same buckets as our `CitationSource.kind`), and **additionally** follow the redirect at ingest to capture the **full path** (needed for "which exact page got cited"). Title alone gives domain; only resolution gives the page URL. **[unverified inference, grounded in the field semantics above.]**

---

## 3. What determines which sources ground a response

- **Live Google Search ranking is the substrate.** Grounding retrieves from Google's live index, so cited URLs track current Google rankings rather than a frozen snapshot ([ai.google.dev docs, 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search); vendor amplification: [websearchapi.ai, undated](https://websearchapi.ai/blog/grounding-with-google-search-gemini-api)).
- **BUT ranking ≠ citation.** A 100k-keyword study found only **38% of pages cited in AI Overviews also rank in the top 10** for that query (down from 76% seven months earlier), and the Gemini 3 model swapped out **~42% of previously cited domains** and pulled **32% more sources per response** ([SE Ranking, 2026](https://seranking.com/blog/gemini-3-impact-on-ai-overviews/)). **Conflict/nuance recorded:** grounding leans on Google ranking but is clearly *not* a top-10 mirror — passage-level relevance and freshness override raw rank.
- **Fan-out coverage is the gating mechanism.** A source can only be cited if a fan-out sub-query surfaces it. Brand presence in fan-out queries themselves correlates with citation: **26.4% of fan-outs contained brand names**, and the study explicitly notes brand presence in the fan-out "increases your likelihood of being cited" ([Seer, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)).
- **Fan-out is long-tail.** 95% of generated sub-queries had **zero global search volume**; avg 6.7 words; ~1% overlap (nearly all unique) ([Seer, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)). **Implication:** optimizing for head keywords is the wrong target; coverage of specific attribute/comparison long-tail phrasings is what gets surfaced.
- **Vendor-claimed scoring layer (treat as secondary):** several SEO vendors describe a "GEO confidence threshold" (~0.70+) and E-E-A-T / Knowledge-Graph entity alignment / structured-data signals feeding selection ([authoritytech.io, 2026](https://authoritytech.io/curated/how-to-get-cited-google-gemini-2026); [oltre.ai, 2026](https://www.oltre.ai/blog/how-to-get-cited-by-gemini/)). **No primary Google source confirms a numeric confidence threshold — tag `[vendor inference, unverified]`.**

---

## 4. Content traits that help a page get grounded / cited

Measured / well-supported:
- **Recency / visible dates.** 21.3% of fan-out queries included a year (mostly 2024–2025), implying Gemini actively searches for and weighs visible publish/update dates ([Seer, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)). Cross-vendor: AI platforms cite content ~25.7% fresher than traditional organic ([authoritytech.io, 2026](https://authoritytech.io/curated/how-to-get-cited-google-gemini-2026)) `[vendor stat]`.
- **Depth on attributes/comparisons.** Fan-outs target comparisons, attributes, and specialized detail rather than surface info — deeper, specific content correlates with citation ([Seer, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)).
- **Answer-first / passage-extractable structure.** Grounding is passage-level (`groundingSupports` maps to text spans), so content that puts a clean, quotable claim in a discrete passage is more extractable ([ai.google.dev docs, 2026-05-18](https://ai.google.dev/gemini-api/docs/google-search); [Seer, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)).

Vendor-claimed (directionally consistent, not primary):
- **Schema / structured data** as a "machine-readable summary" that gives Gemini a clean extraction path ([authoritytech.io, 2026](https://authoritytech.io/curated/how-to-get-cited-google-gemini-2026); [oltre.ai, 2026](https://www.oltre.ai/blog/how-to-get-cited-by-gemini/)) `[vendor inference]`.
- **Knowledge-Graph entity alignment + earned-media corroboration** ([Contently, 2026-04-29](https://contently.com/2026/04/29/top-sources-llms-cite/); [authoritytech.io, 2026](https://authoritytech.io/curated/how-to-get-cited-google-gemini-2026)) `[vendor inference]`.

---

## 5. Authority domains vs. social / UGC — does Gemini favor one?

**Finding: Gemini citations are dominated by social/UGC, NOT traditional authority/media.** This is the strongest empirical signal in the corpus.

Ahrefs Brand Radar, **3M+ US queries, published 2026-06-01** ([ahrefs.com](https://ahrefs.com/blog/most-cited-domains-gemini/)):

| Rank | Domain | Mention share | Class |
|---|---|---|---|
| 1 | reddit.com | 27.5% | UGC/social |
| 2 | youtube.com | 13.7% | UGC/social |
| 3 | en.wikipedia.org | 12.7% | Reference |
| 4 | forbes.com | 2.9% | Media |
| 5 | walmart.com | 2.8% | Commercial |
| 6–50 | — | 1.9%→0.5% | mixed (eBay, retailers, etc.) |

- **Reddit + YouTube alone ≈ 41% of top-50 mention share; Wikipedia adds 12.7%.** Traditional media is small and shrinking: media sites were ~2.17% of citations pre-Gemini-3 and ~2.03% after ([SE Ranking, 2026](https://seranking.com/blog/gemini-3-impact-on-ai-overviews/)).
- Cross-engine corroboration: Reddit is the #1 source across major AI engines (~40% frequency); engines treat Reddit threads as authentic, experience-based, community-validated content — "the signal isn't link authority, it's discussion depth" ([Contently, 2026-04-29](https://contently.com/2026/04/29/top-sources-llms-cite/)).
- **Caveat / conflict:** Ahrefs measures *AI-Overviews-style consumer queries across all topics*; share is topic-dependent and B2B/technical niches skew more toward docs/vendor sites. **[unverified inference]** Also: Reddit's dominance partly reflects Google's commercial Reddit data deal feeding the index, not a pure quality judgment ([Yahoo Finance/Contently coverage, 2026](https://finance.yahoo.com/sectors/technology/articles/chatgpts-gatekeepers-wikipedia-reddit-sites-150000043.html)) `[context, not primary]`.

**Net:** Gemini does **not** prefer "authority domains" in the classic high-DR-media sense. It heavily favors **UGC discussion platforms (Reddit, YouTube)** and **canonical reference (Wikipedia)**. This aligns with Lumidian's existing draft-platform priorities (reddit, quora, medium, wikipedia) and is a point *for* the Reddit/Wikipedia surfaces, *against* over-indexing on press/media placements for Gemini specifically.

---

## Implications for Lumidian (action-relevant)

1. **Fix the citation blind spot:** in the Gemini path of the citation extractor, (a) read `groundingChunks[].web.title` for fast domain classification, and (b) **follow each `groundingChunks[].web.uri` redirect at ingest** (`HEAD`, `allow_redirects=True`, small timeout, modest concurrency, retry on throttle) to capture the real page URL before it expires (~days). Store the resolved URL on `CitationSource.url` and the host on `CitationSource.domain`. **[recommendation; mechanics primary-sourced above]**
2. **Check our Gemini call config:** if we force a JSON response schema on the grounded Gemini call, `groundingMetadata` may return empty — verify in `services/llm_service.py`. **[unverified — verify in code]**
3. **Also capture `webSearchQueries`** — the fan-out queries are a free competitor/topic intelligence signal and tell us which long-tail phrasings Gemini actually issued for our prompts.
4. **Strategy:** for Gemini visibility specifically, weight Reddit + Wikipedia + (where relevant) YouTube over press/media. Emphasize visible dates and discrete, quotable, attribute/comparison-level passages.

---

## Source ledger (with dates & staleness flags)

| Source | Date | Type | Flag |
|---|---|---|---|
| [ai.google.dev — Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search) | upd. 2026-05-18 | **Primary (Google)** | current |
| [adk.dev — Google Search Grounding (ADK)](https://adk.dev/grounding/google_search_grounding/) | undated | Primary (Google ADK) | no date shown |
| [googleapis/python-genai #1512](https://github.com/googleapis/python-genai/issues/1512) | 2025/2026 | Primary (Google repo issue) | current-ish |
| [googleapis/python-genai #1322](https://github.com/googleapis/python-genai/issues/1322) | opened 2025-09-01 | Primary (Google repo issue) | current |
| [discuss.ai.google.dev — feature request #107352](https://discuss.ai.google.dev/t/feature-request-provide-actual-source-urls-in-grounding-metadata/107352) | 2025-10-12 → 2026-01-10 | Google forum | current |
| [discuss.ai.google.dev — 429 grounding #123549](https://discuss.ai.google.dev/t/429-resource-exhausted-when-using-grounding-tool-on-tier-3-api-key/123549) | 2025/2026 | Google forum | current |
| [Cennest — Gemini 2.5 Flash grounding source URLs](https://www.cennest.com/making-sense-of-the-gemini-2-5-flash-with-google-grounding-source-urls/) | 2025-07-08 (upd. 2025-10-06) | Vendor/eng blog | current (updated) |
| [Firstenberg/Medium — grounding + LangChainJS](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d) | 2025-02-06 | Eng blog | **[POSSIBLY STALE]** |
| [Seer Interactive — Gemini 3 query fan-out research](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research) | 2025-11-21 | Controlled study (501 prompts) | current |
| [Ahrefs — 50 most-cited domains in Gemini](https://ahrefs.com/blog/most-cited-domains-gemini/) | 2026-06-01 | Large-N data study (3M+ queries) | current |
| [SE Ranking — Gemini 3 impact on AI Overviews](https://seranking.com/blog/gemini-3-impact-on-ai-overviews/) | 2026 | Data study (100k keywords) | current |
| [Contently — Top sources LLMs cite 2026](https://contently.com/2026/04/29/top-sources-llms-cite/) | 2026-04-29 | Vendor analysis | current |
| [authoritytech.io — Get cited in Gemini 2026](https://authoritytech.io/curated/how-to-get-cited-google-gemini-2026) | 2026 | Vendor SEO | vendor inference |
| [oltre.ai — How to get cited by Gemini 2026](https://www.oltre.ai/blog/how-to-get-cited-by-gemini/) | 2026 | Vendor SEO | vendor inference |
| [websearchapi.ai — Grounding with Google Search](https://websearchapi.ai/blog/grounding-with-google-search-gemini-api) | undated | Vendor | vendor inference |
| [Yahoo Finance — ChatGPT's gatekeepers (Reddit/Wikipedia)](https://finance.yahoo.com/sectors/technology/articles/chatgpts-gatekeepers-wikipedia-reddit-sites-150000043.html) | 2026 | Press | context only |

### Recorded conflicts
- **Fan-out count:** Seer measures ~6 sub-queries for Gemini 2.5 and 10.7 for Gemini 3; vendors quote "2–12." Ranges overlap; use ~6 as the 2.5-flash working figure ([Seer, 2025-11-21](https://www.seerinteractive.com/insights/gemini-3-query-fan-outs-research)).
- **Ranking ↔ citation:** docs imply grounding tracks live Google ranking, but [SE Ranking, 2026](https://seranking.com/blog/gemini-3-impact-on-ai-overviews/) shows only 38% citation/top-10 overlap — grounding is rank-influenced but not rank-equivalent.
- **"GEO confidence ~0.70 threshold":** asserted by SEO vendors, **not confirmed by any Google primary source** — flagged unverified.
