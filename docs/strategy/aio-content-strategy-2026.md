# Lumidian AIO Content Strategy — 2026

> **What this is.** The canonical, evidence-grounded answer to *what content Lumidian should write to get brands cited by AI answer engines (ChatGPT, Claude, Perplexity, Gemini), and why.* It replaces the rules currently scattered across `drafting/platforms.py`, `prompts.py`, `content_service.py`, `cluster_brief.py`, and `clustering_service.py`. Part 1 is the strategy (the "why"); Part 2 is the machine-ready per-platform ruleset that Layer B compiles into writer prompts.
>
> **How it was built.** Three triangulated evidence streams, all under `docs/strategy/research/`: **Stream 1** — first-party mining of production citation data (what our own tracked models actually cited); **Stream 2** — 10 adversarial deep-research passes (4 models + 5 platforms + channel ranking), every claim cited or tagged; **Stream 3** — first-principles model-retrieval mechanics. Where streams conflict, this doc records the conflict rather than papering over it.
>
> **Confidence convention.** Claims are tagged `[first-party]` (our data), cited to a research file, or `[unverified inference]`. Citation share is volatile (the Sept-2025 ChatGPT reshuffle moved rankings in weeks) — **re-run this research quarterly.**
>
> **Version:** 2026-06-03 · **Next refresh due:** ~2026-09

---

# Part 1 — Strategy (the "why")

## 1. First-party citation reality — what our own data shows

We mined production (`/data/lumidian.db`, 131 MB) for what the four models *actually cited* across every real tracking run. The headline:

