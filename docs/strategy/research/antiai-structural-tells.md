# Anti-AI-Writing Enforcement: Structural Tells & Detector Mechanics

> Internal research pass (June 2026) for an automated enforcement layer that strips AI "fingerprints" from generated drafts **before** they ship. Goal is legitimate humanization — making genuine, brand-accurate content read like a person wrote it — not laundering low-effort slop. Two parts: (1) enumerable structural/formatting tells we can detect and lint against in our own output, and (2) how detectors actually score text so we optimize against the real signals, not folklore.

---

## TL;DR for the enforcement system

1. **Punctuation tells are weak signals, but cheap to fix.** The em-dash is the most famous tell and the least reliable — it survives suppression in most models but is trivially stripped. Detectors barely weight it. Fix it anyway because humans notice it; don't believe it's "defeating a detector."
2. **The real signals are statistical: perplexity (predictability) and burstiness (sentence-length variance).** Modern commercial detectors (Pangram, Copyleaks, GPTZero v7) add a trained transformer classifier on top, which catches structural "shape" that survives find-and-replace edits.
3. **The highest-leverage tells are structural shape, not characters:** cadence uniformity (18–24 word sentences repeating), rigid topic-sentence→evidence→summary paragraphs, tidy tricolons, "not just X but Y," bold-label-colon list spam, and boilerplate openers/closers. These persist across revisions and across markdown suppression.
4. **Bar to clear:** "won't trip a detector" is a moving, unreliable target (detectors are unreliable in 2026 in both directions). The durable bar is **"reads human to an editor"** — burstiness + concrete first-person detail + varied openings. Optimize for that and the detector score follows.

---

# PART 1 — Structural / formatting tells (detectable signals)

Each tell below is written so it can be turned into a lint rule over a draft. "Signal" = a measurable heuristic; "Threshold" = a starting value to flag on (tune empirically).

## 1A. Punctuation tells (low weight, high visibility)

| Tell | Detectable signal | Suggested flag threshold |
|------|-------------------|--------------------------|
| Em-dash overuse | `—` count per 1,000 words | > 2.0 per 1k words (human baseline is well under 1; GPT-4.1 hits ~9.1 under markdown suppression) |
| Em-dash as universal connector | `—` used >1× in a single paragraph, or >1 per ~150 words locally | flag any paragraph with ≥2 em-dashes |
| Smart/curly quotes & apostrophes | presence of `" " ' '` (U+2018/2019/201C/201D) when surrounding human-authored corpus uses straight `' "` | flag if curly-quote ratio > 0.5 and source channel normally uses straight quotes |
| Ellipsis as soft trailer | `…` (U+2026) or ` ... ` used for "thoughtful pause" rather than omission | flag > 1 per 500 words |
| Title-Case Headings | headings where most words are Capitalized (vs sentence case) | flag if >60% of heading words are capitalized AND brand style is sentence-case |
| Oxford-comma perfection | Oxford comma applied in 100% of eligible lists | not flaggable alone; only useful combined with other tells |

> **Note:** Per *The Last Fingerprint* (arXiv:2603.27006), the em-dash is "markdown leaking into prose" — the smallest surviving unit of the markdown-saturated training corpus. It persists even when headers/bullets/bold are suppressed (except Meta Llama, which emits ~0.0/1k). So treat em-dash density as a **cosmetic** fix for human readers, not a detector-defeating one.

## 1B. Formatting / layout tells (medium weight, very detectable)

| Tell | Detectable signal | Suggested flag threshold |
|------|-------------------|--------------------------|
| Bold-label-colon list items (`**Speed:** ...`) | fraction of list items matching `^\s*[-*\d.]+\s*\*\*[^*]+\*\*\s*:` | flag if > 0.3 of list items match |
| Excessive bulleting | ratio of bulleted/numbered lines to total non-blank lines | flag if `bulleted_lines / total_lines > 0.4` |
| List-as-default-structure | ≥3 separate lists in a piece under ~800 words | flag |
| Emoji-as-bullets | lines beginning with an emoji glyph as a list marker | flag any |
| "Key Takeaways" / numbered summary blocks | heading text matches `(key takeaways|key points|in summary|tl;dr|quick recap)` immediately followed by a list | flag |
| "In conclusion" / boilerplate closer headers | heading or final paragraph opens with `(in conclusion|in summary|to wrap up|all in all|one thing is clear|ultimately,)` | flag |
| Question-restated section headers | heading ends in `?` and restates the body's first sentence | flag if heading is interrogative AND >0.5 token overlap with next sentence |
| Uniform paragraph length | stdev of paragraph word counts across the piece | flag if `para_wordcount_stdev / mean < 0.25` (paragraphs too uniform) |
| Rigid paragraph template | each paragraph = topic sentence → evidence → summary sentence (detectable as: first & last sentence of most paragraphs are both "claim-like" / low-detail) | flag if pattern holds in >0.6 of paragraphs |

