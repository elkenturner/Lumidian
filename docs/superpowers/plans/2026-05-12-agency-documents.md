# Agency Document Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Ship one-click LLM-generated documents (audit, SOW, monthly report, kickoff checklist) per agency client. Template registry under `services/document_engine/` keeps adding new types cheap.

**Architecture:** New `ClientDocument` table. Template registry = a dict of `Template` dataclasses, each declaring `fetch_data` (gathers context from existing models) + `system_prompt` + `max_tokens`. Generation service composes the prompt, calls existing `call_claude` wrapper, persists the result, emits a `document_generated` activity event. Frontend: Reports tab gets a real generator + list, global Documents stub gets a cross-client view.

**Tech Stack:** FastAPI, SQLAlchemy async, pytest, Anthropic Claude (claude-sonnet-4-6 via existing call_claude). Next.js, React, TypeScript, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-12-agency-documents-design.md`

---

## File Structure

### Backend

- **Modify:** `backend/app/models.py` — add `ClientDocument`.
- **Modify:** `backend/app/database.py` — append migrations.
- **Modify:** `backend/app/schemas.py` — document + template schemas.
- **Modify:** `backend/app/services/agency_activity.py` — `EVENT_DOCUMENT_GENERATED`.
- **Create:** `backend/app/services/document_engine/__init__.py` — exports registry + generator.
- **Create:** `backend/app/services/document_engine/registry.py` — `Template` dataclass + `TEMPLATES` dict + `register`.
- **Create:** `backend/app/services/document_engine/audit_initial.py`.
- **Create:** `backend/app/services/document_engine/sow.py`.
- **Create:** `backend/app/services/document_engine/monthly_report.py`.
- **Create:** `backend/app/services/document_engine/kickoff_checklist.py`.
- **Create:** `backend/app/services/document_engine/generator.py` — `generate_document` function.
- **Modify:** `backend/app/routers/agency.py` — 7 new endpoints.
- **Modify:** `backend/tests/conftest.py` — add `client_documents` to truncation.
- **Create:** `backend/tests/test_agency_documents.py`.

### Frontend

- **Modify:** `frontend/lib/api.ts` — types + 7 functions.
- **Modify:** `frontend/components/agency/activity-icons.tsx` — add `document_generated → FileText`.
- **Create:** `frontend/components/agency/DocumentList.tsx`.
- **Create:** `frontend/components/agency/DocumentViewer.tsx`.
- **Create:** `frontend/components/agency/GenerateDocumentButton.tsx`.
- **Modify:** `frontend/components/agency/ClientReportsTab.tsx` — replace placeholder.
- **Modify:** `frontend/app/agency/documents/page.tsx` — replace stub with real list.

---

## Task 1: Backend model + migration

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Append `ClientDocument` to `models.py`**

```python
class ClientDocument(Base):
    __tablename__ = "client_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    generated_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 2: Append migrations**

In `database.py` migrations list bottom:

```python
        # 2026-05-12: Agency documents (sub-project C)
        """CREATE TABLE IF NOT EXISTS client_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agency_client_id INTEGER NOT NULL REFERENCES agency_clients(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            body_markdown TEXT NOT NULL,
            generated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            generated_at DATETIME,
            updated_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_client_documents_client_kind ON client_documents(agency_client_id, kind, generated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_client_documents_recent ON client_documents(generated_at DESC)",
```

- [ ] **Step 3: Verify**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables, run_migrations
async def m(): await create_tables(); await run_migrations(); print('OK')
asyncio.run(m())"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(backend): ClientDocument model + migrations"
```

---

## Task 2: Schemas + event constant

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/services/agency_activity.py`

- [ ] **Step 1: Append to `schemas.py`**

```python
# ── Agency documents (sub-project C, 2026-05-12) ─────────────────────────────


class DocumentTemplateOut(BaseModel):
    kind: str
    name: str
    description: str


class DocumentOut(BaseModel):
    id: int
    agency_client_id: int
    kind: str
    title: str
    body_markdown: str
    generated_by_user_id: int | None
    generated_by_name: str | None
    generated_at: datetime
    updated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class DocumentWithClientOut(DocumentOut):
    client_id: int
    client_name: str


class DocumentGenerateIn(BaseModel):
    kind: str = Field(min_length=1, max_length=64)


class DocumentUpdateIn(BaseModel):
    body_markdown: str = Field(min_length=1, max_length=200000)
```

- [ ] **Step 2: Append event constant in `agency_activity.py`**

```python
EVENT_DOCUMENT_GENERATED = "document_generated"
```

