# Stream 1 — First-Party Citation Mining (production)

**Source:** production `/data/lumidian.db` (131 MB), queried read-only via Railway SSH on 2026-06-03. Raw data never left the server; only aggregates were returned.
**Tool:** `backend/scripts/layer_a_citation_analysis.py` (`classify_domain` + `analyze`).

---

## Headline finding

Across every citation we can actually resolve in production — **ChatGPT (1,669) and Perplexity (480)** — **exactly zero come from Reddit, Quora, Medium, LinkedIn, or X.** Our entire content engine writes for five platforms that have a **0% observed citation rate** in our own production data.

| Model | Citations | reddit | quora | medium | linkedin | x | target-5 rate |
|-------|-----------|--------|-------|--------|----------|---|---------------|
| ChatGPT | 1,669 | 0 | 0 | 0 | 0 | 0 | **0.0%** |
| Perplexity | 480 | 0 | 0 | 0 | 0 | 0 | **0.0%** |
| Gemini | 470 | — | — | — | — | — | *blind (see caveats)* |
| Claude | 0 rows | — | — | — | — | — | *blind (see caveats)* |

What the models **do** cite instead (after discounting noise):
- **ChatGPT** (913 real, after removing 756 google.com/maps redirect links): vertical/industry authority sites, **Wikipedia (94)**, PR newswire, a little news.
- **Perplexity**: vertical authority sites, **sec.gov (35)**, **YouTube (27)**, **Wikipedia (3)**, owned domains.

So where citations are visible, they go to **owned/authority domains, Wikipedia, regulatory/primary sources, YouTube, and PR** — not social/UGC platforms.

---

## Caveats (read before generalizing)

These are why "0%" is **strong evidence of presence-of-authority-sites** but only **suggestive evidence of absence** for the 5 platforms.

1. **Single-brand skew (biggest caveat).** Of 2,619 total citations, **2,611 belong to one brand (brand_id 2 — Manhattan Street Capital, a B2B capital-markets / Reg-A+ vertical).** This is effectively a one-brand, one-vertical sample. The absence of the 5 platforms is real *for this vertical*; we cannot yet claim it generalizes to, say, consumer SaaS or developer tools. Stream 2 (external research) must test whether the pattern holds beyond finance.

2. **Gemini is 100% blind.** All 470 Gemini "citations" are opaque `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URLs (stored with domain `google.com`). We cannot see what Gemini actually cited without resolving redirects. **Instrumentation gap → Layer B candidate fix.**

3. **Claude is 100% blind.** Claude ran **2,392 queries (2,329 non-empty responses)** but produced **0 citation rows.** Claude's `web_search_20250305` returns *structured* citation objects; our extractor appears to only scrape inline URLs from `response_text`, which Claude largely doesn't emit (it names entities like "GRAIL", "Guardant Health" without inline links). **Instrumentation gap → Layer B candidate fix.** This matters: Claude is Pro-tier and we're flying blind on what it cites.

4. **ChatGPT google.com noise.** 756 of ChatGPT's 1,669 "citations" are `google.com/maps/search/...?utm_source=openai` navigational links the model generated, not content citations. Correctly bucketed as `search_redirect` and discounted. Real ChatGPT content citations ≈ 913.

---

## What this means for Layer A

- The hypothesis to carry into synthesis: **we may be optimizing content for channels the models structurally don't cite, at least in B2B/finance verticals.** Authority-domain, Wikipedia, and primary-source content may matter far more.
- **Two instrumentation bugs** surfaced (Claude citations unextracted; Gemini redirects unresolved). These are Layer B fixes, logged here and in `contradictions.md`. Until fixed, two of four models are blind spots — so the external research (Stream 2) carries extra weight for Claude and Gemini specifically.
- Do **not** conclude the 5 platforms are worthless from this alone — the single-vertical skew and two blind models forbid it. Reconcile against Stream 2 before the per-platform verdicts.

---

## Reproduce

```bash
cd backend
B64=$(base64 < scripts/layer_a_citation_analysis.py | tr -d '\n')
railway ssh "echo $B64 | base64 -d > /tmp/la.py && python3 /tmp/la.py /data/lumidian.db"
```
