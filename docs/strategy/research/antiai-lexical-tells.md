# Anti-AI-Writing Lexical Tells — Master Lexicon (2026)

Purpose: hard-codeable word/phrase lists for a regex-based "does this read like an LLM wrote it?"
checker. Each term is tagged with a **signal weight** (how strongly it indicates AI) and a
**false-positive (FP) risk** flag (how common it is in legitimate human writing). Weight the checker
accordingly: high-signal + low-FP terms should fire hard; high-FP terms should only contribute when
they co-occur with other tells.

## How to read the weights

- **Signal tiers** (S1 strongest → S3 weakest):
  - **S1** — Smoking gun. Corpus-measured frequency spike of ~10x–6700x in AI/post-ChatGPT text.
    A single occurrence is meaningful. (e.g. `delve`, `underscore`, `showcasing`, `tapestry`.)
  - **S2** — Strong tell. Heavily AI-associated in vendor + corpus data, but appears in some
    human professional/marketing writing. Needs context but weights high.
  - **S3** — Weak/contextual tell. Common in human writing too; only meaningful in clusters or
    high density. **Do not fire on these alone.**
- **FP risk:** `FP-HIGH` = also frequent in legitimate human prose (down-weight),
  `FP-MED` = occasional in human prose, `FP-LOW` = rarely human outside of AI-influenced text.

## Sources (every cluster is cited inline by [n])

- [1] Kobak et al., "Delving into LLM-assisted writing in biomedical publications through excess
  vocabulary," *Science Advances* 2025 (15M+ PubMed abstracts, 2010–2024). Reports excess-frequency
  ratio *r*. https://www.science.org/doi/10.1126/sciadv.adt3813 ·
  preprint https://arxiv.org/html/2406.07016v1 · PMC https://pmc.ncbi.nlm.nih.gov/articles/PMC12219543/
- [2] Liang/Juzek-style focal-word study, "Why Does ChatGPT 'Delve' So Much?" arXiv:2412.11385 —
  full per-word occurrences-per-million + % increase 2020→2024.
  https://arxiv.org/html/2412.11385v1
- [3] FSU News summary of the excess-vocabulary work (delve/underscore/meticulous/boast/pivotal/
  intricate/showcasing/realm). https://news.fsu.edu/news/science-technology/2025/02/17/
- [4] GPTZero "Top AI words & phrases" + AI-vocabulary page (frequency multipliers, AI vs human,
  updated 2026). https://gptzero.me/ai-vocabulary · https://gptzero.me/news/most-common-ai-vocabulary/
- [5] Originality.ai, "Most obvious ChatGPT sayings" / "Can humans detect ChatGPT" (10M+ word dataset,
  usage counts). https://originality.ai/blog/obvious-chatgpt-sayings ·
  https://originality.ai/blog/can-humans-detect-chatgpt
- [6] Winston AI, "Most common ChatGPT words." https://gowinston.ai/most-common-chatgpt-words/
- [7] Walter Writes AI, "Most common ChatGPT words to avoid (2026)."
  https://walterwrites.ai/most-common-chatgpt-words-to-avoid/
- [8] Humaneer, "100+ AI words to avoid." https://humaneer.me/blog/ai-words-to-avoid
- [9] HumanizeThisAI, "50 words AI overuses." https://humanizethisai.com/blog/50-words-ai-overuses

Corpus-measured anchors (from [2], occurrences/million 2020→2024, % increase):
delves +6697%, delved +2240%, delving +1817%, showcasing +1396%, delve +1375%, boasts +918%,
underscores +904%, comprehending +899%, intricacies +773%, surpassing +667%, intricate +611%,
underscoring +537%, garnered +437%, showcases +422%, emphasizing +397%, underscore +391%,
realm +381%, surpasses +368%, groundbreaking +330%, advancements +278%, aligns +267%.
From [1]: delves r=28.0, underscores r=13.8, showcasing r=10.7. From [4]: "today's fast-paced/digital
age" ~107x, "notable works include" ~120x, "play a significant role in shaping" ~182x, "objective
study aimed" ~269x more likely AI than human.

---

