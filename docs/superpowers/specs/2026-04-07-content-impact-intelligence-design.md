# Content Impact Intelligence — Design Spec

**Date:** 2026-04-07
**Status:** Draft
**Goal:** Build a competitive moat through content activity correlation intelligence — per-prompt impact timelines, silent data infrastructure for future aggregate insights, and simple heuristic recommendations.

---

## 1. Problem Statement

Lumidian's differentiator is the action layer: monitor visibility → identify gaps → draft content → track outcomes. But today, the relationship between content activity and visibility changes is invisible to users. They draft content, mark it posted, and... nothing. No feedback loop. No way to see whether their effort moved the needle.

Meanwhile, no competitor in the AI visibility space (Otterly, Peec, Profound, Evertune, Sight) offers closed-loop content impact tracking. They diagnose but don't prescribe, and they certainly don't measure outcomes. This is Lumidian's moat opportunity.

---

## 2. What We're Building

Three layers, shipped incrementally:

### Layer 1: Prompt Impact Timelines
Per-prompt mini sparkline graphs with "draft posted" markers overlaid on the score trend line. A dedicated prompt detail page (`/tracker/[brandId]/prompt/[promptId]`) with a full-size interactive timeline and comprehensive prompt breakdown.

### Layer 2: Silent Data Infrastructure
Two new database tables — `PromptRunScore` (time-series of per-prompt per-model scores) and `ContentEvent` (flexible event log for future mining). Populated automatically during tracking runs. No user-facing UI — this is the foundation for aggregate intelligence.

### Layer 3: Simple "Where to Focus" Heuristics
Rule-based insights surfaced on the prompt detail page and brand tracker overview. Examples: "Claude scores improved 14pp since your last posted draft" or "Gemini hasn't responded to content activity for this prompt."

---

## 3. Database Schema Additions

### 3a. `PromptRunScore` Table

Persists per-prompt per-model visibility scores after each tracking run. Currently this data exists in `QueryResult` but must be aggregated on every read — expensive and prevents efficient time-series queries for the mini graphs.

```
PromptRunScore
  id              INTEGER PRIMARY KEY
  prompt_id       INTEGER FK → Prompt (indexed)
  tracking_run_id INTEGER FK → TrackingRun (indexed)
  brand_id        INTEGER FK → Brand (indexed)
  model           TEXT          -- 'chatgpt' | 'claude' | 'perplexity' | 'gemini'
  score           FLOAT         -- visibility percentage (0-100)
  mentioned_count INTEGER       -- mentions for this prompt+model in this run
  query_count     INTEGER       -- total queries (excluding errors)
  created_at      DATETIME      -- run completion timestamp
  
  UNIQUE(prompt_id, tracking_run_id, model)
```

**Index:** `idx_prompt_run_score_prompt_model` on `(prompt_id, model, created_at)` — the primary query pattern for timeline graphs.

**Populated:** In `tracking_service.py` after line 225 (where `RunModelScore` rows are created). Group existing `QueryResult` rows by `(prompt_id, model)`, calculate `mentioned_count / query_count * 100`, insert one `PromptRunScore` per combination.

### 3b. `ContentEvent` Table

Flexible event log for capturing any content-related signal. JSON `data` column allows storing arbitrary payloads without schema changes. This is the "silent storage" for future aggregate intelligence.

```
ContentEvent
  id              INTEGER PRIMARY KEY
  brand_id        INTEGER FK → Brand (indexed)
  prompt_id       INTEGER FK → Prompt (nullable, indexed)
  event_type      TEXT          -- indexed; see event types below
  data            TEXT          -- JSON payload
  created_at      DATETIME      -- indexed
```

**Index:** `idx_content_event_brand_type` on `(brand_id, event_type, created_at)`.

**Event types and payloads:**

