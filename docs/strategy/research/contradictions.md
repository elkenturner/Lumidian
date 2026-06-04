# Contradictions — Current Content Rules vs. Research Evidence

**Purpose:** Audit every content-writing rule currently shipped in Lumidian's drafting/cluster engine against the Stream 1 (first-party citation mining) and Stream 2 (external research) evidence. This is Layer B's changelog input.

**Method:** Each rule below is cited by `file:line`, then marked **CONFIRMED** / **CONTRADICTED** / **NO-EVIDENCE**, with the research source for the verdict. AUDIT ONLY — no app code was modified.

**Date:** 2026-06-03

**Three caveats that color every verdict below:**
1. Stream 1 (production data) is a near-single-brand B2B-finance sample (2,611 of 2,619 citations = one brand) and is blind on Claude + Gemini citations (the two engine bugs). So "0% for platform X" is strong on presence-of-authority-sites, only suggestive on absence. Stream 2 external research is the tie-breaker.
2. Citation share is volatile (the Sept-2025 ChatGPT reshuffle flipped rankings in weeks). Verdicts are directional.
3. Most fresh external data is from GEO/PR vendors; the only peer-reviewed causal source is the Princeton GEO paper (KDD 2024), now stale on model-specific magnitudes but durable on mechanism.

---

## A. CHANNEL / PLATFORM-EXISTENCE RULES (the biggest contradictions)

These concern *which* platforms the engine writes for at all, not how it writes. They are the highest-leverage findings.

### A1. Engine writes drafts for reddit, quora, medium, linkedin, x — `drafting/platforms.py:189-190` (`ALL_PLATFORMS` / `CONTENT_PLATFORMS`); cluster set `clustering_service.py:36` (`CLUSTER_PLATFORMS = ("linkedin", "medium", "reddit", "quora", "x")`)

**Verdict: CONTRADICTED (as the *core* strategy) — these 5 platforms have a 0% observed citation rate in production.**

- Stream 1 (`stream1-citation-mining.md:10-23`): across every resolvable production citation — ChatGPT (1,669) and Perplexity (480) — **exactly zero** come from reddit, quora, medium, linkedin, or X. The engine optimizes for 5 channels with a 0% observed citation rate in first-party data. Models instead cite owned/authority domains, Wikipedia, regulatory/primary sources, YouTube, PR.
- Stream 2 channel ranking (`stream2-channel-ranking.md:122-148`) re-ranks by *publish-to-cite reliability* (not aggregate share) and lands: **Tier 1 = owned site, Wikipedia, trade/industry publications + PR**; the 5 engine platforms are **Tier 2 conditional (LinkedIn, Reddit, Quora) or Tier 3 (Medium, X)**.
- **Nuance preventing a blanket "delete all 5":** the 0% is partly vertical (finance) + partly two blind models (Claude/Gemini citations unextracted). Per-platform Stream 2 files (below) confirm the platforms differ sharply in value. So this is "wrong as the centerpiece," not "every platform worthless."

### A2. X (`x_thread`, `x_post`, `x_reply`) is a first-class draft + cluster platform — `drafting/platforms.py:126-186`, `clustering_service.py:36`

**Verdict: CONTRADICTED — X is a non-citation surface for all four tracked engines; should be deprioritized/removed.**

- `stream2-platform-x.md:12-16, 50-60, 89, 108`: across >100M citations in controlled studies, twitter.com/x.com is consistently below reporting threshold. X's `robots.txt` is catch-all `Disallow: /` (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot all unnamed → blocked); 2025 developer agreement bans training on X content; the only model with real X access is Grok (xAI), which Lumidian does not track. Matches Stream 1's 0%. The research explicitly recommends "consider deprioritizing or removing `x` as a draft platform."

### A3. Quora is a first-class draft + cluster platform with a 250–550-word answer spec — `drafting/platforms.py:39-55`, `clustering_service.py:36`

**Verdict: CONTRADICTED — Quora is near-zero direct-citation, worst in finance, and structurally crawler-blocked.**