- [ ] **Step 3: Verify**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.schemas import DocumentOut, DocumentTemplateOut, DocumentGenerateIn, DocumentUpdateIn, DocumentWithClientOut; from app.services.agency_activity import EVENT_DOCUMENT_GENERATED; print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py backend/app/services/agency_activity.py
git commit -m "feat(backend): document schemas + event constant"
```

---

## Task 3: Template registry + four templates

**Files:**
- Create: `backend/app/services/document_engine/__init__.py`
- Create: `backend/app/services/document_engine/registry.py`
- Create: `backend/app/services/document_engine/audit_initial.py`
- Create: `backend/app/services/document_engine/sow.py`
- Create: `backend/app/services/document_engine/monthly_report.py`
- Create: `backend/app/services/document_engine/kickoff_checklist.py`

- [ ] **Step 1: Create `registry.py`**

```python
"""Template registry for the document engine."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient


@dataclass(frozen=True)
class Template:
    kind: str
    name: str
    description: str
    title_factory: Callable[[AgencyClient], str]
    fetch_data: Callable[[AsyncSession, AgencyClient], Awaitable[dict]]
    system_prompt: str
    user_prompt_template: str  # python-format string with `{data_json}` slot
    max_tokens: int


TEMPLATES: dict[str, Template] = {}


def register(t: Template) -> Template:
    TEMPLATES[t.kind] = t
    return t


def get_template(kind: str) -> Template | None:
    return TEMPLATES.get(kind)


def list_templates() -> list[Template]:
    return list(TEMPLATES.values())
```

- [ ] **Step 2: Create `audit_initial.py`**

```python
"""Initial brand audit template."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile, Competitor, Prompt, TrackingRun
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    prompts: list[dict] = []
    competitors: list[dict] = []
    latest_run = None
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        prompts_q = await db.execute(select(Prompt).where(Prompt.brand_id == brand.id).limit(50))
        prompts = [{"id": p.id, "text": p.text} for p in prompts_q.scalars().all()]
        comp_q = await db.execute(select(Competitor).where(Competitor.brand_id == brand.id).limit(20))
        competitors = [{"name": c.name, "website": c.website_url} for c in comp_q.scalars().all()]
        run_q = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == brand.id, TrackingRun.status == "completed")
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        latest_run = run_q.scalar_one_or_none()

    return {
        "client": {"name": client.name, "slug": client.slug, "status": client.status},
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "brand_profile": (
            {
                "company_description": profile.company_description,
                "tone_of_voice": profile.tone_of_voice,
                "what_not_to_say": profile.what_not_to_say,
                "approved_language": profile.approved_language,
                "publications": profile.publications,
            }
            if profile
            else None
        ),
        "prompts": prompts,
        "competitors": competitors,
        "latest_run": (
            {
                "overall_score": latest_run.overall_score,
                "total_queries": latest_run.total_queries,
                "total_mentions": latest_run.total_mentions,
                "completed_at": latest_run.completed_at.isoformat() if latest_run.completed_at else None,
            }
            if latest_run
            else None
        ),
        "generated_at": datetime.utcnow().isoformat(),
        "has_data": bool(brand and (profile or prompts or latest_run)),
    }


SYSTEM_PROMPT = """You are a senior consultant writing the initial audit for a B2B SaaS client at an AI visibility agency.
Output professional, dense markdown. No filler. Use these sections:

# Initial Visibility Audit — {client.name}

## Current State
(2-3 sentence summary of where they stand. Cite the visibility score if available.)

## What's Working
(bullet list of strengths from brand profile / existing prompts / any positive scores)

## Gaps
(bullet list of weaknesses: incomplete profile fields, low-coverage prompts, missing competitor analysis, etc.)

## Recommendations (next 30 days)
(3-5 specific, prioritized actions)

## Open Questions for the Client
(2-4 things you'd ask in the kickoff call)

Keep tone direct, no hedging. If a data section is empty, explicitly say "Not yet captured" rather than inventing facts.
"""


register(
    Template(
        kind="audit_initial",
        name="Initial audit",
        description="One-page baseline assessment + recommendations",
        title_factory=lambda c: f"Initial audit — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Client data:\n```json\n{data_json}\n```",
        max_tokens=3000,
    )
)
```

- [ ] **Step 3: Create `sow.py`**

```python
"""Statement of Work template."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
    return {
        "client": {
            "name": client.name,
            "primary_contact_name": client.primary_contact_name,
            "primary_contact_email": client.primary_contact_email,
            "retainer_amount_usd": client.retainer_amount_usd,
            "retainer_started_at": client.retainer_started_at.isoformat() if client.retainer_started_at else None,
        },
        "brand": {"name": brand.name, "website_url": brand.website_url} if brand else None,
        "brand_profile": (
            {"company_description": profile.company_description, "tone_of_voice": profile.tone_of_voice}
            if profile else None
        ),
        "today": datetime.utcnow().strftime("%B %d, %Y"),
    }


SYSTEM_PROMPT = """You are drafting a Statement of Work for an AI visibility agency engagement.
Output contract-style markdown. Use these exact sections in this order:

# Statement of Work

**Client:** {client.name}
**Effective date:** {today}
**Monthly retainer:** ${retainer or "TBD"}

## 1. Engagement Summary
(2-3 sentences describing what the agency will do)

## 2. Scope of Services
(bullet list — Brand visibility tracking, weekly content drafting for Reddit/Quora/Medium, monthly client report, opportunity scanning. Include LinkedIn / X / blog posting as upcoming.)

## 3. Deliverables
(quantified per-month deliverables — e.g., "8 LinkedIn drafts/mo, 4 Medium drafts/mo, 4 Reddit/Quora replies/mo")

## 4. Term
(Monthly renewal, 30-day notice to cancel, no minimum)

## 5. Payment Terms
(Net 30, invoiced on the 1st of each month)

## 6. Termination
(Either party with 30 days written notice)

## 7. Signatures
(Two signature blocks: Agency representative + Client)

