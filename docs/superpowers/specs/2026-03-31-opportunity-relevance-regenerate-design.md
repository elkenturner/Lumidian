# Opportunity Relevance Overhaul + Regenerate UX Design

## Problem Summary

Three related issues in the content hub:

1. **Irrelevant opportunities**: Reddit/Quora scanner produces wildly off-topic results (r/stopdrinking, r/WindowsHelp, MKULTRA propaganda for a Reg A+ advisory company) because:
   - Raw prompt text is used as search query, flooding results with generic-word matches ("capital", "raise", "service", "platform")
   - Scoring formula rewards high-engagement posts too heavily (engagement = 40% of score max)
   - Thresholds are too low (Reddit 55, Quora 40)

2. **Draft generate button greyed out / missing**: The empty-state "Generate Drafts Now" button only renders for paid users (`subscription_tier != null`). Before account repair it was invisible. Post-repair it appears, but if no tracking run has been completed yet, clicking returns a generic 400 with no useful guidance.

3. **Rename + regenerate behavior**: Buttons should be renamed "Regenerate Drafts" / "Regenerate Live Opportunities" to reflect that they replace existing content. Opportunity scan trigger only scans Reddit — Quora must be added.

---

## Architecture

### Relevance fix: two layers

**Layer 1 — Smarter search queries (most impactful)**

Instead of sending the raw prompt text as the Reddit search query, extract the 2–3 most specific, domain-relevant phrases. Prioritise multi-word regulatory/technical terms ("Reg A+", "Reg D", "Reg S", "capital raise", "securities offering") as quoted phrases. Generic stop-words are already stripped but domain-specific common words ("capital", "raise", "service", "platform") must also be excluded from queries.

New function: `_build_search_query(prompt_text: str) -> str`
- Strip generic finance/SaaS words (new stop set: `QUERY_STOP`)
- Detect and quote multi-word regulatory terms as phrases
- Return top 3 remaining keywords joined with spaces

**Layer 2 — Reweighted scoring + thresholds + Haiku gate**

- Formula change: `relevance*70 + recency*20 + engagement*10` (was 50/20/20)
- Minimum matches: 3 (was 2)
- Reddit threshold: 65 (was 55)
- Quora threshold: 55 (was 40)
- After scoring, run Claude Haiku once per surviving candidate to confirm relevance: one API call per opportunity, ~$0.001/scan. Since scans run in the background, latency is irrelevant.

### Quora added to scan trigger

`opportunities.py → _scan_and_log` currently only calls `reddit_scanner_service.scan_brand_opportunities`. Add `quora_scanner_service.scan_brand_opportunities` in parallel using `asyncio.gather`.

### Frontend changes

- Rename "Generate Drafts Now" → "Regenerate Drafts" (both right-panel button and empty-state button)
- Rename scan trigger button → "Regenerate Live Opportunities"
- When `generate_now` returns 400 with detail containing "No content gaps", show specific message: "Run a tracking scan first to identify content gaps."

---

## Detailed Design

### `_build_search_query(prompt_text)` — reddit_scanner_service.py

```python
QUERY_STOP = frozenset({
    # Generic finance/SaaS words that appear everywhere and produce false matches
    "capital", "raise", "service", "services", "platform", "platforms",
    "advisory", "advisor", "advisor", "company", "companies", "business",
    "fund", "funds", "funding", "help", "best", "top", "use", "using",
    "invest", "investor", "investors", "market", "markets", "money",
    "growth", "scale", "solution", "solutions", "provider", "providers",
    "startup", "startups", "enterprise", "product", "products",
})

# Multi-word regulatory/technical terms that should be quoted for exact phrase search
_PHRASE_TERMS = [
    "reg a+", "reg d", "reg s", "regulation a", "regulation d", "regulation s",
    "capital raise", "securities offering", "direct listing", "ipo",
    "crowdfunding", "equity crowdfunding", "investor relations",
    "accredited investor", "accredited investors",
    "venture capital", "private equity", "angel investor",
]

def _build_search_query(prompt_text: str) -> str:
    """
    Extract the most specific search terms from a prompt.
    Detects multi-word regulatory phrases and quotes them for exact matching.
    Falls back to top 3 specific single keywords.
    """
    lower = prompt_text.lower()
    quoted_phrases = []
    for phrase in _PHRASE_TERMS:
        if phrase in lower:
            quoted_phrases.append(f'"{phrase}"')

    # Strip known-bad generics and stop words, then take remaining specific words
    clean = re.sub(r"[^a-z0-9\s]", " ", lower)
    words = [w for w in clean.split() if w not in _STOP and w not in QUERY_STOP and len(w) > 3]

    parts = quoted_phrases[:2] + words[:max(0, 3 - len(quoted_phrases))]
    return " ".join(parts) if parts else prompt_text
```

### Haiku relevance gate — reddit_scanner_service.py

After building the candidate list and scoring, run a batch check:

