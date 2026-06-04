# Stream 3 — First-Principles Model-Retrieval Mechanics (Synthesis)

**Purpose:** Synthesize the four Stream 2 per-model deep dives (ChatGPT, Claude, Perplexity, Gemini) plus Stream 1 first-party citation mining into (1) a cross-model mechanics comparison, (2) the universal citation drivers that become Layer B's content rules, and (3) the highest-leverage per-model levers.

**Compiled:** 2026-06-03
**Inputs:** `stream2-model-chatgpt.md`, `stream2-model-claude.md`, `stream2-model-perplexity.md`, `stream2-model-gemini.md`, `stream1-citation-mining.md`
**Sourcing convention:** Every claim traces to one of those reports (which carry the underlying primary/secondary citations). Claims that go *beyond* the source reports are tagged `[unverified inference]`. Cross-report conflicts are called out explicitly.

> **Confidence framing.** The four model reports are themselves a mix of primary docs (API mechanics — high confidence) and secondary citation-index studies (ranking/UGC tilt — directional only). Stream 1 is first-party production data but is single-brand/single-vertical skewed and blind on two of four models. Where Stream 1 (our own data) conflicts with the external Stream 2 studies, both are noted — neither auto-wins.

---

## 1. Cross-Model Comparison

| Mechanic | **ChatGPT** (`gpt-4o-mini` + `web_search`, Responses API) | **Claude** (`claude-haiku-4-5` + `web_search_20250305`) | **Perplexity** (sonar / sonar-pro) | **Gemini** (`gemini-2.5-flash` + `google_search` grounding) |
|---|---|---|---|---|
| **Search backend / index** | Own `OAI-SearchBot` index + historical Bing dependency + content-partner feeds (Reddit, news). Likely a **hybrid**; Bing-vs-own weighting in mid-2026 unresolved.¹ Retrieval depth is shallow (~top-10/20 organic) and sensitive to upstream SERP infra (the Sept-2025 `num=100` event).¹ | **Brave Search** (strong circumstantial evidence — subprocessor list + reverse-engineered `BraveSearchParams`; never officially confirmed; sources ~14mo old).² Claude largely passes Brave's top organic results through with minimal re-ranking (~86.7% overlap).² | Proprietary crawl/index/embedding (`pplx-embed`, Feb 2025) **blended with third-party Google/Bing SERP data** (Reddit honeypot litigation, Oct 2025). Hybrid; unresolved.³ Started on Bing Web Search API (2022), migrated off.³ | **Live Google Search index** (not a cached snapshot). Prompt is rewritten into multiple search-optimized **fan-out sub-queries** (~6 avg for 2.5; range 2–28).⁴ |
| **Recency window / freshness weighting** | No published cutoff. Freshness is a *ranking signal, not a hard filter*; news-partner feeds + continuous re-crawl (~24h robots lag). Live `ChatGPT-User` fetch possible.¹ | No published window. Brave organic recency is the substrate. `web_search_result` carries a `page_age` field, implying age is available to selection.² | **Freshness is the dominant, most-replicated signal** — strongest recency bias of any engine. Window ~12–18mo for general; compresses to **48–72h for breaking topics**. `dateModified`/sitemap `<lastmod>` drive recrawl. (Weight magnitude conflicts: ~44% per SE Ranking vs ~15% per other vendors.)³ | Strong freshness weighting; AI platforms cite content ~25.7% fresher than organic. ~21.3% of fan-out sub-queries include a year, implying active date-seeking.⁴ |
| **Snippet vs. full-page reading** | **Snippet/summary mode** for non-reasoning models like `gpt-4o-mini` — operates on retrieved top-result summaries, not full-page fetches. (Reasoning models can agentically open pages.) Answer-bearing content must survive snippet extraction.¹ Search context capped 128k tokens.¹ | **Snippet-level selection.** Citation carries a ≤150-char `cited_text` snippet — Claude selects the most relevant *quotable sentence*, so crisp self-contained factual sentences are structurally favored.² | **Passage/snippet-level.** Retrieves tens–hundreds of candidates, an L1–L3 reranker keeps ~top 30%, then constrained synthesis over passages.³ Citation slots scarce vs. candidates ("cited or invisible").³ | **Passage-level.** `groundingSupports[]` map answer text spans → grounding chunks; content that puts a clean quotable claim in a discrete passage is more extractable.⁴ |
| **How citations are returned programmatically** | **Two sets:** (a) inline `url_citation` annotation objects (URL + title + char offsets) attached to answer spans = *visible* citations; (b) `sources` field = full list consulted. **Consulted ≠ cited.** URLs are structured, not bare prose.¹ | **Structured objects, NOT inline prose URLs.** `web_search_result_location` objects on `text` blocks' `citations[]` (URL, title, `cited_text`, opaque `encrypted_index`), plus raw `web_search_tool_result` blocks. Regex over prose finds ~nothing.² | **Inline citations in prose** (Sonar returns prose with built-in inline citations; Search API returns structured `results[]` with `url`/`snippet`/`date`). Sonar Pro ≈ 2× Sonar citations.³ | **Opaque redirect proxies.** `groundingChunks[].web.uri` = `vertexaisearch.cloud.google.com/grounding-api-redirect/<token>`; `.web.domain` usually `None`; `.web.title` usually carries the **bare domain**. Real URL requires following the HTTP redirect (expires in ~days).⁴ |
| **UGC / social tilt** | **Mixed, trending to authority.** UGC-dominant pre-Sept-2025 (Reddit ~60%, Wikipedia ~55%), then a ChatGPT-only collapse to Reddit ~10% / Wikipedia <20%, with editorial winners (Forbes, Medium, PR Newswire). Wikipedia still a canonical favorite. (Reddit may still influence answers invisibly.)¹ | **Low / authority-leaning** `[unverified inference]`. No Claude-specific domain study exists; big studies exclude Claude. Expected to track Brave organic authority pages, *not* a fixed UGC whitelist (unlike Perplexity).² | **High — strongest UGC tilt of any engine.** Reddit #1 (#1 most-cited domain), plus YouTube/LinkedIn/forums, blended with selective institutional authority (NIH, Gartner). Wikipedia near-absent.³ | **High.** Reddit 27.5% + YouTube 13.7% ≈ 41% of top-50 mention share; Wikipedia 12.7%; traditional media small (~2%). Favors UGC discussion + canonical reference.⁴ |
| **Notable quirks** | Retrieval depth tied to upstream SERP infra (num=100 event). `gpt-4o-mini` may not be on the current supported web-search model list — verify it still works in prod.¹ Lumidian sees heavy `google.com/maps` redirect noise in ChatGPT citations.⁵ | **Lumidian extractor drops Claude citations entirely** (no `_extract_claude_citations`; regex-over-prose finds nothing) — Claude contributes ~0 to citation/SOV/gap analytics despite being Pro-tier.²,⁵ Newer `_20260209` adds dynamic filtering — not on our version. | **Legal/availability risk on Reddit** (Reddit v. Perplexity, Oct 2025; claimed ~86% Reddit-share drop post-suit, unverified). Citation mix actively shifting.³ Backlinks/domain authority matter *less* than Google. | **JSON-output gotcha:** forcing a structured JSON schema can return **empty `groundingMetadata`** — possible silent citation loss in our config.⁴ `webSearchQueries` is free competitor/topic intel. Lumidian stores Gemini citations as opaque redirects (blind).⁴,⁵ |