Keep professional, plain language. Do not invent terms not specified. If retainer is empty, write "TBD".
"""


register(
    Template(
        kind="sow",
        name="Statement of Work",
        description="Contract-style SOW for new engagements",
        title_factory=lambda c: f"SOW — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Engagement data:\n```json\n{data_json}\n```",
        max_tokens=4000,
    )
)
```

- [ ] **Step 4: Create `monthly_report.py`**

```python
"""Monthly client report template."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, ClientActivityEvent, ContentDraft, TrackingRun
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_start = (month_start - timedelta(days=1)).replace(day=1)

    this_run = None
    last_run = None
    drafts_by_platform: dict[str, int] = {}
    drafts_posted_this_month = 0
    activity: list[dict] = []
    if brand is not None:
        r_q = await db.execute(
            select(TrackingRun)
            .where(TrackingRun.brand_id == brand.id, TrackingRun.status == "completed", TrackingRun.completed_at >= month_start)
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        this_run = r_q.scalar_one_or_none()
        l_q = await db.execute(
            select(TrackingRun)
            .where(
                TrackingRun.brand_id == brand.id,
                TrackingRun.status == "completed",
                TrackingRun.completed_at < month_start,
                TrackingRun.completed_at >= last_month_start,
            )
            .order_by(TrackingRun.completed_at.desc())
            .limit(1)
        )
        last_run = l_q.scalar_one_or_none()
        d_q = await db.execute(
            select(ContentDraft.platform, func.count(ContentDraft.id))
            .where(
                ContentDraft.brand_id == brand.id,
                ContentDraft.status == "posted",
                ContentDraft.posted_at >= month_start,
            )
            .group_by(ContentDraft.platform)
        )
        for platform, count in d_q.all():
            drafts_by_platform[platform] = count
        drafts_posted_this_month = sum(drafts_by_platform.values())

    a_q = await db.execute(
        select(ClientActivityEvent)
        .where(
            ClientActivityEvent.agency_client_id == client.id,
            ClientActivityEvent.created_at >= month_start,
        )
        .order_by(ClientActivityEvent.created_at.asc())
        .limit(50)
    )
    activity = [
        {"event_type": e.event_type, "body": e.body, "at": e.created_at.isoformat()}
        for e in a_q.scalars().all()
    ]

    return {
        "client": {"name": client.name},
        "period": {"start": month_start.isoformat(), "end": now.isoformat(), "label": now.strftime("%B %Y")},
        "this_month_run": (
            {"overall_score": this_run.overall_score, "total_queries": this_run.total_queries}
            if this_run else None
        ),
        "last_month_run": (
            {"overall_score": last_run.overall_score, "total_queries": last_run.total_queries}
            if last_run else None
        ),
        "drafts_posted_this_month": drafts_posted_this_month,
        "drafts_by_platform": drafts_by_platform,
        "activity_events_count": len(activity),
        "activity_sample": activity[:20],
        "has_data": bool(this_run or drafts_posted_this_month or activity),
    }


SYSTEM_PROMPT = """You are writing a monthly client report for an AI visibility agency.
Output professional markdown with these sections:

# Monthly Report — {client.name} — {period.label}

## Summary
(2-3 sentences — what changed this month, in plain English)

## Visibility Change
(If both this-month and last-month runs exist: compare scores, note direction. If only one exists, state baseline. If neither, "Tracking baseline not yet established.")

## Content Shipped
(Group by platform with counts; if zero, say "No content posted this month")

## Notable Activity
(Pull 3-5 highlights from the activity sample — client approvals, drafts sent, etc.)

## Next Month
(2-3 specific recommendations for the coming month)

Keep tight, factual, no fluff.
"""


register(
    Template(
        kind="monthly_report",
        name="Monthly report",
        description="Auto-assembled summary of this month's work + visibility change",
        title_factory=lambda c: f"Monthly report — {c.name} — {datetime.utcnow().strftime('%b %Y')}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Report data:\n```json\n{data_json}\n```",
        max_tokens=3000,
    )
)
```

- [ ] **Step 5: Create `kickoff_checklist.py`**

```python
"""Kickoff checklist template — what's filled in vs what the client still owes."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, Brand, BrandProfile, Prompt
from app.services.document_engine.registry import Template, register


async def fetch_data(db: AsyncSession, client: AgencyClient) -> dict[str, Any]:
    brand_q = await db.execute(select(Brand).where(Brand.agency_client_id == client.id).limit(1))
    brand = brand_q.scalar_one_or_none()
    profile = None
    prompt_count = 0
    if brand is not None:
        prof_q = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand.id))
        profile = prof_q.scalar_one_or_none()
        c_q = await db.execute(select(func.count(Prompt.id)).where(Prompt.brand_id == brand.id))
        prompt_count = c_q.scalar_one() or 0

    return {
        "client": {
            "name": client.name,
            "primary_contact_name": bool(client.primary_contact_name),
            "primary_contact_email": bool(client.primary_contact_email),
        },
        "brand": (
            {"name": brand.name, "website_url": bool(brand.website_url)} if brand else None
        ),
        "brand_profile": (
            {
                "company_description": bool(profile.company_description),
                "tone_of_voice": bool(profile.tone_of_voice),
                "what_not_to_say": bool(profile.what_not_to_say),
                "approved_language": bool(profile.approved_language),
                "publications": bool(profile.publications),
            }
            if profile else None
        ),
        "prompt_count": prompt_count,
    }


SYSTEM_PROMPT = """You are writing a kickoff checklist for an agency client onboarding.
Output a markdown document with this structure:

# Kickoff Checklist — {client.name}

## What we have
(`- [x]` lines for each item that's already filled in)

## What the client still owes
(`- [ ]` lines for each missing piece, with a short explanation of why we need it)

## Suggested first call
(3-4 bullet points to walk through with the client)

Items to check (each becomes either a `[x]` or `[ ]` line based on the data):
- Primary contact name
- Primary contact email
- Brand website URL
- Brand profile: company description
- Brand profile: tone of voice
- Brand profile: what not to say
- Brand profile: approved language
- Brand profile: publications
- At least 10 tracked prompts (currently {prompt_count})

Keep brief and actionable.
"""


register(
    Template(
        kind="kickoff_checklist",
        name="Kickoff checklist",
        description="Onboarding checklist showing what's filled in vs what the client owes",
        title_factory=lambda c: f"Kickoff checklist — {c.name}",
        fetch_data=fetch_data,
        system_prompt=SYSTEM_PROMPT,
        user_prompt_template="Client onboarding state:\n```json\n{data_json}\n```",
        max_tokens=1500,
    )
)
```

- [ ] **Step 6: Create `__init__.py`**

```python
"""Document engine — template registry + generator."""
# Importing each template module triggers its register() call
from app.services.document_engine import (
    audit_initial,  # noqa: F401
    kickoff_checklist,  # noqa: F401
    monthly_report,  # noqa: F401
    sow,  # noqa: F401
)
from app.services.document_engine.registry import (
    TEMPLATES,
    Template,
    get_template,
    list_templates,
    register,
)

__all__ = ["TEMPLATES", "Template", "get_template", "list_templates", "register"]
```

- [ ] **Step 7: Verify registration**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.services.document_engine import list_templates; templates = list_templates(); print(len(templates)); print([t.kind for t in templates])"
```

Expected output:
```
4
['audit_initial', 'sow', 'monthly_report', 'kickoff_checklist']
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/document_engine/
git commit -m "feat(backend): document engine — registry + 4 templates"
```

---

## Task 4: Generator service

**Files:**
- Create: `backend/app/services/document_engine/generator.py`
- Modify: `backend/app/services/document_engine/__init__.py`

- [ ] **Step 1: Create `generator.py`**

```python
"""Document generation — fetch data, call LLM, persist, emit event."""
from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument
from app.services.agency_activity import EVENT_DOCUMENT_GENERATED, emit_event
from app.services.document_engine.registry import Template
from app.services.drafting.client import call_claude


async def generate_document(
    db: AsyncSession,
    *,
    client: AgencyClient,
    template: Template,
    actor_user_id: int | None,
) -> ClientDocument:
    """Fetch data → call LLM → persist + emit activity event → return the new row."""
    data = await template.fetch_data(db, client)
    data_json = json.dumps(data, default=str, indent=2)
    user_prompt = template.user_prompt_template.format(data_json=data_json)
    full_prompt = f"{template.system_prompt}\n\n{user_prompt}"

    body_markdown = await call_claude(
        full_prompt,
        max_tokens=template.max_tokens,
        model="claude-sonnet-4-6",
    )

    doc = ClientDocument(
        agency_client_id=client.id,
        kind=template.kind,
        title=template.title_factory(client),
        body_markdown=body_markdown,
        generated_by_user_id=actor_user_id,
    )
    db.add(doc)
    await db.flush()  # so we have doc.id for the event payload
    await emit_event(
        db,
        agency_client_id=client.id,
        event_type=EVENT_DOCUMENT_GENERATED,
        body=f"Generated {template.name}",
        actor_user_id=actor_user_id,
        payload={"document_id": doc.id, "kind": template.kind},
    )
    await db.commit()
    await db.refresh(doc)
    return doc
```

- [ ] **Step 2: Re-export from `__init__.py`**

Update `backend/app/services/document_engine/__init__.py` — append:

```python
from app.services.document_engine.generator import generate_document

__all__ = ["TEMPLATES", "Template", "get_template", "list_templates", "register", "generate_document"]
```

- [ ] **Step 3: Verify import**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.services.document_engine import generate_document; print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/document_engine/
git commit -m "feat(backend): document generator service"
```

---

## Task 5: Document endpoints (7)

**Files:**
- Modify: `backend/app/routers/agency.py`

- [ ] **Step 1: Update imports**

Add to existing import blocks:

```python
# Add to app.models import tuple:
ClientDocument

# Add to app.schemas import tuple:
DocumentGenerateIn, DocumentOut, DocumentTemplateOut, DocumentUpdateIn, DocumentWithClientOut

# New imports below existing ones:
from app.services.document_engine import generate_document, get_template, list_templates
```

- [ ] **Step 2: Append helper + 7 endpoints**

```python
async def _doc_to_out(db: AsyncSession, doc: ClientDocument) -> DocumentOut:
    name: str | None = None
    if doc.generated_by_user_id is not None:
        u = await db.get(User, doc.generated_by_user_id)
        name = (u.name or u.email) if u else None
    return DocumentOut(
        id=doc.id,
        agency_client_id=doc.agency_client_id,
        kind=doc.kind,
        title=doc.title,
        body_markdown=doc.body_markdown,
        generated_by_user_id=doc.generated_by_user_id,
        generated_by_name=name,
        generated_at=doc.generated_at,
        updated_at=doc.updated_at,
    )


@router.get("/document-templates", response_model=list[DocumentTemplateOut])
async def list_document_templates(
    _user: User = Depends(require_agency_staff),
):
    return [DocumentTemplateOut(kind=t.kind, name=t.name, description=t.description) for t in list_templates()]


@router.get("/clients/{client_id}/documents", response_model=list[DocumentOut])
async def list_client_documents(
    client_id: int,
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    stmt = select(ClientDocument).where(ClientDocument.agency_client_id == client_id)
    if kind:
        stmt = stmt.where(ClientDocument.kind == kind)
    stmt = stmt.order_by(ClientDocument.generated_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [await _doc_to_out(db, d) for d in rows]


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return await _doc_to_out(db, doc)


@router.post("/clients/{client_id}/documents", response_model=DocumentOut, status_code=http_status.HTTP_201_CREATED)
async def create_document(
    client_id: int,
    body: DocumentGenerateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    template = get_template(body.kind)
    if template is None:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=f"Unknown template kind: {body.kind}")
    try:
        doc = await generate_document(db, client=client, template=template, actor_user_id=user.id)
    except ValueError as e:
        # e.g., missing ANTHROPIC_API_KEY
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
    return await _doc_to_out(db, doc)


@router.patch("/documents/{document_id}", response_model=DocumentOut)
async def update_document(
    document_id: int,
    body: DocumentUpdateIn,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.body_markdown = body.body_markdown
    doc.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(doc)
    return await _doc_to_out(db, doc)


@router.delete("/documents/{document_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    await db.delete(doc)
    await db.commit()


@router.get("/documents/recent", response_model=list[DocumentWithClientOut])
async def list_recent_documents(
    limit: int = 20,
    kind: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    limit = max(1, min(limit, 100))
    stmt = (
        select(ClientDocument, AgencyClient)
        .join(AgencyClient, AgencyClient.id == ClientDocument.agency_client_id)
        .order_by(ClientDocument.generated_at.desc())
        .limit(limit)
    )
    if kind:
        stmt = stmt.where(ClientDocument.kind == kind)
    rows = (await db.execute(stmt)).all()
    results: list[DocumentWithClientOut] = []
    for doc, ac in rows:
        base = await _doc_to_out(db, doc)
        results.append(
            DocumentWithClientOut(
                **base.model_dump(),
                client_id=ac.id,
                client_name=ac.name,
            )
        )
    return results
```

- [ ] **Step 3: Verify routes**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if '/document' in p:
        print(p)"
```

Expected: 7 paths including `/api/agency/document-templates`, `/api/agency/clients/{client_id}/documents` (×2), `/api/agency/documents/{document_id}` (×3 — get/patch/delete), `/api/agency/documents/recent`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): document templates + CRUD endpoints"
```

---

## Task 6: Backend tests

**Files:**
- Modify: `backend/tests/conftest.py` — add `"client_documents"` to truncation list.
- Create: `backend/tests/test_agency_documents.py`

- [ ] **Step 1: Update conftest**

Find:
```python
            "client_activity_events", "client_review_links", "agency_tasks", "agency_staff",
```

Replace with:
```python
            "client_documents", "client_activity_events", "client_review_links", "agency_tasks", "agency_staff",
```

- [ ] **Step 2: Create `test_agency_documents.py`**

```python
"""Tests for the document engine endpoints. LLM is mocked."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, ClientActivityEvent, ClientDocument, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "docs@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_client_via_api(client, name: str = "DocCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_list_templates_returns_four(client):
    await _make_agency_user(client)
    resp = await client.get("/api/agency/document-templates")
    assert resp.status_code == 200
    kinds = {t["kind"] for t in resp.json()}
    assert kinds == {"audit_initial", "sow", "monthly_report", "kickoff_checklist"}


@pytest.mark.asyncio
async def test_generate_document_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Initial Audit\n\nMocked content."),
    ):
        resp = await client.post(
            f"/api/agency/clients/{cid}/documents",
            json={"kind": "audit_initial"},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kind"] == "audit_initial"
    assert body["body_markdown"].startswith("# Initial Audit")
    assert body["title"].startswith("Initial audit")

    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.event_type == "document_generated",
            ClientActivityEvent.agency_client_id == cid,
        )
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_generate_unknown_kind_returns_400(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "bogus"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_documents_filters_by_kind(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Doc\n"),
    ):
        await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "audit_initial"})
        await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "sow"})
    all_docs = await client.get(f"/api/agency/clients/{cid}/documents")
    assert len(all_docs.json()) == 2
    audits = await client.get(f"/api/agency/clients/{cid}/documents?kind=audit_initial")
    assert len(audits.json()) == 1
    assert audits.json()[0]["kind"] == "audit_initial"


