# Research backing the Lumidian methodology

*Compiled 2026-07-04 via deep-research workflow: 23 sources fetched, 110 claims extracted, top 25 adversarially verified (3 independent verifiers per claim; 22 confirmed, 3 refuted). Two gaps (GEO paper, sentiment) verified separately. These citations are live on `/methodology`.*

## The eight references on /methodology

| # | Source | Status | What it proves for us |
|---|--------|--------|----------------------|
| 1 | Żatuchin, *Who Owns the AI Recommendation?* — [arXiv:2606.23057](https://arxiv.org/abs/2606.23057), 2026 | Preprint (vendor-affiliated: Rankfor.AI) | Only 41.6% cross-model agreement on top-recommended brand → single-model tracking is insufficient; used case-insensitive alias/regex mention detection at 250 queries × 3 models × 5 repetitions |
| 2 | Song et al., *The Good, The Bad, and The Greedy* — [arXiv:2407.10457](https://arxiv.org/abs/2407.10457), NAACL 2025 | Peer-reviewed | Single-output LLM evaluation is unreliable; paper samples 16–128 completions per prompt and reports mean-over-runs — our exact measurement design |
| 3 | Atil et al., *Non-Determinism of "Deterministic" LLM Settings* — [arXiv:2408.04667](https://arxiv.org/abs/2408.04667), Eval4NLP @ ACL 2025 | Peer-reviewed | Even at temperature 0 + fixed seeds: up to 15% run-to-run accuracy variance, 70% best-to-worst gap, no model repeatable across 5 LLMs × 8 tasks × 10 runs |
| 4 | Yuan et al., *Numerical Sources of Nondeterminism in LLM Inference* — [arXiv:2506.09501](https://arxiv.org/abs/2506.09501), NeurIPS 2025 oral | Peer-reviewed | Root cause is floating-point non-associativity + GPU batching; callers of commercial APIs cannot switch it off (batch-invariant kernels are server-side only) |
| 5 | Angermeir et al., *Reproducibility of LLM-Centric Empirical Studies* — [arXiv:2510.25506](https://arxiv.org/abs/2510.25506), ICSE 2026 | Peer-reviewed | Replication of 85 LLM studies ran up to 30 repetitions per study because of non-determinism; observed up to 30% metric differences between repetitions |
| 6 | Fishkin (SparkToro) & O'Donnell (Gumshoe.ai) — [AIs Are Highly Inconsistent When Recommending Brands](https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/), Jan 2026 | Industry study (raw data published; Gumshoe COI disclosed) | 2,961 runs × 12 prompts: exact brand lists repeat <1 in 100 pairs, but per-brand mention rates are stable over many runs (e.g. 97% over 71 runs). Verdict: "visibility % across dozens to hundreds of prompts run multiple times is a reasonable metric"; AI ranking-position metrics are "full of baloney" |
| 7 | Schulte, Bleeker & Kaufmann, *Don't Measure Once: Measuring Visibility in AI Search* — [arXiv:2604.07585](https://arxiv.org/abs/2604.07585), 2026 | Preprint (vendor-affiliated: Aurora Intelligence) | Repeated identical queries share only 32–43% of cited sources (Jaccard); day-to-day brand overlap 45–59%; visibility must be measured as a distribution over repeated queries |
| 8 | Aggarwal et al., *GEO: Generative Engine Optimization* — [arXiv:2311.09735](https://arxiv.org/abs/2311.09735), KDD 2024 (Princeton/IIT Delhi) | Peer-reviewed | Targeted content changes (citations, quotations, statistics) boost source visibility in generative engine responses by up to 40% on a large multi-domain benchmark. Caveat: efficacy varies across domains. Foundational citation for the content product |

## Additional validated sources (not on the page yet)

**Sentiment classification** (verified separately, could support the sentiment feature):
- *Sentiment Analysis in the Age of Generative AI* — [Customer Needs and Solutions (Springer), 2024](https://link.springer.com/article/10.1007/s40547-024-00143-4). Peer-reviewed; GPT-class models match fine-tuned BERT zero-shot; correlate with human annotators at r=0.59–0.77 vs r=0.20–0.30 for dictionary methods.
- [JMIR Formative Research 2025](https://formative.jmir.org/2025/1/e64723/PDF) — GPT-4 zero-shot sentiment F1=0.85 across 20 datasets, beating GPT-3.5, Llama 2, Claude 3 Sonnet.

**Market shift** (first-party sources with verbatim quotes; candidates for the landing page problem statement):
- [Gartner, Feb 2024](https://www.gartner.com/en/newsroom/press-releases/2024-02-19-gartner-predicts-search-engine-volume-will-drop-25-percent-by-2026-due-to-ai-chatbots-and-other-virtual-agents) — traditional search volume to drop 25% by 2026.
- [Pew, Jul 2025](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/) — with an AI summary, users click a result link in 8% of visits vs 15% without.
- [Pew, Jun 2025](https://www.pewresearch.org/short-reads/2025/06/25/34-of-us-adults-have-used-chatgpt-about-double-the-share-in-2023/) — 34% of US adults have used ChatGPT (2× 2023).
- [SimilarWeb 2025](https://ir.similarweb.com/news-events/press-releases/detail/138/ai-discovery-surges-similarwebs-2025-generative-ai-report-says) — 1.1B AI-platform referral visits in June 2025, +357% YoY.
- Verifier-surfaced corroboration (re-verify before citing publicly): Adobe Analytics AI-referral-to-retail +693% YoY, converting 42% better; Gartner May 2026 consumer AI-shopping survey.

## ⚠️ Refuted claims — do NOT cite these anywhere

These sounded great and failed adversarial verification (from [arXiv:2606.20065](https://arxiv.org/abs/2606.20065), Ranqo-affiliated):

1. ~~"Global brands appear in 73% of relevant AI answers, mid-market 44%, niche 11%"~~ — refuted 1-2.
2. ~~"78% of AI citations go to corporate websites; listicles are the most-cited format at 21%"~~ — refuted 1-2.
3. ~~"None of five executable LLM studies could be reproduced" as a general non-reproducibility headline~~ — refuted 0-3 (cite only the ICSE paper's study-design conclusion, ref 5 above).

## Phrasing rules carried into the page copy

- **No source validates N=3 runs specifically** (studies used 5–128 samples). Say "consistent with published practice of measuring over repeated runs", never "research shows 3 runs is enough".
- Label preprints and industry studies as such — only refs 2, 3, 4, 5, 8 are peer-reviewed.
- The Żatuchin paper's own "EY Anomaly" documents substring-matching false positives for short brand names — a limitation that applies to our substring+fuzzy detection too; candid limitations note is an option.
- Domain-scope qualifiers: 10–34% variance figure is from creative tasks; 15%/70% figures are temperature-0 benchmarks; the <1-in-100 figure is about exact brand-list matches (per-brand mention rates were stable — that's the part that validates averaging).

## Open questions for a future pass

- Is N=3 statistically sufficient, and what confidence interval does it imply? [arXiv:2603.08924](https://arxiv.org/abs/2603.08924) (statistical framework for generative search measurement) may answer this directly.
- Several 2026 preprints may gain peer-reviewed versions — upgrade labels when they do.
