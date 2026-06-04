# Anti-AI Syntactic & Rhetorical Tells — Regex-able Pattern Catalog

> Purpose: enumerable, pattern-level constructions that are strong giveaways of LLM-authored prose, formatted for direct conversion into detection regexes.
> Date: 2026-06. Targets GPT-4-class through 2025/2026-era models (GPT-4o/4.1, Claude 3.5/4.x, Gemini 2.x).

## How to read this file

- **Pattern** — the literal construction.
- **Regex** — a starting regex. All are case-insensitive (`(?i)`); `[—–-]` covers em-dash / en-dash / hyphen-as-dash. Tune word boundaries (`\b`) and tighten `.{1,N}` spans against your false-positive corpus before shipping. Treat every regex as a *candidate signal*, not a verdict — the literature is unanimous that a single instance is fine; **density and co-occurrence** are the actual tell.
- **Notes** — variants, scoring guidance, false-positive risks.

**Global scoring principle (from every source):** no single pattern proves AI authorship. Human writers legitimately use antithesis, tricolon, and em-dashes. The signal is *robotic frequency and co-occurrence* — three tricolons in a paragraph, 20+ em-dashes in an article, every section closing with a "-ing" summary clause. Weight by **count per 1000 words** and **number of distinct categories firing**, not by any single match.

---

## 1. Negation / Antithesis Parallelism

The single most-cited LLM tell. Classical "negative-positive parallelism": negate a familiar framing, then substitute a "more profound" one. Barron's counted this in Fortune 500 filings: ~50 in 2023 → 200+ in 2025.

### 1.1 "It's not just X, it's Y"
- **Pattern:** `It's not just X — it's Y` / `It isn't just X, it's Y` / `This isn't just X, it's Y`
- **Regex:** `(?i)\b(it|this|that|she|he|they)('?s| is| was)\s+not\s+just\s+.{1,60}?[—–,-]\s*(it|this|that)('?s| is|’s)\s+`
- **Notes:** Also catch contracted-then-spelled forms ("It's not merely X, it's Y").

### 1.2 "It's not about X; it's about Y"
- **Pattern:** `This isn't about X; it's about Y` / `It's not about X — it's about Y`
- **Regex:** `(?i)\b(it|this|that)('?s| is| was)\s+n('o|o)t\s+about\s+.{1,60}?[—–;,-]\s*(it|this|that)('?s| is)\s+about\b`

### 1.3 "It's not X. It's Y." (two-sentence staccato form)
- **Pattern:** Negation closed with a period, then a one-clause replacement sentence.
- **Regex:** `(?i)\b(it|this|that)('?s| is| was)\s+not\s+.{1,50}?\.\s+(it|this|that)('?s| is)\s+.{1,50}?\.`
- **Notes:** Pair with short-sentence-fragment detection (§13) — they co-occur heavily.

### 1.4 "not only X but also Y"
- **Pattern:** `not only X but (also) Y`
- **Regex:** `(?i)\bnot only\b.{1,80}?\bbut(\s+also)?\b`

### 1.5 "not X, but Y" / "X, not Y" / "X — not Y"
- **Pattern:** Bare contrastive: `not a mirror but a portal`; trailing form `X — not Y`.
- **Regex (lead):** `(?i)\bnot\s+(a|an|the)?\s*\w+(\s+\w+){0,3},?\s+but\s+(a|an|the|rather)\b`
- **Regex (trailing dash):** `(?i)\b\w+(\s+\w+){0,4}\s*[—–]\s*not\s+\w+`
- **Notes:** `not because X, but because Y` is a common subtype: `(?i)\bnot because\b.{1,80}?\bbut because\b`

### 1.6 "Not X. Not Y. Just Z." (countdown / triple-negation)
- **Pattern:** Multiple negated fragments before a reveal.
- **Regex:** `(?i)\bnot\s+.{1,30}?\.\s+not\s+.{1,30}?\.\s+(just|only|simply)\b`
- **Notes:** Numeric variant: `Not 10. Not 50. [Actual number].`