## CATEGORY 1 — Single-word verb tells
# Format: term | tier | fp-risk | note
delve | S1 | FP-LOW | [1][2][3] poster-child tell; near-zero pre-ChatGPT everyday use
delves | S1 | FP-LOW | [1][2] r=28.0, +6697%
delved | S1 | FP-LOW | [2] +2240%
delving | S1 | FP-LOW | [2] +1817%
underscore | S1 | FP-MED | [1][2][3] +391%; common in formal human prose too
underscores | S1 | FP-MED | [1][2] r=13.8, +904%
underscoring | S1 | FP-MED | [2] +537%
showcase | S2 | FP-MED | [2][4] showcases +422%
showcases | S1 | FP-LOW | [2] +422%
showcasing | S1 | FP-LOW | [1][2] r=10.7, +1396%
boast | S2 | FP-MED | [3] FSU top-five excess word
boasts | S1 | FP-MED | [2] +918%
garner | S2 | FP-MED | [2] garnered +437%
garnered | S1 | FP-MED | [2] +437%
surpass | S2 | FP-MED | [2] surpasses/surpassing high excess
surpassing | S1 | FP-MED | [2] +667%
surpasses | S1 | FP-MED | [2] +368%
emphasize | S3 | FP-HIGH | [2] emphasizing +397% but very common in human writing
emphasizing | S2 | FP-MED | [2] +397%
align | S3 | FP-HIGH | [2] aligns +267%; extremely common human word
aligns | S2 | FP-MED | [2][4] +267%, ~16x (GPTZero)
leverage | S1 | FP-MED | [4][5][8][9] flagship corporate-AI verb, 10–50x AI
harness | S2 | FP-MED | [8][9] "harness the power of"
foster | S2 | FP-MED | [8][9] frequent AI verb
utilize | S2 | FP-MED | [6][8][9] AI prefers over "use"
facilitate | S2 | FP-MED | [6][8][9]
streamline | S2 | FP-MED | [6][7][8]
optimize | S3 | FP-HIGH | [8][9] also normal in tech writing
enhance | S2 | FP-HIGH | [1][6] enhancing in [1] marker set; very common
enhancing | S2 | FP-MED | [1] in core LLM marker set
navigate | S2 | FP-MED | [8][9] "navigate the complexities/landscape"
embark | S1 | FP-LOW | [5] 139 uses in dataset; "embark on a journey"
elevate | S2 | FP-LOW | [8] marketing-AI verb
unlock | S2 | FP-MED | [8] "unlock the potential"
empower | S2 | FP-MED | [8] AI/corporate verb
spearhead | S2 | FP-LOW | [8]
cultivate | S2 | FP-MED | [8]
bolster | S2 | FP-MED | [8]
mitigate | S3 | FP-HIGH | [8] common in risk/legal writing
elucidate | S2 | FP-LOW | [8]
ascertain | S2 | FP-LOW | [8]
commence | S2 | FP-MED | [8] AI prefers over "start/begin"
endeavor | S2 | FP-LOW | [8][9]
curate | S2 | FP-MED | [8]
unpack | S2 | FP-MED | [8] "let's unpack this"
resonate | S2 | FP-MED | [8] "resonate with"
exhibited | S3 | FP-HIGH | [1] in marker set; common human word
comprehending | S1 | FP-LOW | [2] +899%
remarked | S2 | FP-LOW | [4] ~18x AI
impacting | S2 | FP-MED | [4] ~11x AI

