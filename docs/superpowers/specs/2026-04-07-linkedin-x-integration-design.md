# LinkedIn & X Integration Design

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Add LinkedIn and X (Twitter) as full content platforms — opportunity scanning, AI-drafted content, gap analysis integration — gated to Pro tier.

---

## Motivation

Lumidian currently supports Reddit, Quora, Medium, and Wikipedia for content drafting and opportunity scanning. Users want a complete content strategy that also covers LinkedIn and X, the two largest professional and real-time social platforms.

**AI visibility relevance:**
- **X**: Real, direct path to AI visibility. Public tweets are Google-indexed; Perplexity and Gemini cite them in live-web results. Older tweet data exists in ChatGPT/Claude training sets.
- **LinkedIn**: Narrower but real. LinkedIn Articles (long-form) are publicly indexed by Google and findable by Perplexity/Gemini. Regular LinkedIn posts are mostly behind auth walls and less impactful for AI visibility. Both platforms create indirect amplification — content gets shared, cited in blogs/news, and those secondary references improve visibility across all models.

**Business value:** LinkedIn/X are Pro-exclusive features, providing a clear upgrade incentive from Starter.

---

## 1. Platform Specs

Six new entries in `PLATFORM_SPECS` (in `backend/app/services/drafting/platforms.py`):

### LinkedIn

#### `linkedin_article`
- **Use case:** Gap-based drafts (publicly indexed, strongest AI visibility path for LinkedIn)
- **Format:** article
- **Word range:** 600-1500
- **Max tokens:** 3000
- **Tone:** Long-form editorial, professional thought leadership — structured, authoritative
- **Rules:**
  - Open with a strong hook in the first 1-2 sentences — a surprising stat, a bold claim, or a direct answer to the target query
  - Structure with short focused sections separated by blank lines — headers are acceptable on LinkedIn Articles
  - The brand name must appear at least once, in a concrete context (a claim, an example, a data point) — not as a pitch
  - Every major claim must be backed by specific data, examples, or evidence from the Brand Profile
  - Where the Brand Profile includes publications, cite them naturally (e.g., "A study published in...")
  - End with a specific, actionable takeaway — not a generic conclusion
  - No marketing language, no superlatives, no calls to action to "follow" or "like"
  - 1-3 relevant hashtags at the very end, on their own line
  - Content must read as written by a knowledgeable industry professional, not by a brand spokesperson
- **Posting tip:** Publish as a LinkedIn Article (not a post) for Google indexation — articles appear under your profile's "Activity" and are crawled by search engines.

#### `linkedin_post`
- **Use case:** Manual drafts, quick thought leadership
- **Format:** post
- **Word range:** 80-250
- **Max tokens:** 800
- **Tone:** Professional but conversational — like a respected colleague sharing an insight in a meeting
- **Rules:**
  - Open with a direct statement or insight — no "I've been thinking about..." preamble
  - Write in short paragraphs (1-3 sentences each) with line breaks between them — LinkedIn's feed rewards scannable formatting
  - Brand mention only if it directly supports the point being made — never forced
  - No clickbait hooks ("You won't believe...", "Stop doing this...")
  - No excessive emoji or formatting gimmicks
  - 1-3 relevant hashtags at the end
  - Contractions are fine — sound like a person, not a press release
  - No links unless essential to the point
- **Posting tip:** Post from your company's LinkedIn page or personal profile.

#### `linkedin_reply`
- **Use case:** Opportunity replies — short response to a LinkedIn discussion
- **Format:** reply
- **Word range:** 30-100
- **Max tokens:** 400
- **Tone:** Direct, professional, helpful — like replying to a colleague's post
- **Rules:**
  - 1-4 sentences only — replies should be direct and add concrete value
  - Address the specific point or question in the original post
  - Brand mention only if it directly answers the question being asked
  - No hedging, no preamble — get to the point immediately
  - No hashtags in replies
- **Posting tip:** Reply directly to the original post.