**Source key:** ¹ stream2-chatgpt · ² stream2-claude · ³ stream2-perplexity · ⁴ stream2-gemini · ⁵ stream1-citation-mining

---

## 2. Universal Citation Drivers (→ Layer B content rules)

These are the traits rewarded by **all or most** models. Each is the candidate set of *universal* content rules — apply to every draft regardless of target model. Supporting model-report(s) noted.

1. **Answer-first / BLUF structure (front-load the direct answer).**
   - ChatGPT: "44% of ChatGPT citations come from the first third of content"; snippet-mode retrieval rewards front-loaded answers.¹
   - Perplexity: "90% of top-cited sources answered the core question within the first 100 words."³
   - Gemini: passage-level grounding rewards a clean quotable claim in a discrete passage.⁴
   - Claude: ≤150-char `cited_text` mechanic favors crisp self-contained sentences.²
   - **Supported by all four.** Strongest universal driver.

2. **Concrete statistics with numbers (ideally in tables / bold standalone claims).**
   - ChatGPT: Princeton GEO — "Add statistics" = ~30–40%+ lift, one of the three strongest single tactics; stats in tables/bold extract better than stats buried in prose.¹
   - Claude: same Princeton GEO study — Statistics Addition among the biggest gains (~30–40%).²
   - Perplexity: factual, well-structured prose with specific data correlates with citation.³
   - **Supported by ChatGPT + Claude (controlled GEO evidence), reinforced by Perplexity.**

3. **Direct quotations from named/relevant sources.**
   - ChatGPT: Princeton GEO — Quotation Addition strong lift (~28%); expert-quote pages averaged 4.1 vs 2.4 citations.¹
   - Claude: Princeton GEO — Quotation Addition among biggest gains.²
   - **Supported by ChatGPT + Claude (controlled GEO evidence).**