@pytest.mark.asyncio
async def test_update_document_body(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# Original\n"),
    ):
        post = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "sow"})
    did = post.json()["id"]
    resp = await client.patch(f"/api/agency/documents/{did}", json={"body_markdown": "# Edited"})
    assert resp.status_code == 200
    assert resp.json()["body_markdown"] == "# Edited"
    assert resp.json()["updated_at"] is not None


@pytest.mark.asyncio
async def test_delete_document(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# X"),
    ):
        post = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "kickoff_checklist"})
    did = post.json()["id"]
    resp = await client.delete(f"/api/agency/documents/{did}")
    assert resp.status_code == 204
    refreshed = await db_session.get(ClientDocument, did)
    assert refreshed is None


@pytest.mark.asyncio
async def test_recent_documents_returns_with_client_name(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client, name="RecentDocCo")
    with patch(
        "app.services.document_engine.generator.call_claude",
        new=AsyncMock(return_value="# R"),
    ):
        await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "monthly_report"})
    resp = await client.get("/api/agency/documents/recent")
    assert resp.status_code == 200
    docs = resp.json()
    assert any(d["client_name"] == "RecentDocCo" for d in docs)


@pytest.mark.asyncio
async def test_no_anthropic_key_returns_503(client):
    """When ANTHROPIC_API_KEY is empty, call_claude raises ValueError; surface as 503."""
    import os
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    # Don't mock call_claude — let it bail with ValueError due to missing key in test env
    prev = os.environ.get("ANTHROPIC_API_KEY", "")
    os.environ["ANTHROPIC_API_KEY"] = ""
    try:
        resp = await client.post(f"/api/agency/clients/{cid}/documents", json={"kind": "sow"})
        assert resp.status_code == 503
    finally:
        os.environ["ANTHROPIC_API_KEY"] = prev
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_documents.py tests/test_agency_tasks.py tests/test_agency.py tests/test_review_public.py tests/test_agency_activity.py -v --timeout=60
```

Expected: 8 new + 10 + 10 + 8 + 13 = 49 total PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_agency_documents.py
git commit -m "test(backend): document engine endpoints with mocked LLM"
```