### 1.7 "No X, no Y, just Z"
- **Pattern:** `no fluff, no filler, just results`
- **Regex:** `(?i)\bno\s+\w+,\s+no\s+\w+,\s+(just|only|simply)\b`

### 1.8 Cross-sentence "X, however, Y" reversal
- **Pattern:** Initial positive description undercut by mid-sentence `, however,` pivot.
- **Regex:** `(?i)\w+,\s+however,\s+`
- **Notes:** High false-positive in formal human writing; only score when stacked with other categories.

---

## 2. Rule-of-Three / Tricolon & Parallel-Structure Overuse

Tricolon ("having three members," e.g. *veni, vidi, vici*) is legitimate; the tell is **corporate-perfect, back-to-back** tricola. A single one is elegant; three in a row is the pattern-recognition failure.

### 2.1 Three-adjective / three-noun list
- **Pattern:** `fast, reliable, and scalable` / `powerful, comprehensive, and significant`
- **Regex:** `(?i)\b(\w+ly\b|\w+)\s*,\s*\w+\s*,\s*and\s+\w+\b`
- **Tighter (adjective triad before noun):** `(?i)\b(\w+),\s+(\w+),\s+and\s+(\w+)\s+(\w+)`
- **Notes:** Score *density*: flag when ≥2 comma-and triads appear within ~120 words.

### 2.2 Three parallel clauses (semicolon or comma triad)
- **Pattern:** `It empowers teams; it accelerates delivery; it transforms outcomes.`
- **Regex:** `(?i)(\b\w+\s+\w+(\s+\w+){0,4};\s*){2}\w+\s+\w+`
- **Notes:** Also catch verb-led anaphora triads (§2.4).

### 2.3 Tricolon extended to 4–5 ("tricolon abuse")
- **Pattern:** Rule-of-three inflated to long comma-lists.
- **Regex:** `(?i)(\b\w+,\s+){3,}\w+,?\s+and\s+\w+`

### 2.4 Anaphora (repeated opening word/phrase across clauses)
- **Pattern:** `They build. They ship. They iterate.` / `It's about X. It's about Y. It's about Z.`
- **Regex:** `(?i)\b(\w+(\s+\w+)?)\b[^.?!]{1,60}[.?!]\s+\1\b[^.?!]{1,60}[.?!]\s+\1\b`
- **Notes:** Backreference `\1` catches the literal repeated opener.

---

## 3. "Whether you're X or Y" & "From X to Y" Sweeping Ranges

### 3.1 "Whether you're X or Y"
- **Pattern:** `Whether you're a startup or an enterprise…` / `Whether you're new to X or a seasoned Y`
- **Regex:** `(?i)\bwhether you('?re| are)\s+.{1,40}?\bor\b`
- **Notes:** Also `Whether it's X or Y`, `Whether you need X or Y`: `(?i)\bwhether (you|it|they)('?s|('?re)| need| want| are)\b.{1,40}?\bor\b`

### 3.2 "From X to Y" sweeping / false range
- **Pattern:** `From startups to Fortune 500s` / `From X to Y to Z` with often-unrelated endpoints.
- **Regex:** `(?i)\bfrom\s+\w+(\s+\w+){0,3}\s+to\s+\w+(\s+\w+){0,3}\b`
- **Tighter (triple-range):** `(?i)\bfrom\s+.{1,30}?\s+to\s+.{1,30}?\s+to\s+.{1,30}`
- **Notes:** "False ranges" with unrelated endpoints are the AI subtype; high FP on legitimate ranges ("from 2010 to 2020"). Exclude numeric/date endpoints to cut noise.

---

## 4. Setup / Framing Openers

These prime a "let me orient you" pseudo-essay voice. Each is individually weak; as paragraph/section openers they're a strong positional signal — weight higher when sentence- or paragraph-initial.