## CATEGORY 2 — Single-word adjective/adverb tells
intricate | S1 | FP-MED | [1][2][3] +611%
intricacies | S1 | FP-LOW | [2] +773%
meticulous | S1 | FP-LOW | [3] FSU top excess; "meticulous attention to detail"
meticulously | S1 | FP-LOW | [1][3]
pivotal | S1 | FP-MED | [1][2][3][9] strong AI adjective
crucial | S2 | FP-HIGH | [1][2] in marker set, δ high, but very common human word
robust | S2 | FP-HIGH | [6][7][9] empty AI adjective; also legit technical term
seamless | S2 | FP-MED | [6][7][9] marketing-AI staple
comprehensive | S2 | FP-HIGH | [1][6][9] in [1] marker set; also normal
nuanced | S2 | FP-MED | [7][8] "a nuanced understanding"
multifaceted | S2 | FP-LOW | [8] classic AI adjective
holistic | S2 | FP-MED | [8] "a holistic approach"
transformative | S2 | FP-MED | [8][9] hype-adjacent
groundbreaking | S1 | FP-MED | [2][9] +330%
innovative | S3 | FP-HIGH | [9] very common human marketing word
invaluable | S2 | FP-MED | [9]
significant | S3 | FP-HIGH | [9] extremely common; only meaningful in clusters
notable | S2 | FP-MED | [1][4] in marker set
paramount | S2 | FP-LOW | [8][9] "is of paramount importance"
commendable | S2 | FP-LOW | [3][8]
indelible | S2 | FP-LOW | common AI adjective ("left an indelible mark")
vibrant | S2 | FP-MED | "vibrant tapestry/community" AI cliché
bustling | S2 | FP-LOW | "bustling city/marketplace" AI scene-setter
unprecedented | S2 | FP-MED | [8]
quintessential | S2 | FP-LOW | [8]
overarching | S2 | FP-MED | [8]
granular | S3 | FP-HIGH | [8] common in data/tech writing
iterative | S3 | FP-HIGH | [8] common in eng/agile writing
actionable | S2 | FP-MED | [8] "actionable insights"
scalable | S3 | FP-HIGH | [8] normal tech term
cutting-edge | S2 | FP-MED | [7][8] hype (see Cat 6)
primarily | S3 | FP-HIGH | [3] FSU excess word but very common
particularly | S3 | FP-HIGH | [1] in marker set; very common
indispensable | S2 | FP-LOW | [1] indispensability noted
tragically | S2 | FP-LOW | [4] ~11x AI

## CATEGORY 3 — Single-word noun/metaphor tells
tapestry | S1 | FP-LOW | [4][5][8][9] "rich tapestry"; iconic AI noun
landscape | S2 | FP-MED | [5][8][9] "evolving landscape of"; metaphorical use is the tell
realm | S1 | FP-MED | [1][2][3] +381%; "in the realm of"
testament | S1 | FP-LOW | [8][9] "a testament to"
journey | S2 | FP-MED | [5][9] "embark on a journey"; FP-high in literal travel context
beacon | S2 | FP-LOW | [8] "a beacon of"
cornerstone | S2 | FP-MED | [8] "the cornerstone of"
paradigm | S2 | FP-LOW | [8][9] "paradigm shift"
synergy | S2 | FP-LOW | [8][9] corporate-AI buzzword
myriad | S1 | FP-LOW | [8][9] "a myriad of"
plethora | S1 | FP-LOW | [8] "a plethora of"
trove | S2 | FP-LOW | [5] "treasure trove"
advancements | S2 | FP-MED | [2] +278%
insights | S2 | FP-HIGH | [1] in marker set; "actionable insights" but common word
nuances | S2 | FP-MED | [5] 109 uses in dataset
trajectory | S2 | FP-MED | [8]
spectrum | S3 | FP-HIGH | [8] common human word
framework | S3 | FP-HIGH | [8] normal tech/business term
methodology | S3 | FP-HIGH | [8][9] normal academic term
ecosystem | S2 | FP-MED | [8] "the broader ecosystem"
stakeholders | S2 | FP-MED | [8][9] corporate-AI noun
underpinning | S2 | FP-LOW | [8]
underpinnings | S2 | FP-LOW | [5][8]
confluence | S2 | FP-LOW | [8] "a confluence of"
juxtaposition | S2 | FP-LOW | [8]
proliferation | S2 | FP-MED | [8]
discourse | S2 | FP-MED | [8]
efficacy | S3 | FP-HIGH | [8] normal medical/research term
enigma | S2 | FP-LOW | [8]
interplay | S2 | FP-LOW | [8] "a dynamic interplay"