### X (Twitter)

#### `x_thread`
- **Use case:** Gap-based drafts (more content = stronger AI training signal)
- **Format:** thread (3-7 tweets)
- **Word range:** 150-500 (across all tweets)
- **Max tokens:** 1500
- **Tone:** Narrative, educational — each tweet stands alone but builds toward a point
- **Rules:**
  - Format each tweet on its own line, prefixed with `1/`, `2/`, etc.
  - Each tweet must be under 280 characters — this is a hard limit, no exceptions
  - First tweet must hook — state a surprising fact, a bold claim, or a direct answer to the target query
  - Each tweet should make sense on its own if read in isolation (people often see retweets of individual tweets)
  - The brand name should appear naturally in one tweet (not the first) where it supports the argument
  - Last tweet should deliver a concrete takeaway or insight — not a generic wrap-up
  - 0-1 hashtags total, in the last tweet only if natural
  - No "Thread:" or "A thread" prefix — just start with the content
  - Vary tweet length — mix short punchy tweets (40-80 chars) with longer substantive ones
- **Posting tip:** Post as a thread from your brand's X account.

#### `x_post`
- **Use case:** Manual drafts, standalone insights
- **Format:** post
- **Word range:** 15-65 (roughly 280 characters)
- **Max tokens:** 300
- **Tone:** Concise, punchy, conversational — like a smart person tweeting an insight
- **Rules:**
  - Must be under 280 characters — hard limit
  - One clear idea per tweet — do not try to pack multiple points
  - Brand mention only if it's the most natural way to make the point
  - 0-1 hashtags, only if genuinely relevant
  - No thread numbering (this is a standalone tweet)
  - Contractions, casual phrasing, and direct address are encouraged
- **Posting tip:** Post from your brand's X account.

#### `x_reply`
- **Use case:** Opportunity replies — short response to a tweet or thread
- **Format:** reply
- **Word range:** 10-50 (roughly 280 characters)
- **Max tokens:** 200
- **Tone:** Direct, helpful, brief — like replying to someone's tweet
- **Rules:**
  - Must be under 280 characters — hard limit
  - 1-2 sentences maximum — direct and to the point
  - Answer the specific question or add to the specific discussion
  - Brand mention only if it directly and obviously answers the question
  - No hashtags in replies
  - No hedging — be direct
- **Posting tip:** Reply directly to the tweet.

### Platform Mapping

The drafting system uses these mappings:

| Context | LinkedIn | X |
|---|---|---|
| Gap-based drafts (`auto_draft_top_gaps`) | `linkedin_article` | `x_thread` |
| Opportunity replies (`generate_opportunity_draft`) | `linkedin_reply` | `x_reply` |
| Manual drafts (user chooses) | `linkedin_post` or `linkedin_article` | `x_post` or `x_thread` |

`CONTENT_PLATFORMS` (used for gap draft round-robin) adds `"linkedin"` and `"x"`.

`PLATFORM_MAX_TOKENS` additions: `linkedin_article: 3000`, `linkedin_post: 800`, `linkedin_reply: 400`, `x_thread: 1500`, `x_post: 300`, `x_reply: 200`.

---

## 2. Opportunity Scanners

Two new services, both using Serper.dev. Follow the existing Quora scanner pattern.

### `linkedin_scanner_service.py`

**Discovery:** Serper.dev searches with `site:linkedin.com` per brand prompt (up to 5 prompts). Extracts keywords from prompt text using the same approach as the Quora scanner.

**Scoring:** Matches the updated Quora/Reddit scoring pattern:
```
score = relevance * 70.0 + recency * 30.0
```
- **Relevance:** Keyword overlap between prompt and post title+snippet. Stop-word filtered. Minimum 2 keyword matches, minimum threshold before inclusion.
- **Recency:** Graduated decay from Serper's date field — 7d=1.0, 30d=0.7, 60d=0.4, 90d=0.2, older=0.05. Unknown date assumes 180 days.
- **Minimum score:** 45.0 (same as Quora).