### 4.1 "When it comes to X"
- **Regex:** `(?i)(^|[.!?]\s+)when it comes to\b`

### 4.2 "In the world of X" / "In the realm of X" / "In the landscape of X"
- **Regex:** `(?i)\bin (the|today's)\s+(world|realm|landscape|age|era|sphere|domain|space)\s+of\b`

### 4.3 "In today's [fast-paced/digital/ever-evolving] world"
- **Pattern:** `In today's fast-paced world` (~107x more frequent in AI corpora than human).
- **Regex:** `(?i)\bin today('?s)\s+(\w+[-\s])*(world|landscape|environment|market|economy|age)\b`

### 4.4 "Picture this" / "Imagine a…" / "Imagine a world where…"
- **Regex:** `(?i)(^|[.!?]\s+)(picture this|imagine (a|an|that|if|you|a world where))\b`

### 4.5 "Let's dive in" / "Let's unpack/explore/break this down"
- **Regex:** `(?i)\blet('?s| us)\s+(dive (in|into)|unpack|explore|break (this|it) down|delve into|take a (closer )?look)\b`

### 4.6 "Here's the thing" / "Here's the kicker" / "Here's what most people miss"
- **Regex:** `(?i)\bhere('?s| is)\s+(the\s+(thing|kicker|deal|catch|truth|secret|problem)|what (most people|nobody|everyone)\b|where it gets\b)`

### 4.7 "The truth is…" / "The real story is…" / "But none of them is the real story"
- **Regex:** `(?i)\b(the\s+(truth|real story|reality|kicker)\s+is|but none of (them|these) is the (real|whole))\b`

---

## 5. Em-Dash Overuse & "X — and that's a good thing"

Em-dashes alone are **not** reliable (a known false-positive vector — earlier-model vestige), so use density + the specific reframe template, not bare presence.

### 5.1 Em-dash density (document-level, not regex-per-match)
- **Heuristic:** count `[—–]` (and ` - ` used as a dash). Human: ~0–3 per 1000 words; AI commonly 8–20+.
- **Detector:** `[—–]` or `(?<=\w)\s-\s(?=\w)` — then threshold on count/1000 words, don't flag individual hits.

### 5.2 Double-em-dash interrupter
- **Pattern:** `The result — counterintuitively — was speed.`
- **Regex:** `(?i)[—–]\s*\w+(\s+\w+){0,6}\s*[—–]`

### 5.3 "X — and that's a good thing" / closing-dash reframe
- **Pattern:** `…harder to scale — and that's a good thing.` / `— and that's exactly the point.`
- **Regex:** `(?i)[—–]\s*and that('?s| is)\s+(a good thing|exactly|precisely|the (point|whole point)|okay|fine)\b`

---

## 6. Hedging / Qualifier Stacking

LLMs over-soften: when *almost every* claim carries a hedge, that's the tell. Detectors flag "formal hedging language" as a high-AI signal. Score by **hedge density per sentence**, not isolated hits.

### 6.1 Modal / adverbial hedge stacking
- **Pattern:** `may`, `might`, `could`, `can`, `perhaps`, `arguably`, `generally`, `often`, `typically`, `in many cases`, `to some extent`, `somewhat`, `relatively`, `potentially`.
- **Regex (single hedge):** `(?i)\b(may|might|could|can|perhaps|arguably|generally|typically|often|usually|somewhat|relatively|potentially|presumably|conceivably)\b`
- **Regex (stacked hedge — strong signal):** `(?i)\b(may|might|could)\s+(potentially|possibly|perhaps|sometimes|in some cases)\b`
- **Phrase hedges:** `(?i)\b(in many cases|to some extent|in some respects|more often than not|for the most part|it can be argued that|it('?s| is) worth considering)\b`
- **Notes:** Compute hedges-per-100-words; flag above a tuned threshold rather than on any one match.