## CATEGORY 4 — Transition / filler tells (phrases)
moreover | S2 | FP-MED | [6][9] AI over-uses sentence-initial
furthermore | S2 | FP-MED | [6][9]
additionally | S2 | FP-MED | [1][5][6] in [1] marker set
notably | S2 | FP-MED | [1][9] marker set
importantly | S2 | FP-MED | [1] "more importantly"
consequently | S2 | FP-MED | [9]
nevertheless | S3 | FP-HIGH | [9] common human transition
ultimately | S3 | FP-HIGH | [9] common
essentially | S3 | FP-HIGH | [9] common
in essence | S2 | FP-MED | AI summarizer phrase
that being said | S2 | FP-MED | [8] "with that being said"
that said | S2 | FP-MED | [8]
it's worth noting | S1 | FP-LOW | [5][6] classic AI hedge
it is worth noting | S1 | FP-LOW | [5][6]
it's important to note | S1 | FP-LOW | [5][6][8][9] strongest hedge tell
it is important to note | S1 | FP-LOW | [5][6][8][9]
it's worth mentioning | S2 | FP-LOW | [6][9]
it is worth mentioning | S2 | FP-LOW | [6][9]
needless to say | S2 | FP-MED | [8]
it goes without saying | S2 | FP-MED | [8]
generally speaking | S3 | FP-HIGH | [6] common human phrase
in many cases | S3 | FP-HIGH | [6] common
to some extent | S3 | FP-HIGH | [6] common
on the other hand | S3 | FP-HIGH | [8][9] very common transition
in contrast | S3 | FP-HIGH | [9] common
as a result | S3 | FP-HIGH | [6] common
this means that | S3 | FP-HIGH | [6] common AI connective
this highlights the importance of | S2 | FP-LOW | [6]
this serves as a testament to | S1 | FP-LOW | [8][9]
plays a crucial role | S1 | FP-LOW | [5] 91 uses in dataset
plays a vital role in | S1 | FP-LOW | [9]
plays a significant role | S1 | FP-LOW | [4] "play a significant role in shaping" ~182x
plays a key role | S2 | FP-MED | derivative of above
one key benefit is | S2 | FP-MED | [6]
another important factor is | S2 | FP-MED | [6]

## CATEGORY 5 — Opener / closer tells (phrases)
in today's fast-paced world | S1 | FP-LOW | [3][5][9] iconic opener
in today's digital age | S1 | FP-LOW | [4][9] ~107x AI
in today's world | S2 | FP-LOW | derivative
in an ever-evolving landscape | S1 | FP-LOW | [9]
in the ever-evolving landscape of | S1 | FP-LOW | [9]
in the ever-changing world of | S2 | FP-LOW | derivative
in the realm of | S1 | FP-LOW | [8][9]
in the world of | S2 | FP-MED | softer derivative
when it comes to | S2 | FP-HIGH | [8][9] very common; only with density
whether you're | S2 | FP-MED | "whether you're a beginner or a pro" AI opener
in conclusion | S1 | FP-MED | [5][6][8] strongest closer; rare in good human prose
in summary | S2 | FP-MED | [6] closer
to summarize | S2 | FP-MED | closer
in essence | S2 | FP-MED | dual transition/closer
at the end of the day | S2 | FP-MED | [8] closer cliché
the bottom line | S2 | FP-MED | closer cliché
overall | S3 | FP-HIGH | [6] common closer word
ultimately | S3 | FP-HIGH | closer; common
as we navigate | S2 | FP-LOW | [8] opener
as we delve into | S1 | FP-LOW | [8]
let's explore | S2 | FP-MED | [8] opener
let's dive in | S2 | FP-MED | opener
let's unpack | S2 | FP-LOW | [8]
one cannot overstate | S2 | FP-LOW | [8]
it is imperative that | S2 | FP-LOW | [8]
it is crucial to | S2 | FP-MED | [8]
it is essential to | S2 | FP-MED | [8]
in light of | S3 | FP-HIGH | [8] common human phrase
objective study aimed | S1 | FP-LOW | [4][9] ~269x AI (academic abstracts)
aims to explore | S1 | FP-LOW | [4] ~50x AI
notable works include | S1 | FP-LOW | [4] ~120x AI
research needed to understand | S2 | FP-MED | [4][9]
despite facing | S2 | FP-MED | [4][9] "despite facing challenges"
expressed excitement | S2 | FP-LOW | [4]

