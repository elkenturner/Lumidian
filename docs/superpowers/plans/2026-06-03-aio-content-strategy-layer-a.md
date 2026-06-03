# Layer A — AIO Content Strategy (research-grounded) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `docs/strategy/aio-content-strategy-2026.md` — an evidence-grounded, canonical content strategy (prose "why" + machine-ready per-platform ruleset) by triangulating three research streams.

**Architecture:** Research-then-synthesize. Three independent evidence streams — (1) first-party citation mining of production data, (2) deep external research per-model & per-platform, (3) first-principles model mechanics — are gathered into intermediate artifacts under `docs/strategy/research/`, then synthesized into the final two-part doc. The only code is one throwaway, read-only analysis script for Stream 1; no app code changes.

**Tech Stack:** Python (stdlib `sqlite3` analysis script), Railway CLI (production DB access), `deep-research` skill (external passes), Markdown deliverables.

**Spec:** `docs/superpowers/specs/2026-06-03-aio-content-strategy-layer-a-design.md`

**Working dir / branch:** `feat/aio-content-strategy-layer-a` (already created).

**Intermediate artifacts produced along the way** (all under `docs/strategy/research/`):
- `stream1-citation-mining.md` — first-party findings
- `stream2-model-<name>.md` ×4, `stream2-platform-<name>.md` ×5, `stream2-channel-ranking.md`
- `stream3-model-mechanics.md`
- `contradictions.md` — current-rules audit
Final synthesis merges these into `docs/strategy/aio-content-strategy-2026.md`.

---

## Notes for the executor

- **This is a research/writing plan, not a TDD code plan.** Most "tasks" gather or write evidence. The one script (Task 2) gets a lightweight correctness check, not a full TDD cycle.
- **Every external claim** that ends up in the final doc must carry a citation or be tagged `[unverified inference]`. The `deep-research` skill enforces this; preserve it when synthesizing.
- **Do not touch app code.** If research reveals an engine bug/fix, write it into `contradictions.md`, do not implement it.
- **Commit after each task** so the research trail is reviewable.

---

## Task 1: Acquire production data for Stream 1