### 6.2 "It's worth noting / important to note / bears mentioning"
- **Regex:** `(?i)\bit('?s| is)\s+(worth (noting|mentioning|remembering)|important to (note|remember|understand)|bears (noting|mentioning)|notable that)\b`

### 6.3 Sentence-initial discourse hedges
- **Pattern:** `Importantly,` `Interestingly,` `Notably,` `Crucially,`
- **Regex:** `(?i)(^|[.!?]\s+)(importantly|interestingly|notably|crucially|significantly|remarkably|tellingly)\s*,`

### 6.4 Formal connector overload
- **Pattern:** `moreover`, `furthermore`, `consequently`, `additionally`, `thus`, `hence`, `therefore` as paragraph glue.
- **Regex:** `(?i)(^|[.!?]\s+)(moreover|furthermore|consequently|additionally|thus|hence|nonetheless|nevertheless)\s*,`
- **Notes:** Threshold on count; one or two are normal human prose.

---

## 7. Empty Value / Significance Statements

Vague significance-claiming with no concrete content. Strongly corpus-supported.

### 7.1 "plays a [crucial/vital/pivotal/key] role in"
- **Regex:** `(?i)\bplays?\s+a\s+(crucial|vital|pivotal|key|critical|significant|central|major|important)\s+role\b`

### 7.2 "stands as a testament to" / "is a testament to"
- **Regex:** `(?i)\b(stands?|serves?)\s+as\s+a\s+(testament|reminder|symbol|beacon|cornerstone)\s+to\b`

### 7.3 "is a powerful tool (for)"
- **Regex:** `(?i)\bis\s+a\s+(powerful|valuable|essential|versatile|robust)\s+tool\b`

### 7.4 "has become increasingly important / popular"
- **Regex:** `(?i)\b(has|have)\s+become\s+(increasingly|more and more|ever more)\s+\w+`

### 7.5 "continues to evolve / shape / play" (ever-evolving family)
- **Regex:** `(?i)\b(continues?\s+to\s+(evolve|shape|grow|expand|redefine|transform|play)|ever[\s-]evolving|ever[\s-]changing|rapidly evolving)\b`

### 7.6 "underscores / highlights / reflects the importance of"
- **Regex:** `(?i)\b(underscores?|highlights?|reflects?|emphasizes?|illustrates?|demonstrates?)\s+(the\s+)?(importance|significance|need|value|role)\b`

### 7.7 "serves as" / "stands as" / "marks" / "represents" (the "is-a" dodge)
- **Pattern:** Avoiding plain `is`: `The library serves as a hub` instead of `is a hub`.
- **Regex:** `(?i)\b(serves?|stands?)\s+as\s+(a|an|the)\b|\b(marks|represents)\s+(a|an|the)\s+\w+`

### 7.8 Ornate-noun clusters ("tapestry", "landscape", "realm", "paradigm")
- **Regex:** `(?i)\b(rich|vibrant|intricate|complex|ever-evolving)\s+(tapestry|landscape|mosaic|ecosystem|fabric)\b`
- **Single-word watchlist:** `(?i)\b(tapestry|realm|landscape|paradigm|synergy|ecosystem|delve|leverage|utilize|harness|robust|streamline|navigating|boasts|nestled|showcasing|vibrant|bustling|seamless)\b` (threshold on count/1000 words)

### 7.9 "Despite [its] challenges, …" optimistic pivot
- **Regex:** `(?i)\bdespite\s+(its|these|the|several|numerous|various|ongoing)\s+(challenges|obstacles|setbacks|limitations|complexities|difficulties)\b`

---

## 8. Over-Explaining / Restating / Summarizing

### 8.1 Trailing "-ing" significance clause (superficial analysis)
- **Pattern:** `The station has 8 tracks, contributing to socio-economic development.` / `…, highlighting its enduring legacy.`
- **Regex:** `(?i),\s+(highlighting|emphasizing|underscoring|reflecting|showcasing|demonstrating|illustrating|contributing to|reinforcing|signaling|cementing|solidifying)\b`
- **Notes:** One of the highest-precision tells when it closes a factual sentence.

