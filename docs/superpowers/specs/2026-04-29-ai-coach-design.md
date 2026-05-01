# AI Visibility Coach ("Lumi") — Design Spec

**Date:** 2026-04-29
**Approach:** Brand-scoped, ephemeral, tool-using Claude Haiku 4.5 agent rendered as a side drawer with contextual entry points on each brand page. Read-only in v1; architecture forward-compatible with action tools.
**Design skills:** Emil Kowalski + Impeccable (frontend-design) for drawer/affordance UI.

---

## Problem

Lumidian users see visibility scores, gap rankings, and competitor breakdowns but often don't know what they mean. *Is 32% good? Why did it drop? What should I do?* Inline benchmarks can't fix this because scores are only meaningful relative to the prompt set the user chose — there is no shared denominator to map a score onto an absolute "good/bad" scale. Interpretation requires synthesizing several data points (own trend, competitor scores on the same prompts, prompt-set quality, per-model breakdown), which static UI elements can't deliver in a usable way.

The result: users — especially on free and starter tiers — bounce off the dashboard without understanding what their numbers say or what to do about them.

---

## Solution Overview

A brand-scoped AI assistant ("Lumi") rendered as a side drawer on brand pages. It explains scores, diagnoses changes, and recommends concrete next steps, grounded in tool calls over the user's actual data. The agent is read-only in v1: it explains and recommends; it does not act on the user's behalf.

The drawer is opened via a header button or via inline "Explain this" affordances on key data elements (the score number, content gap cards, competitor comparison rows). Inline entry points pre-seed the drawer with a context-relevant question so users don't have to formulate one.

Conversation state lives in browser-side React state. Closing and reopening the drawer in the same session preserves messages; full reload or navigation away from the brand resets. No conversation tables in the database.

---

## Goals

- Reduce confusion for new users about what their scores mean
- Surface relative context (own trend, competitors on same prompts, prompt-set quality) the static UI cannot synthesize
- End every coaching turn with a concrete next step that points to a UI surface the user can act on
- Ship a v1 small enough to validate adoption before investing in action tools or persistence

## Non-goals (v1)

- Cross-brand questions ("compare brand A and B")
- Conversation persistence across sessions / devices
- Action-taking: drafting, posting, mutating prompts/competitors, triggering runs
- Threaded multi-conversation UI (ChatGPT-style sidebar)
- Live evaluation suite (deferred to v1.1)
- Raw query-response inspection inside the agent (the existing UI does this better)

---

## Architecture

### Backend

- **New router** `routers/coach.py` mounted at `/api/coach`
  - `POST /api/coach/{brand_id}/message` — SSE streaming endpoint; body `{messages: [...]}`
  - `GET /api/coach/{brand_id}/usage` — returns `{used, limit, resets_at}` for the current user/day
- **New service** `services/coach_service.py` — owns the agentic loop: build system prompt → call Anthropic streaming → on `tool_use` dispatch and append result → loop until `end_turn` or hard cap
- **New module** `services/coach_tools.py` — declarative tool definitions (Anthropic schema) and a dispatch table mapping tool name → async Python function. Each function takes `(user_id, brand_id, **args)`, enforces ownership, queries existing models/services, and returns a token-budgeted dict.
- **Reuses** the Anthropic client setup from `services/llm_service.py` and the in-memory `_rate_store` pattern from existing routers.
- **Model:** `claude-haiku-4-5-20251001` with prompt caching on the system prompt + tool definitions.

### Frontend

- `components/coach/CoachDrawer.tsx` — slide-out drawer (Radix Dialog or custom), holds the message stream and input
- `components/coach/AskCoachButton.tsx` — small reusable inline trigger; props `{question?: string, autoSubmit?: boolean}` let it pre-seed and optionally auto-submit
- `components/coach/MessageList.tsx` — renders the message stream, including the small "tool status" pills (e.g., "Looking up your competitor scores…")
- `components/coach/UsagePill.tsx` — header pill: "X of N today"
- `components/coach/LimitHitCard.tsx` — replaces the input area when daily limit is reached
- `contexts/CoachContext.tsx` — drawer open/closed state, messages array, pre-seeded question. Mounted at the **shared brand-page layout** (the highest common Next.js layout that wraps all brand-scoped routes for a single brand). Intra-brand navigation (e.g., `/dashboard/[brandId]` → `/content/[brandId]`) preserves messages; navigating to a different brand or to a non-brand page unmounts the provider and clears state. If no shared brand layout exists today, one should be added as part of this work.
- SSE consumed via the browser `EventSource` API; three event types: `text_delta`, `tool_status`, `done`. A fourth `error` event signals fatal failures.

