# Lumidian Anti-AI Writing Standard — 2026

> **What this is.** The single canonical standard for ensuring no content Lumidian generates reads as AI-written. It compiles the research (`docs/strategy/research/antiai-lexical-tells.md`, `antiai-syntactic-tells.md`, `antiai-structural-tells.md`) into one enforceable spec, and is implemented as a code gate: **`backend/app/services/drafting/anti_ai.py`** (14 tests in `tests/test_anti_ai.py`).
>
> This is the **human-credibility / anti-AI rule family** from the Layer B spec — one of the two orthogonal rule families. It is independent of the citation-driver rules: a draft must pass *both*.

---

## The core principle (do not weaken this)

**No single common word proves AI authorship. Density and co-occurrence do.** A dumb word-blocklist that bans "robust" or "crucial" would replicate the documented AI-detector bias against non-native English and technical writing (Stanford: 61.3% of non-native TOEFL essays falsely flagged as AI). So the standard is **two-tier**:

1. **Zero-tolerance tells** — fail on a *single* occurrence. These are near-certain and rarely appear in good human prose:
   - **Assistant-voice leaks** ("as an AI", "I hope this helps", "Certainly!", "great question") → hard block, never ships.
   - **High-precision constructions** — the "it's not just X, it's Y" antithesis, "plays a crucial role", "stands as a testament to", "in today's fast-paced world", "let's dive in", "in conclusion", trailing "…, highlighting its enduring legacy" clauses, "whether you're X or Y", grandiosity ("paradigm shift", "game-changer"), vague attribution ("studies have shown"), "it's worth noting".
   - **Smoking-gun vocabulary (S1)** — corpus-measured 10×–6700× frequency spikes in post-ChatGPT text: *delve, tapestry, underscore, showcasing, intricate, meticulous, pivotal, realm, myriad, testament, embark…*
   - **Uniform robotic cadence** — sentence-length stdev < 6 words (the "cadence uniformity" tell that survives editing).

2. **Density tells** — only fail when they *cluster* (≥2 categories firing, or enough weighted density). These are FP-prone and legitimate in isolation:
   - Common AI-leaning words (*robust, crucial, comprehensive, significant, leverage, seamless…*) — discounted by false-positive risk; one or two is fine.
   - Em-dash density (>2/1k words), bullet-ratio (>40%), bold-label-colon list spam, canned transition openers (Moreover/Furthermore >20% of sentences).

**Explicitly NOT penalized** (these are ESL/technical false-positive traps the research forbids flagging): short sentences in isolation, simple vocabulary, genre-required formality. We flag rhythm *uniformity*, never *shortness*.

## The honest bar

Per the research, **AI detectors are unreliable in both directions in 2026** (OpenAI killed its own; Pangram and others false-positive on real human writing). A find-and-replace pass does **not** move a trained classifier. So the durable target is **"reads human to an editor"**, approximated by: burstiness (sentence-length variance) + concrete specificity (names, numbers, dates) + first-person voice + varied openings + absence of the tells above. Optimize for that and the detector score is a lagging byproduct — and the content is genuinely better, which is the actual point.

---

## The enforcement gate (implemented)

`anti_ai.py` public API:

| Function | Use |
|----------|-----|
| `scan(text) -> AntiAIReport` | Full report: `passed`, `blocked`, `score` (breadth-weighted points/1k words), per-violation detail, metrics. |
| `passes(text) -> bool` | Quick gate. |
| `feedback_for_regeneration(report) -> str` | Concrete instruction listing the exact phrases/tells the writer LLM must remove on rewrite. |
| `autofix(text) -> str` | Safe, **meaning-preserving** cosmetic fixes only (curly→straight quotes, em-dash→comma, strip chat sign-ons). Never touches claims. |

**Scoring model:** weighted points per category (assistant=block; construction=4 each; S1 word=3, S2=2, S3=1, ×(1−fp_discount); structure/rhythm flags=2–4), normalized per 1000 words, multiplied by a **breadth factor** (number of distinct categories firing). A text fails if it is `blocked`, **or** score > threshold (12.0) **and** (a hard signal is present **or** ≥2 categories fire). This is what lets a single "robust" pass while a single "delve" or one antithesis fails.

## The regeneration loop (how Layer B/C wires it in)

The gate runs as the **last step of every draft generation**, before a draft is persisted or shown:

```
draft = writer_llm(prompt)
for attempt in range(MAX_ANTI_AI_RETRIES):     # e.g. 2
    draft = anti_ai.autofix(draft)             # free cosmetic cleanup
    report = anti_ai.scan(draft)
    if report.passed:
        break
    # feed the SPECIFIC tells back and regenerate (preserves facts/claims)
    draft = writer_llm(prompt + "\n\n" + anti_ai.feedback_for_regeneration(report))
# if still failing after retries: flag for human review, never auto-publish
```

This belongs in the unified writer (**Layer B2**) so every generation path inherits it. Until B2 lands, the module is available to call from any drafting path. It composes with the citation-driver rules: a draft must pass the anti-AI gate **and** carry the citation-driver traits (answer-first, stats, inline cites, etc.).

## Integration notes / guardrails

- **Voice integration reinforces this.** Ken's "easy voice/guidelines" requirement (Layer B/C) is itself a strong anti-AI mechanism — writing in a specific human voice raises perplexity and breaks the averaged-AI tone. The voice/guidelines input should be threaded *before* the anti-AI gate, so the gate validates already-voiced text.
- **Don't over-tune to detectors.** The threshold targets editor-credibility, not a specific tool's score. Re-tune against a real corpus of shipped drafts, not against GPTZero.
- **The lexicon/constructions are versioned** — AI tells drift (em-dash was the 2024 tell; cadence uniformity is the 2026 one). Refresh alongside the strategy doc (~quarterly) from the `antiai-*.md` research files.

---

## Source research
- `docs/strategy/research/antiai-lexical-tells.md` — 221-term tiered lexicon (S1–S3 + FP risk), corpus-frequency-anchored.
- `docs/strategy/research/antiai-syntactic-tells.md` — ~60 regex-able constructions across 13 categories.
- `docs/strategy/research/antiai-structural-tells.md` — structural/rhythm tells + detector mechanics + the "reads human to an editor" bar.