| event_type | When fired | JSON `data` payload |
|------------|-----------|---------------------|
| `draft_posted` | `post_draft()` completes | `{draft_id, prompt_id, platform, visibility_at_post}` |
| `score_change` | After `PromptRunScore` insert, if delta from previous run exceeds threshold (5pp) | `{prompt_id, model, old_score, new_score, delta, tracking_run_id}` |
| `competitor_appeared` | Competitor mention detected on a prompt where they weren't before | `{prompt_id, model, competitor_name, tracking_run_id}` |
| `competitor_disappeared` | Competitor no longer mentioned on a prompt | `{prompt_id, model, competitor_name, tracking_run_id}` |
| `heuristic_triggered` | A heuristic rule fires | `{prompt_id, heuristic_id, message, severity, model}` |
| `content_correlated` | Score improved within 2 runs after a draft_posted event | `{prompt_id, draft_id, model, score_before, score_after, delta}` |

### 3c. Migration Strategy

Add to `database.py:run_migrations()` as new `ALTER TABLE` / `CREATE TABLE` steps at the bottom, following existing pattern. Both tables use `Base.metadata.create_all()` for initial creation, with index creation as explicit migration steps wrapped in try/except.

---

## 4. Backend API Additions

### 4a. New Endpoints

**GET `/api/results/{brand_id}/prompt/{prompt_id}/timeline`**

Returns the time-series data for one prompt's impact timeline graph.

```json
{
  "prompt_id": 42,
  "prompt_text": "Best project management tool for startups",
  "timeline": [
    {
      "run_id": 101,
      "completed_at": "2026-03-15T08:00:00Z",
      "scores": {
        "chatgpt": 40.0,
        "claude": 60.0,
        "perplexity": 80.0,
        "gemini": 20.0
      },
      "overall": 50.0
    }
  ],
  "content_events": [
    {
      "id": 7,
      "event_type": "draft_posted",
      "created_at": "2026-03-12T14:30:00Z",
      "data": {
        "draft_id": 33,
        "platform": "reddit",
        "visibility_at_post": 42.0
      }
    }
  ],
  "current_scores": {
    "chatgpt": 45.0,
    "claude": 68.0,
    "perplexity": 82.0,
    "gemini": 25.0,
    "overall": 55.0
  },
  "total_drafts_targeting": 4,
  "latest_draft_posted_at": "2026-04-01T10:00:00Z"
}
```

**Query:** Join `PromptRunScore` with `TrackingRun` for the timeline. Join `ContentEvent` filtered by `prompt_id` and `event_type IN ('draft_posted', 'content_correlated')` for markers. Limit to configurable lookback (default 90 days, query param `?days=30`).

**GET `/api/results/{brand_id}/prompt/{prompt_id}/detail`**

Returns comprehensive prompt detail for the full prompt page.

```json
{
  "prompt": { "id": 42, "text": "...", "prompt_type": "standard" },
  "current_scores": { "chatgpt": 45, "claude": 68, ... },
  "score_trend": "improving",  // "improving" | "declining" | "stable"
  "timeline": [ /* same as above */ ],
  "content_events": [ /* same as above */ ],
  "drafts": [
    {
      "id": 33,
      "platform": "reddit",
      "status": "posted",
      "posted_at": "2026-03-12T14:30:00Z",
      "visibility_at_post": 42.0,
      "content_preview": "First 150 chars...",
      "score_snapshot": {
        "at_posting": 42.0,
        "current": 55.0,
        "delta": 13.0,
        "runs_since": 8
      }
    }
  ],
  "competitors": [
    {
      "name": "CompetitorX",
      "mention_rate": 0.65,
      "trend": "increasing",
      "first_seen": "2026-02-01T00:00:00Z"
    }
  ],
  "insights": [
    {
      "id": "claude_responding",
      "message": "Claude scores improved 14pp since your last posted draft",
      "severity": "positive",
      "model": "claude"
    },
    {
      "id": "gemini_stagnant",
      "message": "Gemini hasn't responded to content activity — consider focusing elsewhere",
      "severity": "warning",
      "model": "gemini"
    }
  ],
  "recent_responses": [
    {
      "model": "claude",
      "response_text": "...",
      "mentioned": true,
      "sentiment": "positive",
      "created_at": "2026-04-06T08:00:00Z"
    }
  ]
}
```

**GET `/api/results/{brand_id}/prompts/overview`**

Returns summary data for all prompts — feeds the mini sparklines on the brand tracker page. Lightweight: only latest scores + mini timeline (last 10 runs) + draft count per prompt.

