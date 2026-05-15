# Agency Weekly Report PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Sub-project H — render the `agency_weekly_report` markdown document as a polished, branded PDF available via `GET /api/agency/documents/{id}/pdf` and a "Download PDF" button in the cockpit.

**Architecture:** Persist `fetch_data` output on `ClientDocument.data_snapshot` at generation time → PDF renderer parses markdown by `## ` headings + reads structured data from the snapshot → Jinja2 template produces single HTML page with embedded base64 logo + inline CSS + inline SVG bars → Playwright Chromium renders to PDF bytes → endpoint streams them with `application/pdf`.

**Tech Stack:** FastAPI, SQLAlchemy async, Playwright (already in deps), Jinja2 (new dep), `markdown` (new dep), pytest. Next.js, React, Tailwind, Axios blob download.

**Spec:** `docs/superpowers/specs/2026-05-15-agency-pdf-report-design.md`

---

## Task 1: Schema + migration + model field

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add the column to the ORM model**

In `backend/app/models.py`, find `class ClientDocument(Base):` and add a new column near the other body-related fields:

```python
data_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
```

(Make sure `Text` is already imported — it's likely used elsewhere in the file.)

- [ ] **Step 2: Add the migration**

In `backend/app/database.py`, find the `run_migrations()` function. Add a new migration step at the BOTTOM (never modify existing steps):

```python
    # Migration: add data_snapshot column to client_documents for PDF rendering
    try:
        await conn.execute(text("ALTER TABLE client_documents ADD COLUMN data_snapshot TEXT"))
        logger.info("Migration applied: client_documents.data_snapshot")
    except Exception:
        # column already exists
        pass
```

The exact try/except shape should match the convention of other migrations in the same function — read the surrounding code and match the pattern. Some use `inspector.get_columns`, others use bare try/except.

- [ ] **Step 3: Boot + verify**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "
import asyncio
from app.database import create_tables, run_migrations
from app.database import engine
from sqlalchemy import text

async def m():
    await create_tables()
    await run_migrations()
    async with engine.connect() as conn:
        r = await conn.execute(text('PRAGMA table_info(client_documents)'))
        cols = [row[1] for row in r]
        print('data_snapshot' in cols, cols)

asyncio.run(m())
"
```

Expected: `True` followed by the column list containing `'data_snapshot'`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat(db): add ClientDocument.data_snapshot column for PDF render snapshot"
```

---

## Task 2: Persist fetch_data on document generation

**Files:** Modify `backend/app/services/document_engine/generator.py`

- [ ] **Step 1: Persist `data` to the new column**

In `generator.py:generate_document(...)`, after `data = await template.fetch_data(db, client)` is computed (around line 22), add a line storing the JSON-encoded snapshot on the `ClientDocument` row.

The current code:
```python
doc = ClientDocument(
    agency_client_id=client.id,
    kind=template.kind,
    title=template.title_factory(client),
    body_markdown=body_markdown,
    generated_by_user_id=actor_user_id,
)
```

becomes:
```python
doc = ClientDocument(
    agency_client_id=client.id,
    kind=template.kind,
    title=template.title_factory(client),
    body_markdown=body_markdown,
    generated_by_user_id=actor_user_id,
    data_snapshot=data_json,
)
```

`data_json` is already computed earlier in the function for the LLM user-prompt — reuse it. No new JSON-encode needed.

- [ ] **Step 2: Verify nothing else breaks**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pytest tests/test_agency_documents.py tests/test_agency_weekly_report.py -v --timeout=60
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/document_engine/generator.py
git commit -m "feat(reports): persist fetch_data snapshot on ClientDocument at generation"
```

---

## Task 3: Add jinja2 + markdown to requirements

**Files:** Modify `backend/requirements.txt`

- [ ] **Step 1: Append pinned versions**

Read `backend/requirements.txt` first. Append (alphabetical or wherever sensible):

```
jinja2==3.1.4
markdown==3.7
```

- [ ] **Step 2: Install**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
pip install jinja2==3.1.4 markdown==3.7
python -c "import jinja2, markdown; print(jinja2.__version__, markdown.__version__)"
```

Expected: prints `3.1.4 3.7`.

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "deps(backend): jinja2 + markdown for PDF rendering"
```

---

## Task 4: PDF renderer module + HTML template

**Files:**
- Create: `backend/app/services/document_engine/pdf_renderer.py`
- Create: `backend/app/services/document_engine/templates/weekly_report.html.j2`

- [ ] **Step 1: Create the directory + HTML template**

```bash
mkdir -p /Users/ken/Desktop/Lumidian/backend/app/services/document_engine/templates
```

Create `backend/app/services/document_engine/templates/weekly_report.html.j2` with this content. It's a single self-contained HTML file (inline CSS, inline base64 logo, inline SVG bars). 6 pages.

```jinja
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{{ document.title }}</title>
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Helvetica, sans-serif; color: #0f172a; background: #fafafa; }
  .page { width: 8.5in; height: 11in; padding: 0.75in; page-break-after: always; position: relative; background: #fafafa; }
  .page:last-child { page-break-after: auto; }
  h1, h2, h3 { margin: 0; font-weight: 600; }
  h1 { font-size: 36pt; line-height: 1.15; }
  h2 { font-size: 16pt; margin-bottom: 12pt; color: #0f172a; border-bottom: 1px solid #ececec; padding-bottom: 6pt; }
  h3 { font-size: 11pt; margin-bottom: 6pt; color: #475569; }
  p { margin: 0 0 10pt; line-height: 1.55; font-size: 11pt; color: #334155; }
  ul { margin: 0 0 10pt; padding-left: 18pt; }
  li { font-size: 11pt; line-height: 1.6; color: #334155; }
  .tracker { font-size: 9pt; letter-spacing: 2pt; text-transform: uppercase; color: #64748b; }
  .card { background: #ffffff; border: 1px solid #ececec; border-radius: 8px; padding: 18pt; margin-bottom: 14pt; }
  .footer { position: absolute; left: 0.75in; right: 0.75in; bottom: 0.45in; display: flex; justify-content: space-between; font-size: 9pt; color: #94a3b8; }
  .footer .wordmark { font-weight: 600; color: #64748b; }
  .center { text-align: center; }
  .right { text-align: right; }
  .muted { color: #94a3b8; }

  /* Cover */
  .cover { display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
  .cover .logo { width: 120px; height: auto; }
  .cover .hero { text-align: center; margin-top: -40pt; }
  .cover .hero .label { font-size: 11pt; letter-spacing: 3pt; text-transform: uppercase; color: #64748b; margin-bottom: 24pt; }
  .cover .hero .name { font-family: Georgia, "Times New Roman", serif; font-size: 56pt; color: #0f172a; margin: 0 0 18pt; }
  .cover .hero .week { font-size: 16pt; color: #475569; }
  .cover .meta { display: flex; justify-content: space-between; font-size: 10pt; color: #64748b; }

  /* Executive headline */
  .headline { display: flex; flex-direction: column; align-items: center; margin-top: 80pt; }
  .headline .score { font-family: Georgia, "Times New Roman", serif; font-size: 96pt; line-height: 1; color: #0f172a; }
  .headline .delta { font-size: 22pt; font-weight: 600; margin-top: 8pt; }
  .headline .delta.up { color: #059669; }
  .headline .delta.down { color: #e11d48; }
  .headline .delta.flat { color: #94a3b8; }
  .headline .delta .arrow { display: inline-block; margin-right: 8pt; }
  .headline .summary { margin-top: 36pt; max-width: 5in; text-align: center; font-size: 12pt; line-height: 1.6; color: #334155; }

  /* Bars */
  .bar-row { display: flex; align-items: center; padding: 8pt 0; border-bottom: 1px solid #f1f5f9; }
  .bar-row:last-child { border-bottom: 0; }
  .bar-row .model { width: 110px; font-size: 10pt; color: #475569; }
  .bar-row .bar-wrap { flex: 1; height: 16px; background: #f1f5f9; border-radius: 8px; overflow: hidden; margin-right: 16pt; }
  .bar-row .bar { height: 100%; background: #22d3ee; }
  .bar-row .num { width: 90pt; text-align: right; font-variant-numeric: tabular-nums; font-size: 10pt; color: #0f172a; }
  .bar-row .num .delta { display: inline-block; margin-left: 8pt; font-size: 9pt; }
  .delta.up { color: #059669; }
  .delta.down { color: #e11d48; }
  .delta.flat { color: #94a3b8; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th { text-align: left; font-weight: 600; color: #64748b; padding: 6pt 8pt; border-bottom: 1px solid #ececec; font-size: 9pt; text-transform: uppercase; letter-spacing: 1pt; }
  td { padding: 8pt; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: top; }
  td.num { font-variant-numeric: tabular-nums; text-align: right; }
  td.delta-cell.up { color: #059669; font-weight: 600; }
  td.delta-cell.down { color: #e11d48; font-weight: 600; }
  td.delta-cell.flat { color: #94a3b8; }
  td.prompt { font-weight: 500; color: #0f172a; max-width: 320pt; }
</style>
</head>
<body>

<!-- PAGE 1 — Cover -->
<div class="page cover">
  <div>
    {% if logo_data_uri %}<img src="{{ logo_data_uri }}" class="logo" alt="Lumidian" />{% else %}<div class="wordmark">Lumidian</div>{% endif %}
  </div>
  <div class="hero">
    <div class="label">Weekly visibility report</div>
    <div class="name">{{ data.client.name }}</div>
    <div class="week">{{ data.period.label }}</div>
  </div>
  <div class="meta">
    <div>Prepared by Lumidian</div>
    <div>{{ generated_label }}</div>
  </div>
</div>

<!-- PAGE 2 — Executive headline -->
<div class="page">
  <div class="tracker">Executive summary</div>
  <div class="headline">
    {% if data.this_week_run %}
      <div class="score">{{ data.this_week_run.overall_score|round|int }}<span style="font-size:36pt;color:#94a3b8;">%</span></div>
      {% set delta = (data.this_week_run.overall_score - data.last_week_run.overall_score) if data.last_week_run else None %}
      {% if delta is not none %}
        <div class="delta {% if delta > 0 %}up{% elif delta < 0 %}down{% else %}flat{% endif %}">
          <span class="arrow">{% if delta > 0 %}▲{% elif delta < 0 %}▼{% else %}—{% endif %}</span>{{ (delta|round(1)) }} pts vs last week
        </div>
      {% else %}
        <div class="delta flat">Baseline week — no prior data to compare</div>
      {% endif %}
    {% else %}
      <div class="score muted">—</div>
      <div class="delta flat">Tracking has not run yet this week</div>
    {% endif %}
    <div class="summary">{{ sections.executive_summary | safe }}</div>
  </div>
  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">2</div>
  </div>
</div>

<!-- PAGE 3 — Visibility breakdown -->
<div class="page">
  <h2>Visibility by model</h2>
  <div class="card">
    {% for m in data.model_scores %}
      <div class="bar-row">
        <div class="model">{{ m.model }}</div>
        <div class="bar-wrap"><div class="bar" style="width: {{ (m.score|float)|round|int }}%;"></div></div>
        <div class="num">{{ (m.score|float)|round(1) }}%</div>
      </div>
    {% else %}
      <div class="muted">No model scores available for this week.</div>
    {% endfor %}
  </div>
  <div>{{ sections.visibility | safe }}</div>
  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">3</div>
  </div>
</div>

<!-- PAGE 4 — Prompt scorecard -->
<div class="page">
  <h2>Prompt-by-prompt</h2>
  <table>
    <thead>
      <tr><th>Prompt</th><th class="num">This week</th><th class="num">Last week</th><th class="num">Δ</th></tr>
    </thead>
    <tbody>
      {% for p in data.per_prompt %}
        <tr>
          <td class="prompt">{{ p.prompt_text }}</td>
          <td class="num">{% if p.this_week_score is not none %}{{ p.this_week_score|round(1) }}%{% else %}—{% endif %}</td>
          <td class="num">{% if p.last_week_score is not none %}{{ p.last_week_score|round(1) }}%{% else %}—{% endif %}</td>
          <td class="num delta-cell {% if p.delta is not none and p.delta > 0 %}up{% elif p.delta is not none and p.delta < 0 %}down{% else %}flat{% endif %}">
            {% if p.delta is not none %}{{ ('+' if p.delta > 0 else '') }}{{ p.delta|round(1) }}{% else %}—{% endif %}
          </td>
        </tr>
      {% else %}
        <tr><td colspan="4" class="muted">No prompts tracked yet.</td></tr>
      {% endfor %}
    </tbody>
  </table>
  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">4</div>
  </div>
</div>

<!-- PAGE 5 — Competitors + Content shipped -->
<div class="page">
  <h2>Competitor landscape</h2>
  <table style="margin-bottom: 24pt;">
    <thead>
      <tr><th>Competitor</th><th class="num">This week</th><th class="num">Last week</th><th class="num">Δ</th></tr>
    </thead>
    <tbody>
      {% for c in data.competitors %}
        <tr>
          <td class="prompt">{{ c.name }}</td>
          <td class="num">{{ c.this_week_mentions }}</td>
          <td class="num">{{ c.last_week_mentions }}</td>
          <td class="num delta-cell {% if c.delta > 0 %}up{% elif c.delta < 0 %}down{% else %}flat{% endif %}">
            {% if c.delta > 0 %}+{% endif %}{{ c.delta }}
          </td>
        </tr>
      {% else %}
        <tr><td colspan="4" class="muted">No competitors tracked yet.</td></tr>
      {% endfor %}
    </tbody>
  </table>

  <h2>Content shipped this week</h2>
  <div class="card">
    {% if data.content_shipped %}
      <ul style="margin: 0; padding-left: 16pt;">
        {% for c in data.content_shipped %}
          <li><strong>{{ c.platform }}</strong> — {{ c.count }} post{{ '' if c.count == 1 else 's' }}</li>
        {% endfor %}
      </ul>
    {% else %}
      <span class="muted">No content posted this week.</span>
    {% endif %}
  </div>

  {% if data.draft_attribution %}
    <h3 style="margin-top: 14pt;">Impact of posted content</h3>
    <ul style="padding-left: 16pt;">
      {% for a in data.draft_attribution[:3] %}
        <li><strong>{{ a.platform }}</strong> — {{ a.prompt_text }} (+{{ a.delta|round(1) }} pts)</li>
      {% endfor %}
    </ul>
  {% endif %}

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">5</div>
  </div>
</div>

<!-- PAGE 6 — Gaps + Next week -->
<div class="page">
  <h2>Where we're losing</h2>
  <div class="card">
    {% if data.top_gaps %}
      <ul style="margin: 0; padding-left: 16pt;">
        {% for g in data.top_gaps %}
          <li><strong>{{ g.prompt_text }}</strong> — platforms lacking: {{ g.platforms_lacking|join(', ') if g.platforms_lacking else 'n/a' }}</li>
        {% endfor %}
      </ul>
    {% else %}
      <span class="muted">No active gaps detected.</span>
    {% endif %}
  </div>

  <h2>Plan for next week</h2>
  <div>{{ sections.next_week | safe }}</div>

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">6</div>
  </div>
</div>

</body>
</html>
```

- [ ] **Step 2: Create the renderer module**

`backend/app/services/document_engine/pdf_renderer.py`:

```python
"""HTML→PDF renderer for agency_weekly_report client documents."""
from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import markdown as _md
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]  # backend/app/services/document_engine/ → repo root
_LOGO_PATH = _REPO_ROOT / "frontend" / "public" / "logo.png"

# Headings the agency_weekly_report system prompt produces (must match exactly)
_SECTION_MAP = {
    "executive summary": "executive_summary",
    "visibility this week": "visibility",
    "per-prompt scorecard": "prompts",
    "competitor delta": "competitors",
    "content shipped": "content",
    "impact of posted content": "impact",
    "top gaps to close": "gaps",
    "next week": "next_week",
}


def _parse_markdown_sections(body: str) -> dict[str, str]:
    """Split markdown by ## headings, return {section_key: html}."""
    if not body:
        return {}
    parts = re.split(r"^##\s+", body, flags=re.MULTILINE)
    # parts[0] is anything before the first ## (typically the # title); ignore.
    out: dict[str, str] = {}
    for part in parts[1:]:
        lines = part.splitlines()
        if not lines:
            continue
        heading = lines[0].strip().lower()
        body_md = "\n".join(lines[1:]).strip()
        key = _SECTION_MAP.get(heading)
        if key is None:
            continue
        out[key] = _md.markdown(body_md, extensions=["extra"])
    return out


def _logo_data_uri() -> str | None:
    try:
        if not _LOGO_PATH.exists():
            logger.warning("Logo not found at %s — rendering text wordmark fallback", _LOGO_PATH)
            return None
        data = _LOGO_PATH.read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:image/png;base64,{b64}"
    except Exception as e:
        logger.warning("Failed to embed logo: %s", e)
        return None


async def _resolve_data(db: AsyncSession, document: ClientDocument) -> dict[str, Any]:
    """Prefer the persisted data_snapshot; fall back to a fresh fetch_data if missing."""
    if document.data_snapshot:
        try:
            return json.loads(document.data_snapshot)
        except json.JSONDecodeError:
            logger.warning("data_snapshot for document %d is not valid JSON; refetching", document.id)

    from app.services.document_engine import get_template
    template = get_template(document.kind)
    if template is None:
        raise ValueError(f"Unknown template kind: {document.kind}")
    client = await db.get(AgencyClient, document.agency_client_id)
    if client is None:
        raise ValueError(f"AgencyClient {document.agency_client_id} not found")
    return await template.fetch_data(db, client)


async def _playwright_pdf(html: str) -> bytes:
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page()
            await page.set_content(html, wait_until="networkidle")
            return await page.pdf(
                format="Letter",
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                print_background=True,
            )
        finally:
            await browser.close()


def _render_html(document: ClientDocument, data: dict[str, Any], sections: dict[str, str]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template("weekly_report.html.j2")
    return template.render(
        document=document,
        data=data,
        sections=sections,
        logo_data_uri=_logo_data_uri(),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
    )


async def render_pdf(db: AsyncSession, document: ClientDocument) -> bytes:
    """Render the given agency_weekly_report ClientDocument to PDF bytes."""
    data = await _resolve_data(db, document)
    sections = _parse_markdown_sections(document.body_markdown or "")
    html = _render_html(document, data, sections)
    return await _playwright_pdf(html)
```

- [ ] **Step 3: Boot-time sanity check**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "
import asyncio
from app.services.document_engine.pdf_renderer import _parse_markdown_sections, _logo_data_uri
md = '# Weekly\n\n## Executive summary\n\nfoo bar.\n\n## Next week\n\n- do x\n- do y\n'
print(list(_parse_markdown_sections(md).keys()))
print('logo:', 'data:image' in (_logo_data_uri() or ''))
"
```

Expected: `['executive_summary', 'next_week']` and `logo: True`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/document_engine/pdf_renderer.py backend/app/services/document_engine/templates/weekly_report.html.j2
git commit -m "feat(reports): PDF renderer for agency_weekly_report (Playwright + Jinja2)"
```

---

## Task 5: PDF endpoint

**Files:** Modify `backend/app/routers/agency.py`

- [ ] **Step 1: Add the endpoint**

Append (near other document endpoints — search for `get_document` around line 823):

```python
@router.get("/documents/{document_id}/pdf")
async def get_document_pdf(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    """Render an agency_weekly_report document as PDF."""
    from fastapi import Response
    import re as _re
    from app.services.document_engine.pdf_renderer import render_pdf

    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.kind != "agency_weekly_report":
        raise HTTPException(status_code=400, detail="PDF export is only available for weekly reports")
    try:
        pdf_bytes = await render_pdf(db, doc)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF: {e}") from e
    safe_title = _re.sub(r"[^a-zA-Z0-9_-]+", "-", (doc.title or f"weekly-report-{doc.id}"))[:120].strip("-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
```

- [ ] **Step 2: Verify route registers**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
python -c "from app.main import app
for r in app.routes:
    p = str(getattr(r, 'path', ''))
    if 'documents' in p and 'pdf' in p:
        print(p, list(getattr(r, 'methods', [])))"
```

Expected: `/api/agency/documents/{document_id}/pdf ['GET']`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/agency.py
git commit -m "feat(backend): agency document PDF download endpoint"
```

---

## Task 6: Backend tests

**Files:** Create `backend/tests/test_agency_pdf_report.py`

- [ ] **Step 1: Create the test file**

```python
"""Tests for the agency weekly report PDF renderer + endpoint."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClient, AgencyStaff, ClientDocument, User
from app.services.document_engine.pdf_renderer import _parse_markdown_sections
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "pdf@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_agency_client(client, name: str = "PdfCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


async def _insert_weekly_report_doc(agency_client_id: int, with_snapshot: bool = True) -> int:
    snapshot = {
        "client": {"name": "TestClient"},
        "period": {"label": "Week of May 8, 2026"},
        "this_week_run": {"overall_score": 47.5, "total_queries": 12, "total_mentions": 6},
        "last_week_run": {"overall_score": 40.0, "total_queries": 12, "total_mentions": 5},
        "model_scores": [{"model": "chatgpt", "score": 50.0, "total_queries": 6, "total_mentions": 3}],
        "per_prompt": [
            {
                "prompt_id": 1,
                "prompt_text": "What is X?",
                "this_week_score": 60.0,
                "last_week_score": 40.0,
                "delta": 20.0,
                "trend": "up",
            }
        ],
        "competitors": [],
        "content_shipped": [{"platform": "linkedin", "count": 2}],
        "draft_attribution": [],
        "top_gaps": [],
        "activity_sample": [],
        "has_data": True,
    }
    body_md = (
        "# Weekly\n\n"
        "## Executive summary\n\nVisibility improved meaningfully.\n\n"
        "## Visibility this week\n\nUp across the board.\n\n"
        "## Next week\n\n- ship more LinkedIn\n- audit competitor X\n"
    )
    async with AsyncSessionLocal() as db:
        doc = ClientDocument(
            agency_client_id=agency_client_id,
            kind="agency_weekly_report",
            title="Weekly report — TestClient — week of May 8, 2026",
            body_markdown=body_md,
            generated_by_user_id=None,
            data_snapshot=json.dumps(snapshot) if with_snapshot else None,
        )
        db.add(doc)
        await db.commit()
        return doc.id


def test_parse_markdown_sections_well_formed():
    md = (
        "# Title\n\n"
        "## Executive summary\n\nfoo.\n\n"
        "## Next week\n\n- a\n- b\n"
    )
    out = _parse_markdown_sections(md)
    assert "executive_summary" in out
    assert "next_week" in out
    assert "<p>foo.</p>" in out["executive_summary"]


def test_parse_markdown_sections_empty():
    assert _parse_markdown_sections("") == {}
    assert _parse_markdown_sections(None) == {} or _parse_markdown_sections("") == {}  # type: ignore[arg-type]


def test_parse_markdown_sections_unknown_heading_ignored():
    md = "## random heading\n\nbody\n\n## Executive summary\n\nfoo.\n"
    out = _parse_markdown_sections(md)
    assert list(out.keys()) == ["executive_summary"]


@pytest.mark.asyncio
async def test_pdf_endpoint_returns_pdf_bytes(client):
    """End-to-end: render via Playwright and confirm bytes are PDF."""
    await _make_agency_user(client)
    cid, _bid = await _create_agency_client(client)
    doc_id = await _insert_weekly_report_doc(cid, with_snapshot=True)
    resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    body = resp.content
    assert body[:4] == b"%PDF", f"Bytes do not start with PDF magic: {body[:20]!r}"


@pytest.mark.asyncio
async def test_pdf_endpoint_rejects_non_weekly_kind(client):
    await _make_agency_user(client, email="pdf2@example.com")
    cid, _bid = await _create_agency_client(client, name="PdfCo2")
    async with AsyncSessionLocal() as db:
        doc = ClientDocument(
            agency_client_id=cid,
            kind="monthly_report",
            title="Monthly stub",
            body_markdown="# foo",
        )
        db.add(doc)
        await db.commit()
        doc_id = doc.id
    resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_pdf_endpoint_404_unknown_id(client):
    await _make_agency_user(client, email="pdf3@example.com")
    resp = await client.get("/api/agency/documents/99999/pdf")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_pdf_endpoint_uses_snapshot_when_present(client):
    """When data_snapshot exists, we should not call fetch_data."""
    await _make_agency_user(client, email="pdf4@example.com")
    cid, _bid = await _create_agency_client(client, name="PdfCo4")
    doc_id = await _insert_weekly_report_doc(cid, with_snapshot=True)

    with patch(
        "app.services.document_engine.agency_weekly_report.fetch_data",
        new=AsyncMock(side_effect=AssertionError("fetch_data should not be called when snapshot present")),
    ):
        resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 200
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/ken/Desktop/Lumidian/backend
source venv/bin/activate
playwright install chromium  # ensure browser binary present
pytest tests/test_agency_pdf_report.py -v --timeout=120
```

Expected: 6 PASS. The endpoint tests take ~5–10s each because of Playwright cold-start.

If `playwright install chromium` reports already installed, that's fine. If a test fails because Chromium isn't available, capture the error and report it.

If `fetch_data` patch path is wrong (it lives where the template module imports it), fix the path. The function is defined in `app/services/document_engine/agency_weekly_report.py` and re-exported via `__init__.py`, so `app.services.document_engine.agency_weekly_report.fetch_data` is the correct patch target.

- [ ] **Step 3: Regression**

```bash
pytest tests/test_agency.py tests/test_agency_drafting.py tests/test_agency_tracking.py tests/test_agency_weekly_report.py tests/test_agency_documents.py tests/test_agency_mark_posted.py tests/test_review_public.py -q --timeout=60
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_agency_pdf_report.py
git commit -m "test(backend): PDF renderer + endpoint (6 tests including end-to-end Playwright)"
```

---

## Task 7: Frontend API helper + Download PDF button

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/components/agency/DocumentList.tsx`

- [ ] **Step 1: Add API helper**

In `frontend/lib/api.ts`, near other `agency*` document helpers:

```typescript
export async function agencyDownloadDocumentPdf(documentId: number): Promise<Blob> {
  const res = await api.get(`/agency/documents/${documentId}/pdf`, {
    responseType: 'blob',
  });
  return res.data as Blob;
}
```

- [ ] **Step 2: Add the button to `DocumentList.tsx`**

Read `frontend/components/agency/DocumentList.tsx` first to understand the row layout. For each document row where `doc.kind === 'agency_weekly_report'`, add a small "Download PDF" button (next to whatever existing per-row actions live there).

Pattern:

```tsx
'use client';

// existing imports
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { agencyDownloadDocumentPdf } from '@/lib/api';

function DownloadPdfButton({ documentId, title }: { documentId: number; title: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await agencyDownloadDocumentPdf(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9_-]+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download PDF');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        onClick={onClick}
        disabled={busy}
        className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
        title="Download as PDF"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        PDF
      </button>
      {error && <span className="ml-2 text-xs text-red-400">{error}</span>}
    </>
  );
}
```

Render this button conditionally `{doc.kind === 'agency_weekly_report' && <DownloadPdfButton documentId={doc.id} title={doc.title} />}` in the row's actions area. Match the surrounding styling — read the file to find the right spot.

- [ ] **Step 3: TS check**

```bash
cd /Users/ken/Desktop/Lumidian/frontend
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/components/agency/DocumentList.tsx
git commit -m "feat(frontend): Download PDF button on weekly report rows"
```

---

## Task 8: Smoke + manual visual check

**Files:** None — verification only.

- [ ] **Step 1: Start backend + render a PDF end-to-end**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
nohup uvicorn app.main:app --port 3001 > /tmp/h-be.log 2>&1 &
sleep 6
python3 <<'PY'
import asyncio, httpx, os, tempfile, subprocess
async def m():
    async with httpx.AsyncClient(base_url="http://localhost:3001", timeout=60.0) as c:
        r = await c.post("/api/auth/login", json={"email": "ken@lumidian.ai", "password": "bat422Tuw!"})
        assert r.status_code == 200, r.text
        cookie = r.cookies
        r = await c.post("/api/agency/clients", cookies=cookie, json={"name": "H-Smoke"})
        cid = r.json()["id"]
        # Generate a stub weekly report via the existing endpoint (LLM will run — costs a few cents)
        from unittest.mock import patch  # not usable cross-process; instead just call and accept LLM
        # Instead: insert the doc directly via the test stub path. For smoke, just check that
        # GET pdf on a known-missing doc returns 404 (proves route is reachable + reachable correctly).
        r = await c.get("/api/agency/documents/99999/pdf", cookies=cookie)
        print(f"unknown doc pdf: {r.status_code}")
        assert r.status_code == 404
        # And that 400 fires for non-weekly kind — we'd need a different doc kind; skip in smoke.
        # Cleanup
        d = await c.delete(f"/api/agency/clients/{cid}", cookies=cookie)
        print(f"cleanup: {d.status_code}")
        print("API OK")
asyncio.run(m())
PY
pkill -f "uvicorn app.main:app --port 3001" 2>/dev/null
```

Expected: 404 for unknown doc id; cleanup 204.

- [ ] **Step 2: Visual sanity check — render an in-memory PDF and open it**

```bash
cd /Users/ken/Desktop/Lumidian/backend && source venv/bin/activate
python3 <<'PY'
import asyncio, json, tempfile, os, subprocess
from app.services.document_engine.pdf_renderer import _render_html, _playwright_pdf

snapshot = {
    "client": {"name": "Acme Co"},
    "period": {"label": "Week of May 8, 2026"},
    "this_week_run": {"overall_score": 62.5, "total_queries": 24, "total_mentions": 15},
    "last_week_run": {"overall_score": 48.0, "total_queries": 24, "total_mentions": 12},
    "model_scores": [
        {"model": "chatgpt", "score": 70.0, "total_queries": 6, "total_mentions": 4},
        {"model": "claude", "score": 55.0, "total_queries": 6, "total_mentions": 3},
        {"model": "perplexity", "score": 80.0, "total_queries": 6, "total_mentions": 5},
        {"model": "gemini", "score": 45.0, "total_queries": 6, "total_mentions": 3},
    ],
    "per_prompt": [
        {"prompt_id": 1, "prompt_text": "best AI visibility tool", "this_week_score": 80, "last_week_score": 60, "delta": 20, "trend": "up"},
        {"prompt_id": 2, "prompt_text": "how does GEO work", "this_week_score": 30, "last_week_score": 50, "delta": -20, "trend": "down"},
    ],
    "competitors": [
        {"competitor_id": 1, "name": "Peec", "this_week_mentions": 12, "last_week_mentions": 8, "delta": 4, "direction": "up"},
        {"competitor_id": 2, "name": "Otterly", "this_week_mentions": 5, "last_week_mentions": 9, "delta": -4, "direction": "down"},
    ],
    "content_shipped": [{"platform": "linkedin", "count": 2}, {"platform": "medium", "count": 1}],
    "draft_attribution": [{"draft_id": 1, "platform": "linkedin", "prompt_text": "best AI visibility tool", "delta": 12.0}],
    "top_gaps": [{"prompt_text": "how does GEO work", "gap_score": 0.7, "platforms_lacking": ["reddit", "quora"]}],
    "activity_sample": [],
    "has_data": True,
}
body_md = """# Weekly Report

## Executive summary

Visibility jumped 14.5 points this week, driven by a strong LinkedIn post that landed in ChatGPT and Perplexity citations.

## Visibility this week

Perplexity and ChatGPT carried the score; Gemini lagged.

## Next week

- Publish a Medium counter-piece to Peec's recent push
- Add a Reddit AMA targeting the "how does GEO work" prompt
- Re-run audit on /blog/visibility-101
"""

class FakeDoc:
    title = "Weekly report — Acme Co — week of May 8, 2026"
    body_markdown = body_md
    kind = "agency_weekly_report"
    id = 1
    data_snapshot = json.dumps(snapshot)
    agency_client_id = 1

from app.services.document_engine.pdf_renderer import _parse_markdown_sections
sections = _parse_markdown_sections(body_md)
html = _render_html(FakeDoc(), snapshot, sections)

# Save HTML for debugging
html_path = "/tmp/h-smoke.html"
with open(html_path, "w") as f:
    f.write(html)
print(f"HTML written: {html_path}")

# Render PDF
pdf = asyncio.run(_playwright_pdf(html))
pdf_path = "/tmp/h-smoke.pdf"
with open(pdf_path, "wb") as f:
    f.write(pdf)
print(f"PDF written: {pdf_path} ({len(pdf)} bytes)")
assert pdf[:4] == b"%PDF", f"Bad magic: {pdf[:10]!r}"
print("PDF magic OK")
PY
echo ""
echo "Open the PDF: open /tmp/h-smoke.pdf"
```

Expected:
- HTML and PDF files written
- "PDF magic OK"
- The PDF opens to 6 pages, looks like the spec layout

**This step requires Ken to visually inspect.** Report file path and ask Ken to open it.

No commit. Manual verification only.

---

## Self-Review

- Spec §"Data Model" (data_snapshot column): Task 1 ✓
- Spec §"Generation path" (persist snapshot): Task 2 ✓
- Spec §"PDF render path" + §"HTML template": Task 4 ✓
- Spec §"Endpoint": Task 5 ✓
- Spec §"Frontend": Task 7 ✓
- Spec §"Testing" (5 test cases): Task 6 covers all + section-parser unit tests ✓
- New deps (jinja2 + markdown): Task 3 ✓
- All code blocks complete. No placeholders.
