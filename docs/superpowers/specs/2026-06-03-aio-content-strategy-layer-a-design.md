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

- No code changes. No refactor of the 5 paths (that's Layer B).
- No prose-quality / critic / model-selection work (that's Layer C).
- No video/audio channels (YouTube), no review sites (G2/Capterra/TrustRadius — permanently excluded per standing decision). The channel re-ranking covers *writable-text* channels only.
- Not a customer-facing or marketing artifact — this is an internal source-of-truth doc.

---

## Approach — two phases

### Phase 1 — Research (`deep-research` skill)

Use the `deep-research` harness (fan-out web search → fetch primary sources → **adversarial fact-check** → cited synthesis). Adversarial verification matters here: the AIO/GEO space is saturated with vendor blogspam and unsourced "best practice" listicles. Guardrails:

- Every claim that lands in the doc carries either a **citation** or an explicit **"first-principles inference — unverified"** tag.
- Prefer primary sources (provider docs, model release notes, retrieval/grounding documentation, controlled studies, citation-index reports) over vendor marketing.
- Where sources conflict, the doc records the conflict rather than picking silently.
- Date-stamp evidence; flag anything older than ~12 months as potentially stale given how fast retrieval behavior changes.

### Phase 2 — Synthesis

Write the two-part doc from verified research. Part 1 prose, Part 2 structured ruleset.

**Output location:** `docs/strategy/aio-content-strategy-2026.md` (new `docs/strategy/` home — strategy lives separately from `docs/superpowers/specs/`). The spec itself lives in `docs/superpowers/specs/`.

---

## Research scope — what we investigate

### Bucket A — Model-retrieval mechanics (first principles)

For each model as Lumidian queries it:
- **ChatGPT** — `gpt-4o-mini` + hosted `web_search` tool (Responses API)
- **Claude** — `claude-haiku-4-5` + `web_search_20250305`
- **Perplexity** — `sonar` / `sonar-pro`
- **Gemini** — `gemini-2.5-flash` + `google_search` grounding

Questions: How does each find and cite web content in 2026? Does it crawl the platform directly or reach it via a Google/Bing index? What structurally determines whether a page/post is surfaced and cited — freshness, domain authority, direct-answer format, named-entity presence, statistic/fact density, schema/structured data, anchor/title match to the query?

### Bucket B — Per-platform citation reality (the current 5)

For LinkedIn, Medium, Reddit, Quora, X: Does this platform's content actually get retrieved/cited by the 4 models, by what mechanism, and what on-platform format gets surfaced? (e.g. is a Quora answer cited because Perplexity indexes Quora directly, or only when Google surfaces it? Did the Sept-2025 ChatGPT Reddit downweight actually happen and how much does it matter?)

### Bucket C — Channel re-ranking (curiosity, non-binding)

Among *writable-text* channels — the 5 plus owned blog, Substack, dev.to, Hacker News, niche/industry forums, etc. — what's the 2026 citation-value ranking? Output is informational; may flag a channel to add/drop in a later layer, but changes nothing in Layer A.

---

## Deliverable structure — `aio-content-strategy-2026.md`

### Part 1 — Strategy (prose, the "why")

1. **How the 4 models retrieve & cite** — one subsection per model (from Bucket A), plus a synthesis of the structural traits that cut across all four.
2. **Per-platform philosophy** — for each of the 5, why it does/doesn't earn citations and through which model(s) (from Bucket B).
3. **Channel re-ranking** — ordered writable-text channels with rationale (from Bucket C).
4. **Where current rules contradict the evidence** — explicit list of today's scattered rules (citing the file/line they live in) that the research shows are wrong or stale, so Layer B knows what to change. Examples to check against evidence: the universal "never use em dashes," the brand-mention-once requirement, the subreddit restriction lists, query-mirroring-in-first-sentence.

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

- Every Part 1 claim is cited or tagged as unverified inference.
- All 5 platforms have a complete Part 2 block with a `confidence` rating.
- The "contradicts current rules" section names specific current rules with file references.
- Channel re-ranking section present.
- Doc committed to `docs/strategy/`.
- Ken reads it end-to-end and confirms he understands and trusts it.

There is no automated test for Layer A (it's a research/writing deliverable). Verification is Ken's review.

---

## Risks & mitigations

- **Vendor blogspam pollutes the research.** → Adversarial fact-check + primary-source preference + explicit conflict-recording.
- **Retrieval behavior is a moving target.** → Date-stamp evidence; `confidence` ratings; the doc is versioned (`-2026`) and expected to be refreshed.
- **Scope creep into Layer B.** → Hard non-goal: zero code. If the research surfaces an obvious engine fix, it's *noted in the "contradictions" section*, not implemented.
- **First-principles claims masquerading as fact.** → Mandatory "unverified inference" tagging.

---

## What happens after Layer A

Layer B spec is written *against* this doc: it takes Part 2's structured ruleset as the spec for the unified engine's prompt rules, and the "contradictions" section as its changelog. Layer C follows for prose quality.