```json
{
  "prompts": [
    {
      "prompt_id": 42,
      "prompt_text": "Best project management tool...",
      "current_overall": 55.0,
      "trend": "improving",
      "sparkline": [40, 42, 45, 48, 50, 52, 50, 53, 54, 55],
      "model_scores": { "chatgpt": 45, "claude": 68, ... },
      "drafts_posted": 3,
      "last_draft_at": "2026-04-01T10:00:00Z",
      "has_recent_content_event": true
    }
  ]
}
```

### 4b. Heuristic Engine

A pure function module `backend/app/services/heuristic_service.py` that takes prompt timeline data and returns insight objects. Called by the prompt detail endpoint. No LLM calls — just rules.

**Initial heuristic rules:**

| ID | Rule | Trigger condition | Severity |
|----|------|-------------------|----------|
| `model_responding` | Model score improved >=10pp within 3 runs after a draft_posted event | ContentEvent correlation | `positive` |
| `model_stagnant` | >=3 drafts posted targeting this prompt, but model score hasn't moved >=5pp | DraftAttribution.delta < 5 && runs_since >= 3 | `warning` |
| `score_dropping` | Overall prompt score declined >=8pp over last 5 runs | PromptRunScore trend | `negative` |
| `model_gap` | One model scores >=30pp higher than another for same prompt | PromptRunScore latest | `info` |
| `inactive_prompt` | No content has targeted this prompt in >=30 days | ContentEvent absence | `info` |
| `competitor_rising` | A competitor's mention rate increased >=20pp on this prompt over last 5 runs | CompetitorMention trend | `warning` |

**Output format:**
```python
@dataclass
class Insight:
    id: str           # heuristic rule ID
    message: str      # human-readable message
    severity: str     # 'positive' | 'warning' | 'negative' | 'info'
    model: str | None # specific model if applicable
    prompt_id: int
    data: dict        # raw numbers behind the insight
```

Insights are computed on-read (not stored), but a `heuristic_triggered` ContentEvent is logged for aggregate analysis — deduplicated by `(prompt_id, heuristic_id)` within a 24-hour window to prevent duplicate logging on repeat page views. This keeps the insights always fresh without stale data concerns.

### 4c. Integration Points with Existing Code

