# Layer B — Unified Content Engine — Design

**Date:** 2026-06-03
**Status:** Design — self-driven (Ken delegated the design calls; he reviews at the end)
**Author:** Claude Code
**Grounded in:** `docs/strategy/aio-content-strategy-2026.md` (Layer A) + `docs/strategy/research/contradictions.md`

---

## Why this exists

Layer A established *what* good AIO content is. Layer B builds the engine that *executes* it. Today the content logic is fragmented across **5 generation paths** (cluster pipeline, manual gap drafts, opportunity replies, weekly auto-gap, Wikipedia) and **two sources of truth** for platform rules (`drafting/platforms.py` + a stale `content_service.py:PLATFORM_GUIDELINES`). The rules are partly wrong (Layer A's `contradictions.md`), two of four tracked models are citation-blind, and there's no surface for the channels that actually work (owned-site, Wikipedia).

## Design decisions (self-driven — rationale captured for Ken's review)

These are the calls I made without Ken's input, with the reasoning so he can veto any of them:

1. **Sequence safety-first, not big-bang.** Decompose Layer B into B0→B3, smallest-blast-radius first. Do **not** autonomously rip out the working 5-path engine. The teardown (B2) is specced but gated behind Ken's review. *Rationale: the current engine ships drafts to paying clients daily; a silent regression there is a business event, not a bug.*
2. **Fix measurement before content.** B0 = the 3 instrumentation bugs. *Rationale: Claude + Gemini are 100% citation-blind right now — that's a live product-accuracy defect affecting every customer's tracking, and it's the prerequisite for proving any later content change works. Highest ROI, lowest risk, already specified.*
3. **Owned-site is the first new content surface (B1), before the big refactor.** *Rationale: Layer A's business read makes owned-site the single highest-value channel (Tier 1, fully controllable, drives the metric) — and it's additive (a new platform), so it ships value without touching the existing engine.*
4. **One unified writer with two orthogonal rule families (B2).** Citation-drivers vs. human-credibility/anti-AI, independently tunable. Voice/guidelines threaded through as a first-class input. *Rationale: Ken's explicit requirements; and the contradictions audit showed the current rules conflate "gets cited" with "doesn't read as AI" — separating them is the core cleanup.*
5. **Per-customer-type platform defaults (B3).** Agency = full breadth; SaaS self-serve = owned-site-first. *Rationale: Layer A business read — different last-mile realities (agency publishes; self-serve self-publishes and can't auto-post).*
6. **Earned media / PR: out of scope, permanently.** Ken's call. The engine never builds outreach/placement.

## Decomposition (each ships independently)

| Sub | Name | Blast radius | Gated on Ken? |
|-----|------|--------------|---------------|
| **B0** | Instrumentation foundation (3 bug fixes) | Additive — new extractors, no behavior change to drafting | No — safe, build now |
| **B1** | Owned-site content surface | Additive — new platform block + generator | No — additive |
| **B2** | Unified writer + two rule families + voice/guidelines plumbing + retire stale duplicate | **High** — replaces the 5 paths | **Yes — review before build** |
| **B3** | Wikipedia → first-class, LinkedIn→article, per-customer-type platform defaults | Medium | After B2 |

This spec details **B0** (the only thing being built pre-review). B1–B3 are scoped here for context; each gets its own plan when reached.

---

## B0 — Instrumentation foundation (the build target)

**Goal:** make all four tracked models report citations correctly, so the product's visibility analytics (and every future content experiment) rest on real data. Purely additive — no change to drafting, scoring, or mention-detection.

### Citation flow (verified in code)
`_query_<model>` returns a result dict → `tracking_service.py:292` persists `result.get("citations")` into `QueryResult.citations` (JSON) → `site_audit/citations.py:extract_for_run` merges `extract_urls(response_text)` (inline prose URLs) + `qr.citations` (structured) → one `CitationSource` row per URL, domain classified via `normalise_url`/`registered_domain`.

### B0.1 — Claude structured citation extraction (BUG 1, highest value)
- **Problem:** `_query_claude` (`llm_service.py:399-404`) returns a dict with **no `citations` key**; `_extract_claude_text` (`:346-359`) keeps only `text` blocks. Claude's URLs live in (a) `web_search_tool_result` blocks (`.content[].url` — the consulted pool) and (b) each `text` block's `.citations[]` (`web_search_result_location.url` — the *actually cited* set). Clean prose has no inline URLs, so the regex path catches nothing → Claude = 0 citations despite 2,392 prod queries.
- **Fix:** add `_extract_claude_citations(response) -> list[dict] | None` returning the *actually-cited* set (text-block `.citations[]`, preferred) and falling back to the consulted pool only if no inline citations exist. Wire it into the Claude return dict as `"citations": _extract_claude_citations(response)`. Guard the documented edge case (`web_search_tool_result.content` is a dict, not a list, on tool error).
- **Why cited-set over consulted-set:** matches the semantics of the other models' `citations` (what was surfaced), and avoids inflating Claude's citation count with every page it merely looked at.

### B0.2 — Gemini real-domain capture (BUG 2)
- **Problem:** `_extract_gemini_citations` (`:226`) stores the raw `web.uri` (`vertexaisearch.cloud.google.com/grounding-api-redirect/<token>`), so `registered_domain` resolves every Gemini citation to `google.com` — Gemini is domain-blind.
- **Fix (B0 scope — cheap + safe):** the SDK already exposes `web.title`, which carries the **bare domain** (e.g. `reddit.com`). Capture it into the citation dict as a `domain_hint`, and have `extract_for_run` prefer `domain_hint` for classification when the URL is an opaque grounding redirect. This recovers domain-level truth (the analytic question — is it Reddit? Wikipedia?) at zero network cost.
- **Deferred to B1 (stretch):** following the redirect (`httpx.head(..., follow_redirects=True)`) to recover the *full* URL. Heavier (network at ingest, ~days expiry, failure handling) and not needed for domain-level analytics. Logged, not built in B0.

### B0.3 — Gemini JSON-schema guardrail (BUG 3)
- **Problem:** a forced `response_schema` on a grounded Gemini call silently nulls `grounding_metadata`. Does **not** currently fire (`:505-508` sets no schema) but is a latent footgun.
- **Fix:** an assertion/comment at the grounded-call site so any future change that adds a schema fails loudly in tests, not silently in prod.

### B0.4 — (NOT in B0) retire the stale `content_service.py` duplicate
Explicitly **deferred to B2.** Removing `PLATFORM_GUIDELINES` + the legacy `generate_draft` path is a consolidation that belongs with the unified-writer work; doing it in isolation risks breaking a live draft path for no immediate gain. Logged here so it isn't forgotten.

### Testing (B0)
TDD with mocked SDK response shapes (no live API calls):
- Claude: fake `response.content` with `text` blocks carrying `.citations[]` + a `web_search_tool_result` block → assert extractor returns the cited URLs, dedupes, handles the dict-not-list error shape, returns `None` when no search occurred.
- Gemini: fake `grounding_chunks` with `web.uri`=redirect + `web.title`=`reddit.com` → assert `domain_hint` captured; assert `extract_for_run` classifies domain as `reddit.com` not `google.com`.
- Guardrail: assert the grounded Gemini config sets no `response_schema`.

### B0 done-criteria
- Claude tracking runs produce `CitationSource` rows (verified against a mocked response in tests; spot-checkable in prod after deploy).
- Gemini citations classify to real domains, not `google.com`.
- All new code TDD-covered; full backend suite green.
- Zero change to drafting, scoring, or mention detection (B0 is measurement-only).

---

## B1–B3 (scoped, not yet planned)

**B1 — Owned-site surface.** A new `owned_site` platform: generator produces a structured answer-page draft (H2/H3 ~120–180-word blocks, JSON-LD, stats, inline cites, freshness) from BrandProfile + EvidencePack, targeting the brand's own domain. Additive platform block (Part 2 of the strategy doc is the spec). For SaaS, output is paste-ready for the user's CMS; for agency, staff publish. Optional B0.2-stretch redirect resolution can land here.

**B2 — Unified writer + two rule families + voice.** Collapse the 5 paths into one writer. Encode Part 2's `universal` rules split into two independently-tunable layers: `citation_drivers` (answer-first, stats, inline cites, schema, freshness, extractable passages) and `human_credibility` (anti-AI tells, burstiness, voice match). Make a **voice/guidelines object** (sample text or a style-guide doc) a first-class pipeline input that conditions every draft — generalize the Pro-only `voice.py`. Apply `contradictions.md` verbatim (fix Medium no-headers, Reddit anti-Q&A; demote arbitrary rules; reframe verbatim canonical-phrasing). Retire the stale duplicate (B0.4). **Gated on Ken's review.**

**B3 — Channel re-pointing + per-customer defaults.** Promote Wikipedia from placeholder to first-class cluster member; switch LinkedIn from feed-post to article as the citation artifact; make the default platform set configurable per customer type (agency = full breadth incl. X-for-optics; SaaS self-serve = owned-site-first). Reddit/Quora repositioned as mention-seeding (expectations + the mention experiment).

---

## Non-goals (Layer B overall)
- No PR/earned-media/outreach capability (Ken: out of scope).
- No auto-posting (posting stays manual — unchanged).
- No new tracking models; B0 fixes existing model instrumentation only.
- B0 specifically: no drafting/scoring/UX changes — measurement only.

## Risks
- **B0 citation extractors parse live SDK shapes** → mitigate with mocked-shape tests + defensive `getattr`/type guards mirroring the existing extractors; worst case an extractor returns `None` (current behavior), never crashes tracking.
- **B2 is the dangerous one** → that's exactly why it's gated behind Ken's review and sequenced last.