## CATEGORY 6 — Hype / marketing tells (phrases)
game-changer | S2 | FP-MED | [8] also human marketing
game changer | S2 | FP-MED | spacing variant
cutting-edge | S2 | FP-MED | [7][8]
cutting edge | S2 | FP-MED | spacing variant
state-of-the-art | S2 | FP-MED | [8] also legit in research
state of the art | S2 | FP-MED | spacing variant
revolutionary | S3 | FP-HIGH | common human hype word
transformative | S2 | FP-MED | [8][9]
unparalleled | S2 | FP-LOW | [8] "unparalleled quality/expertise"
world-class | S2 | FP-MED | [8] marketing cliché
next-level | S2 | FP-MED | marketing cliché
next level | S2 | FP-MED | spacing variant
best-in-class | S2 | FP-MED | marketing cliché
top-notch | S3 | FP-HIGH | common human phrase
unlock the power of | S2 | FP-LOW | [8]
harness the power of | S2 | FP-LOW | [8]
take it to the next level | S2 | FP-MED | marketing cliché
elevate your | S2 | FP-MED | [8] "elevate your brand/game"
supercharge | S2 | FP-MED | marketing verb
turbocharge | S2 | FP-LOW | marketing verb

## CATEGORY 7 — Hard giveaways (assistant-voice leaks — fire at S1 always)
as a large language model | S1 | FP-LOW | [5] direct model self-reference
as an ai language model | S1 | FP-LOW | [5]
as an ai | S1 | FP-LOW | [5]
my training data | S1 | FP-LOW | [5]
i don't have personal | S1 | FP-LOW | assistant disclaimer
i cannot browse | S1 | FP-LOW | assistant disclaimer
as of my last knowledge update | S1 | FP-LOW | assistant disclaimer
as of my knowledge cutoff | S1 | FP-LOW | assistant disclaimer
i hope this helps | S2 | FP-MED | assistant sign-off
certainly! | S2 | FP-MED | [5] paragraph-initial
absolutely! | S2 | FP-MED | [5] paragraph-initial
great question! | S2 | FP-LOW | [8] chat-tone leak
i'd be happy to help | S2 | FP-LOW | [8]
that's a fantastic point | S2 | FP-LOW | [8]
here's the thing: | S2 | FP-MED | [8]
the short answer is | S2 | FP-MED | [8]
let me break this down | S2 | FP-MED | [8]

---

## Implementation notes for the checker

1. **Match whole words / phrase boundaries**, case-insensitive. For single words include inflections
   already enumerated (delve/delves/delved/delving etc.); for others add `\w*` suffix matching with
   care (e.g. `underscor(e|es|ing)`).
2. **Score by tier, not by count of distinct hits.** Suggested weights: S1=3, S2=2, S3=1. Multiply by
   `(1 - fp_discount)` where fp_discount = 0.5 for FP-HIGH, 0.2 for FP-MED, 0 for FP-LOW.
3. **Density matters more than presence.** Normalize total score per 1000 words. A single S3/FP-HIGH
   hit (e.g. `significant`, `overall`) should never flag text on its own — they only matter in
   clusters. The corpus studies are explicit that it is the *co-occurrence* of many style words, not
   any one word, that distinguishes LLM text [1][2].
4. **Cat 7 (assistant-voice leaks) should hard-fail regardless of density** — these are near-certain.
5. **Watch the FP-HIGH set when editing legit technical/academic content**: robust, comprehensive,
   crucial, significant, framework, methodology, scalable, iterative, granular, efficacy, optimize,
   mitigate, emphasize, align, particularly, primarily. These are normal in human engineering and
   research writing — only let them contribute inside a cluster.
6. **Em dashes and structural tells are out of scope here** (this is a lexical lexicon), but note that
   sources [4][5][6] cite em-dash density, parallel "It's not just X, it's Y" constructions, and
   rule-of-three lists as orthogonal structural signals worth a separate checker.