4. **Inline citations to external authoritative sources within your own content.**
   - ChatGPT: Princeton GEO — "Cite Sources" strong lift; **+115% for lower-ranked (SERP ~pos 5) pages** (helps the underdog most).¹
   - Claude: Princeton GEO — Cite Sources among the biggest gains.²
   - **Supported by ChatGPT + Claude (controlled GEO evidence).** Especially high-leverage for pages not already top-authority.

5. **Freshness / dated, maintained content (visible publish/update dates, `dateModified`).**
   - Perplexity: freshness is the *dominant* signal; on-page dates + `dateModified` drive recrawl priority.³
   - Gemini: ~21.3% of fan-outs include a year; AI cites ~25.7% fresher content; visible dates weighed.⁴
   - ChatGPT: recency is an explicit ranking signal (news-partner feeds).¹
   - **Supported by Perplexity (strongest) + Gemini + ChatGPT.** Weakest signal for Claude (no direct evidence).

6. **Extractable, self-contained passages (clear H2/H3 structure, ~120–180-word answer blocks).**
   - ChatGPT: ~120–180-word sections between headings cited ~70% more than <50-word sections; FAQ/direct-answer formatting preferred.¹
   - Gemini: passage-level grounding (`groundingSupports` → spans) rewards discrete quotable passages.⁴
   - Perplexity: clean structured prose matching specific query intent.³
   - Claude: ≤150-char snippet selection favors discrete quotable sentences.²
   - **Supported by all four.**

7. **Structured data / schema (JSON-LD).**
   - Perplexity: schema-enabled pages ~47% Top-3 citation rate vs ~28% (≈19pp lift); Person/Article schema ~2.3× higher.³ (Correlational.)
   - Gemini: schema as a "machine-readable summary" giving a clean extraction path.⁴ (Vendor inference.)
   - **Supported by Perplexity (correlational) + Gemini (vendor inference).** *Weaker evidentiary tier* — not confirmed for ChatGPT/Claude; treat as a recommended-but-unproven universal. `[partial — evidence is correlational/vendor, not controlled]`

8. **Topical depth on attributes / comparisons over head-keyword breadth.**
   - Perplexity: niche in-depth pages outrank big domains; backlinks are *not* a strong gate ("92.78% of cited pages have <10 referring domains").³
   - Gemini: fan-outs target comparisons/attributes; 95% of sub-queries had zero search volume — long-tail coverage wins, head keywords are the wrong target.⁴
   - **Supported by Perplexity + Gemini.**

**Anti-patterns (universally neutral-to-negative):** keyword stuffing (Princeton GEO: *worse* than baseline — ChatGPT + Claude¹,²), "authoritative tone" wording changes with no substance, and excessive meta-tag manipulation (ChatGPT¹).

---

## 3. Per-Model Levers (the 1–2 things that matter MOST per model)

**ChatGPT**
1. **Rank on page 1 of organic / be in the shallow candidate pool.** Retrieval depth is ~top-10/20 and sensitive to SERP infra (num=100 event); if you're not in the first page of results you're not eligible, regardless of on-page craft.¹
2. **Weight toward authoritative editorial + Wikipedia, not UGC, for *visible* citations** — ChatGPT specifically demoted Reddit/UGC in displayed citations post-Sept-2025 (Forbes/Medium/PR Newswire/Wikipedia gained).¹

**Claude**
1. **Fix the extractor first (instrumentation, not content).** We currently capture ~0 Claude citations; until `web_search_result_location` objects are parsed into `query_results.citations`, Claude is invisible in our analytics and no content lever can be measured.²,⁵
2. **Rank in Brave Search organic** (distinct from Bing/Google) — Claude ≈ Brave's top organic with minimal re-ranking, so Brave rank is the dominant recall lever `[if Brave backend still holds — verify periodically]`.²

**Perplexity**
1. **Freshness** — recent/visible dates and `dateModified`, maintained content. It's the single most-replicated, dominant Perplexity signal (window ~12–18mo, far tighter for news).³
2. **BLUF + JSON-LD schema** — answer in the first 100 words plus structured data (Person/Article) for the largest measured on-page lifts.³ (Reddit is its top domain but is legally contested/volatile — do not over-index.)

**Gemini**
1. **Resolve the redirects + fix JSON-config blind spot (instrumentation).** All Gemini citations are opaque proxies; follow the redirect at ingest and verify a forced JSON schema isn't nulling `groundingMetadata`.⁴,⁵
2. **Cover long-tail attribute/comparison phrasings (fan-out coverage)** and lean Reddit + Wikipedia + YouTube — a source can only be cited if a fan-out sub-query surfaces it, and 95% of those sub-queries are zero-volume long-tail.⁴