**URL filtering:**
- Reject non-LinkedIn URLs that leak through Serper results
- Reject job postings (`/jobs/` in URL)
- Reject company "about" pages, event pages, profile pages without specific post content
- Only keep URLs containing `/posts/`, `/pulse/` (articles), or `/feed/update/`

**Storage:** `ContentOpportunity(platform="linkedin", thread_url=url, thread_title=title[:500], subreddit=None, body_preview=snippet[:500], posted_at=parsed_date, relevance_score=score, prompt_id=prompt_id, status="new")`

**Capping:** Same anchor+fresh split as Quora — `_LEAD_CAP=20`, 10 kept by relevance score (anchors), 10 kept by `posted_at` recency (fresh finds). This ensures high-quality evergreen posts stay in the feed while new posts rotate in.

**Pruning:** 14-day expiry on `status="new"` opportunities, matching Quora.

**On-demand scan:** Supports `clear_existing=True` which wipes all `platform="linkedin"` opportunities for the brand before re-scanning.

### `x_scanner_service.py`

**Discovery:** Serper.dev searches with `site:x.com OR site:twitter.com` per brand prompt.

**Scoring:** Same formula — `relevance * 70.0 + recency * 30.0`, same thresholds and graduated recency decay.

**URL filtering:**
- Reject non-X/Twitter URLs
- Require `/status/` in URL (actual tweets, not profile pages or list pages)
- Reject media-only tweets (Serper snippet empty or under 20 characters)

**Storage:** `ContentOpportunity(platform="x", thread_url=url, thread_title=title[:500], subreddit=None, body_preview=snippet[:500], posted_at=parsed_date, relevance_score=score, prompt_id=prompt_id, status="new")`

**Capping & pruning:** Identical to LinkedIn — `_LEAD_CAP=20`, anchor+fresh split, 14-day expiry on `status="new"`.

### Scheduling

Both scanners are added to `scheduler.py`:

| Time (UTC) | Frequency | Job |
|---|---|---|
| 02:00 | Daily | Reddit scanner (existing) |
| 02:30 | Daily | Quora scanner (existing) |
| 02:40 | Daily | LinkedIn scanner (new) |
| 02:50 | Daily | X scanner (new) |

Both new scanners skip brands where the owner's `subscription_tier != "pro"`. Both implement `scan_all_brands()` for the scheduled sweep and `scan_brand_opportunities(brand_id, clear_existing)` for on-demand scans.

---

## 3. Drafting Integration

### `drafting/platforms.py`

- Add all 6 new specs to `PLATFORM_SPECS`
- `CONTENT_PLATFORMS` becomes `["reddit", "quora", "medium", "wikipedia", "linkedin", "x"]` — `reddit_reply`, `linkedin_reply`, and `x_reply` are excluded (reply variants are only used for opportunity drafts)
- `ALL_PLATFORMS` includes reply variants automatically
- `PLATFORM_MAX_TOKENS` additions as specified in Section 1

### `drafting/prompts.py` — `build_prompt()`

Add platform-specific instruction blocks in the prompt body (same branching pattern as existing Reddit/Quora/Medium/Wikipedia):

- **`linkedin_article`:** "Write a LinkedIn Article with a clear headline on the first line. Structure with short sections. The article will be publicly indexed by Google — optimize for the target query's exact phrasing appearing in the title and opening paragraph. Add 1-3 hashtags on the final line."
- **`linkedin_post`:** "Write a LinkedIn post. No title line — start directly with the content. Professional but conversational. Short paragraphs with line breaks. Add 1-3 hashtags on the final line."
- **`linkedin_reply`:** "Write a short, value-adding reply to this LinkedIn discussion. Professional tone, 1-4 sentences, direct and helpful."
- **`x_thread`:** "Write an X thread of 3-7 tweets. Format each tweet on its own line, prefixed with 1/, 2/, etc. Each tweet must be under 280 characters. First tweet must hook. Last tweet can include the brand naturally."
- **`x_post`:** "Write a single tweet under 280 characters. Punchy, conversational. 0-1 hashtags."
- **`x_reply`:** "Write a short reply tweet under 280 characters. Direct, helpful, 1-2 sentences."

