# Universal Reddit Scanner Design

## Goal

Replace the hardcoded industry/subreddit mapping in `reddit_scanner_service.py` with direct Reddit search by prompt text, making the scanner work for any brand regardless of industry.

## Problem

The current scanner maps brand descriptions to ~18 hardcoded industry categories (SaaS, fintech, biotech, etc.) and searches within predefined subreddit lists. Brands that don't match any keyword trigger — music, fitness, consumer apps, fashion, food, and countless others — silently produce zero opportunities every day.

## Architecture

Single file change: `backend/app/services/reddit_scanner_service.py`.

The public API (`scan_brand_opportunities`, `scan_all_brands`) is unchanged. Only the internal search strategy changes.

### Old flow
```
brand description + prompts
  → keyword match → industry category
  → hardcoded subreddit list
  → search each subreddit for generic keywords
  → score + store
```

### New flow
```
brand prompts (each one)  +  brand name (one extra query)
  → Reddit /search.json?q=<text>&sort=relevance&t=month&limit=25
  → filter through blocklist
  → score by relevance + recency + engagement + brand mention
  → deduplicate by URL
  → store top 20
```

## Search Strategy

For each brand, issue one search per prompt text plus one search for the brand name:

```
GET https://www.reddit.com/search.json
  ?q=<url_encoded_prompt_or_brand_name>
  &sort=relevance
  &t=month
  &limit=25
  &type=link
```

- `sort=relevance` — Reddit's own ranking surfaces the most-discussed threads first
- `t=month` — Reddit search param that biases toward recent content while still allowing evergreen threads
- One request per prompt, one per brand name, 1-second sleep between requests (existing rate limit)

A brand with 5 prompts issues 6 total requests (~6 seconds). Results from all queries are pooled and deduplicated by URL before scoring.

## Filtering

Remove posts where the subreddit is in `_BLOCKED_SUBS`. No age cutoff — recency scoring handles deprioritisation naturally.

`_BLOCKED_SUBS` is a `frozenset` of lowercase subreddit names covering:

- **Medical / mental health support**: `cancer`, `depression`, `anxiety`, `bipolar`, `ptsd`, `addiction`, `chronicpain`, `grief`, `survivorsofabuse`, `mentalhealth`, `suicidewatch`, `askdocs`, `medical`, `medicaladvice`
- **Relationship / personal advice**: `relationships`, `relationship_advice`, `amitheasshole`, `tifu`, `confessions`, `legaladvice`, `legaladviceuk`, `legaladviceeurope`
- **News / politics / mega-subs**: `worldnews`, `news`, `politics`, `conspiracy`, `nottheonion`, `askreddit`, `todayilearned`, `explainlikeimfive`, `changemyview`, `nostupidquestions`, `iama`
- **NSFW / sensitive signals**: any subreddit name containing `nsfw`, `porn`, `gore`, `xxx`, `nude`, `fetish`, or `crisis`

Posts are not filtered by comment count or age — a 0-comment post is a first-mover opportunity; old evergreen threads still rank in search results and are worth engaging.

## Scoring (0–100)

Each candidate post receives a score:

| Component | Max pts | Logic |
|-----------|---------|-------|
| Keyword overlap | 50 | Count prompt-text words (≥4 chars) found in post title. `min(matches / max(total_words * 0.4, 1), 1.0) * 50` |
| Recency | 20 | Age in days: ≤7 → 20, ≤30 → 14, ≤60 → 8, ≤90 → 4, older → 0 |
| Engagement | 20 | `min(log10(num_comments + 1) / log10(201), 1.0) * 20` — saturates at ~200 comments |
| Brand mention | 10 | Brand name (case-insensitive) appears in title or body preview → +10 |

Posts are ranked by score descending, top 20 stored per brand.

## Code Deletions

The following are removed entirely:

- `_INDUSTRY_MAP` dict (~100 lines)
- `_DETECTION_RULES` list (~50 lines)
- `_detect_industries()` function
- `_relevant_subreddits()` function
- `_promo_class()` function
- `_PROMO_RESTRICTED_SUBS` frozenset (replaced by `_BLOCKED_SUBS`)
- `_ALLOWED_SIGNALS` / `_RESTRICTED_SIGNALS` tuples
- The per-subreddit `GET /r/{sub}/search.json` search loop

Net result: ~250 lines deleted, ~80 added.

## What Is Kept

- `_REDDIT_BASE`, `_HEADERS` — unchanged
- `_LEAD_CAP = 20` — unchanged
- `scan_brand_opportunities(brand_id)` signature — unchanged
- `scan_all_brands()` — unchanged
- Deduplication by `thread_url` — unchanged
- DB upsert logic (existing opportunities not duplicated) — unchanged
- 1-second rate-limit sleep between requests — unchanged

## Error Handling

- Non-200 response from Reddit → log warning, skip that query, continue with others
- JSON parse failure → log warning, skip
- Brand with no prompts and no name → skip (already handled upstream)
- All queries fail → `scan_brand_opportunities` returns 0, no crash

## Testing

- `test_scan_uses_prompt_text_as_query` — mock `aiohttp` / `httpx`, assert search URL contains prompt text
- `test_blocked_subreddit_filtered` — inject result from `depression` subreddit, assert not stored
- `test_nsfw_signal_filtered` — inject result from `r/nsfw_something`, assert filtered
- `test_scoring_brand_mention_bonus` — post with brand name in title scores ≥10 pts higher than identical post without
- `test_scoring_recency` — post from 3 days ago scores higher than post from 60 days ago
- `test_deduplication` — same URL appearing in two query results stored only once
- `test_zero_comment_post_not_filtered` — 0-comment post passes filter, stored if top-scoring