### 8.2 "This [concept] demonstrates/illustrates/reflects…"
- **Regex:** `(?i)(^|[.!?]\s+)this\s+\w+\s+(demonstrates|illustrates|reflects|reveals|shows|underscores|highlights)\b`

### 8.3 Signposted conclusions / fractal summaries
- **Regex:** `(?i)(^|[.!?]\s+)(in conclusion|to sum up|in summary|to summarize|all in all|ultimately|in essence|at the end of the day|as we('?ve| have) (seen|discussed|explored))\b`

### 8.4 Section-open self-narration
- **Pattern:** `In this section, we'll explore…` paired with closing `…as we've seen in this section`.
- **Regex:** `(?i)\bin this (section|article|post|guide|piece),?\s+(we('?ll| will)|I('?ll| will)|you('?ll| will))\s+(explore|cover|discuss|look at|examine|break down)\b`

### 8.5 Restating-the-question opener (chat-assistant residue)
- **Pattern:** `Great question! The key to X is…` / `When you ask about X, what you're really asking is…`
- **Regex:** `(?i)(^|[.!?]\s+)(great|excellent|that('?s| is) a (great|fantastic|good))\s+question\b|(^|[.!?]\s+)(when (you ask|it comes) (about|to)\b.{1,40}?,\s+what)`

---

## 9. Rhetorical-Question Self-Answer

- **Pattern:** `The result? Faster shipping.` / `The catch? There isn't one.` / `Why does this matter? Because…`
- **Regex:** `(?i)\bthe\s+\w+(\s+\w+){0,3}\?\s+(a|an|the|because|it('?s| is)|simple|none|yes|no)\b`
- **Notes:** Also bare `Why X? Because Y.`: `(?i)(^|[.!?]\s+)(why|how|what)\b[^?]{2,60}\?\s+because\b`

---

## 10. Patronizing Analogy / "Think of it as"

- **Pattern:** `Think of it as a GPS for your finances.` / `It's like a Swiss Army knife for X.`
- **Regex:** `(?i)\b(think of (it|this) (as|like)|it('?s| is) like (a|an)|imagine (it|this) as)\b`

---

## 11. Stakes Inflation / Grandiosity

- **Pattern:** `will fundamentally reshape`, `will define the next era of`, `a paradigm shift`, `game-changer`, `revolutionize`.
- **Regex:** `(?i)\b(fundamentally (reshape|transform|change)|will define the (next era|future) of|paradigm shift|game[\s-]chang(er|ing)|revolutioniz(e|ing|es)|usher(ing)? in a new (era|age)|at the forefront of)\b`

---

## 12. Vague Attribution

- **Pattern:** `Experts argue that…`, `Industry reports suggest…`, `Studies have shown…`, `Observers have cited…`, `Many believe…`.
- **Regex:** `(?i)(^|[.!?]\s+)(experts?\s+(argue|say|agree|suggest|believe)|(industry|recent)\s+(reports?|studies)\s+(suggest|show|indicate)|studies have shown|research (shows|suggests|indicates)|observers have|many (believe|argue|say)|it is (widely )?(believed|known|understood) that)\b`

---

## 13. Structural / Co-occurrence Signals (not single-line regex)

These need document-level counting, not per-match flags. They're the highest-value *aggregate* discriminators.

- **Short-fragment staccato:** ratio of sub-5-word "sentences" (one-thought paragraphs). `(?i)(^|\n)\s*\w[\w\s']{0,25}[.!?]\s*(\n|$)` — count and ratio.
- **Bold-first bullets:** `(?m)^\s*[-*]\s+\*\*[^*]+\*\*\s*[:.]` — every list item opens with a bolded lead-in.
- **Title-Case headings:** `(?m)^#{1,6}\s+([A-Z][a-z]+\s+){2,}` with function words capitalized.
- **Unicode decoration:** arrows `→` `⇒`, smart quotes `[""'']` where surrounding text uses straight quotes, bullet glyphs `•`.
- **One-point dilution:** single thesis restated; detect via high inter-paragraph semantic similarity (embeddings), not regex.
- **Em-dash density:** see §5.1.
- **Hedge density:** see §6.1.