### `drafting/pipeline.py`

**`extract_title_and_body()`:** Add `linkedin_article` to the `title_platforms` set (alongside `reddit` and `medium`) — LinkedIn Articles have a title on the first line.

**New function — `enforce_x_char_limit(text, platform)`:**
- For `x_post` and `x_reply`: if the text exceeds 280 characters, trim at the last word boundary before 280 and append "..."
- For `x_thread`: parse by the `1/`, `2/`, etc. numbering, enforce 280 per tweet, trim individual tweets that exceed the limit
- Applied as a post-processing step after `remove_hedging()` for all X platform variants

**New function — `parse_x_thread(raw_text)`:**
- Splits raw thread output into individual tweets by detecting `N/` numbering patterns
- Returns a list of tweet strings
- Used by the frontend to display tweet-by-tweet with character counts

### `drafting_service.py`

**`generate_gap_draft()`:**
- Platform mapping: when `platform="linkedin"`, uses `linkedin_article` spec. When `platform="x"`, uses `x_thread` spec.
- Both follow the standard pipeline: `build_prompt` -> `call_claude` -> `remove_hedging` -> `extract_title_and_body`
- X drafts get the additional `enforce_x_char_limit()` pass after hedging removal
- Brief format: LinkedIn = `"LinkedIn Article for: \"{prompt.text}\""`, X = `"X thread for: \"{prompt.text}\""`
- No separate workflow needed (unlike Wikipedia) — standard pipeline handles both

**`generate_opportunity_draft()`:**
- LinkedIn opportunities -> `linkedin_reply` spec (short, professional)
- X opportunities -> `x_reply` spec (single tweet reply, under 280 chars)
- Uses haiku model for reply variants (same cost optimization as `reddit_reply`)
- X replies get `enforce_x_char_limit()` pass
- Same brand-name quality check with retry. Same "restricted" bypass logic does not apply (no subreddit promotion classification for LinkedIn/X)

**`auto_draft_top_gaps()`:**
- No code changes needed. It already round-robins across `enabled_platforms` loaded from `BrandContentSettings`. Once LinkedIn/X settings exist for Pro users, they're automatically included in the rotation.
- Platform-to-spec mapping (linkedin -> linkedin_article, x -> x_thread) is handled in `generate_gap_draft`.

### Anti-AI Language

All LinkedIn/X drafts pass through the existing `remove_hedging()` function in `pipeline.py`, which strips:
- Em dashes (replaced with commas)
- Hedging phrases ("notably", "it's worth noting", "importantly", "delve", "dive into", "the bottom line", etc.)
- Markdown headers (not appropriate for LinkedIn posts or X tweets)
- Internal analysis sections the LLM sometimes appends

The platform-specific rules in each spec reinforce this: no hedging language, no corporate voice, no AI-sounding structure. The universal style rules in `build_prompt()` also apply (banned words/phrases, no triple parallel structures, varied sentence length, contractions encouraged).

---

## 4. Gap Analysis & Opportunity Balancing

### Gap Analysis (`gap_analysis_service.py`)

One change:
```python
PLATFORMS = ["reddit", "quora", "medium", "wikipedia", "linkedin", "x"]
```

Effects:
- `platforms_lacking` now includes `"linkedin"` and `"x"` when the brand has no recent posts on those platforms
- Gap scores naturally surface LinkedIn/X through the recency component (a brand with no LinkedIn/X activity gets a higher recency score)
- No changes to the scoring formula: `severity * 0.4 + opportunity * 0.3 + recency * 0.3`

### Opportunity Feed Balancing (Even Split)

**Change to `list_opportunities` in `routers/opportunities.py`:**

