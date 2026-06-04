# Stream 2 — Model Deep Dive: Claude `web_search_20250305` Server-Side Tool

**Research question:** How does Anthropic's Claude `web_search_20250305` server-side tool (used with `claude-haiku-4-5`) retrieve and cite web content as of 2026? Which backend? What determines surfacing/citing? How are citations structured in the API response? What content traits drive citation? And how should a developer correctly extract Claude web-search citations?

**Date of research:** 2026-06-03
**Author:** Internal AIO research pass (Stream 2)
**Source-quality convention:** Primary sources (Anthropic official docs / release notes / controlled academic studies) weighted over vendor SEO blogs. Every claim carries an inline source URL or an `[unverified inference]` tag. Sources older than ~12 months flagged as possibly stale.

---

## TL;DR (the load-bearing findings)

1. **Claude returns web-search citations as STRUCTURED objects, not inline URLs in prose.** Each citation is a `web_search_result_location` object attached to a `text` content block's `citations` array, and the source URLs *also* appear in separate `web_search_tool_result` content blocks. The prose text Claude emits generally does **not** contain inline URLs. A regex-over-`response_text` extractor will therefore miss Claude citations almost entirely. Source: [Anthropic web search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) (current as of 2026-06-03).
2. **Backend is Brave Search** (strong circumstantial evidence; never officially confirmed by Anthropic as of the source date). Source: [TechCrunch, 2025-03-21](https://techcrunch.com/2025/03/21/anthropic-appears-to-be-using-brave-to-power-web-searches-for-its-claude-chatbot/) — **flag: ~14 months old, possibly stale.**
3. **What gets cited ≈ Brave's top organic results, lightly re-ranked.** ~86.7% overlap with Brave's top non-sponsored results in one vendor analysis. Source: [Profound, 2025-03-21](https://www.tryprofound.com/blog/what-is-claude-web-search-explained) — **flag: ~14 months old.**

---

## 1. Which search backend does it use?

**Claim: Claude's web search is powered by Brave Search.** This is *not* officially documented by Anthropic; it is strong circumstantial evidence.

Evidence (all from [TechCrunch, 2025-03-21](https://techcrunch.com/2025/03/21/anthropic-appears-to-be-using-brave-to-power-web-searches-for-its-claude-chatbot/)):
- Anthropic added **"Brave Search" to its subprocessor list** the same week web search launched.
- Simon Willison found that at least one search returned **identical citations** between Claude and Brave, and discovered a parameter literally named **`BraveSearchParams`** in Claude's web-search implementation.
- At the time of the article, **Anthropic had not confirmed** the partnership (TechCrunch said "We've reached out to Anthropic and will update…"). The article hedges with "appears to be."

Corroborating vendor analysis ([Profound, 2025-03-21](https://www.tryprofound.com/blog/what-is-claude-web-search-explained)): an **86.7% overlap** (p < 0.0001) between Claude's surfaced/cited results and Brave's top non-sponsored organic results across tested queries, with some queries at 100% top-5 match. Claude "relies on Brave Search's indexed and cached results" rather than crawling independently, and "directly utilises Brave's top-ranked organic results without significant re-ranking."

> **Conflict / nuance:** Anthropic's own docs never name a backend. The Brave attribution is reverse-engineered + subprocessor-list inference, not an Anthropic statement. **Both backend sources are ~14 months old (March 2025)** — Anthropic could have changed or added providers since. Treat "Brave" as the best-available but **unconfirmed and possibly stale** answer. `[unverified inference: still Brave as of mid-2026]`

**AIO implication:** if the Brave-backend finding still holds, ranking in **Brave Search** organic results is a strong proxy for Claude web-search visibility — and this is a *different* optimisation target than Bing (ChatGPT) or Google (Gemini). Profound measured only ~20% Claude↔ChatGPT result overlap, confirming the targets diverge.

---

## 2. What determines which results are surfaced and cited?

**Retrieval (Anthropic-controlled, [official docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)):**
1. Claude decides *when* to search based on the prompt (recency, changing facts, specific orgs/people/products, or explicit "look it up" requests). It answers from parametric knowledge for stable facts.
2. The API executes the search(es) — possibly multiple rounds in a single turn — and feeds results back to Claude. Results are **encrypted** before re-entering context (`encrypted_content`).
3. At end of turn, Claude emits a final answer **with cited sources**.

**What gets surfaced:** the underlying search provider (Brave, per §1) returns the candidate set; Profound's analysis indicates Claude largely **passes Brave's top organic ranking through with minimal re-ranking** ([Profound, 2025-03-21](https://www.tryprofound.com/blog/what-is-claude-web-search-explained)).

**What Claude chooses to *cite* from that set** is governed by relevance to the specific claim it's making — the citations feature "was found to be significantly more likely to cite the most relevant quotes" and citations are "guaranteed to contain valid pointers" because they're parsed, not free-text generated ([Anthropic citations docs](https://platform.claude.com/docs/en/build-with-claude/citations)). So: **Brave decides candidate recall; Claude decides which candidate sentence supports each claim.**

**Developer levers over surfacing (official docs):**
- `allowed_domains` / `blocked_domains` — whitelist/blacklist source domains.
- `user_location` (approximate city/region/country/timezone) — localises results.
- `max_uses` — caps number of searches (1–3 for simple lookups, 15–20+ for research).
- System-prompt steering of search eagerness.
- Newer `web_search_20260209` version adds **dynamic filtering** (Claude writes/executes code to prune results before they hit context) — but this requires the code-execution tool and **is not available on `web_search_20250305`**, the version Lumidian uses. Source: [official docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).

---

## 3. How are citations STRUCTURED in the API response? (the core question)

**Answer: Claude returns citations as structured objects in two places, NOT as inline URLs in the answer text.** Verbatim from the [official web search docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), the `assistant` message `content` array contains, in order:

1. A `text` block — Claude's decision to search (no URL).
2. A `server_tool_use` block — the executed query (`input.query`).
3. A **`web_search_tool_result`** block — the raw result list. Each entry:
   ```json
   {
     "type": "web_search_result",
     "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
     "title": "Claude Shannon - Wikipedia",
     "encrypted_content": "EqgfCioIARgBIiQ3YTAw...",
     "page_age": "April 30, 2025"
   }
   ```
4. One or more **`text` blocks carrying a `citations` array**. Each citation is a `web_search_result_location` object (verbatim):
   ```json
   {
     "type": "web_search_result_location",
     "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
     "title": "Claude Shannon - Wikipedia",
     "encrypted_index": "Eo8BCioIAhgBIiQyYjQ0OWJmZi1lNm..",
     "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001) was an American mathematician..."
   }
   ```

**Field meanings ([official docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)):**
- `url` — the cited source URL (this is the field you want for citation extraction).
- `title` — source page title.
- `cited_text` — up to 150 chars of the cited snippet.
- `encrypted_index` — opaque reference; **must be passed back unchanged in multi-turn conversations** so citations resolve. Do not parse it for a URL.
- On the `web_search_result` blocks, `encrypted_content` must likewise be passed back in follow-up turns.
- Note: `cited_text`, `title`, and `url` **do not count toward token usage**.

**Key structural fact:** the URLs live in (a) `web_search_tool_result` → `web_search_result` blocks and (b) `text` block → `citations[]` → `web_search_result_location.url`. **They are NOT embedded as `https://…` strings inside the human-readable answer prose.** Claude's narrative text is clean prose; the citation is a sibling structured object pointing at the span of text it supports. This is the same model as document citations (`char_location` / `page_location` / `content_block_location`), where the cited claim and its source pointer are separate structured fields ([Anthropic citations docs](https://platform.claude.com/docs/en/build-with-claude/citations)).

**Error handling:** web-search errors still return HTTP 200 with a `web_search_tool_result_error` body (`too_many_requests`, `invalid_input`, `max_uses_exceeded`, `query_too_long`, `unavailable`). Source: [official docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).

---

## 4. How should a developer CORRECTLY extract Claude web-search citations?

**Do NOT regex `https://` out of the answer text — that will miss almost everything,** because Claude's prose rarely contains inline URLs (see §3).

**Correct algorithm (per [official docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)):** iterate `response.content` blocks and pull URLs from the structured objects:

```python
def extract_claude_citations(response) -> list[dict]:
    cites: list[dict] = []
    seen: set[str] = set()
    for block in (response.content or []):
        btype = getattr(block, "type", None)
        # (a) Raw result list — every URL the search surfaced
        if btype == "web_search_tool_result":
            content = getattr(block, "content", None) or []
            # NB: on error this is a single dict, not a list — guard it
            if isinstance(content, list):
                for r in content:
                    if getattr(r, "type", None) == "web_search_result":
                        url = getattr(r, "url", None)
                        if url and url not in seen:
                            seen.add(url)
                            cites.append({"url": url, "title": getattr(r, "title", None)})
        # (b) Citations actually attached to the answer (the ones Claude *used*)
        elif btype == "text":
            for c in (getattr(block, "citations", None) or []):
                if getattr(c, "type", None) == "web_search_result_location":
                    url = getattr(c, "url", None)
                    if url and url not in seen:
                        seen.add(url)
                        cites.append({
                            "url": url,
                            "title": getattr(c, "title", None),
                            "cited_text": getattr(c, "cited_text", None),
                        })
    return cites
```

Distinguish two sets if needed: **(a)** all results surfaced (`web_search_tool_result`) vs **(b)** results Claude actually cited in its answer (`web_search_result_location` on text blocks). For "which domains does Claude cite," set (b) is the precise answer; set (a) is the candidate pool.

### Confirmed gap in the Lumidian codebase

Our own extractor **misses Claude citations**, confirmed by reading the code:

- **`backend/app/services/llm_service.py` → `_query_claude` (lines ~362–414):** the returned dict has **no `citations` key** at all. Unlike `_query_perplexity` (line 458) and the Gemini path which call `_build_result(..., citations=...)`, the Claude path returns a bare dict `{"response_text", "mentioned", "latency_ms", "error"}`. There is **no `_extract_claude_citations` function** — only `_extract_claude_text`, which concatenates `text` blocks and *deliberately skips* `server_tool_use` and `web_search_tool_result` blocks (the very blocks that hold the URLs). So structured citations are dropped at the source.
- **`backend/app/services/site_audit/citations.py` → `extract_urls`:** parses URLs only via `_MD_LINK_RE` / `_BARE_URL_RE` regex over `QueryResult.response_text`. Since Claude's `response_text` is clean prose with no inline URLs, this regex finds (near) nothing for Claude rows. The `CitationSource` extractor (`extract_for_run`) therefore records essentially zero Claude citations.
- For contrast, the codebase already added a `query_results.citations` JSON column (migration dated 2026-06-02, `database.py:727`) and Perplexity/Gemini structured-citation extractors — **Claude was never wired into that path.**

**Fix shape:** add a `_extract_claude_citations(response)` (per algorithm above), pass it through `_build_result(..., citations=...)` in `_query_claude`, and have the `site_audit` citation pipeline read the structured `query_results.citations` column for Claude rows instead of regexing `response_text`. `[unverified inference: this matches how Perplexity/Gemini are already handled, so it should slot into the existing column + extractor pattern]`

---

## 5. What content format/traits make a page more likely to be cited?

Two layers: **(A) get into Brave's top organic results** (recall), then **(B) be the most citable sentence** (selection).

**(B) Citable-content traits — controlled academic evidence.** The **Princeton/Georgia Tech/IIT Delhi/AI2 GEO study** (KDD 2024, "GEO: Generative Engine Optimization," 10k queries on a Bing-Chat-like system) found these tactics lifted citation visibility by **up to ~40%** ([Princeton publication record](https://collaborate.princeton.edu/en/publications/geo-generative-engine-optimization/); plain-English summaries: [SEO.ai](https://seo.ai/blog/generative-engine-optimization-geo), [DerivateX](https://derivatex.agency/blog/princeton-geo-paper-plain-english/)):
- **Statistics Addition**, **Cite Sources (citations/references)**, and **Quotation Addition** drove the biggest gains (each ~30–40%).
- **Fluency Optimization** and **Authoritative Voice** also helped; combining tactics (esp. Statistics + Fluency) compounded.
- **Keyword stuffing performed *worse* than baseline** — classic SEO keyword tactics backfire in generative engines.
- **Caveat:** the test harness mimicked Bing Chat, not Claude/Brave specifically. **`[unverified inference: traits transfer to Claude]`** — the mechanism (LLM selecting quotable, well-sourced sentences) is provider-agnostic, but the study was not run against Claude. Study is ~2 years old (2024) — directionally durable but pre-dates current models. **Flag: possibly stale on magnitudes.**

This aligns with Anthropic's own behaviour: citations carry a ≤150-char `cited_text` snippet, so **pages with crisp, self-contained, quotable factual sentences (with stats and a clear claim) are structurally easier for Claude to cite** than diffuse prose ([Anthropic web search docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)). `[unverified inference from the 150-char snippet mechanic]`

**(A) Domain-level: does Claude cite social/UGC or authority domains?**
- **No Claude-specific citation-domain study was found.** The big cross-model studies explicitly **exclude Claude.** Semrush's June-2025 study (Reddit 40.1%, Wikipedia 26.3%, YouTube 23.5% of cited sources; no other domain >5%) covers **ChatGPT, Google AI Mode, Perplexity — not Claude or Gemini** ([Semrush, period 2025-07-14→2025-10-12](https://www.semrush.com/blog/most-cited-domains-ai/)). UGC-dominance findings (Reddit/Wikipedia/YouTube/LinkedIn/Medium top the lists) likewise come from non-Claude models ([Writesonic 2.4M-domain study](https://writesonic.com/blog/llm-ai-search-citation-study-dominant-domains); [Soar](https://www.soar.sh/blog/how-reddit-became-the-biggest-llm-citation-source)).
- **Conflicting signal on UGC weight overall:** Grow & Convert found LLMs source **industry/niche sites ~86% of the time and generic sites like Reddit only ~16%** ([Grow & Convert](https://www.growandconvert.com/research/llms-source-industry-sites-more-than-generic-sites/)) — directly at odds with the Reddit-dominance narrative. This is a real conflict in the literature, likely driven by query mix (commercial/B2B queries → industry sites; broad consumer queries → UGC) and by **per-model retrieval differences**.
- **Best inference for Claude specifically:** because Claude ≈ Brave's organic ranking (§1), **Claude's cited domains should track whatever Brave ranks for a query — not a hard-coded UGC boost.** Perplexity is the model documented to *manually boost* Reddit/GitHub/Amazon/LinkedIn as trusted domains ([DataStudios via search synthesis](https://www.semrush.com/blog/most-cited-domains-ai/)); **no such manual-boost list is documented for Claude.** So relative to Perplexity, **Claude is expected to lean more on conventional organic-authority pages (and whatever Brave surfaces) and less on a fixed UGC whitelist.** `[unverified inference — no direct Claude domain study exists; based on the Brave-passthrough finding]`
- **Volatility warning:** citation domain mixes are unstable — Reddit's ChatGPT share fell from ~60% to ~10% in ~6 weeks after an OpenAI retrieval change (Aug–Sep 2025) ([Semrush](https://www.semrush.com/blog/most-cited-domains-ai/)). Any domain-targeting strategy must be re-measured continuously.

---

## 6. Conflicts & staleness ledger

| Topic | Conflict / staleness | Disposition |
|---|---|---|
| Backend = Brave | Never confirmed by Anthropic; evidence is subprocessor list + reverse-engineering. Sources are March 2025 (~14 mo old). | Best available answer; treat as **unconfirmed + possibly stale**. |
| Claude re-ranks Brave or not | Profound says "no significant re-ranking" (domain level), but Anthropic docs imply Claude selects *which* result supports each claim (claim level). | Not a true conflict — recall (Brave) vs selection (Claude) are different layers. |
| UGC vs authority dominance | Semrush/Writesonic: UGC (Reddit/Wikipedia) dominates. Grow & Convert: industry sites 86% vs generic 16%. | Genuine conflict; query-mix + per-model dependent. Neither study includes Claude. |
| GEO trait transfer to Claude | Princeton study used a Bing-Chat-like harness, 2024. | Mechanism plausibly transfers; magnitudes possibly stale → `[unverified for Claude]`. |
| `web_search_20250305` vs `_20260209` | Lumidian uses `_20250305` (no dynamic filtering). Newer version has it. | Confirmed by official docs; no action unless we upgrade tool version. |

### Primary-source anchor list (date-stamped)
- **[Anthropic — Web search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)** — current as of fetch 2026-06-03. PRIMARY. (Response JSON, citation object schema, domain filtering, errors, tool versions.)
- **[Anthropic — Citations docs](https://platform.claude.com/docs/en/build-with-claude/citations)** — current as of fetch 2026-06-03. PRIMARY. (Structured citation model, char/page/content_block locations, reliability claims.)
- **[Princeton GEO study (KDD 2024)](https://collaborate.princeton.edu/en/publications/geo-generative-engine-optimization/)** — 2024, academic. PRIMARY-ish for traits. Flag: ~2 yrs old, non-Claude harness.
- **[TechCrunch — Brave backend](https://techcrunch.com/2025/03/21/anthropic-appears-to-be-using-brave-to-power-web-searches-for-its-claude-chatbot/)** — 2025-03-21. Secondary/investigative. Flag: ~14 mo old.
- **[Profound — Claude web search explained](https://www.tryprofound.com/blog/what-is-claude-web-search-explained)** — 2025-03-21. Vendor analysis. Flag: ~14 mo old.
- **[Semrush — most-cited domains](https://www.semrush.com/blog/most-cited-domains-ai/)** — study period 2025-07→2025-10. Vendor study; **excludes Claude.**
- **[Grow & Convert — industry vs generic sites](https://www.growandconvert.com/research/llms-source-industry-sites-more-than-generic-sites/)** — vendor study; conflicting UGC signal.
- **[Writesonic — 2.4M domain study](https://writesonic.com/blog/llm-ai-search-citation-study-dominant-domains)** — study period 2025-05→2025-10; UGC-dominance; excludes Claude.

---

## 7. Actionable takeaways for Lumidian AIO

1. **Fix the extractor (highest priority, confirmed bug):** wire structured `web_search_result_location` extraction into `_query_claude` and persist into the existing `query_results.citations` column; stop relying on regex-over-prose for Claude. Without this, Claude contributes ~0 to citation/SOV/gap analytics despite being a Pro-tier model.
2. **Optimisation target for Claude visibility is Brave Search organic rank** (if Brave backend still holds) — distinct from Bing/Google. Re-verify the backend periodically.
3. **Content traits to push** (GEO-backed): add **statistics, direct quotations, explicit source citations, fluent authoritative phrasing**; write **crisp ≤150-char quotable factual sentences**; avoid keyword stuffing.
4. **Don't assume Claude cites Reddit/UGC like Perplexity does** — Perplexity has a documented UGC manual-boost; Claude does not. Claude likely favours conventional organic-authority pages surfaced by Brave. Verify empirically once the extractor is fixed (we'll then have first-party Claude citation-domain data — better than any external study).
5. **Use `allowed_domains` cautiously** if we ever want to constrain Claude's sourcing during internal evaluation; it's a hard lever in the tool definition.