---

## 4. Conflicts to Record (cross-report and report-vs-Stream-1)

1. **UGC tilt: external studies vs. our production data (the biggest conflict).** Stream 2 says Reddit is the #1 cited domain for Perplexity and Gemini, and historically high for ChatGPT. **Stream 1 found exactly zero Reddit/Quora/Medium/LinkedIn/X citations** across 1,669 ChatGPT + 480 Perplexity production citations — a 0% rate on the five platforms our content engine writes for.⁵ **Reconciliation:** Stream 1 is single-brand/single-vertical (B2B finance — Manhattan Street Capital) and blind on Claude+Gemini. The conflict is likely **query-mix/vertical-driven** (B2B/finance → authority + primary sources; broad consumer → UGC), consistent with stream2-claude's note that Grow & Convert found industry sites ~86% vs generic ~16%.² **Do not assume UGC tilt generalizes to B2B verticals.** This is the central unresolved tension Layer B must hold.

2. **ChatGPT UGC over time (intra-report).** Aggregate/2026 studies (Writesonic, Peec) keep Reddit at/near #1 across engines; ChatGPT-specific trackers (Semrush, IndexLab) show a sharp ChatGPT-only Reddit/Wikipedia *visible-citation* decline from Sept 2025. Both true: aggregate driven by Perplexity/Gemini; ChatGPT demotes UGC in *displayed* citations.¹

3. **Perplexity freshness weight magnitude.** SE Ranking ~44.2% vs other vendors ~15%. Direction (freshness is top-tier) is consistent; magnitude is not.³

4. **Perplexity retrieval architecture.** Own index (pplx-embed) vs. still ingesting Google/Bing SERPs (honeypot litigation). Unresolved; treat as hybrid — classic indexability still matters.³

5. **Claude backend (Brave).** Reverse-engineered + subprocessor-list inference, ~14mo old, never confirmed by Anthropic. Best-available but unconfirmed/possibly stale.²

6. **Gemini ranking ≠ citation.** Docs imply grounding tracks live Google ranking, but only 38% of cited pages rank top-10 (down from 76%); Gemini 3 swapped ~42% of cited domains. Grounding is rank-influenced, not rank-equivalent.⁴

7. **GEO trait transfer to Claude/Perplexity/Gemini.** The Princeton GEO controlled evidence (statistics/quotations/citations lifts) was run on a Bing-Chat-like harness, not against Claude/Brave, Perplexity, or Gemini specifically. The mechanism (an LLM selecting quotable, well-sourced sentences) is provider-agnostic and plausibly transfers, but magnitudes are `[unverified inference]` for the non-ChatGPT engines.¹,²

8. **Schema/JSON-LD as a universal.** Only correlational (Perplexity) or vendor-inferred (Gemini); no controlled evidence and nothing for ChatGPT/Claude. Include as a recommended universal but flag the weaker evidentiary basis. `[partial]`

---

## 5. Two Instrumentation Caveats That Gate Everything

Both Stream 1 and Stream 2 independently surface the same blind spots — these must be fixed before any per-model content lever can be *measured* on our own data:

- **Claude:** structured `web_search_result_location` citations are never extracted (regex-over-prose path); ~0 Claude citation rows in production.²,⁵
- **Gemini:** citations stored as opaque `grounding-api-redirect` proxies (domain logged as `google.com`); must follow the redirect at ingest (expires in ~days), and verify a forced JSON schema isn't returning empty `groundingMetadata`.⁴,⁵

Until both are fixed, two of four models are analytics blind spots and the external Stream 2 research carries extra weight for Claude and Gemini specifically.

---

### Summary of universal citation drivers (3 sentences)

Across all four engines the most robust, multiply-supported content rules are **answer-first/BLUF structure** and **discrete extractable passages** (every model) plus **concrete statistics, direct quotations, and inline citations to external authorities** (controlled Princeton-GEO evidence for ChatGPT and Claude, ~30–40% lifts), with **freshness/dated content** dominant for Perplexity and Gemini and a likely-but-weaker **schema/JSON-LD and topical-depth-over-head-keywords** pair. The strongest unresolved tension is the **UGC tilt conflict**: external studies put Reddit/UGC at #1 for Perplexity and Gemini, yet Lumidian's own production data shows a 0% citation rate on Reddit/Quora/Medium/LinkedIn/X — most plausibly because our sample is single-vertical B2B/finance, where models lean on authority, Wikipedia, and primary sources instead. Acting on per-model levers for Claude and Gemini is currently blocked by two instrumentation bugs (unextracted Claude structured citations; unresolved Gemini redirect proxies) that must be fixed before those levers can be measured on first-party data.