Instead of returning all opportunities sorted globally by relevance (which lets one platform dominate), implement balanced interleaving:

1. Query all `status="new"` (or filtered status) opportunities for the brand
2. Exclude platforms that are not enabled in `BrandContentSettings`
3. Exclude LinkedIn/X for non-Pro users
4. Group remaining opportunities by platform
5. Calculate per-platform share: `slots_per_platform = limit / n_platforms_with_results`
6. For each platform, take top N by `relevance_score` (up to its share)
7. If a platform has fewer results than its share, redistribute remaining slots to other platforms (by next highest relevance across remaining)
8. Interleave the final list: round-robin across platforms so the feed alternates rather than showing blocks of one platform

Example: `limit=20`, 4 platforms with results -> 5 per platform. If LinkedIn only has 3 results, the remaining 2 slots go to the next highest-scoring opportunities from any other platform.

### Platform Selector

`BrandContentSettings` already supports per-brand per-platform toggles with `enabled: bool`. No model changes needed.

- LinkedIn and X are added as available platform options in the frontend settings panel
- Default for new Pro users: all 6 platforms enabled
- Default for new Starter/Free users: LinkedIn/X not shown (Pro gate)
- Scanners check `BrandContentSettings.enabled` before storing opportunities for a platform
- `auto_draft_top_gaps` loads enabled platforms and only generates for those — LinkedIn/X are naturally excluded when disabled

---

## 5. Pro-Only Gate

### Tier Check Helper

New utility in `backend/app/dependencies.py`:

```python
PRO_ONLY_PLATFORMS = frozenset({"linkedin", "x", "linkedin_article", "linkedin_post",
                                 "linkedin_reply", "x_thread", "x_post", "x_reply"})

def require_pro_for_platform(platform: str, user: User):
    """Raise 403 if the platform requires Pro and the user isn't on Pro."""
    if platform in PRO_ONLY_PLATFORMS and user.subscription_tier != "pro":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{platform.replace('_', ' ').title()} features require a Pro subscription.",
        )
```

### Enforcement Points

| Layer | Enforcement |
|---|---|
| Content router — `generate_draft`, `generate_now` | `require_pro_for_platform(platform, user)` before generation |
| Opportunities router — `list_opportunities` | Filter out `platform in ("linkedin", "x")` for non-Pro users (silent exclusion, no error) |
| Opportunities router — `draft_opportunity` | Check tier before drafting from a LinkedIn/X opportunity |
| Opportunities router — `trigger_scan` | Reject on-demand LinkedIn/X scans for non-Pro users |
| Content settings router — `update_content_settings` | Prevent enabling LinkedIn/X for non-Pro users |
| Scheduler — LinkedIn/X `scan_all_brands` | Skip brands where owner's `subscription_tier != "pro"` |
| `auto_draft_top_gaps` | Already respects `BrandContentSettings.enabled` — non-Pro users can't enable LinkedIn/X, so naturally excluded |

---

## 6. Frontend Changes

### `PlatformBadge.tsx`

Add LinkedIn and X to the style and label maps:

```
PLATFORM_STYLES:
  linkedin: { bg: 'rgba(10,102,194,0.12)', text: '#3b82f6', border: 'rgba(10,102,194,0.25)' }
  x:        { bg: 'rgba(148,163,184,0.10)', text: 'var(--text-secondary)', border: 'rgba(148,163,184,0.18)' }

PLATFORM_LABELS:
  linkedin: 'LinkedIn'
  x: 'X'
```

### Content Page (`content/page.tsx`)

**Draft modal:**
- `DRAFT_PLATFORMS` becomes `['reddit', 'quora', 'medium', 'wikipedia', 'linkedin', 'x']`
- When LinkedIn is selected: sub-selector appears — "Post" or "Article" (Article is default). Maps to `linkedin_post` or `linkedin_article` in the API call.
- When X is selected: sub-selector appears — "Post" or "Thread" (Thread is default). Maps to `x_post` or `x_thread` in the API call.
- Both platform buttons show lock icon + "Pro" badge for non-Pro users. Clicking shows upgrade prompt instead of generating.