**Across every citation we can resolve — ChatGPT (1,669) and Perplexity (480) — exactly 0% come from Reddit, Quora, Medium, LinkedIn, or X.** The five platforms our entire content engine writes for have a **zero observed citation rate** in our own data. The models instead cite owned/authority domains, **Wikipedia** (ChatGPT's top non-vertical source, 94 citations), **sec.gov / primary regulatory sources**, **YouTube**, and **PR newswires**. `[first-party]` (`research/stream1-citation-mining.md`)

**Three caveats that bound this finding** — it is strong evidence of *what gets cited*, weaker evidence that the 5 platforms are worthless:

1. **Single-vertical skew.** 2,611 of 2,619 citations belong to one brand (Manhattan Street Capital — B2B capital-markets / Reg-A+). The absence of social platforms is real *for B2B finance*; it may not generalize to consumer or developer verticals.
2. **Gemini is 100% blind.** All 470 Gemini citations are opaque `vertexaisearch.cloud.google.com/grounding-api-redirect/...` proxies — we literally cannot see what Gemini cited. Instrumentation bug (BUG 2 below).
3. **Claude is 100% blind.** Claude ran 2,392 queries but produced 0 citation rows — its structured citations are never extracted (BUG 1 below).

So two of four models are dark, and our visible sample is one vertical. **The external research (Stream 2) is the tie-breaker, and fixing the two instrumentation bugs is the single highest-value way to make future versions of this doc trustworthy.**

## 2. How the four models retrieve & cite (first principles)

Full mechanics table in `research/stream3-model-mechanics.md`. The essentials:

| | ChatGPT (`gpt-4o-mini`+`web_search`) | Claude (`haiku-4-5`+`web_search`) | Perplexity (sonar/-pro) | Gemini (`2.5-flash`+grounding) |
|---|---|---|---|---|
| **Backend** | Own OAI-SearchBot index + Bing (hybrid) | Brave Search (unconfirmed, ~14mo-old evidence) | Proprietary index + Google/Bing SERP (hybrid) | Live Google index, ~6 fan-out sub-queries |
| **Reading** | Snippet-mode (shallow top-10/20) | Snippet (≤150-char `cited_text`) | Passage rerank (~top 30%) | Passage-level grounding spans |
| **Citations returned** | Inline `url_citation` objects + `sources` list | **Structured objects, no inline URLs** | Inline prose citations | **Opaque redirect proxies** |
| **UGC tilt** | Mixed→authority (post-Sept-2025) | Low/authority (inferred) | **High — Reddit #1** | High — Reddit 27.5%, YouTube, Wikipedia |

**The universal citation drivers** — traits *all or most* models reward, which become Layer B's universal rules (`stream3-model-mechanics.md:28-78`):

1. **Answer-first / BLUF** — front-load the direct answer. Supported by all four (ChatGPT: 44% of citations from the first third; Perplexity: 90% of cited sources answer within 100 words). *Strongest universal driver.*
2. **Concrete statistics** (in tables / bold, not buried) — Princeton GEO controlled study: ~30–40% citation lift (ChatGPT + Claude).
3. **Direct quotations** from named sources — ~28% lift (Princeton GEO).
4. **Inline citations to external authorities** within your content — strong lift, **+115% for lower-ranked pages** (helps underdogs most).
5. **Freshness / visible dates** (`dateModified`) — dominant for Perplexity, strong for Gemini + ChatGPT.
6. **Extractable self-contained passages** (clear H2/H3, ~120–180-word answer blocks) — supported by all four.
7. **Schema / JSON-LD** — Perplexity ~19pp lift (correlational); weaker evidentiary tier.
8. **Topical depth on attributes/comparisons** over head-keyword breadth — backlinks barely matter (92.78% of Perplexity-cited pages have <10 referring domains).

**Anti-patterns (penalized):** keyword stuffing (*worse* than baseline — Princeton GEO), "authoritative tone" word-changes with no substance, meta-tag manipulation.

**The single most important strategic fact:** traditional SEO authority (Domain Authority, backlinks) shows weak-to-negative correlation with AI citation; **crawlability, schema, recency, and extractable structure are what drive it** (`stream2-channel-ranking.md`). This is a different game from SEO.

## 3. Per-platform philosophy (the current 5)

**Reddit** — Models *retrieve* Reddit constantly but *cite* it rarely (ChatGPT: ~1.93% of retrievals). Cited Reddit threads are **old (~900 days), low-upvote, short, Q&A-format** — engines surface organically-validated aged threads, not fresh self-posts. Only ChatGPT + Perplexity ever emit visible Reddit citations (Claude is litigated/blocklisted by Reddit; Gemini ~0.1%). Finance is a documented low-Reddit vertical. **You cannot reliably publish a new Reddit post and get it cited** — citability comes from aged community validation. (`stream2-platform-reddit.md`)

**Quora** — Quora's `robots.txt` blocks *all four engines'* crawlers (`Disallow: /` for GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, et al., verified live 2026-06-03). Absent from every top-cited-domain study; AI-Overviews share fell ~99%. The one "Quora wins" stat (4.1× multiplier) measures domains *mentioned on* Quora, not Quora itself being cited. **Structurally near-uncitable, platform-wide.** (`stream2-platform-quora.md`)

**Medium** — Mid-tier and declining; strength concentrated in *developer/technical* verticals, not B2B/finance. For content you control, an **owned domain ≥ Medium** — and republishing on Medium with a canonical tag can *cannibalize* the owned URL's citation. The real lever near Medium is earned third-party **news** distribution (+325% lift), which is a different thing. (`stream2-platform-medium.md`)

**LinkedIn** — The one nuanced case. LinkedIn earns real citations for B2B — but only **public, Google-indexed long-form Pulse *articles*** (not gated feed posts), and concentrated on **ChatGPT Search (~14.3%) and Google AI Mode (~13.5%)**, with Perplexity far lower (~5.3%) and Claude/Gemini unconfirmed. The surge is *recent* (Nov-2025→Feb-2026), so our 0% is partly staleness + engine-mix. **Our current `linkedin_post`/`linkedin_reply` specs target the wrong artifact; `linkedin_article` is the citation-relevant one.** (`stream2-platform-linkedin.md`)

**X** — A non-citation surface for all four engines. `robots.txt` blocks all AI crawlers; the 2025 developer agreement bans training on X data; only Grok (xAI, untracked) has real access. Reach-only. (`stream2-platform-x.md`)

**Verdict:** of the current 5, **LinkedIn (articles only) is the sole defensible AI-citation play**, and only on a subset of engines. Reddit/Quora/Medium/X range from low-leverage to structurally uncitable for AI visibility.

## 4. Channel re-ranking (writable-text channels)

Re-ranked by *publish-to-cite reliability* — controllability × crawlability × cross-engine breadth × evidence (`stream2-channel-ranking.md`):

- **Tier 1 (highest reliability):** **Owned blog/brand site**, **Wikipedia**, **industry/trade publications + PR**. These have the strongest structural citability and best corroborate our first-party data.
- **Tier 2 (conditional):** LinkedIn (public articles, B2B, ChatGPT/Google AI), Reddit (aged organic threads, consumer verticals), Stack Overflow / GitHub / dev.to (developer verticals only).
- **Tier 3 (low/declining):** Medium, Quora (crawler-blocked), X (crawler-blocked), Substack, Hacker News.

**The two glaring gaps in our current engine:** (1) **no owned-site content surface exists at all** — the single biggest strategic miss, since owned is the only channel where all 8 citation levers are controllable; (2) **Wikipedia is treated as an excluded placeholder**, despite being Tier 1 and ChatGPT's top domain.

## 5. Where current rules contradict the evidence

Full line-referenced audit in `research/contradictions.md` (Layer B's changelog). The structural headlines:

- **The core channel strategy aims at the wrong targets.** The engine writes for 5 platforms at 0% observed citation, has **no owned-site surface**, and sidelines **Tier-1 Wikipedia**. (`contradictions.md` §A)
- **Several format rules actively fight the evidence:** Medium "no `##` headers / flowing prose" (`platforms.py:62-63`) removes the extractable H2/H3 structure that drives citation; Reddit "don't pose-and-answer" (`platforms.py:16`) forbids the Q&A format that is >50% of cited Reddit content. (`contradictions.md` D2, D3)
- **Most universal style rules are NO-EVIDENCE / arbitrary** — em-dash ban, banned-words list, contraction/sentence-variety rules, and the cluster **verbatim canonical-phrasing** enforcement (which risks the keyword-stuffing penalty). Only **answer-first**, **anti-fabrication/evidence-grounding**, and the **hedging ban** are genuinely CONFIRMED by evidence. (`contradictions.md` B, C, E1)
- **Length ranges optimize the wrong variable** — word count has ~zero citation correlation; *extractable ~120–180-word passages* are what matter, and they're specified nowhere. (`contradictions.md` D1)
- **A stale duplicate rule set** (`content_service.py:39-117` `PLATFORM_GUIDELINES`) still drives a legacy `generate_draft` path on `claude-sonnet-4-6`, bypassing the whole `drafting/` pipeline — two sources of truth. (`contradictions.md` F1)
- **Three instrumentation bugs** (below) make Claude + Gemini citation-blind.

### Engine bugs (Layer B instrumentation fixes — verified in code)

- **BUG 1 — Claude citations never extracted.** `_query_claude` (`llm_service.py:399-404`) returns no `citations` key; `_extract_claude_text` skips the `web_search_result_location` blocks holding the URLs. Fix: add `_extract_claude_citations()` parsing `text` blocks' `citations[]`. Claude is Pro-tier and currently 100% dark.
- **BUG 2 — Gemini redirects stored unresolved.** `_extract_gemini_citations` (`llm_service.py:226`) stores the raw `grounding-api-redirect` proxy. Fix: use `groundingChunks[].web.title` (carries bare domain) for fast bucketing **and** follow the redirect at ingest (`requests.head(..., allow_redirects=True)`) — proxies expire in ~days, so it must run at ingest.
- **BUG 3 — Gemini JSON-schema-empties-grounding.** Does *not* currently fire (the grounded call sets no `response_schema`, `llm_service.py:505-508`), but add a guardrail so no future grounded Gemini call forces a JSON schema (it silently nulls `groundingMetadata`).

---

# Part 2 — Structured per-platform ruleset (machine-ready for Layer B)

> Stable keys for Layer B to parse. `confidence` reflects stream agreement. The current 5 platforms are documented as-is; **owned-site and Wikipedia blocks are added** because the evidence makes them Tier 1 and Layer B should treat them as first-class (see §4).

### Universal rules (apply to every block)
```
universal:
  answer_first: true            # direct answer in first 1-2 sentences / 100 words
  passage_structure: H2/H3 with discrete ~120-180-word self-contained answer blocks
  statistics: include concrete numbers, in tables or bold standalone claims
  quotations: include direct quotes from named sources where available
  inline_citations: cite external authoritative sources inline (esp. high-leverage for non-top-authority pages)
  freshness: include visible publish/update date; keep dateModified current
  schema: emit JSON-LD (Article/Person/FAQ) where the surface allows  # weaker evidence
  evidence_grounding: every claim traceable to Brand Profile / Evidence Sources — never fabricate  # CONFIRMED
  no_hedging: confident, evidence-backed declaratives (not "may/might/could")  # CONFIRMED
  entity_binding: name the brand clearly once in a concrete factual context  # ghost-citation: 53.1% vs 10.6%
  anti_pattern: NO keyword stuffing, NO verbatim phrase repetition, NO authoritative-tone-without-substance
```

### owned_site  *(NEW — Tier 1, highest priority)*
```
owned_site:
  retrieved_by: all 4 models (the only channel where every lever is controllable); ~44-52% of citations on some engines for informational/BOFU queries
  format: structured article/answer page; H2/H3 with FAQ-style answer blocks; JSON-LD
  length: driven by extractable passages, not a total; most cited pages <1000 words
  sourcing: cite primary/authoritative sources inline; link to owned pillar
  citation_bait: schema + freshness + extractable answer blocks + entity density + topical depth
  do: [own the canonical URL, keep dateModified fresh, answer the exact query first, add stats/quotes]
  dont: [hide content behind JS-only render, omit dates, thin pages]
  brand_mention_rule: name the brand as the factual subject; this is your surface
  confidence: high  (Stream 1 authority-domain pattern + Stream 2 Tier-1 consensus)
```

### wikipedia  *(promote from placeholder to Tier 1)*
```
wikipedia:
  retrieved_by: ChatGPT (#1 domain, ~7.8% all / ~47.9% top-10), Gemini (12.7%), others; the "truth layer"
  format: neutral encyclopedic, third-person, every claim cited to a reliable secondary source
  length: 100-300 words per suggested edit
  sourcing: REQUIRED — reliable independent secondary sources; no primary/promotional
  citation_bait: presence in the canonical reference the models trust most
  do: [edit existing notable articles, cite reliable sources, neutral tone]
  dont: [COI editing, promotional language, create non-notable articles]
  brand_mention_rule: only where independently notable and verifiable; COI/notability is the real gate
  confidence: high (Stream 1 + Stream 2), with controllability caveat (COI/notability limits what we can place)
```

### linkedin
```
linkedin:
  retrieved_by: ChatGPT Search (~14.3%), Google AI Mode (~13.5%); Perplexity ~5.3%; Claude/Gemini unconfirmed
  format: PUBLIC long-form Pulse ARTICLE (not gated feed post); H2/H3 + answer blocks
  length: 600-1500 words, but extractability > length
  sourcing: cite sources inline; concrete data per claim
  citation_bait: public + Google-indexed + article format + entity binding
  do: [publish as a public article, ensure it is Google-indexable, name the brand once concretely, add stats]
  dont: [rely on feed posts/replies for citation, gate behind login]
  brand_mention_rule: brand name MUST appear once in concrete context (already in spec, aligns)
  confidence: medium  (recent inflection Nov2025-Feb2026; engine-mix dependent; Stream1 shows 0% but partly stale)
  note: current linkedin_post / linkedin_reply specs target the WRONG artifact — prioritize linkedin_article
```

### medium
```
medium:
  retrieved_by: mid-tier, declining; dev/technical verticals mainly; NOT finance
  format: editorial article — BUT use clear H2/H3 (current "no headers" rule is CONTRADICTED)
  length: 800-2000 (convention); extractable passages matter more
  sourcing: cite peer-reviewed/authoritative sources; concrete data per claim (CONFIRMED levers)
  citation_bait: weak vs owned domain; prefer owned for controlled content
  do: [use H2/H3 structure, cite sources, add stats]  # fix the no-headers rule
  dont: [republish owned content here with canonical (cannibalizes), expect finance citation]
  brand_mention_rule: brand name once in body (aligns)
  confidence: medium-low  (Stream 1 = 0%; Stream 2 = declining/vertical-limited)
  note: deprioritize vs owned_site; only worthwhile for dev/technical brands
```

### reddit
```
reddit:
  retrieved_by: ChatGPT (~1.93% of retrievals) + Perplexity only; Claude blocked, Gemini ~0.1%
  format: cited Reddit content is AGED, short, Q&A-format, organically upvoted — NOT freshly publishable
  length: short (cited threads ~80 words)
  sourcing: organic community validation over time (cannot be manufactured at publish time)
  citation_bait: aged thread + Q&A problem->solution + topical match (votes don't drive citation)
  do: [participate authentically in Q&A threads, disclose affiliation, target consumer verticals]
  dont: [expect a new standalone post to get cited, use in B2B/finance, forbid Q&A format (current rule is wrong)]
  brand_mention_rule: only if genuinely the most direct answer; affiliation disclosed
  confidence: low for "publish-and-get-cited"; the citable artifact is aged validation, not a fresh draft
  note: fix the anti-Q&A rule (D3); reconsider whether to generate Reddit drafts at all for B2B
```

### quora
```
quora:
  retrieved_by: NONE — robots.txt blocks all 4 engines' crawlers (verified 2026-06-03)
  format: n/a for AI citation
  length: n/a
  sourcing: n/a
  citation_bait: none — structurally crawler-blocked
  do: []
  dont: [generate Quora drafts expecting AI citation]
  brand_mention_rule: n/a
  confidence: high that it is near-uncitable (Stream 1 0% + verified robots.txt block + absent from all studies)
  note: strong candidate for REMOVAL from the engine for AI-visibility purposes
```

### x
```
x:
  retrieved_by: NONE of the 4 tracked engines (robots.txt Disallow: /; dev-agreement bans training); only Grok (untracked)
  format: n/a for AI citation
  length: n/a
  sourcing: n/a
  citation_bait: none — non-citation surface
  do: []
  dont: [generate X drafts expecting AI citation in the 4 tracked models]
  brand_mention_rule: n/a
  confidence: high that it is reach-only for AI citation (Stream 1 0% + Stream 2 cross-study absence + robots block)
  note: strong candidate for REMOVAL; only relevant if Grok is ever tracked
```

---

## What Layer B inherits from this

1. **Part 2 universal rules + per-platform blocks** → the new unified writer's prompt rules.
2. **`contradictions.md`** → the explicit list of current rules to delete/keep/reframe (with file:line).
3. **The three engine bugs** → instrumentation fixes that unblock first-party Claude + Gemini citation data (which will make the next version of this doc far stronger than external studies).
4. **The strategic re-pointing** → add an owned-site surface, promote Wikipedia, prioritize LinkedIn *articles*, and seriously consider dropping Quora + X (and Reddit for B2B) as draft platforms.

> **Decision deferred to Ken (not Layer A's call):** whether to *remove* Quora/X/Reddit from the engine or keep-but-deprioritize. Layer A's job was to surface the evidence; the platform-set decision is a product call for the Layer B spec.