---

## Suggested scoring model

1. Tally matches per category, normalized per 1000 words.
2. Cap each category's contribution (avoid one repeated phrase dominating).
3. Score = weighted sum, with **number of distinct categories firing** as a multiplier (breadth matters more than depth — three categories at low density beats one category at high density).
4. Highest-weight categories (best precision): §1 (antithesis), §8.1 (trailing -ing clause), §5.3 (dash reframe), §7.1–7.3/7.8 (empty value + ornate nouns), §8.5 (restating the question).
5. Lowest-weight / FP-prone (use only as multipliers): bare em-dash count (§5.1), single hedges (§6.1), formal connectors (§6.4), `from X to Y` (§3.2).

---

## Sources

- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) — community-curated catalog of phrasing/markup tells (negation, tricolon, "serves as" dodge, trailing -ing analysis, vague attribution, promotional clusters).
- [Colin Gorrie, "Why ChatGPT writes like that"](https://www.deadlanguagesociety.com/p/rhetorical-analysis-ai) — rhetorical-device analysis: antithesis ("it's not X, it's Y"), ascending tricolon, parallelism, the "taste" thesis.
- [tropes.fyi — AI Writing Pattern Directory](https://tropes.fyi/directory) and [mirror gist](https://gist.github.com/ossa-ma/f3baa9d25154c33095e22272c631f5a1) — enumerated trope list with templates (negative parallelism, countdown, rhetorical self-answer, anaphora, em-dash addiction, "here's the kicker", false ranges, "serves as" dodge, signposted conclusions).
- [DEV Community — "Why Does AI Keep Saying 'It's Not X, It's Y'?"](https://dev.to/milind_nair/why-does-ai-keep-saying-its-not-x-its-y-2ihk) — origin and prevalence of the antithesis tell.
- [Ruben Hassid — "It's not [X], it's [Y]"](https://ruben.substack.com/p/its-not-x-its-y) — variant catalog of the antithesis template.
- [ai-text-humanizer.com — Common Words and Phrases in AI-Generated Text](https://ai-text-humanizer.com/ai-words/) — corpus frequency multipliers ("today's fast-paced world" ~107x, "notable works include" >120x, "aims to explore" ~50x, "aligns" ~16x).
- [arXiv 2510.05136 — Linguistic Characteristics of AI-Generated Text: A Survey](https://arxiv.org/abs/2510.05136) — survey of lexical/syntactic distinguishing features (PDF binary; cited from abstract/search context).
- [Rolling Stone — "ChatGPT Hyphen: Are Em Dashes a Giveaway of AI Writing?"](https://www.rollingstone.com/culture/culture-features/chatgpt-hypen-em-dash-ai-writing-1235314945/) — em-dash as a non-reliable-alone signal; density framing.
- [Surfer SEO — How to Avoid AI Detection (2026 Guide)](https://surferseo.com/blog/avoid-ai-detection/) and [aidetectors.io](https://www.aidetectors.io/blog/how-to-tell-if-text-is-ai-written) — detector-vendor breakdowns: hedging-language flagging, formal-connector overload, generic openers, per-model fingerprints (ChatGPT em-dashes, Claude caveat-verbosity, Gemini list-heaviness).
- [JustDone — Common AI Words and Phrases to Avoid](https://justdone.com/blog/ai/common-ai-words) and [Medium — 7 Dead Giveaways of AI Writing](https://medium.com/@jess_33150/7-dead-giveaways-of-ai-writing-df5145f13498) — editor-side phrase lists and replacements.