```python
async def _haiku_relevance_check(
    brand_name: str,
    brand_description: str,
    candidates: list[dict],  # {title, subreddit, body_preview}
) -> list[bool]:
    """
    Ask Claude Haiku whether each candidate is a genuine content opportunity.
    Returns a list of booleans (True = keep). Fails open on API errors.
    """
    import os
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return [True] * len(candidates)  # fail open if no key

    client = anthropic.AsyncAnthropic(api_key=api_key)
    results = []
    for c in candidates:
        prompt = (
            f"Brand: {brand_name}\n"
            f"What they do: {brand_description}\n\n"
            f"Reddit post title: {c['title']}\n"
            f"Subreddit: r/{c['subreddit']}\n"
            f"Post preview: {c.get('body_preview', '')[:300]}\n\n"
            "Is this a genuine opportunity for this brand to contribute expert value "
            "as a reply or comment? Answer only YES or NO."
        )
        try:
            msg = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=5,
                messages=[{"role": "user", "content": prompt}],
            )
            text = msg.content[0].text if msg.content else ""
            results.append("YES" in text.upper())
        except Exception:
            results.append(True)  # fail open — don't drop on API error
    return results
```

Brand description sourced from `BrandProfile.company_description` if available (queried from DB in `scan_brand_opportunities`), else falls back to `brand.website_url`.

Brand description sourced from `BrandProfile.company_description` if available, else `brand.website_url`.

### Scoring formula change — reddit_scanner_service.py:_score_thread

```python
# Before:
score = relevance * 50.0 + recency * 20.0 + engagement * 20.0 + brand_bonus
# After:
score = relevance * 70.0 + recency * 20.0 + engagement * 10.0 + brand_bonus
```

Threshold change: `if score < 65.0: continue` (was 55.0)
Minimum matches: `if relevance < 0.45 or matches < 3: return 0.0` (was matches < 2)

### Scoring formula change — quora_scanner_service.py:_score_question

```python
# Minimum matches: 3 (was 2)
if matches < 3:
    return 0.0
# Threshold in scan_brand_opportunities:
if score < 55.0: continue  # was 40.0
```

### Scan trigger — opportunities.py:_scan_and_log

```python
async def _scan_and_log(brand_id: int) -> None:
    import asyncio
    from app.services.reddit_scanner_service import scan_brand_opportunities as reddit_scan
    from app.services.quora_scanner_service import scan_brand_opportunities as quora_scan

    await asyncio.gather(
        reddit_scan(brand_id, clear_existing=True),
        quora_scan(brand_id, clear_existing=True),
    )
    # ... existing analytics log code unchanged
```

### Frontend — button renames + error message

**content/page.tsx**
- Line with `{generating ? 'Generating…' : 'Generate Drafts Now'}` → `'Regenerate Drafts'`
- Scan button label `'Scan for Live Opportunities'` → `'Regenerate Live Opportunities'`
- In `handleGenerateNow` catch block: if error detail includes "No content gaps", show: `"Run a tracking scan first to identify content gaps."`

**components/content/ContentTabPanels.tsx**
- Empty-state button: `'Generate Drafts Now'` → `'Regenerate Drafts'`
- Description text updated to match

---

## Data Flow

```
User clicks "Regenerate Live Opportunities"
  → POST /api/opportunities/{brand_id}/scan
  → _scan_and_log runs in background:
      ├─ reddit_scan(clear_existing=True)
      │    ├─ Build queries using _build_search_query() per prompt
      │    ├─ Fetch Reddit posts, score with new formula (threshold 65)
      │    └─ Run Haiku gate on surviving candidates
      └─ quora_scan(clear_existing=True)
           ├─ Extract keywords per prompt
           ├─ Serper.dev search
           └─ Score with new formula (threshold 55)
  → Both write fresh ContentOpportunity rows
  → Frontend polls getOpportunities() and refreshes

User clicks "Regenerate Drafts"
  → POST /api/content/{brand_id}/generate-now
  → auto_draft_top_gaps(clear_existing=True, max_gaps=N)
  → If no gaps: 400 "No content gaps found for brand X. ..."
  → Frontend shows: "Run a tracking scan first to identify content gaps."
```

---

## Files Changed

| File | Change |
|------|--------|
| `backend/app/services/reddit_scanner_service.py` | Add `QUERY_STOP`, `_PHRASE_TERMS`, `_build_search_query()`, `_haiku_relevance_check()`; update `_score_thread` weights + threshold; update `scan_brand_opportunities` to use new query builder and Haiku gate |
| `backend/app/services/quora_scanner_service.py` | Raise min matches to 3, raise threshold to 55 |
| `backend/app/routers/opportunities.py` | Add Quora scan to `_scan_and_log` via `asyncio.gather` |
| `frontend/app/content/page.tsx` | Rename buttons; improve error message for no-gaps case |
| `frontend/components/content/ContentTabPanels.tsx` | Rename empty-state button label |

---

## Error Handling

- Haiku gate fails open: if the API call throws, the opportunity is kept (no silent drops)
- Quora scan failure in gather doesn't block Reddit results (gather exceptions are caught per-service)
- "No content gaps" error produces a user-friendly frontend message instead of raw API error text

## Out of Scope

- Changing the Quora search query construction (uses `extract_keywords` which is already reasonable)
- Adding relevance explanations to the UI
- Persisting Haiku verdicts to the database