---

## Task 7: Frontend API client + icons

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/agency/activity-icons.tsx`

- [ ] **Step 1: Append to `lib/api.ts`**

```typescript
// ── Agency documents (sub-project C, 2026-05-12) ─────────────────────────────

export interface DocumentTemplate {
  kind: string;
  name: string;
  description: string;
}

export interface AgencyDocument {
  id: number;
  agency_client_id: number;
  kind: string;
  title: string;
  body_markdown: string;
  generated_by_user_id: number | null;
  generated_by_name: string | null;
  generated_at: string;
  updated_at: string | null;
}

export interface AgencyDocumentWithClient extends AgencyDocument {
  client_id: number;
  client_name: string;
}

export async function agencyListDocumentTemplates(): Promise<DocumentTemplate[]> {
  const res = await api.get<DocumentTemplate[]>('/agency/document-templates');
  return res.data;
}

export async function agencyListDocuments(clientId: number, kind?: string): Promise<AgencyDocument[]> {
  const params: Record<string, string> = {};
  if (kind) params.kind = kind;
  const res = await api.get<AgencyDocument[]>(`/agency/clients/${clientId}/documents`, { params });
  return res.data;
}

export async function agencyGetDocument(documentId: number): Promise<AgencyDocument> {
  const res = await api.get<AgencyDocument>(`/agency/documents/${documentId}`);
  return res.data;
}