**Opportunity tab:**
- LinkedIn opportunities: render with title, snippet preview, external link to the LinkedIn post. PlatformBadge shows "LinkedIn".
- X opportunities: render with tweet text preview, external link to the tweet. PlatformBadge shows "X".
- No subreddit field shown (null for these platforms).

**Draft cards:**
- LinkedIn Article: same layout as Medium drafts — title + body + posting tip "Publish as LinkedIn Article"
- LinkedIn Post: shorter layout, no title, posting tip "Post to LinkedIn"
- X Thread: display tweet-by-tweet with numbered prefixes and per-tweet character count badges. Copy button copies all tweets with line separators. Posting tip "Post as thread on X".
- X Post: single tweet display with character count badge (green under 280, red if over). Posting tip "Post on X".

**Content settings panel:**
- Add LinkedIn and X toggle rows alongside existing Reddit/Quora/Medium/Wikipedia toggles
- Pro-only lock styling for non-Pro users (dimmed toggle + "Pro" badge + "Upgrade to Pro" text)

### `lib/api.ts`

No new endpoints or types needed. Existing functions (`generateDraft`, `getOpportunities`, `getDrafts`, `triggerScan`) accept platform as a string — `"linkedin"`, `"x"`, `"linkedin_article"`, `"x_thread"` etc. work without changes.

### Content utilities (`content/utils.ts`)

- Add LinkedIn/X to any platform display name maps used in the content page

---

## 7. No Schema Changes Required

The existing models handle LinkedIn/X without modification:

- **`ContentOpportunity`**: `platform` is `String(50)` — accepts `"linkedin"` and `"x"`. `subreddit` is nullable. All other fields (thread_url, thread_title, body_preview, posted_at, relevance_score) are platform-agnostic.
- **`ContentDraft`**: `platform` is `String(50)` — accepts all new variant strings. Title, content_text, content_brief, etc. are all platform-agnostic.
- **`BrandContentSettings`**: `platform` is `String(50)` with `enabled: bool` — just add rows for `"linkedin"` and `"x"`.
- **`ContentGap`**: `platforms_lacking` is JSON — already stores a list of platform strings.

No database migrations needed.

---

## 8. Files Changed

### New files
- `backend/app/services/linkedin_scanner_service.py`
- `backend/app/services/x_scanner_service.py`

### Modified files
- `backend/app/services/drafting/platforms.py` — add 6 platform specs, update CONTENT_PLATFORMS, ALL_PLATFORMS, PLATFORM_MAX_TOKENS
- `backend/app/services/drafting/prompts.py` — add LinkedIn/X branches in `build_prompt()`
- `backend/app/services/drafting/pipeline.py` — add `enforce_x_char_limit()`, `parse_x_thread()`, update `extract_title_and_body()` for linkedin_article
- `backend/app/services/drafting/__init__.py` — re-export new functions
- `backend/app/services/drafting_service.py` — platform mapping in `generate_gap_draft()` and `generate_opportunity_draft()`
- `backend/app/services/gap_analysis_service.py` — add linkedin/x to PLATFORMS
- `backend/app/dependencies.py` — add `require_pro_for_platform()`, `PRO_ONLY_PLATFORMS`
- `backend/app/routers/opportunities.py` — balanced interleaving, Pro gate on LinkedIn/X
- `backend/app/routers/content.py` — Pro gate on LinkedIn/X draft generation
- `backend/app/scheduler.py` — add LinkedIn/X scanner jobs at 02:40/02:50 UTC
- `frontend/components/PlatformBadge.tsx` — add LinkedIn/X styles and labels
- `frontend/app/content/page.tsx` — draft modal sub-selectors, X thread display, Pro lock UI, DRAFT_PLATFORMS update
- `frontend/app/content/utils.ts` — platform display name additions