## 1C. Rhythm / cadence tells (HIGH weight — this is what survives editing)

This is the single most cited 2026 tell ("cadence uniformity"). These map directly to detector burstiness.

| Tell | Detectable signal | Suggested flag threshold |
|------|-------------------|--------------------------|
| Uniform sentence length | stdev of sentence word-counts | flag if `sentence_len_stdev < 6` words (human prose is "a drunk EKG" of alternating short/long) |
| Clustering in the 18–24 word band | fraction of sentences with 18–24 words | flag if > 0.5 of sentences fall in this band |
| No short sentences | count of sentences ≤ 6 words | flag if 0 short sentences in >300 words |
| No fragments / no asides | presence of sentence fragments or parenthetical asides | flag if 0 fragments AND 0 parentheticals in a long piece |
| Low burstiness (composite) | normalized variance of per-sentence length + per-sentence perplexity | flag if below human band (see Part 2) |
| Uniform transitions | repeated transition openers (`Moreover, Furthermore, Additionally, However,`) | flag if >0.2 of sentences start with a canned transition |

## 1D. Phrase-pattern tells (HIGH weight — survive find-and-replace poorly but recur)

| Tell | Detectable signal |
|------|-------------------|
| "Not just X, but Y" | regex `not (just\|only) .+,? but` — humans use occasionally; LLMs ~1 per paragraph |
| Tidy tricolons | three comma-separated parallel adjectives/nouns ending in "and" (`fast, reliable, and affordable`) at high density |
| "From X to Y" framing | `from .+ to .+` openers at 2–5× human rate |
| Present-participial tails | main clause + `, ` + `-ing` verb phrase, at 2–5× human rate |
| Hedging preambles | `(it's important to note\|it's worth noting\|generally speaking\|to some extent\|that said,)` |
| LLM "aidiolect" vocabulary | `(delve\|harness\|bolster\|illuminate\|leverage\|utilize\|tapestry\|realm\|beacon\|landscape\|navigate the\|in today's)` — flag density > N per 1k words |

---

# PART 2 — Detector mechanics (what we're actually optimizing against)

## 2A. The three detection layers

Modern detectors stack three signals; all three weaken as base LLMs improve.

1. **Perplexity** — "how likely an AI model would have chosen the exact same words." Low perplexity (predictable text) ⇒ looks AI. Human writers make locally "surprising" word choices, raising perplexity. GPTZero's stated heuristic: **perplexity above ~85 suggests human authorship; lower suggests AI.** (This is a documented support-doc threshold, not a hard rule — treat as directional.)

2. **Burstiness** — variance of perplexity (and sentence length) *across* the document. AI is uniform ("very consistent"); humans alternate long/complex and short/punchy. **GPTZero explicitly states there is no fixed burstiness threshold** — higher = more human. Practically: maximize variance of sentence length and local predictability.

3. **Trained classifier (the decisive layer in 2026)** — a transformer fine-tuned to recognize AI "statistical fingerprints," not just perplexity. GPTZero now runs a **seven-component proprietary model** (sentence-level + document-level + student-writing-specific + mixed-content detection). **Pangram** is a from-scratch trained classifier (researchers from Stanford/Tesla/Google) that reportedly hits ≥99.8% on benchmark AI text with a claimed ~1-in-10,000 false-positive rate (independently checked by U. Chicago / U. Maryland). **Copyleaks** and **Originality.ai** are similar classifier-first tools; Originality.ai tunes *aggressive* (fewer false negatives, more false positives — SEO market), while academic tools tune conservative.

> Implication: a find-and-replace pass on em-dashes and "delve" does **not** move a trained classifier. The classifier keys on overall token-distribution shape and structural cadence. Only genuinely varying rhythm, vocabulary unpredictability, and concrete specificity move it.

## 2B. Concrete "human" target values (directional, tune empirically)

