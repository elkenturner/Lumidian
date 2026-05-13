# Agency Weekly Report — Design

**Date:** 2026-05-13
**Status:** Approved (autonomous mode). Sub-project G of the agency-portal-OS roadmap.

---

## Context

Sub-project F shipped per-prompt scores and a weekly tracking cadence for agency-tier brands. Agency staff now need a **shareable weekly artifact** that bundles those scores with content activity into a client-facing report. This becomes the "what changed this week" deliverable that closes the loop between tracking + drafting and the retainer client.

The existing `monthly_report` template in the document engine is too thin — it only summarizes visibility + draft counts + activity. Agency clients on a weekly cadence need more: per-prompt scorecard, competitor delta, content gaps, draft→score attribution.

## Goals

1. New `agency_weekly_report` Template in `app/services/document_engine/` — markdown, LLM-rendered, stored in `ClientDocument` (same pattern as `monthly_report`).
2. Auto-generate the report at the end of the weekly agency tracking sweep, once per agency brand per week.
3. On-demand generation via the existing `POST /api/agency/clients/{id}/documents` endpoint with `kind="agency_weekly_report"`.
4. Optional UI nudge: a dedicated "Generate weekly report" button in the cockpit Reports section that calls the existing endpoint with this kind, for staff who don't want to dig through the template list.

## Non-Goals (this sub-project)

- PDF rendering (markdown only for v1; PDF can come later if a client asks).
- Email delivery to the client (markdown viewable in the cockpit; staff share the link manually).
- Editing the report in-place beyond what the existing Documents tab already supports.
- Changing the document-engine architecture.
- Comparison vs arbitrary historical periods (the report is always "this week vs last week").

## Data Model

No schema changes. The new template is just another `kind` value in `ClientDocument.kind`.

## Backend

### 1. New template module

Create `backend/app/services/document_engine/agency_weekly_report.py`:

```python
"""Weekly comprehensive report for agency-tier clients."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AgencyClient,
    Brand,
    ClientActivityEvent,
    Competitor,
    CompetitorMention,
    ContentDraft,
    ContentGap,
    DraftAttribution,
    Prompt,
    QueryResult,
    RunModelScore,
    TrackingRun,
)
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    # Resolve the agency brand
    brand_q = await db.execute(
        select(Brand).where(Brand.agency_client_id == client.id).limit(1)
    )
    brand = brand_q.scalar_one_or_none()
    now = datetime.utcnow()
    week_start = now - timedelta(days=7)
    prev_week_start = week_start - timedelta(days=7)

    if brand is None:
        return {
            "client": {"name": client.name},
            "period": _period(now, week_start),
            "has_data": False,
        }

    this_run = await _latest_completed_run(db, brand.id, since=week_start, until=now)
    last_run = await _latest_completed_run(db, brand.id, since=prev_week_start, until=week_start)

    per_prompt = await _per_prompt_scorecard(db, brand.id, this_run, last_run)
    competitors = await _competitor_delta(db, brand.id, this_run, last_run)
    content = await _content_shipped(db, brand.id, week_start)
    attribution = await _draft_attribution(db, brand.id, week_start)
    gaps = await _top_gaps(db, brand.id, limit=3)
    activity = await _activity_sample(db, client.id, week_start)

    return {
        "client": {"name": client.name},
        "period": _period(now, week_start),
        "this_week_run": _run_summary(this_run),
        "last_week_run": _run_summary(last_run),
        "model_scores": await _model_scores(db, this_run),
        "per_prompt": per_prompt,
        "competitors": competitors,
        "content_shipped": content,
        "draft_attribution": attribution,
        "top_gaps": gaps,
        "activity_sample": activity,
        "has_data": bool(this_run or content or activity),
    }
```

Helper functions defined in the same module (kept private with leading underscore):