### No new DB tables in v1

Conversation state is React state. Future-extending to persistence is a strictly additive change (new tables; pull from React state on open if a server-side conversation exists).

---

## Tools (read-only, v1)

All tools take `brand_id` as their first argument. The dispatch wrapper substitutes the URL-bound `brand_id` over any value the model includes in its `tool_use` block, so the agent cannot be coerced into querying a different brand. All tools enforce `Brand.user_id == current_user.id` at the dispatch layer. Each tool's docstring is written for Claude to read, since tool docstrings ARE part of the agent's instructions. Each result has a token budget; oversized results are truncated with a continuation hint.

| # | Tool | When the agent should call it | Returns |
|---|------|-------------------------------|---------|
| 1 | `get_brand_overview` | First call in nearly every conversation — establishes context | name, tier (display + internal), brand_type, website_url, prompt count, list of prompts (id + text), latest run's overall_score, score 7d ago, score 30d ago, total runs |
| 2 | `get_score_breakdown` | When the user asks "why X%" or "which models / prompts are weak" | per-model score (chatgpt/claude/perplexity/gemini), per-prompt score, mention counts, denominators. Optional `run_id`; defaults to latest. |
| 3 | `get_score_trend` | When the user asks "is it getting better/worse" or "what changed" | last N runs (default 10): date, overall_score, per-model scores. Used to spot drops and inflection points. |
| 4 | `get_competitor_comparison` | When the user asks about competitors or "why am I losing" | for each competitor: name, mention rate on the same prompts, per-prompt deltas (where they win, where you win) |
| 5 | `get_content_gaps` | When the user asks "what should I do" or "where am I weak" | top N gaps by `severity_score`: prompt text, model, severity, opportunity_score, platforms_lacking, top competitor mentions on that prompt |
| 6 | `get_drafts_summary` | When the user asks about content / pending work | counts by status (draft/approved/posted), 5 most recent drafts (title, platform, status), link to the content page |
| 7 | `get_brand_profile` | When the agent needs tone/audience to give content advice | company_description, target_audience, tone_of_voice, what_not_to_say, publications. Returns null fields gracefully when unfilled. |

### Deliberate exclusions

- **No `get_query_response` tool.** Raw `QueryResult.response_text` would burn 3-5K tokens to reach a conclusion the user could scan in 10 seconds in the existing Responses UI. Agent points there instead.
- **No mutation tools in v1.** No `add_prompt`, `add_competitor`, `trigger_run`, `generate_draft`. The agent recommends these and points at the existing UI affordance; the user clicks the button.

---

## System Prompt Structure

~2-3K tokens, organized into 7 blocks, fully cacheable across turns (90% cache-read discount on Haiku 4.5):

**Block 1 — Role & mission.** "You are Lumi, the Lumidian visibility coach. Help the user understand their brand's AI visibility and recommend next steps. Diagnose before prescribing."

**Block 2 — What Lumidian does (mechanics).** Tracking runs query 4 LLMs (ChatGPT, Claude, Perplexity, Gemini) with web search. Score = mentions / total queries × 100. Mention detection is case-insensitive substring + fuzzy normalized. Tier differences (which models query for which tiers — directly mirrors the table in CLAUDE.md). Pitch brands are temporary free-tier-only.

**Block 3 — Interpretation rules.** A score is meaningless without prompt scope. NEVER call a number "good" or "bad" in absolute terms. Always frame relative to (a) the user's own trend, (b) competitor scores on the same prompts, (c) prompt-set quality. If <5 prompts, flag scores as noisy and recommend adding more before optimizing. If a single model is dragging the average, surface that explicitly. Never compare to fabricated industry averages — there are none.

**Block 4 — Coaching style.** Diagnose before prescribing — pull data with tools first. One observation + one recommendation per turn. Ask one clarifying question if intent is ambiguous (e.g., "improve" — improve where?). Flag uncertainty: "I can't tell from your data" beats guessing.