- **Perplexity:** aim above the AI band — GPTZero's >85 line is the only published anchor.
- **Burstiness:** no numeric target exists; instead enforce sentence-length **stdev ≥ ~6–8 words** and ensure a real mix (some ≤6-word, some ≥30-word sentences).
- **Composite detector score target:** practitioner consensus for "passes as human" is **<15% AI across multiple detectors** (and ideally checked on more than one tool, since they disagree).

## 2C. What lowers an AI-detection score (the humanization levers)

In rough order of effectiveness against a *trained classifier* (not just perplexity):

1. **Burstiness / sentence-length variance** — deliberately alternate a 6-word sentence with a 25-word one; add a parenthetical aside; let one sentence land short. Single biggest lever.
2. **Lexical unpredictability** — replace high-probability filler ("delve," "utilize," "crucial," "leverage") with specific, less-expected word choices.
3. **Concrete, verifiable detail** — names, numbers, dates, places, product specifics. AI defaults to generic abstraction; specificity is the hardest thing for a classifier to mimic.
4. **First-person / lived experience** — "When we ran this on X, the result was Y." Personal voice raises perplexity and breaks the "statistical average of a million voices" tone.
5. **Varied openings** — kill repeated transition starts; vary sentence-initial structure.
6. **Mild informality / imperfection** — contractions, an occasional fragment, a colloquialism. (Genuine typos lower scores but are not acceptable in shipped brand content — prefer informality over errors.)
7. **Break the rigid paragraph template** — don't open every paragraph with a topic sentence and close with a summary.

## 2D. Known false-positive triggers (so we don't over-flag legit human content)

Our enforcement linter must NOT punish these, because they're also markers of *genuine* human writing that detectors wrongly flag:

- **Non-native / ESL English** — the largest documented bias. A Stanford study found **61.3% of non-native TOEFL essays were flagged as AI, and 97.8% by at least one detector**; false-positive rates run up to ~3× higher for non-native writers (simpler vocab, shorter, more formulaic = looks AI). (arXiv:2304.02819)
- **Formulaic-by-genre writing** — legal, technical, academic boilerplate, structured how-tos. Low perplexity for legitimate reasons.
- **Short texts** — too little signal; detectors are unreliable under a few hundred words. Turnitin **suppresses AI scores below 20%** as noise and admits a ~4% sentence-level false-positive rate.
- **Highly edited / polished human writing** — heavy copyediting flattens burstiness and can read as AI.

> Design rule: our linter should flag **structural/rhythm uniformity and LLM phrase patterns**, not "simple vocabulary" or "short sentences" in isolation — otherwise we'd replicate the ESL-bias false positives.

## 2E. 2026 state of the art — are detectors reliable?

Honest read: **no, not reliably, in either direction.**