**Files:**
- Create: `docs/strategy/research/.gitignore` (ignore the raw DB copy — don't commit production data)
- Produce (uncommitted): `backend/_layerA_prod.db` (local copy of production DB)

- [ ] **Step 1: Confirm Railway access**

Run: `railway whoami`
Expected: prints the logged-in account. If it errors, run `railway login` (interactive — ask Ken to run `! railway login` in-session) before continuing.

- [ ] **Step 2: Locate and copy the production SQLite DB**

Production DB lives on the persistent volume at `/data/lumidian.db` (per `spotitearly_pilot_export/pilot_data_summary.md`). Copy it locally:

Run: `railway run bash -c 'cat /data/lumidian.db' > backend/_layerA_prod.db`
(If `railway run` cannot stream the volume, fall back to `railway ssh` then `base64 /data/lumidian.db`, or use the existing nightly backup in `backups/`.)

Expected: `backend/_layerA_prod.db` is a non-trivial file (`ls -la` shows MB-scale, not bytes).

- [ ] **Step 3: Sanity-check the copy**

Run:
```bash
python3 -c "import sqlite3; c=sqlite3.connect('backend/_layerA_prod.db'); print('citations:', c.execute('select count(*) from citation_sources').fetchone()); print('responses:', c.execute('select count(*) from query_results').fetchone()); print('models:', c.execute('select model,count(*) from citation_sources group by model').fetchall())"
```
Expected: citation count ≥ the 1,277 seen locally; per-model breakdown printed. If Claude shows 0 here too, that's a real finding (record it).

- [ ] **Step 4: Prevent committing raw production data**

Create `docs/strategy/research/.gitignore`:
```
# never commit raw production data
*.db
*.csv
```
Also confirm `backend/_layerA_prod.db` is ignored (it's under `backend/`, not the research dir — add `_layerA_prod.db` to repo root `.gitignore` too).

- [ ] **Step 5: Commit (gitignores only)**

```bash
git add docs/strategy/research/.gitignore .gitignore
git commit -m "chore: gitignore Layer A raw data; prep Stream 1 dirs"
```

---

## Task 2: Build the Stream 1 citation-mining script

**Files:**
- Create: `backend/scripts/layer_a_citation_analysis.py` (throwaway analysis, read-only)
- Test: `backend/scripts/test_layer_a_citation_analysis.py`

The script answers: per model, what domains/platforms get cited, at what rate; what the LinkedIn/Medium/Reddit/Quora/X hit-rate is; resolves the google.com-redirect and Claude-gap caveats.

- [ ] **Step 1: Write the failing test for the domain→platform classifier**

The core reusable unit is `classify_domain(domain) -> str` (returns one of: `reddit`, `quora`, `medium`, `linkedin`, `x`, `youtube`, `wikipedia`, `news`, `owned`, `search_redirect`, `other`).

Create `backend/scripts/test_layer_a_citation_analysis.py`:
```python
from scripts.layer_a_citation_analysis import classify_domain

def test_classifies_core_platforms():
    assert classify_domain("reddit.com") == "reddit"
    assert classify_domain("old.reddit.com") == "reddit"
    assert classify_domain("quora.com") == "quora"
    assert classify_domain("medium.com") == "medium"
    assert classify_domain("some-pub.medium.com") == "medium"
    assert classify_domain("linkedin.com") == "linkedin"
    assert classify_domain("twitter.com") == "x"
    assert classify_domain("x.com") == "x"

def test_classifies_known_noise():
    assert classify_domain("google.com") == "search_redirect"
    assert classify_domain("vertexaisearch.cloud.google.com") == "search_redirect"
    assert classify_domain("youtube.com") == "youtube"
    assert classify_domain("en.wikipedia.org") == "wikipedia"

def test_unknown_is_other():
    assert classify_domain("manhattanstreetcapital.com") == "other"
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && python -m pytest scripts/test_layer_a_citation_analysis.py -v`
Expected: FAIL — `ModuleNotFoundError` / `classify_domain` not defined.

- [ ] **Step 3: Implement the script**

Create `backend/scripts/layer_a_citation_analysis.py`:
```python
"""Throwaway Layer A analysis — read-only mining of production citation data.
NOT wired into the app. Usage: python scripts/layer_a_citation_analysis.py <db_path>
"""
import sqlite3, sys, json
from collections import Counter, defaultdict

_PLATFORM_SUFFIX = {
    "reddit.com": "reddit", "quora.com": "quora", "medium.com": "medium",
    "linkedin.com": "linkedin", "twitter.com": "x", "x.com": "x",
    "youtube.com": "youtube", "youtu.be": "youtube", "wikipedia.org": "wikipedia",
}
_SEARCH_REDIRECT = {"google.com", "vertexaisearch.cloud.google.com",
                    "bing.com", "duckduckgo.com"}
_NEWS = {"forbes.com", "techcrunch.com", "reuters.com", "bloomberg.com",
         "nytimes.com", "businessinsider.com", "theverge.com"}

def classify_domain(domain: str) -> str:
    d = (domain or "").lower().strip().lstrip("www.")
    if d in _SEARCH_REDIRECT or d.endswith(".google.com"):
        return "search_redirect"
    for suffix, label in _PLATFORM_SUFFIX.items():
        if d == suffix or d.endswith("." + suffix):
            return label
    if d in _NEWS:
        return "news"
    return "other"

def analyze(db_path: str) -> dict:
    c = sqlite3.connect(db_path)
    rows = c.execute("select model, domain, kind from citation_sources").fetchall()
    per_model_platform = defaultdict(Counter)
    per_model_total = Counter()
    for model, domain, _kind in rows:
        plat = classify_domain(domain)
        per_model_platform[model][plat] += 1
        per_model_total[model] += 1
    # hit-rate of the 5 target platforms per model
    targets = ["reddit", "quora", "medium", "linkedin", "x"]
    summary = {}
    for model, total in per_model_total.items():
        plats = per_model_platform[model]
        summary[model] = {
            "total": total,
            "by_platform": dict(plats.most_common()),
            "target5_hits": {t: plats.get(t, 0) for t in targets},
            "target5_rate_pct": round(100 * sum(plats.get(t, 0) for t in targets) / total, 2) if total else 0.0,
        }
    c.close()
    return summary

if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else "_layerA_prod.db"
    print(json.dumps(analyze(db), indent=2))
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && python -m pytest scripts/test_layer_a_citation_analysis.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/layer_a_citation_analysis.py backend/scripts/test_layer_a_citation_analysis.py
git commit -m "feat: Layer A throwaway citation-mining script + classifier tests"
```

---

## Task 3: Run Stream 1 and write the findings artifact

**Files:**
- Create: `docs/strategy/research/stream1-citation-mining.md`

- [ ] **Step 1: Run the analysis against production data**

Run: `cd backend && python scripts/layer_a_citation_analysis.py _layerA_prod.db`
Expected: JSON with per-model `target5_rate_pct` and `by_platform`. Capture the output.

- [ ] **Step 2: Investigate the Claude gap**

If Claude has 0/near-0 citations: check whether Claude runs at all (`select model, count(*) from query_results group by model`) and whether the citation extractor handles Claude's `web_search_20250305` citation format. Determine: *no Claude runs* vs. *runs exist but citations not extracted*. Record which.

Run:
```bash
cd backend && python3 -c "import sqlite3; c=sqlite3.connect('_layerA_prod.db'); print(c.execute('select model,count(*) from query_results group by model').fetchall())"
```

- [ ] **Step 3: Spot-check the google.com / search_redirect bucket**

Pull 10 sample `url`s where domain is google.com and confirm they're grounding-redirect URLs (Gemini) vs. real google.com pages. Record the finding so the redirect discount is justified, not assumed.

Run:
```bash
cd backend && python3 -c "import sqlite3; c=sqlite3.connect('_layerA_prod.db'); [print(r[0]) for r in c.execute(\"select url from citation_sources where domain='google.com' limit 10\").fetchall()]"
```

- [ ] **Step 4: Write `stream1-citation-mining.md`**

Document, with the actual numbers: per-model cited-platform distribution; the `target5_rate_pct` per model (the headline: do our 5 platforms get cited?); the Claude-gap resolution; the google.com-redirect resolution; sample-size + vertical-skew caveat (note which brands/verticals dominate the data). State conclusions as *presence is strong evidence, absence is weaker (sampling)* per the spec's bias mitigation.

- [ ] **Step 5: Commit (artifact only — never the .db)**

```bash
git add docs/strategy/research/stream1-citation-mining.md
git commit -m "docs: Stream 1 — first-party citation-mining findings"
```

---

## Task 4: Stream 2 — deep-research pass, ChatGPT retrieval

**Files:**
- Create: `docs/strategy/research/stream2-model-chatgpt.md`

- [ ] **Step 1: Run the deep-research skill**

Invoke `deep-research` with this question:
> "How does OpenAI's ChatGPT web_search tool (gpt-4o-mini via the Responses API, search_context_size=medium) retrieve and cite web pages as of 2026? Which search index/backend does it use (Bing? OpenAI's own crawler?), what recency window applies, what ranking signals determine which sources are surfaced, how are citations selected and formatted, and does it fetch full page content or rely on snippets? Prioritize OpenAI primary docs and controlled studies over vendor SEO blogs. Flag the publish date of every source and note anything likely stale."

- [ ] **Step 2: Save the cited report** to `docs/strategy/research/stream2-model-chatgpt.md`, preserving citations and any `[unverified inference]` tags.

- [ ] **Step 3: Commit**

```bash
git add docs/strategy/research/stream2-model-chatgpt.md
git commit -m "docs: Stream 2 — ChatGPT retrieval research"
```

---

## Task 5: Stream 2 — deep-research pass, Claude retrieval

**Files:**
- Create: `docs/strategy/research/stream2-model-claude.md`

- [ ] **Step 1: Run `deep-research`** with:
> "How does Anthropic's Claude web_search_20250305 server-side tool retrieve and cite web content as of 2026? Which search backend does it use, what determines which results are surfaced and cited, how are citations structured in the response, and what content format makes a page more likely to be cited? Prioritize Anthropic primary docs. Date-stamp sources."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-model-claude.md` with citations preserved.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-model-claude.md && git commit -m "docs: Stream 2 — Claude retrieval research"
```

---

## Task 6: Stream 2 — deep-research pass, Perplexity retrieval

**Files:**
- Create: `docs/strategy/research/stream2-model-perplexity.md`

- [ ] **Step 1: Run `deep-research`** with:
> "How does Perplexity (sonar / sonar-pro) retrieve and cite sources as of 2026? Does it use its own crawler/index or a third-party search API? What ranking and recency signals govern source selection, how many sources does it typically cite, and what on-page traits correlate with being cited? Prioritize Perplexity primary docs and independent studies. Date-stamp sources."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-model-perplexity.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-model-perplexity.md && git commit -m "docs: Stream 2 — Perplexity retrieval research"
```

---

## Task 7: Stream 2 — deep-research pass, Gemini retrieval

**Files:**
- Create: `docs/strategy/research/stream2-model-gemini.md`

- [ ] **Step 1: Run `deep-research`** with:
> "How does Google Gemini (gemini-2.5-flash) with the google_search grounding tool retrieve and cite web content as of 2026? How does grounding work, how are grounding-redirect URLs (vertexaisearch / google.com redirects) formed, what determines which sources ground a response, and what content traits help a page get grounded? Prioritize Google primary docs. Date-stamp sources."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-model-gemini.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-model-gemini.md && git commit -m "docs: Stream 2 — Gemini retrieval research"
```

---

## Task 8: Stream 2 — deep-research pass, Reddit as a cited source

**Files:**
- Create: `docs/strategy/research/stream2-platform-reddit.md`

- [ ] **Step 1: Run `deep-research`** with:
> "As of 2026, how often and how do AI answer engines (ChatGPT, Claude, Perplexity, Gemini) cite Reddit content? Did ChatGPT downweight Reddit around September 2025 — is that real and to what degree? Does Reddit's Google licensing deal affect which models can surface it? What kind of Reddit post/comment (subreddit, format, age, vote count) actually gets cited? Prioritize primary sources and controlled GEO studies; flag vendor speculation. Date-stamp everything."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-platform-reddit.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-platform-reddit.md && git commit -m "docs: Stream 2 — Reddit citation research"
```

---

## Task 9: Stream 2 — deep-research pass, Quora as a cited source

**Files:**
- Create: `docs/strategy/research/stream2-platform-quora.md`

- [ ] **Step 1: Run `deep-research`** with:
> "As of 2026, do AI answer engines (ChatGPT, Claude, Perplexity, Gemini) cite Quora answers, and through what mechanism (direct index vs. Google surfacing)? What makes a Quora answer get cited — answer position, format, author credibility, recency? Is Quora's citation value rising or falling? Primary sources and studies preferred. Date-stamp sources."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-platform-quora.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-platform-quora.md && git commit -m "docs: Stream 2 — Quora citation research"
```

---

## Task 10: Stream 2 — deep-research pass, Medium as a cited source

**Files:**
- Create: `docs/strategy/research/stream2-platform-medium.md`

- [ ] **Step 1: Run `deep-research`** with:
> "As of 2026, do AI answer engines cite Medium articles, and how? Does Medium's domain authority help or does the model prefer original/owned domains? What article traits (length, structure, headings, citations, author) correlate with being cited? Is publishing on Medium better or worse than the same content on an owned domain for AI citation? Primary sources/studies preferred. Date-stamp."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-platform-medium.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-platform-medium.md && git commit -m "docs: Stream 2 — Medium citation research"
```

---

## Task 11: Stream 2 — deep-research pass, LinkedIn as a cited source

**Files:**
- Create: `docs/strategy/research/stream2-platform-linkedin.md`

- [ ] **Step 1: Run `deep-research`** with:
> "As of 2026, do AI answer engines cite LinkedIn posts or articles? LinkedIn largely blocks crawlers and requires login — how does that affect AI retrieval? Is LinkedIn long-form content actually surfaced/cited, or only valuable for human reach? Distinguish AI-citation value from social reach. Primary sources preferred. Date-stamp."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-platform-linkedin.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-platform-linkedin.md && git commit -m "docs: Stream 2 — LinkedIn citation research"
```

---

## Task 12: Stream 2 — deep-research pass, X as a cited source

**Files:**
- Create: `docs/strategy/research/stream2-platform-x.md`

- [ ] **Step 1: Run `deep-research`** with:
> "As of 2026, do AI answer engines (ChatGPT, Claude, Perplexity, Gemini) cite X/Twitter posts? X restricts crawling and gates its API — which models can actually access X content, and does any cite it in answers? What format (single post vs. thread) if any gets surfaced? Distinguish citation value from reach. Primary sources preferred. Date-stamp."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-platform-x.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-platform-x.md && git commit -m "docs: Stream 2 — X citation research"
```

---

## Task 13: Stream 2 — deep-research pass, writable-text channel re-ranking

**Files:**
- Create: `docs/strategy/research/stream2-channel-ranking.md`

- [ ] **Step 1: Run `deep-research`** with:
> "As of 2026, rank writable-text publishing channels by how reliably their content gets cited by AI answer engines (ChatGPT, Claude, Perplexity, Gemini). Include: owned blog/site, Reddit, Quora, Medium, LinkedIn, X, Substack, dev.to, Hacker News, Stack Overflow, GitHub, and niche/industry forums. Exclude video (YouTube) and review sites (G2/Capterra). What structural traits make a channel citable (crawlability, no login wall, structured content, domain trust)? Primary sources and GEO studies preferred. Date-stamp."

- [ ] **Step 2: Save** to `docs/strategy/research/stream2-channel-ranking.md`. Cross-reference against Stream 1's `by_platform` data (which non-5 channels actually appeared in our citations).

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream2-channel-ranking.md && git commit -m "docs: Stream 2 — writable-channel re-ranking research"
```

---

## Task 14: Stream 3 — first-principles model mechanics synthesis

**Files:**
- Create: `docs/strategy/research/stream3-model-mechanics.md`

- [ ] **Step 1: Synthesize the mechanics** from the four Stream-2 model reports (Tasks 4–7) into one comparison: per model — search backend, recency window, ranking signals, snippet-vs-fullpage fetch, citation selection/formatting. Where the Stream-2 reports left a mechanic unknown, run a targeted follow-up `deep-research` query or tag it `[unverified inference]`.

- [ ] **Step 2: Build a cross-model comparison table** (rows = mechanics, columns = the 4 models) so the structural commonalities (what *all* models reward) are visible. These commonalities become the universal content rules.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/stream3-model-mechanics.md && git commit -m "docs: Stream 3 — first-principles model mechanics"
```

---

## Task 15: Audit current rules for the contradictions section

**Files:**
- Create: `docs/strategy/research/contradictions.md`
- Read (do not modify): `backend/app/services/drafting/platforms.py`, `backend/app/services/drafting/prompts.py`, `backend/app/services/content_service.py`, `backend/app/services/clustering_service.py`, `backend/app/services/cluster_brief.py`

- [ ] **Step 1: Extract every current content rule** with file:line references. Cover: `PLATFORM_SPECS` (tone/format/length/rules per platform), the universal style rules (em-dash ban, hedging ban, banned words), query-mirroring rule, brand-mention-once rule, subreddit restriction lists, the stale duplicate `PLATFORM_GUIDELINES` in `content_service.py`.

- [ ] **Step 2: For each rule, mark it** `confirmed` / `contradicted` / `no-evidence` against the Stream 1–3 findings. Write the verdict + the evidence reference into `contradictions.md`. This is the changelog Layer B will consume.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/research/contradictions.md && git commit -m "docs: current-rules audit vs. evidence (Layer B changelog)"
```

---

## Task 16: Synthesize Part 1 (prose strategy)

**Files:**
- Create: `docs/strategy/aio-content-strategy-2026.md`

- [ ] **Step 1: Write the front matter + Part 1** in the exact section order from the spec:
  1. First-party citation reality (from `stream1-citation-mining.md`)
  2. How the 4 models retrieve & cite (from `stream3-model-mechanics.md` + Stream-2 model reports)
  3. Per-platform philosophy ×5 (reconcile Stream 1 hit-rate with Stream 2 per-platform reports — surface conflicts explicitly)
  4. Channel re-ranking (from `stream2-channel-ranking.md`, cross-checked vs. Stream 1)
  5. Where current rules contradict the evidence (summarize `contradictions.md`, link to it)

- [ ] **Step 2: Enforce the claim-tagging rule** — every claim is cited, `[unverified inference]`, or `[first-party data]`. Scan the section to confirm none are bare assertions.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/aio-content-strategy-2026.md
git commit -m "docs: AIO content strategy Part 1 (prose, the why)"
```

---

## Task 17: Synthesize Part 2 (structured per-platform ruleset)

**Files:**
- Modify: `docs/strategy/aio-content-strategy-2026.md`

- [ ] **Step 1: Append Part 2** — one structured block per platform (LinkedIn, Medium, Reddit, Quora, X) using the exact key schema from the spec:
```
<platform>:
  retrieved_by:          # which models cite it, via what mechanism (from Streams 1+2)
  format / structure:    # the on-platform shape that gets surfaced
  length:                # target range + rationale
  sourcing:              # real thread URL? real question? citations required?
  citation_bait:         # structural traits that get it surfaced
  do: [...]
  dont: [...]
  brand_mention_rule:    # when/how the brand may appear
  confidence:            # high/med/low + why (reflects stream agreement vs conflict)
```

- [ ] **Step 2: Ensure each `confidence` value reflects stream agreement** — high only where Stream 1 (where present) and Stream 2 agree; low where they conflict or evidence is thin.

- [ ] **Step 3: Commit**
```bash
git add docs/strategy/aio-content-strategy-2026.md
git commit -m "docs: AIO content strategy Part 2 (per-platform ruleset)"
```

---

## Task 18: Final self-review against the spec's done-criteria

**Files:**
- Modify (as needed): `docs/strategy/aio-content-strategy-2026.md`

- [ ] **Step 1: Check every done-criterion** from the spec's "Validation / done criteria" section, one by one:
  - Stream 1 breakdown present with target5 hit-rate, unknowns re-classified, Claude + google.com caveats resolved.
  - Stream 2 per-model (4) and per-platform (5) passes exist and are cited.
  - Stream 3 mechanics writeup exists.
  - Every Part 1 claim cited / tagged / first-party-attributed.
  - All 5 platforms have a complete Part 2 block with confidence.
  - Contradictions section names rules with file references.
  - Channel re-ranking present.

- [ ] **Step 2: Fix any gap inline.** If a criterion fails, go back to the relevant task's artifact and complete it.

- [ ] **Step 3: Update `CURRENT_STATE.md`** — record Layer A shipped, the headline first-party finding, and that Layer B/C are next. Bump the timestamp.

- [ ] **Step 4: Final commit**
```bash
git add docs/strategy/aio-content-strategy-2026.md CURRENT_STATE.md
git commit -m "docs: Layer A complete — AIO content strategy 2026 synthesized + verified"
```

- [ ] **Step 5: Hand back to Ken** for the end-to-end read (the human verification gate — he must confirm he understands and trusts it before Layer B starts).

---

## Self-review (plan vs. spec)

- **Spec coverage:** Stream 1 → Tasks 1–3; Stream 2 model passes → Tasks 4–7; Stream 2 platform passes → Tasks 8–12; channel re-ranking → Task 13; Stream 3 → Task 14; contradictions → Task 15; Part 1 → Task 16; Part 2 → Task 17; done-criteria → Task 18. All spec sections covered.
- **No placeholders:** every research task contains the actual question to run; the script task contains full code + tests.
- **Naming consistency:** `classify_domain` and the `stream*-*.md` / `aio-content-strategy-2026.md` paths are used identically across tasks.
- **Data safety:** raw production `.db`/`.csv` gitignored (Task 1); only synthesized markdown is committed.