export async function agencyGenerateDocument(clientId: number, kind: string): Promise<AgencyDocument> {
  const res = await api.post<AgencyDocument>(`/agency/clients/${clientId}/documents`, { kind });
  return res.data;
}

export async function agencyUpdateDocument(documentId: number, bodyMarkdown: string): Promise<AgencyDocument> {
  const res = await api.patch<AgencyDocument>(`/agency/documents/${documentId}`, { body_markdown: bodyMarkdown });
  return res.data;
}

export async function agencyDeleteDocument(documentId: number): Promise<void> {
  await api.delete(`/agency/documents/${documentId}`);
}

export async function agencyRecentDocuments(limit = 20, kind?: string): Promise<AgencyDocumentWithClient[]> {
  const params: Record<string, string | number> = { limit };
  if (kind) params.kind = kind;
  const res = await api.get<AgencyDocumentWithClient[]>('/agency/documents/recent', { params });
  return res.data;
}
```

- [ ] **Step 2: Update `activity-icons.tsx`**

Add `FileText` to the lucide-react imports. Add to the ICONS map:
```typescript
  document_generated: FileText,
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/components/agency/activity-icons.tsx
git commit -m "feat(frontend): document API methods + document_generated icon"
```

---

## Task 8: DocumentViewer + GenerateDocumentButton + DocumentList components

**Files:**
- Create: `frontend/components/agency/DocumentViewer.tsx`
- Create: `frontend/components/agency/GenerateDocumentButton.tsx`
- Create: `frontend/components/agency/DocumentList.tsx`

- [ ] **Step 1: DocumentViewer.tsx**

```tsx
'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, X } from 'lucide-react';
import { agencyDeleteDocument, agencyUpdateDocument, type AgencyDocument } from '@/lib/api';

interface Props {
  doc: AgencyDocument | null;
  onClose: () => void;
  onChange: (next: AgencyDocument) => void;
  onDelete: (id: number) => void;
}