- `_period(now, week_start)` → `{"start": ..., "end": ..., "label": "Week of <date>"}`
- `_latest_completed_run(db, brand_id, since, until)` — returns the most recent `TrackingRun` with `status="completed"` and `completed_at` in `[since, until)`
- `_run_summary(run)` → `{"overall_score", "total_queries", "total_mentions", "completed_at"}` or `None`
- `_model_scores(db, run)` — fetches `RunModelScore` rows for the run; returns list of `{model, score, total_queries, total_mentions}`
- `_per_prompt_scorecard(db, brand_id, this_run, last_run)` — for each prompt in the brand: `{prompt_id, prompt_text, this_week_score, last_week_score, delta, trend}`. Score per prompt = `mentions / queries` across all models for that prompt within the run. Trend = `"up" | "down" | "flat"` from delta sign with a 5-pt threshold.
- `_competitor_delta(db, brand_id, this_run, last_run)` — for each competitor: this-week mentions vs last-week mentions, delta, direction
- `_content_shipped(db, brand_id, week_start)` → list of `{platform, count}`; `posted_at >= week_start` and `status="posted"`
- `_draft_attribution(db, brand_id, week_start)` — uses existing `DraftAttribution` rows: posted drafts in the last ~30 days with non-null `delta`; returns up to 5 highest-delta entries with `{draft_id, platform, prompt_text, score_at_posting, current_score, delta}`
- `_top_gaps(db, brand_id, limit)` — most recent ContentGap rows for the brand sorted by `gap_score` desc, includes `{prompt_text, gap_score, platforms_lacking}`
- `_activity_sample(db, client_id, week_start)` — up to 30 `ClientActivityEvent` rows in the window, oldest first; returns `{event_type, body, at}` dicts

All counts and lists are bounded so the JSON sent to Claude stays under ~6 KB.

### 2. System prompt + registration

```python
SYSTEM_PROMPT = """You are writing a weekly comprehensive report for an AI visibility agency client.
Output professional markdown with these exact sections (in this order):

# Weekly Report — {client.name} — {period.label}

## Executive summary
(2-3 sentences — the headline of what happened this week.)

## Visibility this week
(Overall score this week vs last week, direction, per-model breakdown table.
If `last_week_run` is null: "Baseline week — no prior data to compare." If both null: "Tracking has not run yet this week.")

## Per-prompt scorecard
(Markdown table of prompts ordered worst → best for this week. Columns: Prompt | This week | Last week | Δ | Trend.
If a prompt has no data this week, show "—".)

## Competitor delta
(For each competitor: their this-week mention count vs last-week, direction. If no competitors tracked, say "No competitors tracked yet.")

## Content shipped
(Group by platform with counts. If zero, say "No content posted this week.")

## Impact of posted content
(For drafts with non-zero attribution delta this week, list 3-5 highest-delta items: platform + prompt + score lift. If empty, say "Not enough runs since posting to attribute impact yet.")

## Top gaps to close
(List the top 3 gap_score prompts. For each: prompt text + platforms_lacking. If none, say "No active gaps detected.")

## Next week
(2-3 specific, actionable recommendations based on the data above.)

Stay tight, factual, no fluff. Numbers should be exact from the data — don't round visibility scores. Don't invent prompts, competitors, or events that aren't in the data.
"""

register(
    Template(
        kind="agency_weekly_report",
        name="Weekly report (agency)",
        description="Comprehensive weekly recap: visibility, per-prompt scores, competitors, content, gaps.",
        title_factory=lambda c: f"Weekly report — {c.name} — week of {datetime.utcnow().strftime('%b %d, %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Report data:\n```json\n{data_json}\n```",
        max_tokens=4000,
    )
)
```

### 3. Wire into `__init__.py`

In `backend/app/services/document_engine/__init__.py`, add the import alongside `monthly_report`:

```python
from app.services.document_engine import (
    audit_initial,  # noqa: F401
    agency_weekly_report,  # noqa: F401
    kickoff_checklist,  # noqa: F401
    monthly_report,  # noqa: F401
    sow,  # noqa: F401
)
```

### 4. Auto-generation hook on the weekly sweep

Modify `backend/app/scheduler.py` `_run_all_agency_brands` to wrap each per-brand task: after `_safe_run` completes for an agency brand, kick off a document-generation task using the new template.

Cleanest path: define a helper next to `_run_all_agency_brands`:

```python
async def _run_agency_brand_and_report(brand_id: int, client_id: int) -> None:
    """Run weekly tracking for an agency brand, then auto-generate the weekly report. Non-fatal."""
    await _safe_run(brand_id, "weekly")
    try:
        from app.database import AsyncSessionLocal
        from app.models import AgencyClient
        from app.services.document_engine import generate_document, get_template

        template = get_template("agency_weekly_report")
        if template is None:
            return
        async with AsyncSessionLocal() as db:
            client = await db.get(AgencyClient, client_id)
            if client is None:
                return
            await generate_document(db, client=client, template=template, actor_user_id=None)
    except Exception as e:
        logger.error("Weekly agency report generation failed for brand %d: %s", brand_id, e)
```

Then in `_run_all_agency_brands`, change the existing `asyncio.create_task(_safe_run(brand.id, "weekly"), ...)` to:

```python
asyncio.create_task(
    _run_agency_brand_and_report(brand.id, brand.agency_client_id),
    name=f"tracking-agency-{brand.id}",
)
```

This keeps tracking failure-isolated from report failure (report errors logged, don't raise).

### 5. Cockpit "Generate weekly report" shortcut button

In `backend/app/routers/agency.py`, **no new endpoint** — the existing `POST /api/agency/clients/{id}/documents` already accepts `{"kind": "agency_weekly_report"}` via the registry.

## Frontend

### 1. New API client method (optional but tidy)

Add to `frontend/lib/api.ts` next to the existing `agency*` helpers:

```typescript
export async function agencyGenerateWeeklyReport(clientId: number): Promise<ClientDocumentOut> {
  const res = await api.post<ClientDocumentOut>(
    `/agency/clients/${clientId}/documents`,
    { kind: "agency_weekly_report" },
  );
  return res.data;
}
```

If the cockpit Documents tab already has a generic generate-by-kind helper, reuse that and skip this method.

### 2. "Generate weekly report" button in cockpit Reports section

In `frontend/components/agency/ClientCockpit.tsx`, locate the Reports / Documents section (it currently lists generated documents). Add a button alongside the section title that:

- Calls `agencyGenerateWeeklyReport(client.id)` on click
- Shows a spinner while in flight (10-30s LLM call)
- On success: bumps a `docsRefreshKey` to remount the documents list so the new report appears
- On 503 ("ANTHROPIC_API_KEY missing"): shows the existing error pattern

If the Reports section is not already a separate component, leave the section-finding to the implementer with a grep for `documents` or `report`.

## Testing

- Backend test: `agency_weekly_report` template is registered → `get_template("agency_weekly_report")` returns it.
- Backend test: `fetch_data` returns expected keys when brand has zero tracking + zero content (empty-state path).
- Backend test: `fetch_data` returns expected keys when brand has at least one completed run + one posted draft in the week (happy-path shape check; uses test fixtures).
- Backend test: `_run_agency_brand_and_report` calls `_safe_run` then `generate_document` — both mocked. Verify the call order.
- Backend test: `_run_agency_brand_and_report` swallows generation errors (mock `generate_document` to raise; assert it doesn't propagate).
- Backend test: `POST /api/agency/clients/{id}/documents` with `kind="agency_weekly_report"` returns 201 (LLM mocked). No new endpoint test needed beyond the kind being accepted.

## Risks

- **LLM hallucination in the report** — system prompt explicitly says "don't invent prompts, competitors, or events." Numbers come from the JSON. Audit the first few generated reports manually before trusting auto-generation downstream.
- **Empty-state markdown** — when a brand has no tracking yet, the report risks being misleadingly polished. The fetch_data returns `has_data: False`; the prompt's per-section "if null" branches handle this. The first generated report for a brand may be very short — acceptable.
- **Cost** — Claude Sonnet generation at 4000 max tokens, weekly, per agency brand. With a handful of agency clients, negligible.
- **Race with manual generation** — if a staff member clicks "generate" while the weekly sweep is also generating, two `ClientDocument` rows are created. Acceptable; documents tab shows both with timestamps.

## Out of scope (becomes future sub-project H)

- PDF export of the weekly report
- Email delivery to client primary contact
- Versioning / diff between consecutive weekly reports
- Pinning a "current week" report to the cockpit overview