**Block 5 — Anti-patterns (explicit don'ts).**
- Don't fabricate benchmarks ("the industry average is 45%")
- Don't recommend features that don't exist (no auto-posting, no scheduling — see project memory)
- Don't dump tool data verbatim — synthesize
- AI visibility is not SEO. Don't recommend backlink building. Recommend Reddit threads, Quora answers, Wikipedia presence, expert quotes in publications, comparison content.
- Don't ask the user to do something the agent can do via tools (e.g., "go look at your competitors" when `get_competitor_comparison` is available)
- **Don't speculate on causation.** When a user asks "why did my score drop?" or "why is X happening?", you can identify *what changed* (which model, which prompt, which competitor moved) from the data, but you cannot identify *why* it changed — that would require web search you don't have access to, and even then causal attribution is speculative. Diagnose the *what* concretely; explicitly say the *why* requires investigation outside this tool (e.g., "Perplexity dropped you on prompts 3 and 5 — checking those specific responses in the Responses tab will show what they're returning instead").

**Block 6 — Few-shot examples.** 4-5 canonical exchanges:
- "Is 32% good?" → diagnose with tools, frame relative to trend + competitors, end with one concrete next step
- "Why did my score drop?" → trend + breakdown tools, identify *what changed* (which model and prompts drove the drop), explicitly note that the *why* (the underlying cause in the AI's training/web data) is not visible from inside Lumidian and point the user at the Responses tab to inspect what those models are returning instead
- "What should I do?" → gaps tool, pick highest-leverage gap, recommend platform
- "Why is competitor X beating me?" → competitor comparison, identify prompts they win, recommend content type
- "I have <5 prompts" → flag noise, recommend prompt expansion before optimization

**Block 7 — Domain heuristics.** User-supplied operational rules from running Lumidian. Seed examples to be replaced/augmented during spec review:
- "<5 prompts → scores are noisy"
- "Reddit moves Perplexity faster than Wikipedia"
- "ChatGPT search has 24-48hr cache lag"

### Refusal patterns (hard-coded in the prompt)

- Off-topic question (cooking, weather, general): "I only handle Lumidian visibility questions."
- Question about another user's brand: tools enforce ownership; agent says "I can only see your brands."
- Question that requires data the agent doesn't have access to: "I can't see [X] from your data — try [where it lives in the UI]."

### Red-flag detection on agent output

Post-process the assistant's final response with a string check for:
- Specific fabricated numbers not present in any tool result this turn (regex against tool-result JSON)
- References to non-existent features ("auto-post", "schedule", "post for me")

If detected, log a quality alarm (`AnalyticsEvent` type `coach_quality_warning`). v1: log only. v1.1: optionally regenerate.

---

## Data Flow (one turn, end-to-end)

```
1. User types in CoachDrawer, presses send.
   Frontend appends user message to React state, opens
   EventSource("/api/coach/{brand_id}/message", {messages, brand_id})

2. FastAPI route handler:
   a. Authenticates (existing get_current_user dep)
   b. Verifies Brand.user_id == current_user.id → 404 if not
   c. Checks rate limit (per-user-per-day counter)
      → 429 with {limit, used, resets_at} if exceeded
   d. Hands off to coach_service.run_turn(brand_id, messages, user)

3. coach_service.run_turn (async generator yielding SSE events):
   a. Build system prompt (cached) + tool defs (cached)
   b. Loop:
      - anthropic.messages.stream(model="claude-haiku-4-5",
          system=system_prompt, messages=messages, tools=tool_defs,
          max_tokens=4096)
      - As deltas arrive: yield SSE "text_delta"
      - When stop_reason="tool_use": for each tool_use block:
          - Yield SSE "tool_status" ("Looking up competitor scores…")
          - Dispatch tool with brand_id + user
          - Token-budget the result
          - Append tool_result to messages
      - If stop_reason="end_turn": yield "done", break
      - Hard cap: 8 tool-call cycles → force end with apology message
   c. Increment rate-limit counter on success

4. Frontend EventSource handler:
   - text_delta → append to current assistant buffer, render
   - tool_status → render small "thinking" pill
   - done → finalize message, re-enable input
   - error → show inline error, keep prior messages, allow retry

5. Drawer close:
   - Messages stay in CoachContext (React state) — reopen in same
     session restores them
   - Page navigation away from brand → context unmounts, messages lost
   - Full reload → messages lost
```

### Pre-seeded entry flow

When the user clicks an "Explain this" affordance, `AskCoachButton` calls `coach.openWith({ question, autoSubmit: true })`. The drawer opens, the question is pushed into the messages array as a user message, and `runTurn` is invoked automatically. Indistinguishable from a typed message after that.

### Concurrency

If the user sends a second message before the first stream finishes, the frontend disables the input until `done`. No queue. Backend doesn't need a lock — the SSE connection is per-request.

---

## Rate Limits

In-memory `_rate_store` keyed `coach:{user_id}:{date_utc}`. Counter resets at midnight UTC. **What counts as a "message":** one user message submitted to the coach increments the counter by 1, regardless of how many internal tool calls the agent makes in response. Failed turns (e.g., Anthropic 5xx after retry) do not increment.

| Tier (display) | Internal key | Daily cap |
|----------------|--------------|-----------|
| Free / Pitch   | `None`       | 5         |
| Starter        | `basic`      | 25        |
| Growth         | `starter`    | 75        |
| Pro            | `pro`        | 250       |

### Why Pro isn't unlimited

A 250/day cap is invisible to legitimate users (a focused coaching session is 5–15 messages). The cap exists as a backstop against misbehaving clients (script in a loop, browser extension, abuse). It is trivial to raise per-customer if a real heavy user complains; it is not trivial to recover from a multi-thousand-dollar cost spike.

### Limit-hit UX

The frontend polls `GET /api/coach/{brand_id}/usage` once when the drawer opens, plus updates locally on each successful send.

States:

- **Normal** (`used < 80% of limit`): header pill shows "X of N today" in muted text.
- **Soft warning** (`used >= 80% of limit`, e.g., 4/5 for free): pill switches to amber; tooltip on hover reads "1 message left today".
- **Limit reached** (`used >= limit`): the input area is replaced by `LimitHitCard`:
  - Headline: **"You've used all {N} messages today."**
  - Body: "Resets at midnight UTC ({user-local time})."
  - For Free / Starter / Growth: primary CTA "Upgrade for more" → `/settings/billing`
  - For Pro: copy is "Daily limit reached" + "Email support if you need more — this cap exists to prevent runaway clients."
  - Header pill turns red and reads "Limit reached"
- **429 from server mid-session** (e.g., the user opened two browser tabs): show the same `LimitHitCard` immediately, regardless of local count.

### Cost model (reference)

~$0.005 per message on Haiku 4.5 with prompt caching. Worst-case monthly per-user cost (every day at limit): Free $0.75, Starter $3.75, Growth $11.25, Pro $37.50. Negligible against tier prices. For comparison, a single tracking run is ~$0.10–0.30 in LLM calls.

---

## Hard Caps

- **8 tool-call cycles per turn** — force-end with a graceful "I'm not making progress — try rephrasing?" message. Logs an `AnalyticsEvent` so we can review failed conversations.
- **4K output tokens per Anthropic call** (`max_tokens=4096`).
- **Token budget per tool result** (per-tool, defined in `coach_tools.py`):
  - `get_brand_overview` — 1500
  - `get_score_breakdown` — 2000
  - `get_score_trend` — 1500
  - `get_competitor_comparison` — 2500
  - `get_content_gaps` — 2500
  - `get_drafts_summary` — 1500
  - `get_brand_profile` — 1500

If a result exceeds budget, the dispatch wrapper truncates and appends a continuation hint (e.g., `"…12 more competitors omitted; ask for a specific one"`). The agent learns to ask narrower questions on retry.

---

## Error Handling

| Failure | User sees | Backend behavior |
|---------|-----------|------------------|
| Anthropic 429 (rate limit) | "Coach is busy, try again in a moment" | Retry once with 5s backoff, then fail clean |
| Anthropic 5xx | Same | Retry once with 2s backoff |
| Anthropic 401 (bad/missing API key) | "Coach is unavailable — admin notified" | Log via `errors` router; don't retry |
| Tool dispatch error (DB/service issue) | Surfaces inside agent response: agent gets `{"error": "..."}` and adapts ("I had trouble fetching that — try X") | Log; agent typically explains it can't fetch |
| Tool returns oversized result | Agent gets truncated result with continuation hint | Truncation in dispatch wrapper |
| User exceeds rate limit | 429 before any LLM call; UI shows `LimitHitCard` | No LLM cost incurred |
| Agent loops past 8 tool calls | Force-end message: "I'm not making progress — try rephrasing?" | Log conversation summary for review |
| SSE connection drops mid-stream | Frontend shows "connection lost, retry"; partial assistant message preserved in state | Backend does not auto-retry — avoids double-charging |
| User has no `BrandProfile` filled in | `get_brand_profile` returns nulls; agent recommends filling it in via Brand Profile tab | n/a |
| Brand has zero tracking runs | `get_brand_overview` returns nulls; agent recommends triggering first run | n/a |

---

## Quality Strategy

**v1 (ship):**
- System prompt + tool docstrings + 4-5 few-shot examples — base quality
- User-supplied domain heuristics in Block 7 (red-lined during spec review)
- Anti-pattern enforcement in prompt
- Red-flag detection on agent output, log only

**v1.1 (post-launch, deferred):**
- Curated 20-question eval set built from real conversations over the first month. Each entry: input message, expected tools called, must-not-say phrases. Run weekly against the current system prompt.
- Optional regenerate on red-flag detection.

---

## UI Surfaces (v1)

The drawer is mounted at the brand-page layout level. Three contextual entry points seed it with a question:

1. **Main visibility score number** on `/dashboard/[brandId]` — small "?" icon next to the score → "Why is my visibility score {X}%?"
2. **Each `ContentGap` card** — small "Explain" link in the card footer → "Tell me about this gap on prompt '{prompt_text}'."
3. **Competitor comparison rows** — "Why?" link in each row → "Why is {competitor_name} outperforming us?"

Plus a generic header button on brand pages: "Ask Lumi" → opens an empty drawer.

The drawer is right-aligned, ~420px wide on desktop, full-width on mobile (slides up as a sheet). Frontend-design follows the Emil Kowalski + Impeccable skill conventions used elsewhere in the app.

### First-open experience

When the drawer opens with no messages:
- Greeting: "Hi — I'm Lumi. I help you make sense of {brand_name}'s visibility data."
- Three suggested-question chips:
  - "Is my score good?"
  - "What should I focus on?"
  - "How do I compare to competitors?"
- Clicking a chip submits it as a user message.

---

## Future Extensions (v1.1+)

### Action tools

The architecture is forward-compatible. Tool registry can take write tools without changing the loop:
- `draft_for_gap(brand_id, gap_id, platform)` — calls existing `drafting_service`
- `trigger_run(brand_id, prompt_id?)` — calls existing `tracking_service`

Gating piece of work for actions: an approval-card UX. New SSE event type `action_proposal`, an inline confirm/cancel component in the drawer, idempotency keys, and an audit log entry per executed action.

### Conversation persistence

Add `CoachConversation(brand_id, context_summary, updated_at)` and `CoachMessage(conversation_id, role, content, tool_calls, created_at)` tables. Older turns roll into `context_summary` via a Claude summarization call when length exceeds a budget. Defer until users ask for it.

### Multi-brand context

Lift the drawer to a global mount and add a `list_brands()` tool. Useful for power users juggling multiple brands.

### Eval suite

20-question test bank with golden tool-call sets and must-not-say phrases. Run weekly.

---

## Testing

Backend only (frontend has no test suite per CLAUDE.md). New file `tests/test_coach.py` matching the patterns in `tests/test_brands.py`.

**Stub Anthropic client** using the existing pattern from `tests/test_tracking_service_unit.py` (`patch("anthropic.AsyncAnthropic", return_value=fake_client)`). No live LLM calls.

Coverage:
- **Ownership:** user A cannot query user B's brand → 404 on POST and GET
- **Rate limit:** at limit, the next message returns 429 with the right body; counter resets after midnight UTC (mocked clock)
- **Tool dispatchers:** each returns the documented shape, enforces `user_id` filter, truncates oversized payloads with continuation hint
- **Agent loop:** end-to-end with stub LLM (`tool_use` → tool dispatched → `end_turn` reached); SSE events emitted in the right order
- **Tool-call cap:** stub LLM that always returns `tool_use` is force-ended at 8 cycles
- **SSE event format:** verifies `text_delta`, `tool_status`, `done` event shape
- **Refusal cases:** off-topic question, missing brand, missing API key

No live LLM calls in tests. Agent quality verification happens through the v1.1 eval set, not pytest.

---

## Open Items (to populate during implementation / spec review)

- **Block 7 domain heuristics** — user red-line during spec review
- **Refusal copy and `LimitHitCard` copy** — final wording during frontend implementation
- **Drawer width and mobile breakpoints** — settled during the Emil/Impeccable design pass
- **Tool docstring final wording** — drafted during backend implementation; will be reviewed for clarity since the agent reads them as instructions

---

## Summary

A small, focused, read-only AI coach. No new DB tables. ~7 read tools. Side drawer with contextual entry points. Brand-scoped, ephemeral, rate-limited. Forward-compatible with action tools but not building them yet. Built on Haiku 4.5 with prompt caching, ~$0.005 per message. Agent quality comes from a structured system prompt with explicit anti-patterns, few-shot examples, and user-supplied domain heuristics — supplemented post-launch by an eval suite.