export function DocumentViewer({ doc, onClose, onChange, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;

  const startEdit = () => {
    setBody(doc.body_markdown);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await agencyUpdateDocument(doc.id, body);
      onChange(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this document?')) return;
    setBusy(true);
    try {
      await agencyDeleteDocument(doc.id);
      onDelete(doc.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(doc.body_markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog.Root open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(90vw,900px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-lg">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] p-5">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{doc.title}</Dialog.Title>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {doc.kind} · generated{' '}
                {new Date(doc.generated_at + (doc.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
                {doc.generated_by_name && <> by {doc.generated_by_name}</>}
              </p>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-md border border-[var(--border-default)] p-2 hover:bg-[var(--bg-card)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-5">
            {editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={24}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-3 font-mono text-xs text-[var(--text-primary)]"
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--text-primary)]">
                {doc.body_markdown}
              </pre>
            )}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] p-4">
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={save}
                    disabled={busy}
                    className="rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    disabled={busy}
                    className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={copy}
                    className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={startEdit}
                    className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: GenerateDocumentButton.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, FileText, Loader2 } from 'lucide-react';
import {
  agencyGenerateDocument,
  agencyListDocumentTemplates,
  type AgencyDocument,
  type DocumentTemplate,
} from '@/lib/api';

interface Props {
  clientId: number;
  onGenerated: (doc: AgencyDocument) => void;
}

export function GenerateDocumentButton({ clientId, onGenerated }: Props) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agencyListDocumentTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const pick = async (kind: string) => {
    setGenerating(true);
    setError(null);
    try {
      const doc = await agencyGenerateDocument(clientId, kind);
      onGenerated(doc);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setError('LLM unavailable. Check that ANTHROPIC_API_KEY is set on the backend.');
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            disabled={generating}
            className="flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                Generate document
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-[280px] rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] p-1 text-sm text-[var(--text-primary)] shadow-lg"
          >
            {templates.map((t) => (
              <DropdownMenu.Item
                key={t.kind}
                onSelect={() => pick(t.kind)}
                className="cursor-pointer rounded px-3 py-2 outline-none hover:bg-[var(--bg-card)] focus:bg-[var(--bg-card)]"
              >
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{t.description}</div>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: DocumentList.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { agencyListDocuments, type AgencyDocument } from '@/lib/api';
import { DocumentViewer } from './DocumentViewer';

interface Props {
  clientId: number;
  // optional: render docs supplied externally (e.g., after a fresh generation)
  injectDoc?: AgencyDocument | null;
}

export function DocumentList({ clientId, injectDoc }: Props) {
  const [docs, setDocs] = useState<AgencyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<AgencyDocument | null>(null);

  useEffect(() => {
    agencyListDocuments(clientId)
      .then(setDocs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (injectDoc) {
      setDocs((prev) => [injectDoc, ...prev.filter((d) => d.id !== injectDoc.id)]);
      setActiveDoc(injectDoc);
    }
  }, [injectDoc]);

  return (
    <>
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Documents</h3>
        {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && docs.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">No documents yet. Generate one above.</p>
        )}
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 text-sm"
            >
              <FileText className="mt-0.5 h-4 w-4 text-[var(--text-secondary)]" />
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => setActiveDoc(d)}
                  className="text-left font-medium text-[var(--text-primary)] hover:underline"
                >
                  {d.title}
                </button>
                <div className="text-xs text-[var(--text-muted)]">
                  {d.kind} ·{' '}
                  {new Date(d.generated_at + (d.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString()}
                  {d.generated_by_name && <> · {d.generated_by_name}</>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <DocumentViewer
        doc={activeDoc}
        onClose={() => setActiveDoc(null)}
        onChange={(next) => {
          setDocs((prev) => prev.map((d) => (d.id === next.id ? next : d)));
          setActiveDoc(next);
        }}
        onDelete={(id) => setDocs((prev) => prev.filter((d) => d.id !== id))}
      />
    </>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/agency/DocumentViewer.tsx frontend/components/agency/GenerateDocumentButton.tsx frontend/components/agency/DocumentList.tsx
git commit -m "feat(frontend): document viewer + generator + list components"
```

---

## Task 9: Wire into Reports tab + global Documents page

**Files:**
- Modify: `frontend/components/agency/ClientReportsTab.tsx`
- Modify: `frontend/app/agency/documents/page.tsx`

- [ ] **Step 1: Replace `ClientReportsTab.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { DocumentList } from './DocumentList';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import type { AgencyDocument } from '@/lib/api';

interface Props {
  brandId: number | null;
  clientId?: number;
}

export function ClientReportsTab({ brandId, clientId }: Props) {
  const [justGenerated, setJustGenerated] = useState<AgencyDocument | null>(null);

  if (clientId == null) {
    return <p className="text-sm text-[var(--text-muted)]">No client context.</p>;
  }

  return (
    <div className="space-y-4 text-[var(--text-primary)]">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          Generated reports, audits, SOWs, and other documents for this client.
        </p>
        <GenerateDocumentButton clientId={clientId} onGenerated={setJustGenerated} />
      </div>
      <DocumentList clientId={clientId} injectDoc={justGenerated} />
    </div>
  );
}
```

Now update the call site in `frontend/app/agency/clients/[id]/page.tsx`:
- Find the line with `<ClientReportsTab brandId={client.brand_id} />`
- Replace with `<ClientReportsTab brandId={client.brand_id} clientId={client.id} />`

- [ ] **Step 2: Replace `frontend/app/agency/documents/page.tsx` with real list**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { agencyRecentDocuments, type AgencyDocumentWithClient } from '@/lib/api';
import { DocumentViewer } from '@/components/agency/DocumentViewer';

const KINDS = [
  { value: '', label: 'All kinds' },
  { value: 'audit_initial', label: 'Initial audit' },
  { value: 'sow', label: 'Statement of Work' },
  { value: 'monthly_report', label: 'Monthly report' },
  { value: 'kickoff_checklist', label: 'Kickoff checklist' },
];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<AgencyDocumentWithClient[]>([]);
  const [kind, setKind] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<AgencyDocumentWithClient | null>(null);

  useEffect(() => {
    setLoading(true);
    agencyRecentDocuments(50, kind || undefined)
      .then(setDocs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [kind]);

  return (
    <div className="p-8 text-[var(--text-primary)]">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && docs.length === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          No documents yet. Generate one from a client&apos;s Reports tab.
        </p>
      )}

      <ul className="space-y-2">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-sm"
          >
            <FileText className="mt-0.5 h-4 w-4 text-[var(--text-secondary)]" />
            <div className="flex-1 min-w-0">
              <button
                onClick={() => setActiveDoc(d)}
                className="text-left font-medium text-[var(--text-primary)] hover:underline"
              >
                {d.title}
              </button>
              <div className="text-xs text-[var(--text-muted)]">
                {d.kind} ·{' '}
                <Link href={`/agency/clients/${d.client_id}`} className="hover:underline">
                  {d.client_name}
                </Link>{' '}
                ·{' '}
                {new Date(d.generated_at + (d.generated_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <DocumentViewer
        doc={activeDoc}
        onClose={() => setActiveDoc(null)}
        onChange={(next) => {
          setDocs((prev) => prev.map((d) => (d.id === next.id ? { ...d, ...next } : d)));
          setActiveDoc((prev) => (prev ? { ...prev, ...next } : null));
        }}
        onDelete={(id) => setDocs((prev) => prev.filter((d) => d.id !== id))}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/agency/ClientReportsTab.tsx frontend/app/agency/clients/[id]/page.tsx frontend/app/agency/documents/page.tsx
git commit -m "feat(frontend): wire document engine into Reports tab + global Documents page"
```

---

## Task 10: End-to-end smoke test

**Files:** None — verification only.

- [ ] **Step 1: Start dev servers**

Terminal 1: `cd backend && source venv/bin/activate && uvicorn app.main:app --port 3001`
Terminal 2: `cd frontend && npm run dev -- -p 3002`

Wait for migrations.

- [ ] **Step 2: API smoke (LLM-touching)**

This DOES hit the real Anthropic API. Skip if ANTHROPIC_API_KEY is missing — fall back to backend tests for validation.

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python <<'PY'
import asyncio, httpx, os
async def m():
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("skip: ANTHROPIC_API_KEY not set"); return
    async with httpx.AsyncClient(base_url="http://localhost:3001", timeout=60.0) as c:
        r = await c.post("/api/auth/login", json={"email": "ken@lumidian.ai", "password": os.environ["ADMIN_PASSWORD"]})
        cookie = r.cookies
        r = await c.post("/api/agency/clients", cookies=cookie, json={"name": "C-Smoke"})
        cid = r.json()["id"]
        r = await c.get("/api/agency/document-templates", cookies=cookie)
        print("templates:", [t["kind"] for t in r.json()])
        r = await c.post(f"/api/agency/clients/{cid}/documents", cookies=cookie, json={"kind": "kickoff_checklist"})
        print("generated kickoff:", r.status_code, "len=", len(r.json()["body_markdown"]) if r.status_code == 201 else r.text)
        await c.delete(f"/api/agency/clients/{cid}", cookies=cookie)
    print("OK")
asyncio.run(m())
PY
```

- [ ] **Step 3: Browser smoke (skip if Playwright unavailable)**

1. Log in.
2. Visit a client's Reports tab. "Generate document" button appears.
3. Click it → dropdown shows 4 templates.
4. Pick Kickoff checklist (fastest). Loading state appears for 5-20s.
5. Document modal opens with the generated markdown.
6. Click Copy → confirm "Copied!".
7. Click Edit → change a word → Save. Modal re-renders with updated body.
8. Close modal. Document appears in the per-client list with the right title and timestamp.
9. Navigate to global `/agency/documents` page. The new document shows up filterable by kind, click → opens viewer.
10. Delete from viewer. Confirm modal, then list updates.

Stop servers when done.

---

## Self-Review

- Spec coverage: ClientDocument model (T1), schemas + event (T2), 4 templates + registry (T3), generator (T4), 7 endpoints (T5), tests (T6), frontend API + icons (T7), 3 components (T8), Reports tab + global Documents wiring (T9), smoke (T10). ✓
- Type consistency: AgencyDocument fields match across backend/frontend. ✓
- LLM mock pattern: T6 uses `unittest.mock.patch("app.services.document_engine.generator.call_claude", new=AsyncMock(...))` consistently. ✓
- Event integration: `document_generated` constant in T2, registered in `EVENT_*` exports of agency_activity, emitted in generator (T4), icon in T7. ✓
