# Layer A — AIO Content Strategy (research-grounded) — Design

**Date:** 2026-06-03
**Status:** Design — pending implementation plan
**Author:** Claude Code (brainstormed with Ken)

---

## Context

Lumidian's core service is content creation — the differentiator that's supposed to beat tracking-only competitors. But the content engine has three problems, confirmed by a code audit of the pipeline (`clustering_service.py`, `drafting_service.py`, `drafting/`, `content_service.py`):

1. **No legible methodology.** There are **5 separate content-generation paths** (cluster pipeline, manual gap drafts, opportunity replies, weekly auto-gap drafting, Wikipedia). They don't share one writer.
2. **The rules are gray.** Writing rules live across **6+ files**; platform guidelines are defined in **3 places** (`drafting/platforms.py` authoritative, `content_service.py` stale duplicate, subreddit strategy elsewhere). No single document says *what good AIO content is and why it gets cited*.
3. **Inconsistent source-grounding.** Real-source plumbing exists (`quora_search_service.py`, `reddit_scanner_service.py`) but is wired in unevenly — some paths attach a real thread/question URL, others don't.

This effort is decomposed into three stacked layers. **This spec covers Layer A only.**

- **Layer A (this spec)** — define *what good AIO content is*, per platform, grounded in **external 2026 research + first-principles model-retrieval reasoning**. Output: one canonical strategy doc. Mostly research + writing.
- **Layer B (later)** — collapse the 5 paths into one unified content engine that consumes Layer A, with consistent source-grounding.
- **Layer C (later)** — output-quality pass (model selection, critic loop, anti-slop, voice).

B and C each get their own spec → plan → build cycle, grounded in A.

### Decisions already made (from brainstorm)

- **Deepest pains:** what content *should* be (the rules/strategy) and the writing actually being *good*; real source-grounding is a supporting concern. Pure architectural legibility was *not* the primary driver — it's the enabler.
- **Source of truth for the rules:** external 2026 research + first-principles reasoning about how each model's retrieval works. **Not** Ken's gut alone, **not** Lumidian's own (thin, post-methodology-change) attribution data.
- **Platform scope:** hold the current 5 (LinkedIn, Medium, Reddit, Quora, X) as the working set the strategy must cover; **also** produce a non-binding channel re-ranking across writable-text channels "out of curiosity."
- **Doc shape:** prose strategy (the "why") **plus** a structured per-platform ruleset (machine-ready for Layer B). Two-in-one.

---

## Goal

Produce a single, evidence-grounded, canonical document — **`docs/strategy/aio-content-strategy-2026.md`** — that:

1. Explains *how each of the 4 models retrieves and cites web content* (first principles).
2. Defines, per platform (current 5), *what to write and why it earns AI citations*.
3. Provides a structured, per-platform ruleset that Layer B can compile directly into writer prompts.
4. Explicitly flags where today's scattered rules contradict the evidence.
5. Includes a non-binding re-ranking of writable-text channels.

Success = Ken reads it, fully understands the methodology, and trusts it as the source of truth that retires the gray rules.

### Non-goals (explicitly out of scope for Layer A)

