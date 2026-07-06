# Lumi Actions + App-Wide Availability — Design

**Date:** 2026-07-05
**Status:** Approved by Ken (approach + scope), spec pending review
**Depends on:** Lumi coach overhaul (`36d9ba1` — dark restyle, error rendering, stop button)

## Goal

Let Lumi act on its own advice instead of dead-ending at "go do X yourself": propose
concrete actions the user confirms with one click, link directly into the right app
surface, and be available everywhere in the customer app instead of only on
`/dashboard`.

## Decisions already made (with Ken)

1. **Confirm-card model.** Lumi never mutates anything on its own. Write actions
   render as cards in the chat with Confirm/Cancel. Navigation links execute
   instantly (they're just links).
2. **V1 action set (core):** add/remove prompt, add/remove competitor, trigger
   tracking run, navigation deep links. NOT in v1: draft generation, opportunity
   dismissal, brand-profile edits, report generation.
3. **Architecture: client-executed confirmations (Approach A).** Proposal tools are
   read-only; the Confirm button calls the *existing* REST endpoint from
   `lib/api.ts`. No new mutation endpoints, no pending-action table, no held agent
   state. A confirmed card is a plain authenticated API call the user could already
   make in the UI, so every existing guard (ownership, tier caps, run-in-progress
   checks) applies unchanged.
4. **Ride-along improvement: app-wide Lumi** with a floating launcher + page
   context. NOT in v1: conversation persistence, suggested follow-up chips,
   per-tier model routing.

## 1. Backend — proposal tools + new SSE events

### New tools (in the existing `coach_tools.py` registry)

All use `register_tool` and the existing `_verify_brand_ownership`. None mutate.
Each does read-only pre-checks so Lumi doesn't propose doomed actions, then returns
a dict containing a `proposal` (or `link`) key plus a `status` the model can read.

| Tool | Args | Pre-checks | Proposal payload |
|---|---|---|---|
| `propose_add_prompt` | `text` (str) | strip; 5–300 chars; not a duplicate of an existing prompt (case-insensitive) | `{kind: "add_prompt", label: 'Add prompt: "…"', args: {text}}` |
| `propose_remove_prompt` | `prompt_id` (int) | prompt exists and belongs to this brand | `{kind: "remove_prompt", label: 'Remove prompt: "…"', args: {prompt_id}}` |
| `propose_add_competitor` | `name` (str) | strip; 2–100 chars; not a duplicate competitor | `{kind: "add_competitor", label: 'Track competitor: …', args: {name}}` |
| `propose_remove_competitor` | `competitor_id` (int) | competitor exists and belongs to this brand | `{kind: "remove_competitor", label: 'Stop tracking: …', args: {competitor_id}}` |
| `propose_tracking_run` | — | no `TrackingRun` with status pending/running for this brand | `{kind: "tracking_run", label: "Run a fresh tracking report", args: {}}` |
| `link_to_surface` | `surface` (enum), `entity_id` (int, optional) | surface in enum | `{link: {surface, entity_id, label}}` |

`link_to_surface` surface enum: `dashboard`, `reports`, `content_board`,
`prompts_settings`, `competitors`, `billing`, `site_audit`, `wikipedia`.
`entity_id` is carried through for future use (e.g. focusing a prompt on the
reports page) but v1 links are page-level.

Failed pre-checks return `{status: "rejected", reason: "..."}` to the model (no
event emitted) so Lumi can adjust ("you're already tracking DAT").

Tier caps are deliberately NOT pre-checked (they live in the real endpoints and in
frontend copy); if a confirm hits a cap, the card shows the API's error message.

### SSE emission (`coach_service.run_turn`)

After `dispatch_tool` returns, if the result contains `proposal`, yield
`{"type": "action_proposal", "data": {**result["proposal"], "id": tool_use_id}}`.
If it contains `link`, yield `{"type": "action_link", "data": result["link"]}`.
The full result (minus nothing — it's small) is still passed back to the model as
the `tool_result`. `tool_use_id` gives the frontend a stable card key.

Backward compatible: the frontend's `parseSSEEvent` drops unknown event names, so
an old client simply doesn't render cards.

### Page context

- `CoachMessageRequest` gains `page: str | None = Field(None, max_length=120)`.
  Sanitized: strip, drop control chars/newlines.
- `run_turn` gains `page` kwarg. When present, a **second system block without
  cache_control** is appended after the cached static block:
  `"CURRENT PAGE: the user is viewing {page} in the Lumidian app."`
  The cached prefix stays byte-identical → prompt cache unaffected.

### System prompt (`coach_prompt.py`) — new section 8: TAKING ACTIONS

Rules:
- Diagnose first; propose an action only when it follows from data you pulled.
- At most 2 proposals per turn.
- Your text answer must stand alone — cards supplement, never replace, the answer.
- Never re-propose an action the user dismissed this conversation (dismissals
  appear as "(dismissed: …)" notes in the history).
- Removals are only proposed when the user expressed intent to remove something.
- For anything you cannot do (edit profile, generate drafts, change billing), use
  `link_to_surface` instead of describing a path through menus.
- Pitch brands: prefer prompt/competitor proposals over tracking runs (guidance
  only — the tracking endpoint enforces the real limits either way).

## 2. Frontend — ActionCard in the chat flow

### Types (`lib/coach-types.ts`)

```ts
export type CoachActionKind =
  | "add_prompt" | "remove_prompt" | "add_competitor" | "remove_competitor" | "tracking_run";
export type CoachActionState = "proposed" | "working" | "done" | "failed" | "dismissed";
export interface CoachAction {
  id: string;                       // tool_use_id from the event
  kind: CoachActionKind;
  label: string;
  args: Record<string, unknown>;
  state: CoachActionState;
  error?: string;                   // API error message when failed
}
export interface CoachLink { surface: string; entityId?: number; label: string; }
```

`CoachMessage` gains `actions?: CoachAction[]` and `links?: CoachLink[]`, plus
`note?: boolean` (see outcome notes). `CoachSSEEvent` union gains
`action_proposal` and `action_link`.

### Reducer (`CoachContext`)

New actions: `append_action`, `append_link` (attach to the in-progress assistant
message), `set_action_state` (by card id, across all messages). `send` continues to
filter empty messages; outcome notes are ordinary non-empty user-role messages so
they flow into history automatically.

### ActionCard (`components/coach/ActionCard.tsx`, new)

Rendered under the assistant bubble text, design-token styled (border-subtle,
bg-card, radius-md). States:

- **proposed:** label + `Confirm` (accent) + `Dismiss` (ghost) buttons
- **working:** spinner, buttons disabled
- **done:** ✓ + label, success-text, buttons gone
- **failed:** ⚠ + API error message (danger-text), `Retry` re-runs confirm
- **dismissed:** struck/muted label

Confirm dispatches by kind to the existing client:
`addPrompt` / `deletePrompt` / `addCompetitor` / `removeCompetitor` / `triggerRun`.
On success (and on dismiss), append a muted **outcome note** to the thread as a
user-role message — `✓ Added prompt "…"` / `(dismissed: Add prompt "…")` — rendered
as a small centered chip, not a bubble (`note: true`). That's how Lumi learns the
outcome next turn with zero backend state. `tracking_run` success note includes
"run started" so Lumi doesn't immediately propose another.

Nav links render as compact `Open → {label}` buttons using a frontend
`SURFACE_ROUTES` map: dashboard `/dashboard`, reports `/reports`, content_board
`/content/{brandId}`, prompts_settings `/settings`, competitors `/settings`,
billing `/settings/billing`, site_audit `/site-audit/{brandId}`, wikipedia
`/wiki/{brandId}`. Clicking navigates (Next router) and closes the drawer.
*(Exact tab anchors within /settings verified at implementation time; page-level is
acceptable v1.)*

### Concurrency guard

Cards stay clickable after later turns, but `set_action_state("working")` guards
double-clicks, and Confirm is disabled while `state.sending` is true (avoids
mutating mid-stream).

## 3. App-wide mount + launcher

- `CoachShell` moves out of `app/dashboard/layout.tsx` (file reverts to
  pass-through or is deleted) into `AppShellInner` in `components/AppShell.tsx`,
  inside `BrandProvider` so the launcher can use `useBrand().activeBrandId`.
- New `components/coach/CoachLauncher.tsx`: fixed bottom-right circular button
  (gradient-signature bg, Sparkles icon, shadow-elevated). Visible only when
  (a) an authenticated customer surface is showing (reuse AppShell's existing
  chrome-visibility logic), (b) `activeBrandId != null`, (c) pathname doesn't start
  with `/agency` or `/admin`, (d) the drawer isn't already open. Opens via
  `open({brandId: activeBrandId})` — no auto-question, so users finally see the
  suggested-question empty state.
- Existing `AskCoachButton` call sites keep working unchanged (they pass explicit
  brandIds).
- `send` includes `page: window.location.pathname` in the request body.

## 4. Safety model (recap)

- No new mutation endpoints; no new caps. Confirm = normal authenticated API call;
  ownership, tier caps, and run-in-progress checks enforced where they already
  live. API failures surface on the card.
- Proposal tools are read-only and ownership-scoped like every existing coach tool.
- `page` is length-capped and sanitized before entering the system prompt.
- SSE additions are ignored by older clients.

## 5. Testing

**Backend (`tests/test_coach_actions.py`, new; extend `test_coach.py`):**
- Per proposal tool: happy-path payload shape; ownership rejection (other user's
  prompt_id/competitor_id); validation rejection (short text, duplicate prompt,
  run already in flight → `status: "rejected"`).
- `run_turn` emits `action_proposal` / `action_link` events when a mocked tool
  result carries `proposal` / `link` (reuse existing stream-mocking pattern).
- Page context: block appended when `page` present, absent when None; sanitization
  strips newlines; static block still carries `cache_control`.
- Router: `page` accepted, over-length rejected (422).

**Frontend:** `tsc` + eslint clean; live browser pass — ask Lumi something that
yields an add-prompt proposal, Confirm, verify the prompt appears in the brand's
prompt list, outcome note renders, second turn shows Lumi aware of it; launcher
appears on `/content/{brandId}` and opens with empty state; nav link navigates and
closes drawer.

## Out of scope (explicit)

Conversation persistence, follow-up chips, per-tier model routing, draft/report
generation actions, brand-profile edit actions, agency (`/agency/*`) surfaces,
query-param deep-link focus (e.g. `/reports?prompt=`), mid-turn blocking
confirmations (Approach C).