**`tracking_service.py` — after line 225 (RunModelScore creation):**
- Group `QueryResult` rows by `(prompt_id, model)`
- Insert `PromptRunScore` rows
- Compare with previous run's `PromptRunScore` to detect significant changes
- Log `score_change` ContentEvents for deltas >=5pp
- Check for `content_correlated` events (score improvement within 2 runs of a `draft_posted` event)
- Check for `competitor_appeared` / `competitor_disappeared` events (compare with previous run's CompetitorMention)

**`content_service.py` — in `post_draft()`:**
- Log `draft_posted` ContentEvent with prompt_id, platform, visibility snapshot

**`results.py` router:**
- Add three new endpoints (timeline, detail, overview) following existing patterns
- Use same auth/ownership checks (`get_current_user`, filter by `user_id`)

---

## 5. Frontend Architecture

### 5a. New Components

**`PromptSparkline`** — Compact inline chart for prompt rows on the brand tracker/reports page.

- Recharts `AreaChart` inside `ResponsiveContainer`, height 64px
- Single gradient-filled area line showing overall score trend
- Small circular markers (r=3) at draft-posted events, colored `var(--accent)`
- No axes, no labels — pure sparkline. Hover tooltip shows date + score
- Uses same gradient/tooltip patterns as existing `TrendChart`

**`PromptImpactTimeline`** — Full-size interactive chart for the prompt detail page.

- Recharts `ComposedChart` inside `ResponsiveContainer`, height 320px
- One `Line` per model (color-coded using existing `--color-{model}` variables, dashed `strokeDasharray="4 2"`)
- One `Area` for overall score (gradient fill, indigo accent)
- `ReferenceLine` vertical dashed lines at each draft-posted event, with custom label component
- Timeframe selector matching existing pattern: 7d | 30d | 90d | all
- Model toggle in legend (clickable, matches `TrendChart` pattern)
- Custom glassmorphic tooltip matching existing pattern

**Draft marker design on the timeline:**
- Vertical dashed line (`stroke: var(--accent-light)`, `strokeDasharray: "3 3"`, `opacity: 0.6`)
- Small diamond icon at the top of the line (SVG, 10x10px)
- On hover: tooltip showing draft title, platform badge, date posted, visibility at time of posting
- On click: navigate to draft detail
- Multiple markers close together should not overlap — collapse into a grouped indicator showing count

**`PromptInsightCard`** — Displays a single heuristic insight.

- Left border colored by severity: `var(--success)` for positive, `var(--warning)` for warning, `var(--danger)` for negative, `var(--accent)` for info
- Icon matching severity (TrendingUp, AlertTriangle, TrendingDown, Info from lucide-react)
- Message text in `var(--text-primary)`
- Model badge if model-specific (using existing model color pills)
- Compact: single line with icon + text + optional badge. No card wrapper — these stack cleanly in a list

**`PromptDetailPage`** — The full dedicated page for a single prompt.

Route: `/tracker/[brandId]/prompt/[promptId]`

### 5b. Prompt Detail Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to [Brand Name]                                     │
│                                                              │
│  "Best project management tool for startups"                 │
│  ─────────────────────────────────────────                   │
│  Overall: 55%  ▲ +6pp (30d)                                 │
│                                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                       │
│  │GPT   │ │Claude│ │Perp  │ │Gemini│  ← model score pills  │
│  │ 45%  │ │ 68%  │ │ 82%  │ │ 25%  │     with model color  │
│  │ ▲+3  │ │ ▲+14 │ │ ▲+2  │ │ ──0  │     left borders      │
│  └──────┘ └──────┘ └──────┘ └──────┘                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ IMPACT TIMELINE ─────────────────────────────────────┐  │
│  │  7d  30d  [90d]  all                                   │  │
│  │                                                        │  │
│  │  100%│       📄           📄                           │  │
│  │      │   ╱───────╲   ╱──────────                      │  │
│  │   50%│──╱         ╲─╱                                  │  │
│  │      │╱                                                │  │
│  │    0%│──────────────────────────── time                │  │
│  │      Jan     Feb     Mar     Apr                       │  │
│  │                                                        │  │
│  │  ── Overall  -- ChatGPT  -- Claude  -- Perplexity     │  │
│  │  -- Gemini   📄 Draft posted                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                       │
│  INSIGHTS            │  CONTENT ACTIVITY                     │
│  ┃ ▲ Claude scores   │                                       │
│  ┃   improved 14pp   │  📄 Reddit FAQ draft                  │
│  ┃   since last post │     Posted Mar 12 · +13pp since       │
│  ┃                   │                                       │
│  ┃ ⚠ Gemini hasn't  │  📄 Quora comparison response          │
│  ┃   responded to    │     Posted Feb 28 · +2pp since        │
│  ┃   content activity│                                       │
│  ┃                   │  📄 Medium deep-dive                   │
│  ┃ ℹ ChatGPT scores │     Draft · Not yet posted            │
│  ┃   30pp below      │                                       │
│  ┃   Claude          │                                       │
│                      │                                       │
├──────────────────────┴──────────────────────────────────────┤
│                                                              │
│  COMPETITOR PRESENCE                                         │
│  ┌────────────────┬──────┬──────┬──────┬──────┐             │
│  │ Competitor      │ GPT  │Claude│ Perp │Gemini│             │
│  ├────────────────┼──────┼──────┼──────┼──────┤             │
│  │ CompetitorX    │  65% │  40% │  70% │  55% │  ▲ rising  │
│  │ CompetitorY    │  30% │  20% │  45% │  10% │  ── stable │
│  └────────────────┴──────┴──────┴──────┴──────┘             │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  RECENT AI RESPONSES                                         │
│  ┌─ Claude ─────────────────────────────────────────────┐   │
│  │ "For startups looking for project management, I'd     │   │
│  │  recommend considering [BrandName] for its..."        │   │
│  │  ✓ Mentioned · Positive · Apr 6                       │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌─ ChatGPT ────────────────────────────────────────────┐   │
│  │ "There are several great options for startups. The    │   │
│  │  most popular choices include Asana, Monday..."       │   │
│  │  ✗ Not mentioned · Neutral · Apr 6                    │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5c. Visual Design Language

**Aesthetic direction:** Refined dark analytics — consistent with existing Lumidian design. Not a new look, but a deeper, more premium expression of the existing system.

**The prompt detail page should feel like opening an X-ray of a single prompt.** Everything about that prompt's health, history, and trajectory in one place. Dense but not cluttered — each section earns its space.

**Specific design choices:**

**Impact Timeline (the hero element):**
- Full-width card with extra vertical padding (28px top, 24px bottom)
- Subtle top-border gradient: `linear-gradient(90deg, var(--color-chatgpt), var(--color-claude), var(--color-perplexity), var(--color-gemini))` at 2px height, 40% opacity — a quiet nod to the multi-model nature
- Chart area background: `radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.04) 0%, transparent 70%)` — subtle glow anchoring the chart
- Draft markers: vertical lines with a soft pulse animation on the most recent one (`@keyframes pulse-marker` — opacity oscillates 0.4-0.8 over 2s, CSS only)
- Grid lines: `rgba(99,102,241,0.05)` — barely visible, just enough structure

**Model Score Pills (hero section):**
- `model-card` pattern with left border (3px, model color)
- Background: `rgba(model-color, 0.06)`
- Score in monospace (`stat-value` class)
- Delta below in smaller text, colored green/red/muted based on direction
- Hover: background brightens to `rgba(model-color, 0.12)`, border to full opacity

**Insights Panel:**
- No card wrapper — insights stack directly with 8px gap
- Each insight: `padding: 10px 14px`, left border 3px colored by severity
- Background: transparent (inherits from parent card)
- Severity icon: 16px, matching border color
- Message: `var(--text-primary)`, 14px
- Model badge inline if applicable (small pill, model color background at 15% opacity)

**Content Activity Panel:**
- Each draft entry: compact row with platform icon, title, date, and delta badge
- Posted drafts: delta shown as pill (`+13pp` in green, `-2pp` in red)
- Unposted drafts: muted text "Draft - not yet posted"
- Hover: subtle background lift matching `card-hover` pattern

**Sparklines (on brand tracker/reports page):**
- 64px height, no axes, no labels
- Gradient fill matching accent color at 15% opacity
- Draft markers as tiny dots (r=2.5) on the x-axis at the correct time position
- The sparkline replaces nothing — it's added to the existing prompt row as a new column/section

**Responsive behavior:**
- Desktop: two-column layout for Insights + Content Activity
- Tablet (<=1024px): single column, Insights above Content Activity
- Mobile (<=768px): all sections stack, chart height reduces to 240px, model pills wrap to 2x2 grid

### 5d. Navigation & Access Points

**From brand tracker / reports page:**
- Each prompt row gets a sparkline and a "View details" link/arrow
- Clicking the sparkline or the arrow navigates to `/tracker/[brandId]/prompt/[promptId]`

**From content hub (`/content/[brandId]`):**
- Drafts that target a specific prompt show a "View prompt" link
- Links to the prompt detail page for that prompt

**Back navigation:**
- "Back to [Brand Name]" link at top of prompt detail page
- Returns to the reports/tracker page (use `router.back()` with fallback to `/reports`)

### 5e. New API Client Methods

Add to `frontend/lib/api.ts`:

```typescript
// Prompt timeline for sparklines (lightweight)
export async function getPromptsOverview(brandId: number): Promise<PromptsOverviewResponse> {
  return dedupedGet(`/results/${brandId}/prompts/overview`);
}

// Full prompt timeline for detail page
export async function getPromptTimeline(
  brandId: number, promptId: number, days?: number
): Promise<PromptTimelineResponse> {
  const params = days ? `?days=${days}` : '';
  return dedupedGet(`/results/${brandId}/prompt/${promptId}/timeline${params}`);
}

// Comprehensive prompt detail
export async function getPromptDetail(
  brandId: number, promptId: number
): Promise<PromptDetailResponse> {
  return dedupedGet(`/results/${brandId}/prompt/${promptId}/detail`);
}
```

---

## 6. Integration Checklist — No Loose Ends

### Backend hooks (existing files modified):

| File | Change | Why |
|------|--------|-----|
| `models.py` | Add `PromptRunScore` and `ContentEvent` models | New tables |
| `database.py` | Add CREATE TABLE + index migrations at bottom of `run_migrations()` | Schema setup |
| `tracking_service.py` | After line 225: compute + insert `PromptRunScore` rows. After line 368 (draft attribution): log `score_change` and `content_correlated` ContentEvents | Populate time-series data |
| `content_service.py` | In `post_draft()` after line 482: log `draft_posted` ContentEvent | Capture content events |
| `routers/results.py` | Add 3 new endpoints (timeline, detail, overview) | API surface |
| `schemas.py` | Add Pydantic response models for new endpoints | Validation |

### New backend files:

| File | Purpose |
|------|---------|
| `services/heuristic_service.py` | Pure-function heuristic engine, no DB writes, no LLM calls |

### Frontend hooks (existing files modified):

| File | Change | Why |
|------|--------|-----|
| `lib/api.ts` | Add 3 new API methods + TypeScript interfaces | API client |
| `app/reports/page.tsx` | Add sparkline to each prompt row, add click-through to prompt detail | Entry point |

### New frontend files:

| File | Purpose |
|------|---------|
| `components/PromptSparkline.tsx` | Compact 64px inline chart with draft markers |
| `components/PromptImpactTimeline.tsx` | Full-size interactive chart for detail page |
| `components/PromptInsightCard.tsx` | Single heuristic insight display |
| `app/tracker/[brandId]/prompt/[promptId]/page.tsx` | Prompt detail page |

### What is NOT changing:

- Existing `TrendChart` component — untouched, the new charts are separate components
- Existing `ContentAttribution` / `DraftAttribution` models — still used as-is; `ContentEvent` supplements, doesn't replace
- Existing tracking run flow — only additive changes (inserting PromptRunScore after existing RunModelScore insert)
- Existing draft generation flow — only additive (logging ContentEvent after existing post_draft logic)
- Existing routes — no URL changes, no redirects

### Backfill strategy:

On first deploy, `PromptRunScore` will be empty for historical runs. Two options:
1. **Backfill script** — iterate through historical `QueryResult` rows grouped by `(tracking_run_id, prompt_id, model)`, compute scores, insert `PromptRunScore` rows. Run once after migration.
2. **Lazy backfill** — when the timeline endpoint is called and finds no `PromptRunScore` data, fall back to aggregating from `QueryResult` on-the-fly. Slower but no migration script needed.

**Recommendation:** Option 1 (backfill script) — run it as a one-time startup task or management command. The timeline graphs look sad when empty, and users already have historical data worth showing.

---

## 7. Moat Mechanics Summary

**Stickiness (A):** Each prompt accumulates a rich timeline of scores + content events + insights. This history can't be exported or rebuilt elsewhere. The longer a user tracks, the more valuable their account becomes.

**Network effect (C):** The `ContentEvent` table silently accumulates data across all users. When the user base grows, aggregate patterns ("FAQ content improves Claude scores 68% of the time") become statistically significant and can power recommendation engines. Layer 3 (aggregate intelligence) plugs into the same `PromptInsightCard` UI slots without any frontend changes.

**Technical difficulty (B):** Competitors would need to build: (1) content drafting pipeline, (2) post tracking workflow, (3) per-prompt time-series scoring, (4) event correlation engine, (5) heuristic system — AND accumulate months of longitudinal data. This is a 3-6 month effort for a competitor starting from zero.

---

## 8. Future Extensions (Not in Scope, But Designed For)

- **LLM-powered strategic briefs** — replace heuristic insights with natural-language analysis. Same UI slots, different engine behind them.
- **Cross-user benchmarks** — "Your prompt scores in the top quartile for SaaS brands." Requires enough users per vertical.
- **Prompt discovery** — auto-suggest new prompts based on what's working for similar brands. Uses `ContentEvent` aggregate data.
- **Content recipe recommendations** — "Brands that published FAQ content saw 2x impact on Claude." Powered by `content_correlated` events across users.
- **Email digest** — weekly prompt performance summary with top insights. Uses heuristic output.

These all consume the same data infrastructure being built now. No schema changes needed — only new service logic reading from `PromptRunScore` and `ContentEvent`.