- No app code changes. No refactor of the 5 paths (that's Layer B). The *only* code written is a throwaway, read-only analysis/re-classification script for Stream 1, which is not wired into the app.
- No prose-quality / critic / model-selection work (that's Layer C).
- No video/audio channels (YouTube), no review sites (G2/Capterra/TrustRadius — permanently excluded per standing decision). The channel re-ranking covers *writable-text* channels only.
- Not a customer-facing or marketing artifact — this is an internal source-of-truth doc.

---

## Approach — triangulated research, then synthesis

The research is the product. A single external pass would just give us better-organized vendor blogspam. Instead we **triangulate three independent evidence streams**, each of which can corroborate or contradict the others, then synthesize. (A fourth stream — live probing of the 4 models — was considered and deliberately excluded to bound cost/time; noted here so the decision is traceable.)

### Stream 1 — First-party citation mining (our production data) — *the wedge*

We have ~1,277 `CitationSource` rows and ~11,392 `QueryResult` rows in production recording **what the models actually cited in real runs**. Nobody else has this. We mine it to answer Bucket B empirically instead of trusting articles.

- Pull production data (`CitationSource` + `QueryResult.response_text`) via the Railway DB — production is the source of truth; local `clarity_ai.db` is only a preview/dev sanity check.
- Compute, **per model**, the distribution of cited domains and map domains → platform/channel (is it Reddit? Quora? owned site? Wikipedia? YouTube? a news domain?).
- **Re-classify the ~1,112 `kind='unknown'` citations** so the platform breakdown isn't under-counted. (Re-classification logic lives in a throwaway analysis script, not the app — Layer A ships zero app code.)
- Explicitly surface two known data caveats found during scoping: **Claude has zero citations recorded** (extraction gap vs. Pro-tier-only — determine which), and **`google.com` appears as a top "domain"** (likely Gemini grounding-redirect URLs — resolve/discount these so they don't pollute the ranking).
- Headline question this stream answers: *do LinkedIn / Medium / Reddit / Quora / X actually appear in real citations, and at what rate per model?* Preliminary local-DB look suggests they barely appear — if production confirms it, that reframes the whole strategy.

### Stream 2 — Deep external research (`deep-research` skill, per-model + per-platform)

Not one combined pass — a **separate adversarial deep-research pass per model (4) and per platform (5)**, plus one for the channel re-ranking. The `deep-research` harness fans out web search → fetches primary sources → **adversarially fact-checks** → cites. Guardrails:

- Every claim that lands in the doc carries either a **citation** or an explicit **"first-principles inference — unverified"** tag.
- Prefer primary sources (provider docs, model/release notes, retrieval & grounding documentation, controlled GEO studies, citation-index reports) over vendor marketing.
- Where sources conflict — or conflict with Stream 1 — the doc **records the conflict** rather than picking silently.
- Date-stamp every source; flag anything older than ~12 months as potentially stale.

### Stream 3 — First-principles model mechanics

For each model, document the *actual* retrieval architecture from primary docs: which search backend it uses (its own index vs. Bing vs. Google), recency window, ranking signals, how it selects and formats citations, and whether it fetches page content or relies on snippets. This is the mechanistic "why" that explains the Stream-1 patterns.

### Synthesis

Triangulate the three streams into the two-part doc. Where streams agree, state with high confidence. Where they conflict, present the conflict and Label confidence accordingly (the `confidence` field in Part 2 exists for exactly this).

**Output location:** `docs/strategy/aio-content-strategy-2026.md` (new `docs/strategy/` home — strategy lives separately from `docs/superpowers/specs/`). The spec itself lives in `docs/superpowers/specs/`.

---

## Research scope — the questions each stream feeds

### Bucket A — Model-retrieval mechanics *(Streams 2 + 3)*

For each model as Lumidian queries it:
- **ChatGPT** — `gpt-4o-mini` + hosted `web_search` tool (Responses API)
- **Claude** — `claude-haiku-4-5` + `web_search_20250305`
- **Perplexity** — `sonar` / `sonar-pro`
- **Gemini** — `gemini-2.5-flash` + `google_search` grounding

Questions: How does each find and cite web content in 2026? Does it crawl the platform directly or reach it via a Google/Bing index? What structurally determines whether a page/post is surfaced and cited — freshness, domain authority, direct-answer format, named-entity presence, statistic/fact density, schema/structured data, anchor/title match to the query?

### Bucket B — Per-platform citation reality (the current 5) *(Streams 1 + 2)*

For LinkedIn, Medium, Reddit, Quora, X: Does this platform's content actually get retrieved/cited by the 4 models, by what mechanism, and what on-platform format gets surfaced? **Stream 1 answers the "does it actually happen" empirically; Stream 2 explains the mechanism.** (e.g. is a Quora answer cited because Perplexity indexes Quora directly, or only when Google surfaces it? Did the Sept-2025 ChatGPT Reddit downweight actually happen and does our citation data show it?)

### Bucket C — Channel re-ranking (curiosity, non-binding) *(Streams 1 + 2)*

Among *writable-text* channels — the 5 plus owned blog, Substack, dev.to, Hacker News, niche/industry forums, etc. — what's the 2026 citation-value ranking? Cross-check the external ranking against which non-5 channels actually show up in our first-party citations. Output is informational; may flag a channel to add/drop in a later layer, but changes nothing in Layer A.

---

## Deliverable structure — `aio-content-strategy-2026.md`

### Part 1 — Strategy (prose, the "why")

1. **First-party citation reality (Stream 1)** — what our own production data shows each model actually cites: domain/platform distribution per model, the LinkedIn/Medium/Reddit/Quora/X hit-rate, resolved data caveats (Claude gap, google.com redirects). Leads because it's our unique evidence and frames everything after it.
2. **How the 4 models retrieve & cite** — one subsection per model (from Bucket A / Streams 2+3), plus a synthesis of the structural traits that cut across all four, explaining the Stream-1 patterns mechanistically.
3. **Per-platform philosophy** — for each of the 5, why it does/doesn't earn citations and through which model(s), reconciling first-party hit-rate (Stream 1) with external evidence (Stream 2).
4. **Channel re-ranking** — ordered writable-text channels with rationale (from Bucket C), cross-checked against which non-5 channels actually appear in our citations.
5. **Where current rules contradict the evidence** — explicit list of today's scattered rules (citing the file/line they live in) that the research shows are wrong or stale, so Layer B knows what to change. Examples to check against evidence: the universal "never use em dashes," the brand-mention-once requirement, the subreddit restriction lists, query-mirroring-in-first-sentence — **and the foundational question of whether the current 5-platform set is even the right target.**

### Part 2 — Structured ruleset (per platform, machine-ready)

One block per platform, stable keys so Layer B can parse it:

```
<platform>:
  retrieved_by:          # which models cite it, via what mechanism
  format / structure:    # the on-platform shape that gets surfaced
  length:                # target range, with rationale
  sourcing:              # real thread URL? real question? citations required?
  citation_bait:         # structural traits that get it surfaced (the active ingredient)
  do:                    # [...]
  dont:                  # [...]
  brand_mention_rule:    # when/how the brand may appear
  confidence:            # how well-evidenced this block is (high/med/low + why)
```

A `confidence` field per block keeps the doc honest where evidence is thin.

---

## Validation / "done" criteria

- **Stream 1** produced: a per-model cited-domain/platform breakdown from production data, with the LinkedIn/Medium/Reddit/Quora/X hit-rate quantified, the ~1,112 unknowns re-classified, and the Claude-gap + google.com caveats resolved (explained, not silently dropped).
- **Stream 2** produced: a per-model and per-platform external research pass, every claim cited or tagged unverified.
- **Stream 3** produced: a per-model retrieval-mechanics writeup grounded in primary docs.
- Every Part 1 claim is cited, tagged as unverified inference, or attributed to first-party data.
- All 5 platforms have a complete Part 2 block with a `confidence` rating that reflects stream agreement/conflict.
- The "contradicts current rules" section names specific current rules with file references.
- Channel re-ranking section present.
- Doc committed to `docs/strategy/`.
- Ken reads it end-to-end and confirms he understands and trusts it.

There is no automated test for Layer A (it's a research/writing deliverable). Verification is the criteria above + Ken's review.

---

## Risks & mitigations

- **Vendor blogspam pollutes the research.** → Three independent streams cross-check each other; adversarial fact-check + primary-source preference + explicit conflict-recording.
- **First-party data is biased / thin.** → Our citation history skews to whatever brands/verticals we've tracked (local preview is finance/crowdfunding-heavy) and Perplexity is under-represented (71 rows). Mitigate: report hit-rates *per model* and note sample size + vertical skew; treat Stream 1 as strong evidence of *presence* (a platform showing up is real) but weaker evidence of *absence* (could be sampling). Reconcile against Stream 2 before concluding.
- **Production data access.** → Pull via Railway (per project convention — production `lumidian.db` is truth, local is preview). Read-only; analysis runs in a throwaway script, never app code.
- **Retrieval behavior is a moving target.** → Date-stamp evidence; `confidence` ratings; the doc is versioned (`-2026`) and expected to be refreshed.
- **Scope creep into Layer B.** → Hard non-goal: zero app code. The only code Layer A writes is a throwaway analysis/re-classification script for Stream 1. If research surfaces an obvious engine fix, it's *noted in the "contradictions" section*, not implemented.
- **First-principles claims masquerading as fact.** → Mandatory "unverified inference" tagging.

---

## What happens after Layer A

Layer B spec is written *against* this doc: it takes Part 2's structured ruleset as the spec for the unified engine's prompt rules, and the "contradictions" section as its changelog. Layer C follows for prose quality.