- **OpenAI killed its own classifier (July 2023)** — only 26% true-positive, 9% false-positive. It never came back.
- Vendor accuracy claims (Pangram ~99.98%, Copyleaks "near-perfect") hold on **clean, un-edited** model output but degrade sharply on **paraphrased / humanized** text. Independent and journalistic reviews (e.g., The Atlantic's Pangram investigation) report real-world false positives on genuine human writing high enough to be an institutional-liability problem.
- Consensus: **no detector — Turnitin, GPTZero, Copyleaks, Originality, Grammarly — reliably catches frontier-LLM output that has passed a humanizer / real editing pass.** The "Pangram problem": adversarial writers reverse-engineer failures faster than vendors retrain.

**Therefore the right internal bar is "reads human to an editor," not "scores <X% on tool Y."** The read-aloud test is the durable check machines still fail. If we optimize burstiness + concreteness + first-person voice + varied openings, the detector score is a lagging byproduct, and — crucially — the content is *actually better*, which is the point.

---

# Enforcement checklist (what humanizes text)

A pre-ship lint/rewrite pass should enforce, in priority order:

- [ ] **Sentence-length variance:** stdev ≥ ~6–8 words; include at least one ≤6-word and one ≥25-word sentence per ~200 words. (Highest leverage.)
- [ ] **No 18–24 word clustering:** < 50% of sentences in that band.
- [ ] **Vary openings:** no canned transition (`Moreover/Furthermore/Additionally`) opening > 20% of sentences; no repeated sentence-initial structure.
- [ ] **Concrete specificity:** require ≥N proper nouns / numbers / dates per section; flag generic abstraction.
- [ ] **First-person / brand voice present** where appropriate.
- [ ] **Kill LLM phrase patterns:** "not just X but Y," tidy tricolons, "from X to Y," "it's important to note," "in conclusion," "one thing is clear."
- [ ] **Kill aidiolect vocab:** delve, harness, bolster, leverage, utilize, tapestry, realm, beacon, landscape, navigate.
- [ ] **List discipline:** `bulleted_lines / total_lines ≤ 0.4`; no bold-label-colon spam (≤30% of items); no emoji bullets; no auto "Key Takeaways."
- [ ] **Paragraph variety:** para word-count stdev/mean ≥ 0.25; break topic→evidence→summary template.
- [ ] **Punctuation hygiene (cosmetic):** em-dash ≤ 2/1k words and ≤1 per paragraph; match channel quote style (straight vs curly); ellipsis ≤1/500 words; sentence-case headings per brand style.
- [ ] **Do NOT penalize:** simple vocabulary or short sentences *in isolation*, ESL-style phrasing, or genre-required formality (false-positive triggers).
- [ ] **Final gate:** read-aloud test — if it sounds like a textbook, it fails regardless of any tool score.

---

## Sources

- [GPTZero — How do I interpret burstiness or perplexity?](https://support.gptzero.me/articles/9585228410-how-do-i-interpret-burstiness-or-perplexity) (perplexity >85 = human; no fixed burstiness threshold)
- [GPTZero — What is perplexity & burstiness for AI detection?](https://gptzero.me/news/perplexity-and-burstiness-what-is-it/)
- [GPTZero — How Do AI Detectors Work?](https://gptzero.me/news/how-ai-detectors-work/) (seven-component model)
- [GPTZero vs. Pangram accuracy comparison](https://gptzero.me/news/gptzero-vs-pangram/)
- [Pangram Labs — Which AI Detector Is Most Accurate? 30 Tools Tested (2026)](https://www.pangram.com/blog/best-ai-detector-tools)
- [Pangram — How accurate is Pangram on ESL?](https://www.pangram.com/blog/how-accurate-is-pangram-ai-detection-on-esl)
- [The Atlantic Pangram-reliability investigation (summary)](https://mezha.ua/en/news/chi-varto-doviryati-shi-detektoram-311834/)
- [Pangram AI detector still flags real human writing](https://aiweekly.co/alerts/pangram-ai-detector-still-flags-real-human-writing)
- [Freeburg, "The Last Fingerprint: How Markdown Training Shapes LLM Prose" (arXiv:2603.27006, 2026)](https://arxiv.org/abs/2603.27006)
- [Duey AI — The Em-Dash Myth: What Actually Gives Away AI Writing](https://www.duey.ai/post/em-dash-ai-writing) (cadence uniformity; em-dash suppressed in GPT-5.1)
- [The Augmented Educator — Ten Telltale Signs of AI-Generated Text](https://www.theaugmentededucator.com/p/the-ten-telltale-signs-of-ai-generated)
- [The Field Guide to AI Slop — Charlie Guo](https://www.ignorance.ai/p/the-field-guide-to-ai-slop)
- [Liang et al., "GPT detectors are biased against non-native English writers" (arXiv:2304.02819)](https://arxiv.org/pdf/2304.02819) (61.3% / 97.8% TOEFL false-positive figures)
- [BAID: A Benchmark for Bias Assessment of AI Detectors (arXiv:2512.11505)](https://arxiv.org/pdf/2512.11505)
- [Stanford ESL false-positive study summary](https://hastewire.com/blog/study-reveals-ai-detectors-false-positives-on-non-native-writers)
- [OpenAI discontinued its AI text classifier (26% TPR / 9% FPR)](https://gowinston.ai/openai-text-classifier-ai-detector-discontinued/)
- [How AI detectors work (and why they're failing in 2026)](https://tooldirectory.ai/blog/how-ai-detectors-work-and-why-theyre-failing-in-2026)
- [Are AI Detectors Accurate in 2026? — Walter Writes](https://walterwrites.ai/are-ai-detectors-accurate/)
- [How to lower AI detection score — burstiness/perplexity levers (HumanText.pro)](https://humantext.pro/blog/perplexity-and-burstiness-in-ai-detection)
- [Reduce AI detection score: practical guide for researchers (ProofreaderPro)](https://proofreaderpro.ai/blog/reduce-ai-detection-score) (<15% multi-detector target)
- [Turnitin false-positive / <20% suppression discussion (USD Legal Research Center)](https://lawlibguides.sandiego.edu/c.php?g=1443311&p=10721367)