- `stream2-platform-quora.md:13-16, 67-89, 94-100, 153-156`: Quora's `robots.txt` (fetched live 2026-06-03) blocks GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Claude-User, Claude-SearchBot — i.e. all four engines' bots. Quora is absent from every top-cited-domain study; AI-Overviews share fell ~99%; B2B-SaaS data calls it "essentially absent." The one "Quora wins" stat (4.1x multiplier) is about domains *mentioned on* Quora, NOT Quora being cited. Platform-wide, not vertical-specific.

### A4. Medium is a first-class draft + cluster platform (800–2000-word article) — `drafting/platforms.py:56-72`, `clustering_service.py:36`

**Verdict: CONTRADICTED for finance / weakly supported in dev verticals — owned domain ≥ Medium for controlled content.**

- `stream2-platform-medium.md:11-14, 34-44, 60-70`: Medium is mid-tier and declining (#9, ~5.9% of *unbranded* B2B citations), with strength concentrated in developer/technical verticals (GitHub/dev.to/Medium cluster), not finance. Owned/authority domains are as good or better for content you control; republishing on Medium with canonical can *cannibalize* the owned URL's citation without the corroboration benefit. The real lever is earned third-party *news* distribution (+325% lift), not Medium.

### A5. LinkedIn is a first-class draft + cluster platform — `drafting/platforms.py:91-125, 159-172`, `clustering_service.py:36`

**Verdict: PARTIALLY CONFIRMED / engine-mix-CONTRADICTED — LinkedIn earns real citations but mostly on engines Lumidian doesn't strongly hit, and only for public Pulse *articles*.**

- `stream2-platform-linkedin.md:12-16, 40-66, 84-92, 123-132`: LinkedIn is #1–2 cited for B2B on **ChatGPT Search (~14.3%) and Google AI Mode (~13.5%)**, but only **~5.3% on Perplexity** and **not prominent on Claude/Gemini** (the engines weighted in Lumidian's paid panel). Citable artifact is the public long-form **article** (50–66% of cited LinkedIn content), NOT gated feed posts. So the current `linkedin_post`/`linkedin_reply` specs target the *wrong* artifact; `linkedin_article` is the citation-relevant one. The surge is recent (Nov-2025→Feb-2026), so Stream 1's 0% is partly staleness. **Genuine open conflict to validate** (`stream2-channel-ranking.md:137`).

### A6. Reddit is a first-class draft + cluster platform with standalone-post + reply specs — `drafting/platforms.py:9-38`, `clustering_service.py:36`

**Verdict: CONTRADICTED for the "publish a Reddit post and get cited" model; the platform's citation behavior is retrieve-don't-cite + aged-thread-only.**

- `stream2-platform-reddit.md:13-19, 81-90, 112-118`: ChatGPT *retrieves* Reddit constantly but *cites* it only ~1.93% of retrievals; cited Reddit threads are **old (~900 days avg), low-upvote (<20), short (~80 words), Q&A-format** — engines surface organically-validated aged threads, not fresh self-posts. Of Lumidian's 4 engines, only ChatGPT + Perplexity ever emit visible Reddit citations (Claude litigated/blocklisted; Gemini ~0.1%). Finance is a documented low-Reddit vertical. The current "write a 150–400-word standalone post" spec (`platforms.py:9-25`) cannot reliably produce a *citable* artifact — citability comes from aged community validation, not publish-time format.

### A7. Wikipedia is excluded from clusters / treated as a placeholder — `clustering_service.py` docstring (`CLAUDE.md`: "Wikipedia is excluded (handled in its own UI tab as a placeholder)")

**Verdict: CONTRADICTED (under-prioritized) — Wikipedia is Tier 1 and the single highest-value reliably-cited surface after owned.**

- `stream1-citation-mining.md:19-23` (Wikipedia = 94 ChatGPT citations, the top non-vertical source) + `stream2-channel-ranking.md:46-49, 130`: Wikipedia is ChatGPT's #1 domain (~7.8% all / ~47.9% top-10), the structural ideal (crawlable, structured, no wall, "truth layer"), and Tier 1 on citability. The standalone Wikipedia drafting path exists (`prompts.py:47-147`) but Wikipedia being a placeholder/excluded from the coordinated cluster engine under-weights the highest-value controllable-ish surface. Controllability is genuinely gated by COI/notability (the one caveat that justifies *some* special handling).

### A8. No owned-site / first-party content draft platform exists — `drafting/platforms.py:8-187` (platform list has no "owned blog")

**Verdict: CONTRADICTED (critical gap) — owned site is Tier 1, the only channel where all 8 citability levers are controllable, and the dominant finance citation surface.**

- `stream2-channel-ranking.md:51-54, 126-132, 162`: owned blog/brand site is the only Tier-1 channel you fully control (crawlability, schema, speed, freshness, structure, entity density); wins BOFU/category queries; ~44–52% of citations on some engines (Gemini, informational). `stream2-platform-quora.md:117` and `-medium.md:68` both note finance citations lean ~48% to owned/first-party sites. The drafting engine has no owned-content surface at all — the single biggest strategic miss.

---

## B. UNIVERSAL STYLE RULES — `drafting/prompts.py:271-287`

### B1. Em-dash / en-dash ban — `prompts.py:272`

**Verdict: NO-EVIDENCE (arbitrary stylistic rule).** No research source ties dash usage to AI citability. The Princeton GEO levers (stats, sources, quotes, fluency) and per-engine extractability traits never mention punctuation. This is an anti-AI-slop human-readability preference, not a citation driver. Harmless but unjustified by evidence.

### B2. Banned-words list ("delve", "dive into", "unpack", "it's worth noting", "the bottom line", "at the end of the day") — `prompts.py:273`

**Verdict: NO-EVIDENCE (arbitrary).** No source links specific lexical bans to citation. Same anti-slop rationale as B1; no Stream 1/2 evidence for or against. Flag as a style preference, not a citation lever.

### B3. Hedging-language ban ("may", "might", "could potentially", "perhaps", "it seems") — `prompts.py:274`; also enforced post-gen via `remove_hedging` (`clustering_service.py:30, 180`)

**Verdict: CONFIRMED (the one universal style rule with real evidence).**

- `stream2-platform-medium.md:84` (arXiv 2605.25517, 252k trials): "evidence-backed, confident (not hedged) claims" carry a positive citation effect (odds ratio 2–243). Confident, declarative, evidence-backed phrasing is citation-favorable across engines. The ban aligns with the evidence — with the caveat that confidence must be *backed by evidence*, not just asserted (the claim-verifier at `clustering_service.py:365-370` is the right guardrail).

### B4. "Vary sentence length" — `prompts.py:275` (also `platforms.py:48` for Quora)

**Verdict: NO-EVIDENCE (arbitrary).** Relates loosely to Princeton's "Fluency Optimization" lever (`stream2-model-chatgpt.md:84`) but that lever is about overall readability, not a literal sentence-length-variation instruction. No source measures sentence-length variance as a citation factor. Plausibly helpful, unproven.

### B5. "Use contractions naturally" — `prompts.py:276`

**Verdict: NO-EVIDENCE (arbitrary).** No research links contractions to citability. Human-voice preference.

### B6. "Only reference facts/stats in Brand Profile or Evidence Sources — never invent data" — `prompts.py:277` (+ information hierarchy `prompts.py:244-249`, claim-verifier, evidence-pack citation rules `prompts.py:202-206`)

**Verdict: CONFIRMED (strongly).**

- Princeton GEO (`stream2-model-chatgpt.md:81-83`, `stream2-model-claude.md:153-156`): "Add statistics" → +30-40%; "Cite external authoritative sources" → +115% for lower-ranked pages — the strongest single controlled levers. Anti-fabrication + evidence-grounding + exact figures (`prompts.py:249`) directly implement the highest-evidence citation tactics. This is the engine's best-supported rule cluster.

### B7. "Mention {brand} only if it fits naturally — never force it" (universal) — `prompts.py:278`; reinforced per-platform (`platforms.py:18, 49, 118, 136, 153, 166, 180`); cluster "brand mentioned as a fact, not a pitch" (`prompts.py:237`)

**Verdict: NO-EVIDENCE / weakly CONTRADICTED — citation rewards entity *presence*, and the "ghost citation" data suggests brand naming matters more than this rule implies.**

- `stream2-channel-ranking.md:115` and `stream2-model-gemini.md:83`: "entity clarity + factual density" and "brand presence in fan-out queries increases citation likelihood" — entity recognition drives citability. `stream2-platform-linkedin.md:103-106` (Seer, 541k responses): when a brand is *named* in the answer, its content is cited 53.1% of the time vs 10.6% when absent ("ghost citation"). The conservative "only if natural" framing may *under*-bind the brand entity. Not a hard contradiction (forced/promotional mentions are correctly penalized), but the evidence leans toward ensuring clear entity binding rather than minimizing mentions. Note the Medium/LinkedIn specs already require ≥1 brand mention (`platforms.py:64, 100`), which aligns better.

### B8. "Content must read as written by a human expert, not AI" + "no meta-commentary" — `prompts.py:279-280`

**Verdict: NO-EVIDENCE (arbitrary as a citation lever).** Author-expertise/E-E-A-T appears in vendor lists (`stream2-platform-medium.md:86`) but is "weakly sourced" and not isolated in any controlled study. Meta-commentary removal is output-hygiene, not citation-driven. Reasonable, unproven.

---

## C. QUERY-MIRRORING RULES — `drafting/prompts.py:282-287` + intro `prompts.py:240-242`

### C1. First sentence must directly answer the target query (answer-first / BLUF) — `prompts.py:283`; Quora "VERY FIRST SENTENCE states the direct answer" (`platforms.py:44`)

**Verdict: CONFIRMED (strongly, multi-source).**

- `stream2-model-chatgpt.md:88, 94` ("44% of ChatGPT citations come from the first third of content"; "lead with the direct answer in first ~100-150 words"); `stream2-model-perplexity.md:73` ("90% of top-cited sources answered the core question within the first 100 words"); `stream2-model-gemini.md:94` (passage-level grounding favors answer-first); `stream2-platform-medium.md:83` ("list/first position in context" strong positive). Answer-first is one of the best-supported citation levers across all four engines.

### C2. Use the query's exact words/key noun phrases throughout; don't substitute synonyms — `prompts.py:284, 286, 287`

**Verdict: CONFIRMED with a caveat — topic/term relevance is the dominant citation factor, BUT this risks tipping into keyword-stuffing, which is penalized.**

- CONFIRMED side: `stream2-platform-medium.md:80` ("topic relevance — odds ratio >>10,000, dominant factor"); `stream2-model-gemini.md:84` (long-tail attribute/comparison phrasings get surfaced via fan-out). Semantic match to query intent matters.
- CAVEAT/CONTRADICTION: Princeton found **keyword stuffing performs *worse* than baseline** and "authoritative tone" wording changes had no/negative effect (`stream2-model-chatgpt.md:85`, `stream2-model-claude.md:156`). The rule "use the actual words from the query, do not substitute synonyms only" (`prompts.py:287`), taken literally, edges toward keyword repetition. Net: relevance CONFIRMED, but the rule should be framed as semantic topical alignment, not literal term-repetition, to avoid the documented stuffing penalty.

### C3. "Checked" framing — query-mirroring "these are checked" — `prompts.py:282`

**Verdict: NO-EVIDENCE on the mechanic itself (it's an internal prompt assertion).** The underlying answer-first principle is C1-CONFIRMED; the "checked" claim is a prompt-engineering nudge, not a research-backed rule.

---

## D. PER-PLATFORM SPEC RULES

### D1. Length ranges per platform — reddit 150–400, reddit_reply 20–80, quora 250–550, medium 800–2000, wikipedia 100–300, linkedin_article 600–1500, linkedin_post 80–250, x_thread 400–800, x_post 20–70, linkedin_reply 30–120, x_reply 10–50 — `platforms.py:11,28,41,58,75,93,111,128,146,161,175`

**Verdict: NO-EVIDENCE / weakly CONTRADICTED — length is a near-zero citation factor; the ranges are platform-convention-driven, not citation-optimized.**

- `stream2-platform-medium.md:87, 93-96` (Ahrefs): word count has **near-zero correlation** (Spearman ~0.04) with citation; >53% of cited pages are <1,000 words. What matters is **extractability of self-contained passages** (100–300 word answer blocks), not total length. The ranges aren't *wrong* (they're sane platform norms) but they optimize for the wrong variable. The one citation-relevant structural target — discrete ~120–180-word extractable blocks (`stream2-model-chatgpt.md:89`) — is NOT specified anywhere in the specs.

### D2. "NO markdown headers / ## headings" for medium + reddit; flowing prose only — `platforms.py:15, 62, 63`; LinkedIn "bold not ## headers" `platforms.py:97`

**Verdict: CONTRADICTED — clear H2/H3 heading structure with short answer blocks *increases* citation; banning headers removes an extractability signal.**

- `stream2-platform-medium.md:85` ("clear H2/H3 heading hierarchy + short answer block — positive; models map structure via headings; 100–300 word extractable passages favored"); `stream2-model-chatgpt.md:89, 98` ("use clear H2/H3 structure with ~120-180-word answer blocks and FAQ patterning"). The "flowing editorial prose, no headers" rule for Medium (`platforms.py:62-63`) works *against* the documented extractable-structure lever. (Reddit is a special case — its citable form is short Q&A comments, so no-headers there is defensible; Medium is where this bites.)

### D3. Reddit "do NOT pose a question and then answer it" / "write as a reply, not standalone Q&A" — `platforms.py:16`

**Verdict: CONTRADICTED by what actually gets cited.** `stream2-platform-reddit.md:85` (Semrush 248k URLs): **Q&A threads = >50% of cited Reddit citations**; problem→direct-solution structure dominates. The cited Reddit artifact *is* the Q&A format the rule forbids. (Caveat: the rule is about authentic community behavior, and citability comes from aged organic threads, not fresh posts — so even "correct" format won't reliably get a *new* post cited. See A6.)

### D4. Reddit "no markdown, conversational, genuine community member, disclose affiliation" — `platforms.py:13-22`

**Verdict: CONFIRMED as platform-authenticity hygiene / irrelevant to citation.** Matches Reddit norms and `stream2-platform-reddit.md:86` (votes/engagement don't drive citation; topical alignment does). Authenticity rules are fine; they're orthogonal to whether the post gets cited (which it largely won't — A6).

### D5. Subreddit promotion classification — restricted/allowed/cautious lists + strategy blocks — `platforms.py:216-296`

**Verdict: NO-EVIDENCE (arbitrary hand-built lists) — and oriented toward promotion-safety, not citability.**

- The `_PROMO_RESTRICTED_SUBREDDITS` frozenset (`platforms.py:220-242`), name-signal keyword lists (`platforms.py:245-250`), and per-strategy prompt blocks (`platforms.py:265-296`) are a manually curated promotion-compliance heuristic. No research source informs which subreddits are listed. Separately, `stream2-platform-reddit.md:89` shows cited subreddits are niche *consumer-product* communities (r/BuyItForLife, r/4kTV) with no B2B/finance equivalents — so the classifier's careful promotion-gating is mostly moot for the vertical where Lumidian has data (Reddit ~never cited in finance). Arbitrary + low-relevance.

### D6. Medium "MUST cite peer-reviewed publications from Brand Profile naturally" — `platforms.py:65`; Medium "include concrete data/evidence for every claim" — `platforms.py:66`

**Verdict: CONFIRMED.** Princeton "cite external authoritative sources" (+115% low-ranked pages) and "add statistics" (+30-40%) — `stream2-model-chatgpt.md:81-83`. Citing sources + concrete data are the strongest controlled levers; this spec implements them.

### D7. Medium/LinkedIn "brand name MUST appear at least once in body" — `platforms.py:64, 100`

**Verdict: CONFIRMED.** Aligns with entity-presence + ghost-citation evidence (see B7): clear brand-entity binding correlates with the brand's content being cited (`stream2-platform-linkedin.md:103-106`; `stream2-model-gemini.md:83`).

### D8. X "format as numbered thread 1/ 2/...", "<280 chars per tweet", "4-8 tweets" — `platforms.py:130-139`

**Verdict: NO-EVIDENCE / moot.** `stream2-platform-x.md:78-80`: the single-post-vs-thread question is "moot for ChatGPT/Claude/Perplexity/Gemini" because X content isn't reaching them. Format rules are correct *for X-the-product* but irrelevant to citation since the platform itself is a non-citation surface (A2).

### D9. "No hashtags / no engagement bait / no emojis" across LinkedIn + X specs — `platforms.py:102-103, 119-122, 137-139, 153-154, 167, 181-184`

**Verdict: NO-EVIDENCE (arbitrary, reach-oriented).** These optimize against human-engagement-bait. No citation source addresses hashtags/emojis/engagement bait as citation factors. Consistent with the "AI visibility only, not human reach" memory, but unproven as citation levers — pure style hygiene.

---

## E. CLUSTER-SPECIFIC RULES — `cluster_brief.py`, `clustering_service.py`, `prompts.py:226-238`

### E1. Canonical phrasings — "3-5 short phrases appearing verbatim across pieces, entity-binding strings", each 6-14 words including brand name — `cluster_brief.py:46, 52`; enforced "VERBATIM REQUIRED, word-for-word" — `clustering_service.py:121`; "include at least one canonical phrasing verbatim" — `prompts.py:234`

**Verdict: WEAKLY CONFIRMED on intent (entity binding), NO-EVIDENCE on the verbatim-repetition mechanic — and at risk of the keyword-stuffing penalty.**

- Intent CONFIRMED: entity clarity / consistent facts across surfaces is a citability trait (`stream2-channel-ranking.md:115` "entity recognition, not link equity, drives citability"; "third-party corroboration — consistent facts across owned + earned surfaces"). Binding a stable entity string is directionally sound.
- Mechanic NO-EVIDENCE + RISK: no source supports forcing the *same phrase verbatim* across pieces. Princeton's keyword-stuffing penalty (`stream2-model-chatgpt.md:85`) cautions against repetition-as-a-tactic. The "VERBATIM REQUIRED word-for-word" enforcement (`clustering_service.py:121`) is the most aggressive version of this and the most exposed to the stuffing penalty. Reframe as consistent entity/fact phrasing, not literal cross-piece string repetition.

### E2. Narrative spine — "1-3 sentence through-line, maintain without restating verbatim" — `cluster_brief.py:47`; `prompts.py:236`

**Verdict: NO-EVIDENCE (arbitrary cluster-coherence device).** No research source addresses a cross-piece narrative spine as a citation factor. It's an internal content-coordination construct; neither supported nor refuted by citation evidence. Plausibly fine for human coherence, irrelevant to citability.

### E3. Cluster "do not open with the brand name; do not include CTAs; practitioner voice, brand as fact not pitch" — `prompts.py:237`

**Verdict: PARTIALLY CONTRADICTED on "don't open with brand name."** The no-CTA / no-pitch / fact-not-pitch framing is fine (matches anti-promotional evidence). But "do not open with the brand name" can conflict with answer-first entity-binding (C1 + B7 + ghost-citation): leading with the entity in the first ~100 words is citation-favorable. Mild tension, not a hard error.

### E4. Brief built only from Brand Profile, "never invent stats or claims" — `cluster_brief.py:51, 53`; claim-verifier strips unsupported claims on paid tiers — `clustering_service.py:365-370`

**Verdict: CONFIRMED.** Same evidence as B6 — anti-fabrication + evidence-grounding is the highest-confidence rule cluster. The claim-verifier is a correct guardrail.

### E5. Asymmetric pillar reference — appends "Further reading on Medium" link to LinkedIn/Reddit/Quora/X pieces — `clustering_service.py:45-74`

**Verdict: CONTRADICTED indirectly — it routes "further reading" to Medium, a Tier-3 declining surface (A4), and to Medium specifically as the pillar default (`clustering_service.py:72-74`).** Pointing cross-references at Medium under-leverages owned-site/Wikipedia (the Tier-1 surfaces). The own-site pillar option exists (`pillar_url`) but Medium is the hardcoded fallback label. Low-stakes, but it codifies the wrong destination priority.

---

## F. STALE / DUPLICATE-CODE FINDING (not a content rule, but Layer-B-relevant)

### F1. `content_service.py:39-117` `PLATFORM_GUIDELINES` is a stale duplicate of `drafting/platforms.py`

**Verdict: STALE DUPLICATE — confirmed, should be reconciled/deleted.**

- `content_service.py:39-117` defines an *older, parallel* `PLATFORM_GUIDELINES` dict (wikipedia/reddit/quora/medium/linkedin/x) with its own tone/rules/workflow fields, consumed by the legacy `generate_draft` path (`content_service.py:313, 345`) which still calls **`claude-sonnet-4-6`** directly (`content_service.py:379`) — bypassing the entire `drafting/` pipeline (evidence pack, critic, voice, citations) and the newer `PLATFORM_SPECS` (`platforms.py:8`). Its rules drifted: e.g. Medium "Minimum 600 words" (`content_service.py:88`) vs `platforms.py:58` 800–2000; reddit "Match subreddit tone" with no subreddit classifier; no query-mirroring, no universal style rules, no em-dash/hedging bans. **Two sources of truth for platform guidance.** Any Layer B rule change made in `platforms.py` will silently NOT apply to whatever still calls `content_service.generate_draft`. Audit which router paths still hit it; consolidate onto `drafting/platforms.py`.

---

## ENGINE BUGS SURFACED BY RESEARCH (Layer B instrumentation fixes)

These are not content rules — they are measurement defects that make the per-platform verdicts above *less certain* (two of four models are citation-blind). Fixing them gives Lumidian first-party Claude + Gemini citation data, which beats any external study.

### BUG 1 — Claude structured citations are never extracted (Claude is 100% citation-blind)

**Confirmed in code + research.**
- Surfaced by: `stream1-citation-mining.md:35` (Claude ran 2,392 queries, produced **0 citation rows**) and detailed root-cause in `stream2-model-claude.md:13, 137-145, 193`.
- Code confirmation: `backend/app/services/llm_service.py:399-404` — `_query_claude` returns a bare dict `{"response_text", "mentioned", "latency_ms", "error"}` with **no `citations` key**; it never calls `_build_result(..., citations=...)` (contrast `_query_gemini` at `llm_service.py:554-555` and the Perplexity path). `_extract_claude_text` (called at `llm_service.py:385`) concatenates `text` blocks and skips the `web_search_tool_result` / `web_search_result_location` blocks that actually hold the URLs. Downstream, `site_audit/citations.py extract_urls` regexes `response_text` for inline `https://`, which Claude's clean prose doesn't contain → ~0 Claude citations recorded.
- Fix shape (per `stream2-model-claude.md:101-145`): add `_extract_claude_citations(response)` iterating `response.content` for `web_search_tool_result` → `web_search_result` `.url` (candidate pool) and `text` block `citations[]` → `web_search_result_location.url` (actually-cited set); persist into the existing `query_results.citations` column (migration `database.py:727`, dated 2026-06-02). Guard: on error `web_search_tool_result.content` is a dict, not a list.

### BUG 2 — Gemini grounding-redirect URLs are stored unresolved (Gemini is 100% citation-blind)

**Confirmed in code + research.**
- Surfaced by: `stream1-citation-mining.md:33` (all 470 Gemini "citations" are opaque `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs stored as domain `google.com`) and resolution mechanics in `stream2-model-gemini.md:11-15, 45-75, 127`.
- Code confirmation: `llm_service.py:202-231` `_extract_gemini_citations` stores the raw `web.uri` (line 226), which is always the redirect proxy — no redirect-following, no use of the cheaper `web.title` shortcut.
- Two fixes per research:
  - **(a) `groundingChunks[].web.title` shortcut** (`stream2-model-gemini.md:14, 73-75`): `.web.title` usually carries the bare domain (e.g. `reddit.com`) while `.web.uri` is the proxy and `.web.domain` is `None`. The extractor already reads `web.title` (`llm_service.py:230`) but stores it only as a display title, not as the classification domain — use it for fast own/competitor/third-party bucketing.
  - **(b) Redirect-follow at ingest** (`stream2-model-gemini.md:12, 52-71, 127`): `requests.head(redirect_url, allow_redirects=True, timeout=5).url` resolves to the real page URL. **Must run at ingest** — redirects expire after ~days (`stream2-model-gemini.md:13, 69`). Use HEAD + small concurrency + retry (mirror the existing Serper burst-throttle lesson).

### BUG 3 — Possible Gemini JSON-schema-empties-groundingMetadata issue to audit

**Audited — does NOT currently apply to the tracking call, but worth recording the guardrail.**
- Surfaced by: `stream2-model-gemini.md:41, 128` — when a forced JSON `response_schema`/`response_mime_type` is set on a grounded Gemini call, `groundingMetadata` frequently comes back **empty** (support offsets invalidated), silently losing citation metadata.
- Code audit: `llm_service.py:505-508` — the tracking `_query_gemini` builds `GenerateContentConfig(tools=[Tool(google_search=GoogleSearch())])` and a plain fallback config; **neither sets `response_mime_type` nor `response_schema`.** So the tracking path is NOT currently exposed to this bug. **However:** any future change that adds a JSON schema to the grounded call (or any *other* grounded Gemini call elsewhere that forces JSON) would silently zero out citations. Layer B action: add a lint/assertion that grounded Gemini calls never set a response schema, and audit any other `google_search` + JSON-schema call sites if added later. Reference: `stream2-model-gemini.md:41`.

---

## SUMMARY TABLE (verdict counts)

| Verdict | Rules |
|---|---|
| **CONFIRMED** | B3 (hedging ban), B6/E4 (anti-fabrication + evidence grounding), C1 (answer-first), D4 (Reddit authenticity), D6 (Medium cite-sources), D7 (brand-in-body) |
| **CONFIRMED w/ caveat** | C2 (query terms — but avoid stuffing), E1-intent (entity binding) |
| **CONTRADICTED** | A1 (5-platform core strategy), A2 (X), A3 (Quora), A4 (Medium-finance), A6 (Reddit publish-to-cite), A7 (Wikipedia under-prioritized), A8 (no owned-site surface), C2-mechanic (literal term-repeat), D2 (no-headers on Medium), D3 (Reddit anti-Q&A), E5 (Medium pillar default) |
| **PARTIALLY CONTRADICTED** | A5 (LinkedIn engine-mix + wrong artifact), E3 (don't-open-with-brand) |
| **NO-EVIDENCE (arbitrary)** | B1 (em-dash), B2 (banned words), B4 (sentence variety), B5 (contractions), B8 (human-voice), C3 (checked-framing), D1 (length ranges), D5 (subreddit lists), D8 (X thread format), D9 (no hashtags/emoji), E1-mechanic (verbatim phrasing), E2 (narrative spine) |
| **STALE DUPLICATE** | F1 (`content_service.py` PLATFORM_GUIDELINES) |
| **ENGINE BUGS** | Claude citations unextracted; Gemini redirects unresolved; Gemini JSON-schema risk (not currently triggered) |
