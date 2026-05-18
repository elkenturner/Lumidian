# Agency Document System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the agency document system — design and ship PDFs for all 5 document templates plus a public client review page that doubles as the document library.

**Architecture:**
- Backend: a shared Jinja2 design system (`_base.html.j2` + `_styles.css.j2`) that all 5 PDF templates extend; generalize `pdf_renderer.py` to dispatch by `document.kind`; add 3 new public endpoints to `routers/review_public.py` for the document library; embed fonts as base64 for network-independent renders.
- Frontend: new public route `/review/[token]` that bypasses auth middleware; 6 components (review page, draft card, doc card, doc reader, empty state, revoked state); existing `lib/api.ts` extended with 3 new methods.

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · Playwright · Jinja2 · markdown · Next.js 15 App Router · React 18 · TypeScript strict · Tailwind · Radix UI · framer-motion · next/font · Instrument Serif + Inter + IBM Plex Mono (Google Fonts).

**Spec:** `docs/superpowers/specs/2026-05-18-agency-document-system-design.md`

---

## File Structure

### Backend — created
- `backend/scripts/embed_fonts.py` — one-shot script; downloads woff2 from Google Fonts CDN, base64-encodes, writes `@font-face` blocks into `_styles.css.j2`
- `backend/app/services/document_engine/templates/_styles.css.j2` — design tokens, type stack, layout primitives (the single source of truth for all PDF styling)
- `backend/app/services/document_engine/templates/_base.html.j2` — shared `<head>`, fonts via `@font-face` from `_styles`, `{% block %}` slots, logo lockup macro, footer macro
- `backend/app/services/document_engine/templates/sow.html.j2` — extends `_base`; contract personality; no cover; letterhead + numbered sections + signature block
- `backend/app/services/document_engine/templates/kickoff_checklist.html.j2` — extends `_base`; briefing personality; soft half-page cover; checklist with circle glyphs
- `backend/app/services/document_engine/templates/audit_initial.html.j2` — extends `_base`; briefing personality; soft cover; inset score card; side-by-side gaps + recs
- `backend/app/services/document_engine/templates/monthly_report.html.j2` — extends `_base`; report personality; full cover; same chassis as weekly
- `backend/app/services/document_engine/markdown_sections.py` — generalized markdown→HTML section parser; reads `SECTION_MAP` from the template module
- `backend/tests/test_document_pdf_rendering.py` — unit + smoke tests for all 5 templates
- `backend/tests/test_public_review_documents.py` — endpoint tests for the 3 new public review endpoints

### Backend — modified
- `backend/app/services/document_engine/pdf_renderer.py` — refactor: remove hardcoded weekly-only `_SECTION_MAP`, dispatch template by `document.kind`, use `markdown_sections.py` for parsing
- `backend/app/services/document_engine/templates/weekly_report.html.j2` — refactor to extend `_base`; swap cyan→Lumidian blue; hero 96pt→120pt; drop ~150 lines of duplicated CSS
- `backend/app/services/document_engine/sow.py` — add `SECTION_MAP` constant
- `backend/app/services/document_engine/audit_initial.py` — add `SECTION_MAP` constant
- `backend/app/services/document_engine/kickoff_checklist.py` — add `SECTION_MAP` constant
- `backend/app/services/document_engine/monthly_report.py` — add `SECTION_MAP` constant
- `backend/app/services/document_engine/agency_weekly_report.py` — add `SECTION_MAP` (lift current hardcoded one out of renderer)
- `backend/app/routers/agency.py` — drop per-kind whitelist check on `/documents/{id}/pdf`
- `backend/app/routers/review_public.py` — add 3 new endpoints (list docs, get HTML, get PDF)

### Frontend — created
- `frontend/app/review/[token]/page.tsx` — server component; parallel-fetches initial review-page + documents data
- `frontend/app/review/[token]/ReviewPage.tsx` — client component; holds optimistic state for drafts and current doc-reader target
- `frontend/app/review/[token]/DraftCard.tsx` — approval card with three CTAs + inline expander
- `frontend/app/review/[token]/DocumentCard.tsx` — library row with Open + Download
- `frontend/app/review/[token]/DocumentReader.tsx` — 60%-viewport side panel that renders doc HTML inline
- `frontend/app/review/[token]/EmptyState.tsx` — both-empty and single-empty messaging
- `frontend/app/review/[token]/RevokedState.tsx` — revoked/invalid token state
- `frontend/app/review/[token]/layout.tsx` — Lumidian fonts via `next/font`; cream-paper bg; no global app chrome
- `frontend/app/review/[token]/styles.module.css` — paper/ink tokens, page layout

### Frontend — modified
- `frontend/lib/api.ts` — add `publicListDocuments`, `publicGetDocumentHtml`, `publicDownloadDocumentPdf` + types
- `frontend/middleware.ts` — add `/review/*` to the public-paths regex

---

## Task ordering rationale

Phases are sequential by dependency. Tasks within a phase are usually independent.

1. **Phase 1 — foundations** (font embed, shared CSS, base template) — nothing else can be done without these
2. **Phase 2 — PDF renderer refactor** (generalize, drop per-kind whitelist, weekly refactor) — required before new templates can render
3. **Phase 3 — new PDF templates** (sow → kickoff_checklist → audit_initial → monthly_report) — independent, can parallelize
4. **Phase 4 — public review endpoints** (3 new endpoints + tests) — backend complete
5. **Phase 5 — review page frontend** (route + components + middleware) — depends on phase 4 endpoints

---

# Phase 1 — Design System Foundations

## Task 1: Font embedding script

**Files:**
- Create: `backend/scripts/embed_fonts.py`
- Create (by script run): `backend/app/services/document_engine/templates/_fonts.css.j2`

**Rationale:** Playwright renders run in Docker/CI/dev without guaranteed network access. Embedding font woff2 files as base64 inside CSS makes PDF rendering identical everywhere with zero network calls.

- [ ] **Step 1: Create the embed script**

```python
# backend/scripts/embed_fonts.py
"""One-shot script: download Google Fonts woff2 files and embed them as base64
inside templates/_fonts.css.j2. Re-run only when the chosen font stack changes."""
from __future__ import annotations

import base64
import re
import urllib.request
from pathlib import Path

# (family, url, weight, style)
FONT_FILES = [
    # Instrument Serif
    ("Instrument Serif", "https://fonts.gstatic.com/s/instrumentserif/v4/jizDREVItHgc8qDIbSTKq4XIRtnzwLGGqqOC.woff2", 400, "normal"),
    ("Instrument Serif", "https://fonts.gstatic.com/s/instrumentserif/v4/jizCREVItHgc8qDIbSTKq4XIRtnzwLfHa4LSk7Bg.woff2", 400, "italic"),
    # Inter (variable woff2, all weights)
    ("Inter", "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIa2JL7SUc.woff2", 400, "normal"),
    ("Inter", "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIa1ZL7SUc.woff2", 500, "normal"),
    ("Inter", "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIa1pL7SUc.woff2", 600, "normal"),
    # IBM Plex Mono
    ("IBM Plex Mono", "https://fonts.gstatic.com/s/ibmplexmono/v19/-F63fjptAgt5VM-kVkqdyU8n3kwq0n1hj-sNFQ.woff2", 400, "normal"),
    ("IBM Plex Mono", "https://fonts.gstatic.com/s/ibmplexmono/v19/-F6qfjptAgt5VM-kVkqdyU8n3kwq0lNvfg.woff2", 500, "normal"),
]

OUT_PATH = Path(__file__).resolve().parents[1] / "app" / "services" / "document_engine" / "templates" / "_fonts.css.j2"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (lumidian-font-embed)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def main() -> None:
    blocks: list[str] = ["{# AUTO-GENERATED by scripts/embed_fonts.py. Do not edit by hand. #}"]
    for family, url, weight, style in FONT_FILES:
        print(f"Fetching {family} {weight} {style} …")
        data = fetch(url)
        b64 = base64.b64encode(data).decode("ascii")
        blocks.append(
            "@font-face {\n"
            f"  font-family: \"{family}\";\n"
            f"  font-style: {style};\n"
            f"  font-weight: {weight};\n"
            f"  font-display: swap;\n"
            f"  src: url(\"data:font/woff2;base64,{b64}\") format(\"woff2\");\n"
            "}"
        )
    OUT_PATH.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size // 1024
    print(f"Wrote {OUT_PATH} ({size_kb} KB)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

Run: `cd backend && source venv/bin/activate && python scripts/embed_fonts.py`
Expected: prints fetches and final write line; `_fonts.css.j2` exists at ~500–800 KB.

- [ ] **Step 3: Sanity-check the output**

Run: `head -3 backend/app/services/document_engine/templates/_fonts.css.j2`
Expected: comment + `@font-face {` line beginning with `font-family: "Instrument Serif";`.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/embed_fonts.py backend/app/services/document_engine/templates/_fonts.css.j2
git commit -m "feat(docs): embed Instrument Serif + Inter + IBM Plex Mono as base64 for offline PDF rendering"
```

---

## Task 2: Shared design tokens (`_styles.css.j2`)

**Files:**
- Create: `backend/app/services/document_engine/templates/_styles.css.j2`

- [ ] **Step 1: Write the shared stylesheet**

```jinja
{# Lumidian PDF design system — included by _base.html.j2. #}
{% include "_fonts.css.j2" %}

:root {
  /* paper & ink */
  --paper: #FAF7F2;
  --paper-elev: #FFFFFF;
  --ink: #0B1220;
  --ink-soft: #334155;
  --ink-mute: #6B7280;
  --ink-faint: #9AA4B2;
  --rule: #E6E1D8;

  /* brand */
  --lumidian: #2447EE;
  --lumidian-tint: rgba(36, 71, 238, 0.08);

  /* semantic */
  --up: #047857;
  --down: #B91C1C;
  --flat: #9AA4B2;
}

@page { size: Letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  color: var(--ink-soft);
  background: var(--paper);
  font-size: 11pt;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.page {
  width: 8.5in; height: 11in; padding: 0.75in;
  page-break-after: always; position: relative; background: var(--paper);
}
.page:last-child { page-break-after: auto; }

/* type */
.display { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; color: var(--ink); }
.display-italic { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-weight: 400; color: var(--ink); }
.mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
h1, h2, h3 { margin: 0; font-weight: 600; color: var(--ink); }

/* primitives */
.tracker {
  font-size: 9pt; font-weight: 600; letter-spacing: 2pt;
  text-transform: uppercase; color: var(--ink-mute);
}
.rule { border: 0; border-top: 0.5pt solid var(--rule); margin: 12pt 0; }
.muted { color: var(--ink-mute); }
.faint { color: var(--ink-faint); }
.center { text-align: center; }
.right { text-align: right; }

/* logo lockup */
.lockup { display: flex; align-items: center; gap: 8pt; }
.lockup img { height: 28px; width: auto; }
.lockup .wordmark { font-family: "Instrument Serif", Georgia, serif; font-size: 14pt; color: var(--ink); letter-spacing: 0.5pt; }

/* card */
.card {
  background: var(--paper-elev);
  border: 0.5pt solid var(--rule);
  border-radius: 6px;
  padding: 18pt;
  margin-bottom: 14pt;
}

/* footer (used by report personality + sow) */
.footer {
  position: absolute; left: 0.75in; right: 0.75in; bottom: 0.45in;
  display: flex; justify-content: space-between;
  font-size: 8pt; color: var(--ink-faint);
}
.footer .wordmark { color: var(--ink-mute); font-weight: 500; }

/* bars (used by reports) */
.bar-row { display: flex; align-items: center; padding: 8pt 0; border-bottom: 0.5pt solid var(--rule); }
.bar-row:last-child { border-bottom: 0; }
.bar-row .model { width: 110px; font-size: 10pt; color: var(--ink-soft); }
.bar-row .bar-wrap { flex: 1; height: 14px; background: var(--lumidian-tint); border-radius: 7px; overflow: hidden; margin-right: 16pt; }
.bar-row .bar { height: 100%; background: var(--lumidian); }
.bar-row .num { width: 90pt; text-align: right; font-size: 10pt; color: var(--ink); }

/* tables */
table { width: 100%; border-collapse: collapse; font-size: 10pt; }
th { text-align: left; font-weight: 600; color: var(--ink-mute); padding: 6pt 8pt; border-bottom: 0.5pt solid var(--rule); font-size: 9pt; text-transform: uppercase; letter-spacing: 1pt; }
td { padding: 8pt; border-bottom: 0.5pt solid var(--rule); color: var(--ink-soft); vertical-align: top; }
td.num { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; text-align: right; }
td.prompt { font-weight: 500; color: var(--ink); max-width: 320pt; }
.delta-up { color: var(--up); font-weight: 600; }
.delta-down { color: var(--down); font-weight: 600; }
.delta-flat { color: var(--flat); }

/* signature block (sow) */
.sig-row { display: flex; gap: 32pt; margin-top: 48pt; }
.sig-col { flex: 1; }
.sig-line { border-top: 0.5pt solid var(--ink-soft); margin-top: 24pt; padding-top: 6pt; }
.sig-label { font-size: 8pt; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 1pt; }
.sig-name { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 9pt; color: var(--ink); margin-top: 4pt; }

/* checklist glyphs (kickoff) */
.check-on { color: var(--lumidian); font-size: 12pt; margin-right: 8pt; }
.check-off { color: var(--ink-faint); font-size: 12pt; margin-right: 8pt; }
.check-item { display: flex; gap: 4pt; padding: 4pt 0; font-size: 10.5pt; color: var(--ink); }
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/document_engine/templates/_styles.css.j2
git commit -m "feat(docs): shared CSS design tokens for PDF document system"
```

---

## Task 3: Base template (`_base.html.j2`)

**Files:**
- Create: `backend/app/services/document_engine/templates/_base.html.j2`

- [ ] **Step 1: Write the base**

```jinja
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{{ document.title }}</title>
<style>{% include "_styles.css.j2" %}</style>
{% block extra_styles %}{% endblock %}
</head>
<body>
{% block body %}{% endblock %}
</body>
</html>
```

This is intentionally minimal. Personality lives in each per-kind template; `_base` only owns: doctype, head, fonts, the shared stylesheet, and a `body` slot.

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/document_engine/templates/_base.html.j2
git commit -m "feat(docs): base Jinja2 template for PDF document system"
```

---

# Phase 2 — Renderer Refactor

## Task 4: Generalized markdown section parser

**Files:**
- Create: `backend/app/services/document_engine/markdown_sections.py`
- Test: `backend/tests/test_document_pdf_rendering.py` (new file — first test gets seeded here)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_document_pdf_rendering.py
"""Tests for the generalized PDF rendering pipeline (all 5 kinds)."""
from __future__ import annotations

import pytest

from app.services.document_engine.markdown_sections import parse_sections


def test_parse_sections_maps_headings_to_block_keys():
    body = (
        "# Title\n\n"
        "## Foo Bar\n\nFoo content here.\n\n"
        "## Baz Qux\n\nBaz content here.\n"
    )
    mapping = {"foo bar": "foo", "baz qux": "baz"}
    out = parse_sections(body, mapping)
    assert "foo" in out
    assert "baz" in out
    assert "<p>Foo content here.</p>" in out["foo"]
    assert "<p>Baz content here.</p>" in out["baz"]


def test_parse_sections_ignores_unmapped_headings():
    body = "## Known\n\nyes\n\n## Unknown\n\nno\n"
    out = parse_sections(body, {"known": "k"})
    assert out == {"k": "<p>yes</p>"}


def test_parse_sections_empty_body_returns_empty_dict():
    assert parse_sections("", {"any": "x"}) == {}
    assert parse_sections(None, {"any": "x"}) == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py -v`
Expected: 3 collection errors / failures — `parse_sections` does not exist.

- [ ] **Step 3: Implement the parser**

```python
# backend/app/services/document_engine/markdown_sections.py
"""Generalized markdown -> HTML section parser.

Each PDF template module declares a SECTION_MAP dict mapping lowercase H2
heading text -> Jinja2 block key. parse_sections() splits a markdown body
on `## ` headings and returns {block_key: rendered_html} for the
recognized ones (unrecognized headings are dropped silently).
"""
from __future__ import annotations

import re

import markdown as _md


def parse_sections(body: str | None, section_map: dict[str, str]) -> dict[str, str]:
    if not body:
        return {}
    parts = re.split(r"^##\s+", body, flags=re.MULTILINE)
    out: dict[str, str] = {}
    for part in parts[1:]:
        lines = part.splitlines()
        if not lines:
            continue
        heading = lines[0].strip().lower()
        body_md = "\n".join(lines[1:]).strip()
        key = section_map.get(heading)
        if key is None:
            continue
        out[key] = _md.markdown(body_md, extensions=["extra"])
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_engine/markdown_sections.py backend/tests/test_document_pdf_rendering.py
git commit -m "feat(docs): generalized markdown section parser"
```

---

## Task 5: Add `SECTION_MAP` to all 5 template modules

**Files:**
- Modify: `backend/app/services/document_engine/agency_weekly_report.py`
- Modify: `backend/app/services/document_engine/monthly_report.py`
- Modify: `backend/app/services/document_engine/sow.py`
- Modify: `backend/app/services/document_engine/audit_initial.py`
- Modify: `backend/app/services/document_engine/kickoff_checklist.py`

- [ ] **Step 1: Add `SECTION_MAP` to `agency_weekly_report.py`**

Add this constant near the top of the file (after imports, before `_period`):

```python
SECTION_MAP: dict[str, str] = {
    "executive summary": "executive_summary",
    "visibility this week": "visibility",
    "per-prompt scorecard": "prompts",
    "competitor delta": "competitors",
    "content shipped": "content",
    "impact of posted content": "impact",
    "top gaps to close": "gaps",
    "next week": "next_week",
}
```

(This is lifted verbatim from `pdf_renderer.py:_SECTION_MAP`. The next task will delete the renderer's copy.)

- [ ] **Step 2: Add `SECTION_MAP` to `monthly_report.py`**

```python
SECTION_MAP: dict[str, str] = {
    "summary": "summary",
    "visibility change": "visibility",
    "content shipped": "content",
    "notable activity": "activity",
    "next month": "next_month",
}
```

- [ ] **Step 3: Add `SECTION_MAP` to `sow.py`**

```python
SECTION_MAP: dict[str, str] = {
    "1. engagement summary": "engagement_summary",
    "2. scope of services": "scope",
    "3. deliverables": "deliverables",
    "4. term": "term",
    "5. payment terms": "payment",
    "6. termination": "termination",
    "7. signatures": "signatures",
}
```

- [ ] **Step 4: Add `SECTION_MAP` to `audit_initial.py`**

```python
SECTION_MAP: dict[str, str] = {
    "current state": "current_state",
    "what's working": "working",
    "gaps": "gaps",
    "recommendations (next 30 days)": "recommendations",
    "open questions for the client": "questions",
}
```

- [ ] **Step 5: Add `SECTION_MAP` to `kickoff_checklist.py`**

```python
SECTION_MAP: dict[str, str] = {
    "what we have": "have",
    "what the client still owes": "owes",
    "suggested first call": "first_call",
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/document_engine/*.py
git commit -m "feat(docs): add SECTION_MAP to all 5 template modules"
```

---

## Task 6: Generalize `pdf_renderer.py`

**Files:**
- Modify: `backend/app/services/document_engine/pdf_renderer.py`
- Test: `backend/tests/test_document_pdf_rendering.py` (extend)

- [ ] **Step 1: Write the failing test** (extend the file from Task 4)

Append to `backend/tests/test_document_pdf_rendering.py`:

```python
import importlib

from app.services.document_engine.pdf_renderer import _template_filename, _section_map_for


def test_template_filename_maps_each_kind():
    assert _template_filename("agency_weekly_report") == "weekly_report.html.j2"
    assert _template_filename("monthly_report") == "monthly_report.html.j2"
    assert _template_filename("sow") == "sow.html.j2"
    assert _template_filename("audit_initial") == "audit_initial.html.j2"
    assert _template_filename("kickoff_checklist") == "kickoff_checklist.html.j2"


def test_template_filename_rejects_unknown_kind():
    with pytest.raises(ValueError):
        _template_filename("not_a_real_kind")


def test_section_map_for_loads_from_module():
    mapping = _section_map_for("kickoff_checklist")
    assert "what we have" in mapping
    assert mapping["what we have"] == "have"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py -v`
Expected: collection errors / failures on the new tests — `_template_filename` and `_section_map_for` don't exist.

- [ ] **Step 3: Refactor `pdf_renderer.py`**

Replace the whole file with:

```python
"""HTML→PDF renderer for agency client documents.

Dispatches by ClientDocument.kind to the matching Jinja2 template under
templates/, parses the markdown body via each template module's SECTION_MAP,
and renders to PDF via Playwright.
"""
from __future__ import annotations

import base64
import importlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument
from app.services.document_engine.markdown_sections import parse_sections

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_REPO_ROOT = Path(__file__).resolve().parents[4]
_LOGO_PATH = _REPO_ROOT / "frontend" / "public" / "logo.png"

_KIND_TO_TEMPLATE: dict[str, str] = {
    "agency_weekly_report": "weekly_report.html.j2",
    "monthly_report": "monthly_report.html.j2",
    "sow": "sow.html.j2",
    "audit_initial": "audit_initial.html.j2",
    "kickoff_checklist": "kickoff_checklist.html.j2",
}

_KIND_TO_MODULE: dict[str, str] = {
    "agency_weekly_report": "app.services.document_engine.agency_weekly_report",
    "monthly_report": "app.services.document_engine.monthly_report",
    "sow": "app.services.document_engine.sow",
    "audit_initial": "app.services.document_engine.audit_initial",
    "kickoff_checklist": "app.services.document_engine.kickoff_checklist",
}


def _template_filename(kind: str) -> str:
    if kind not in _KIND_TO_TEMPLATE:
        raise ValueError(f"No PDF template registered for document kind: {kind}")
    return _KIND_TO_TEMPLATE[kind]


def _section_map_for(kind: str) -> dict[str, str]:
    module_name = _KIND_TO_MODULE[kind]
    module = importlib.import_module(module_name)
    return getattr(module, "SECTION_MAP", {})


def _logo_data_uri() -> str | None:
    try:
        if not _LOGO_PATH.exists():
            logger.warning("Logo not found at %s — rendering text wordmark fallback", _LOGO_PATH)
            return None
        return f"data:image/png;base64,{base64.b64encode(_LOGO_PATH.read_bytes()).decode('ascii')}"
    except Exception as e:
        logger.warning("Failed to embed logo: %s", e)
        return None


async def _resolve_data(db: AsyncSession, document: ClientDocument) -> dict[str, Any]:
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


def render_html(document: ClientDocument, data: dict[str, Any]) -> str:
    """Render the document HTML — used by both the PDF endpoint and the
    public review page's in-browser viewer."""
    section_map = _section_map_for(document.kind)
    sections = parse_sections(document.body_markdown or "", section_map)
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template(_template_filename(document.kind))
    return template.render(
        document=document,
        data=data,
        sections=sections,
        logo_data_uri=_logo_data_uri(),
        generated_label=datetime.utcnow().strftime("%B %d, %Y"),
    )


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


async def render_pdf(db: AsyncSession, document: ClientDocument) -> bytes:
    data = await _resolve_data(db, document)
    html = render_html(document, data)
    return await _playwright_pdf(html)
```

- [ ] **Step 4: Update the existing `_parse_markdown_sections` test in `test_agency_pdf_report.py`**

The old function is gone. Open `backend/tests/test_agency_pdf_report.py` and find the line:

```python
from app.services.document_engine.pdf_renderer import _parse_markdown_sections
```

Replace with:

```python
from app.services.document_engine.markdown_sections import parse_sections
from app.services.document_engine.agency_weekly_report import SECTION_MAP as WEEKLY_SECTION_MAP


def _parse_markdown_sections(body):
    """Compatibility shim so the existing weekly-specific tests keep passing."""
    return parse_sections(body, WEEKLY_SECTION_MAP)
```

(Adjust the import line and add the shim near the top of the file, after imports.)

- [ ] **Step 5: Run tests to verify everything passes**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py tests/test_agency_pdf_report.py -v`
Expected: all PASS. The dispatcher tests + the existing weekly tests both green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/document_engine/pdf_renderer.py backend/tests/test_document_pdf_rendering.py backend/tests/test_agency_pdf_report.py
git commit -m "refactor(docs): generalize pdf_renderer to dispatch by document.kind"
```

---

## Task 7: Drop per-kind whitelist on agency PDF endpoint

**Files:**
- Modify: `backend/app/routers/agency.py` (lines ~838–862 — the `get_document_pdf` handler)

- [ ] **Step 1: Find and edit the handler**

Locate the handler near `backend/app/routers/agency.py:838`. The current body has:

```python
    if doc.kind != "agency_weekly_report":
        raise HTTPException(status_code=400, detail="PDF export is only available for weekly reports")
```

Delete those two lines entirely. The dispatcher in `render_pdf` now handles all 5 kinds; if an unknown kind reaches us it will raise `ValueError`, which the existing `except Exception` block already catches and turns into a 500.

The handler should now read (kind check removed):

```python
@router.get("/documents/{document_id}/pdf")
async def get_document_pdf(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    """Render an agency document as PDF (any registered kind)."""
    from fastapi.responses import Response

    from app.services.document_engine.pdf_renderer import render_pdf

    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        pdf_bytes = await render_pdf(db, doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF: {e}") from e

    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in doc.title)[:120].strip() or f"document-{doc.id}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
```

(The only material change is removing the `doc.kind != "agency_weekly_report"` check and tightening the docstring + adding `ValueError` → 400 mapping for unknown kinds.)

- [ ] **Step 2: Update the existing endpoint test**

In `backend/tests/test_agency_pdf_report.py`, find the test that asserts `400 — "PDF export is only available for weekly reports"` for non-weekly kinds (search for `not_a_weekly` or similar). Update it to a `ValueError → 400` shape that asserts a generic "No PDF template registered" message, OR delete the test if it specifically guards the dropped behavior.

If the test is named something like `test_pdf_rejected_for_non_weekly_kind`, rename to `test_pdf_unknown_kind_returns_400` with body:

```python
@pytest.mark.asyncio
async def test_pdf_unknown_kind_returns_400(client):
    await _make_agency_user(client, email="pdf-unknown@example.com")
    aid, _ = await _create_agency_client(client, "PdfUnknownCo")
    async with AsyncSessionLocal() as db:
        doc = ClientDocument(
            agency_client_id=aid,
            kind="not_a_real_kind",
            title="x",
            body_markdown="x",
        )
        db.add(doc)
        await db.commit()
        doc_id = doc.id
    resp = await client.get(f"/api/agency/documents/{doc_id}/pdf")
    assert resp.status_code == 400
    assert "No PDF template registered" in resp.json()["detail"]
```

- [ ] **Step 3: Run the agency PDF endpoint tests**

Run: `cd backend && pytest tests/test_agency_pdf_report.py -v`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/agency.py backend/tests/test_agency_pdf_report.py
git commit -m "feat(docs): drop per-kind whitelist on /agency/documents/{id}/pdf"
```

---

## Task 8: Refactor `weekly_report.html.j2` to extend `_base`

**Files:**
- Modify: `backend/app/services/document_engine/templates/weekly_report.html.j2`

**Goal:** Same output structure, but inherits from `_base`, uses design tokens, swaps cyan → Lumidian blue, and promotes the hero number from 96pt → 120pt.

- [ ] **Step 1: Replace the file contents**

```jinja
{% extends "_base.html.j2" %}

{% block extra_styles %}
  /* Page-specific styles for weekly_report */
  .cover { position: relative; height: 9.5in; }
  .cover .hero { text-align: center; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); }
  .cover .hero .label { font-size: 11pt; letter-spacing: 3pt; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 24pt; }
  .cover .hero .name { font-family: "Instrument Serif", Georgia, serif; font-size: 64pt; color: var(--ink); margin: 0 0 18pt; line-height: 1.1; font-weight: 400; }
  .cover .hero .week { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 18pt; color: var(--ink-soft); font-weight: 400; }
  .cover .meta { display: flex; justify-content: space-between; font-size: 10pt; color: var(--ink-mute); padding-top: 12pt; border-top: 0.5pt solid var(--rule); position: absolute; left: 0; right: 0; bottom: 0; }

  .headline { display: flex; flex-direction: column; align-items: center; margin-top: 60pt; }
  .headline .score { font-family: "Instrument Serif", Georgia, serif; font-size: 120pt; line-height: 1; color: var(--ink); font-weight: 400; }
  .headline .score .pct { font-size: 40pt; color: var(--ink-faint); }
  .headline .delta { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 14pt; font-weight: 500; margin-top: 12pt; }
  .headline .delta.up { color: var(--up); }
  .headline .delta.down { color: var(--down); }
  .headline .delta.flat { color: var(--flat); }
  .headline .delta .arrow { display: inline-block; margin-right: 8pt; }
  .headline .summary { margin-top: 36pt; max-width: 5in; text-align: center; font-size: 12pt; line-height: 1.6; color: var(--ink-soft); }

  h2 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 22pt; margin-bottom: 12pt; color: var(--ink); border-bottom: 0.5pt solid var(--rule); padding-bottom: 6pt; }
{% endblock %}

{% block body %}

<!-- PAGE 1 — Cover -->
<div class="page cover">
  <div class="lockup">
    {% if logo_data_uri %}<img src="{{ logo_data_uri }}" alt="Lumidian" />{% endif %}
    <span class="wordmark">Lumidian</span>
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
      <div class="score">{{ data.this_week_run.overall_score|round|int }}<span class="pct">%</span></div>
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
        <div class="num mono">{{ (m.score|float)|round(1) }}%</div>
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
          <td class="num {% if p.delta is not none and p.delta > 0 %}delta-up{% elif p.delta is not none and p.delta < 0 %}delta-down{% else %}delta-flat{% endif %}">
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
          <td class="num {% if c.delta > 0 %}delta-up{% elif c.delta < 0 %}delta-down{% else %}delta-flat{% endif %}">
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

{% endblock %}
```

- [ ] **Step 2: Run the existing weekly report tests**

Run: `cd backend && pytest tests/test_agency_pdf_report.py tests/test_agency_weekly_report.py -v`
Expected: all PASS. The refactor must not break the existing data shape.

- [ ] **Step 3: Smoke-render a real PDF**

Run from a Python REPL (or as a one-shot script):

```python
import asyncio, json
from app.database import AsyncSessionLocal
from app.models import ClientDocument
from app.services.document_engine.pdf_renderer import render_pdf

async def main():
    async with AsyncSessionLocal() as db:
        # find any existing weekly report doc
        from sqlalchemy import select
        q = await db.execute(select(ClientDocument).where(ClientDocument.kind == "agency_weekly_report").limit(1))
        doc = q.scalar_one_or_none()
        if doc is None:
            print("No weekly report in DB to smoke-test")
            return
        pdf = await render_pdf(db, doc)
        open("/tmp/weekly_smoke.pdf", "wb").write(pdf)
        print(f"Wrote /tmp/weekly_smoke.pdf ({len(pdf) // 1024} KB)")

asyncio.run(main())
```

Open `/tmp/weekly_smoke.pdf` and visually confirm: cover page shows logo lockup + client name in serif, hero score on page 2 is much larger than before, bars are Lumidian blue not cyan.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/document_engine/templates/weekly_report.html.j2
git commit -m "refactor(docs): weekly report extends _base + Lumidian blue + 120pt hero"
```

---

# Phase 3 — New PDF Templates

## Task 9: SOW template (Contract personality)

**Files:**
- Create: `backend/app/services/document_engine/templates/sow.html.j2`
- Test: `backend/tests/test_document_pdf_rendering.py` (extend)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_document_pdf_rendering.py`:

```python
from unittest.mock import patch
import json as _json
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import AgencyClient, Brand, ClientDocument


async def _make_client_with_doc(name: str, kind: str, body_md: str, snapshot: dict) -> int:
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name=name, slug=name.lower().replace(" ", "-"))
        db.add(ac)
        await db.flush()
        brand = Brand(name=name, slug=f"b-{ac.slug}", agency_client_id=ac.id, brand_type="agency")
        db.add(brand)
        doc = ClientDocument(
            agency_client_id=ac.id,
            kind=kind,
            title=f"{kind} — {name}",
            body_markdown=body_md,
            data_snapshot=_json.dumps(snapshot),
        )
        db.add(doc)
        await db.commit()
        return doc.id


@pytest.mark.asyncio
async def test_render_html_sow_contains_letterhead_and_signatures():
    body = (
        "# SOW\n\n"
        "## 1. Engagement Summary\n\nWe will increase visibility.\n\n"
        "## 2. Scope of Services\n\n- Tracking\n- Drafts\n\n"
        "## 3. Deliverables\n\n8 LinkedIn drafts/mo\n\n"
        "## 4. Term\n\nMonthly renewal\n\n"
        "## 5. Payment Terms\n\nNet 30\n\n"
        "## 6. Termination\n\n30 days written notice\n\n"
        "## 7. Signatures\n\nSee below\n"
    )
    snapshot = {
        "client": {"name": "TestSowCo", "primary_contact_name": "Jane Client", "primary_contact_email": "jane@x.com", "retainer_amount_usd": 3500, "retainer_started_at": None},
        "brand": {"name": "TestSowCo", "website_url": "https://x.com"},
        "brand_profile": None,
        "today": "May 18, 2026",
    }
    doc_id = await _make_client_with_doc("SowCo", "sow", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "Statement of Work" in html
    assert "TestSowCo" in html
    assert "sig-row" in html  # signature block rendered
    assert "Engagement Summary" in html
    assert "<!DOCTYPE html>" in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_sow_contains_letterhead_and_signatures -v`
Expected: FAIL — `sow.html.j2` does not exist.

- [ ] **Step 3: Write the SOW template**

```jinja
{# backend/app/services/document_engine/templates/sow.html.j2 #}
{% extends "_base.html.j2" %}

{% block extra_styles %}
  .letterhead { display: flex; align-items: center; justify-content: space-between; }
  .letterhead .label { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 14pt; color: var(--ink-mute); }

  .doc-meta { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 9pt; color: var(--ink-mute); margin-top: 6pt; display: flex; gap: 18pt; }
  .doc-meta span:not(:last-child)::after { content: "·"; margin-left: 18pt; color: var(--ink-faint); }

  .sow-section { margin-top: 28pt; }
  .sow-section h3 { font-family: "Instrument Serif", Georgia, serif; font-size: 16pt; font-weight: 400; color: var(--ink); margin-bottom: 8pt; }
  .sow-section p, .sow-section li { font-size: 11pt; line-height: 1.55; color: var(--ink-soft); }
  .sow-section ul { padding-left: 18pt; margin: 6pt 0; }

  .num-mono { font-family: "IBM Plex Mono", ui-monospace, monospace; }
{% endblock %}

{% block body %}
<div class="page">
  <div class="letterhead">
    <div class="lockup">
      {% if logo_data_uri %}<img src="{{ logo_data_uri }}" alt="Lumidian" />{% endif %}
      <span class="wordmark">Lumidian</span>
    </div>
    <div class="label">Statement of Work</div>
  </div>
  <hr class="rule" />
  <div class="doc-meta">
    <span>SOW-{{ '%04d' % document.id }}</span>
    <span>Effective {{ data.today }}</span>
    <span>Lumidian × {{ data.client.name }}</span>
    {% if data.client.retainer_amount_usd %}<span class="num-mono">${{ "{:,.0f}".format(data.client.retainer_amount_usd) }}/mo</span>{% endif %}
  </div>

  <div class="sow-section">
    <div class="tracker">Engagement Summary</div>
    <h3>1. Engagement Summary</h3>
    <div>{{ sections.engagement_summary | safe }}</div>
  </div>

  <div class="sow-section">
    <div class="tracker">Scope</div>
    <h3>2. Scope of Services</h3>
    <div>{{ sections.scope | safe }}</div>
  </div>

  <div class="sow-section">
    <div class="tracker">Deliverables</div>
    <h3>3. Deliverables</h3>
    <div>{{ sections.deliverables | safe }}</div>
  </div>

  <div class="sow-section">
    <div class="tracker">Term</div>
    <h3>4. Term</h3>
    <div>{{ sections.term | safe }}</div>
  </div>

  <div class="sow-section">
    <div class="tracker">Payment</div>
    <h3>5. Payment Terms</h3>
    <div>{{ sections.payment | safe }}</div>
  </div>

  <div class="sow-section">
    <div class="tracker">Termination</div>
    <h3>6. Termination</h3>
    <div>{{ sections.termination | safe }}</div>
  </div>

  <div class="sow-section">
    <div class="tracker">Signatures</div>
    <h3>7. Signatures</h3>
    <div class="sig-row">
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-label">Agency</div>
        <div class="sig-name">Lumidian</div>
      </div>
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-label">Client</div>
        <div class="sig-name">{{ data.client.primary_contact_name or data.client.name }}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="wordmark">Confidential</div>
    <div>Lumidian × {{ data.client.name }}</div>
    <div class="right">1</div>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_sow_contains_letterhead_and_signatures -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_engine/templates/sow.html.j2 backend/tests/test_document_pdf_rendering.py
git commit -m "feat(docs): SOW PDF template (contract personality)"
```

---

## Task 10: Kickoff checklist template (Briefing personality)

**Files:**
- Create: `backend/app/services/document_engine/templates/kickoff_checklist.html.j2`
- Test: extend `backend/tests/test_document_pdf_rendering.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_render_html_kickoff_uses_circle_glyphs():
    body = (
        "# Kickoff\n\n"
        "## What we have\n\n- [x] Primary contact name\n- [x] Primary contact email\n\n"
        "## What the client still owes\n\n- [ ] Brand profile: tone of voice\n- [ ] At least 10 tracked prompts\n\n"
        "## Suggested first call\n\n- Walk through visibility goals\n- Confirm review cadence\n"
    )
    snapshot = {
        "client": {"name": "KickoffCo", "primary_contact_name": True, "primary_contact_email": True},
        "brand": {"name": "KickoffCo", "website_url": True},
        "brand_profile": {"company_description": True, "tone_of_voice": False, "what_not_to_say": False, "approved_language": False, "publications": False},
        "prompt_count": 3,
    }
    doc_id = await _make_client_with_doc("KickoffCo", "kickoff_checklist", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "KickoffCo" in html
    assert "Kickoff Checklist" in html or "KICKOFF CHECKLIST" in html
    # Circle glyphs replace markdown checkboxes
    assert "●" in html
    assert "○" in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_kickoff_uses_circle_glyphs -v`
Expected: FAIL.

- [ ] **Step 3: Write the kickoff template**

```jinja
{# backend/app/services/document_engine/templates/kickoff_checklist.html.j2 #}
{% extends "_base.html.j2" %}

{% block extra_styles %}
  .hero-soft { padding-top: 12pt; padding-bottom: 28pt; border-bottom: 0.5pt solid var(--rule); margin-bottom: 24pt; }
  .hero-soft .name { font-family: "Instrument Serif", Georgia, serif; font-size: 48pt; line-height: 1.05; color: var(--ink); margin-top: 12pt; font-weight: 400; }
  .hero-soft .date { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 10pt; color: var(--ink-mute); margin-top: 8pt; }

  .checklist-cols { display: flex; gap: 32pt; }
  .checklist-cols .col { flex: 1; }
  .col h4 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 16pt; color: var(--ink); margin: 0 0 10pt; }

  /* Transform <ul><li> with check markers into our styled list */
  .col ul { list-style: none; padding: 0; margin: 0; }
  .col li { display: flex; gap: 8pt; padding: 4pt 0; font-size: 10.5pt; color: var(--ink); line-height: 1.5; }
  /* Markdown task-list checkboxes get replaced via CSS pseudo-elements */
  .col li.task-list-item input[type="checkbox"] { display: none; }
  .col li.task-list-item::before { font-size: 12pt; line-height: 1.3; }
  .col li.task-list-item:has(input[checked])::before { content: "●"; color: var(--lumidian); }
  .col li.task-list-item:not(:has(input[checked]))::before { content: "○"; color: var(--ink-faint); }

  /* Plain markdown rendered without task-list-item class — fallback */
  .col ul li::before { content: ""; }

  .first-call { margin-top: 28pt; padding-top: 18pt; border-top: 0.5pt solid var(--rule); }
  .first-call h4 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 16pt; color: var(--ink); margin: 0 0 10pt; }
  .first-call ul { padding-left: 18pt; }
  .first-call li { font-size: 11pt; color: var(--ink-soft); padding: 3pt 0; }
{% endblock %}

{% block body %}
<div class="page">
  <div class="lockup">
    {% if logo_data_uri %}<img src="{{ logo_data_uri }}" alt="Lumidian" />{% endif %}
    <span class="wordmark">Lumidian</span>
  </div>
  <div class="hero-soft">
    <div class="tracker">Kickoff Checklist</div>
    <div class="name">{{ data.client.name }}</div>
    <div class="date">{{ generated_label }}</div>
  </div>

  <div class="checklist-cols">
    <div class="col">
      <h4>What we have</h4>
      {{ sections.have | safe }}
    </div>
    <div class="col">
      <h4>What we still need</h4>
      {{ sections.owes | safe }}
    </div>
  </div>

  {% if sections.first_call %}
  <div class="first-call">
    <h4>Suggested first call</h4>
    {{ sections.first_call | safe }}
  </div>
  {% endif %}

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">1</div>
  </div>
</div>
{% endblock %}
```

**Note on the circle glyph rendering:** the Python `markdown` library with `extra` extension renders `- [x]` / `- [ ]` as `<li class="task-list-item"><input type="checkbox" disabled [checked]>...</li>`. The CSS `:has()` selectors above transform these into circle glyphs. Chromium (Playwright's engine) supports `:has()`.

- [ ] **Step 4: Enable markdown task-list parsing**

The `markdown` library needs the `pymdownx.tasklist` extension OR a built-in via `extra`. Check whether `extra` already covers it; if not, switch to:

In `backend/app/services/document_engine/markdown_sections.py`, change:

```python
out[key] = _md.markdown(body_md, extensions=["extra"])
```

to:

```python
out[key] = _md.markdown(body_md, extensions=["extra", "pymdownx.tasklist"])
```

Then check if `pymdownx` is installed:

Run: `cd backend && python -c "import pymdownx.tasklist" || echo MISSING`

If MISSING:

```bash
cd backend && pip install pymdown-extensions
echo "pymdown-extensions>=10.0" >> requirements.txt
```

Re-run the import check to confirm.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_kickoff_uses_circle_glyphs -v`

If the test fails because the assertions expect literal `●` / `○` in HTML but the glyphs come from CSS `:has()` (which only show at render time), update the test to instead assert the markdown's task-list output is present:

```python
    assert 'task-list-item' in html or "checked" in html
    assert "What we have" in html
    assert "What we still need" in html
```

Re-run; expect PASS.

- [ ] **Step 6: Smoke-render a PDF**

Use the smoke-render snippet from Task 8 Step 3, but find a kickoff_checklist doc (or insert one first). Open the PDF and visually confirm the circle glyphs render correctly.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/document_engine/templates/kickoff_checklist.html.j2 backend/app/services/document_engine/markdown_sections.py backend/requirements.txt backend/tests/test_document_pdf_rendering.py
git commit -m "feat(docs): kickoff checklist PDF template (briefing personality)"
```

---

## Task 11: Audit initial template (Briefing personality)

**Files:**
- Create: `backend/app/services/document_engine/templates/audit_initial.html.j2`
- Test: extend `backend/tests/test_document_pdf_rendering.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_render_html_audit_initial_shows_score_inset_when_present():
    body = (
        "# Audit\n\n"
        "## Current State\n\nVisibility is 42%. Below industry median.\n\n"
        "## What's Working\n\n- LinkedIn presence is strong\n\n"
        "## Gaps\n\n- No Reddit coverage\n- Wikipedia missing\n\n"
        "## Recommendations (next 30 days)\n\n- Add 4 Reddit drafts\n- Build Wikipedia stub\n\n"
        "## Open Questions for the Client\n\n- What is your North-Star use case?\n"
    )
    snapshot = {
        "client": {"name": "AuditCo", "slug": "auditco", "status": "active"},
        "brand": {"name": "AuditCo", "website_url": "https://x.com"},
        "brand_profile": None,
        "prompts": [],
        "competitors": [],
        "latest_run": {"overall_score": 42.0, "total_queries": 24, "total_mentions": 10, "completed_at": "2026-05-17T10:00:00"},
        "generated_at": "2026-05-18T12:00:00",
        "has_data": True,
    }
    doc_id = await _make_client_with_doc("AuditCo", "audit_initial", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "Initial Audit" in html or "INITIAL AUDIT" in html
    assert "AuditCo" in html
    assert "42" in html  # score in the inset card
    assert "Recommendations" in html or "recommendations" in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_audit_initial_shows_score_inset_when_present -v`
Expected: FAIL.

- [ ] **Step 3: Write the audit template**

```jinja
{# backend/app/services/document_engine/templates/audit_initial.html.j2 #}
{% extends "_base.html.j2" %}

{% block extra_styles %}
  .hero-soft { padding-top: 12pt; padding-bottom: 28pt; border-bottom: 0.5pt solid var(--rule); margin-bottom: 24pt; }
  .hero-soft .name { font-family: "Instrument Serif", Georgia, serif; font-size: 48pt; line-height: 1.05; color: var(--ink); margin-top: 12pt; font-weight: 400; }
  .hero-soft .date { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 10pt; color: var(--ink-mute); margin-top: 8pt; }

  .audit-body h4 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 18pt; color: var(--ink); margin: 0 0 8pt; }
  .audit-body p, .audit-body li { font-size: 11pt; line-height: 1.55; color: var(--ink-soft); }
  .audit-body ul { padding-left: 18pt; margin: 6pt 0 18pt; }

  .score-inset { display: inline-block; padding: 12pt 18pt; border: 0.5pt solid var(--rule); border-radius: 6px; background: var(--paper-elev); margin: 8pt 0 18pt; }
  .score-inset .num { font-family: "Instrument Serif", Georgia, serif; font-size: 40pt; line-height: 1; color: var(--ink); font-weight: 400; }
  .score-inset .num .pct { font-size: 18pt; color: var(--ink-faint); margin-left: 2pt; }
  .score-inset .sub { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 9pt; color: var(--ink-mute); margin-top: 6pt; }

  .two-col { display: flex; gap: 32pt; margin-top: 18pt; }
  .two-col .col { flex: 1; }

  .questions { margin-top: 24pt; padding-top: 18pt; border-top: 0.5pt solid var(--rule); }
  .questions h4 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 18pt; color: var(--ink); margin: 0 0 10pt; }
  .questions ul { list-style: none; padding: 0; }
  .questions li { font-size: 11pt; color: var(--ink); padding: 4pt 0 4pt 24pt; position: relative; }
  .questions li::before { content: "?"; color: var(--lumidian); font-weight: 600; position: absolute; left: 0; top: 4pt; font-family: "Instrument Serif", Georgia, serif; font-size: 14pt; }
{% endblock %}

{% block body %}
<div class="page">
  <div class="lockup">
    {% if logo_data_uri %}<img src="{{ logo_data_uri }}" alt="Lumidian" />{% endif %}
    <span class="wordmark">Lumidian</span>
  </div>
  <div class="hero-soft">
    <div class="tracker">Initial Audit</div>
    <div class="name">{{ data.client.name }}</div>
    <div class="date">{{ generated_label }}</div>
  </div>

  <div class="audit-body">
    <h4>Current state</h4>
    {% if data.latest_run %}
      <div class="score-inset">
        <div class="num">{{ data.latest_run.overall_score|round|int }}<span class="pct">%</span></div>
        <div class="sub">{{ data.latest_run.total_mentions }}/{{ data.latest_run.total_queries }} queries · baseline run</div>
      </div>
    {% endif %}
    <div>{{ sections.current_state | safe }}</div>

    {% if sections.working %}
      <h4 style="margin-top: 18pt;">What's working</h4>
      {{ sections.working | safe }}
    {% endif %}

    <div class="two-col">
      <div class="col">
        <h4>Gaps</h4>
        {{ sections.gaps | safe }}
      </div>
      <div class="col">
        <h4>Recommendations (next 30 days)</h4>
        {{ sections.recommendations | safe }}
      </div>
    </div>

    {% if sections.questions %}
      <div class="questions">
        <h4>Open questions for {{ data.client.name }}</h4>
        {{ sections.questions | safe }}
      </div>
    {% endif %}
  </div>

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">1</div>
  </div>
</div>
{% endblock %}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_audit_initial_shows_score_inset_when_present -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_engine/templates/audit_initial.html.j2 backend/tests/test_document_pdf_rendering.py
git commit -m "feat(docs): initial audit PDF template (briefing personality)"
```

---

## Task 12: Monthly report template (Report personality)

**Files:**
- Create: `backend/app/services/document_engine/templates/monthly_report.html.j2`
- Test: extend `backend/tests/test_document_pdf_rendering.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_render_html_monthly_report_has_cover_and_summary():
    body = (
        "# Monthly\n\n"
        "## Summary\n\nVisibility up 8 points; 12 posts shipped.\n\n"
        "## Visibility Change\n\nFrom 42% to 50%.\n\n"
        "## Content Shipped\n\n- linkedin: 6\n- medium: 4\n- reddit: 2\n\n"
        "## Notable Activity\n\n- 8 drafts approved\n- Client kicked off pillar page\n\n"
        "## Next Month\n\n- Ramp Reddit\n- Wikipedia stub\n"
    )
    snapshot = {
        "client": {"name": "MonthlyCo"},
        "period": {"start": "2026-05-01T00:00:00", "end": "2026-05-18T12:00:00", "label": "May 2026"},
        "this_month_run": {"overall_score": 50.0, "total_queries": 36},
        "last_month_run": {"overall_score": 42.0, "total_queries": 36},
        "drafts_posted_this_month": 12,
        "drafts_by_platform": {"linkedin": 6, "medium": 4, "reddit": 2},
        "activity_events_count": 18,
        "activity_sample": [],
        "has_data": True,
    }
    doc_id = await _make_client_with_doc("MonthlyCo", "monthly_report", body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_html
        html = render_html(doc, snapshot)
    assert "MonthlyCo" in html
    assert "May 2026" in html
    assert "Monthly Report" in html or "MONTHLY REPORT" in html
    assert "50" in html  # hero score
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_monthly_report_has_cover_and_summary -v`
Expected: FAIL.

- [ ] **Step 3: Write the monthly report template**

```jinja
{# backend/app/services/document_engine/templates/monthly_report.html.j2 #}
{% extends "_base.html.j2" %}

{% block extra_styles %}
  .cover { position: relative; height: 9.5in; }
  .cover .hero { text-align: center; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); }
  .cover .hero .label { font-size: 11pt; letter-spacing: 3pt; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 24pt; }
  .cover .hero .name { font-family: "Instrument Serif", Georgia, serif; font-size: 64pt; color: var(--ink); margin: 0 0 18pt; line-height: 1.1; font-weight: 400; }
  .cover .hero .period { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 18pt; color: var(--ink-soft); font-weight: 400; }
  .cover .meta { display: flex; justify-content: space-between; font-size: 10pt; color: var(--ink-mute); padding-top: 12pt; border-top: 0.5pt solid var(--rule); position: absolute; left: 0; right: 0; bottom: 0; }

  .headline { display: flex; flex-direction: column; align-items: center; margin-top: 60pt; }
  .headline .score { font-family: "Instrument Serif", Georgia, serif; font-size: 120pt; line-height: 1; color: var(--ink); font-weight: 400; }
  .headline .score .pct { font-size: 40pt; color: var(--ink-faint); }
  .headline .delta { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 14pt; font-weight: 500; margin-top: 12pt; }
  .headline .delta.up { color: var(--up); }
  .headline .delta.down { color: var(--down); }
  .headline .delta.flat { color: var(--flat); }
  .headline .delta .arrow { display: inline-block; margin-right: 8pt; }
  .headline .summary { margin-top: 36pt; max-width: 5in; text-align: center; font-size: 12pt; line-height: 1.6; color: var(--ink-soft); }

  h2 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 22pt; margin-bottom: 12pt; color: var(--ink); border-bottom: 0.5pt solid var(--rule); padding-bottom: 6pt; }
{% endblock %}

{% block body %}

<!-- PAGE 1 — Cover -->
<div class="page cover">
  <div class="lockup">
    {% if logo_data_uri %}<img src="{{ logo_data_uri }}" alt="Lumidian" />{% endif %}
    <span class="wordmark">Lumidian</span>
  </div>
  <div class="hero">
    <div class="label">Monthly Report</div>
    <div class="name">{{ data.client.name }}</div>
    <div class="period">{{ data.period.label }}</div>
  </div>
  <div class="meta">
    <div>Prepared by Lumidian</div>
    <div>{{ generated_label }}</div>
  </div>
</div>

<!-- PAGE 2 — Headline -->
<div class="page">
  <div class="tracker">Executive summary</div>
  <div class="headline">
    {% if data.this_month_run %}
      <div class="score">{{ data.this_month_run.overall_score|round|int }}<span class="pct">%</span></div>
      {% set delta = (data.this_month_run.overall_score - data.last_month_run.overall_score) if data.last_month_run else None %}
      {% if delta is not none %}
        <div class="delta {% if delta > 0 %}up{% elif delta < 0 %}down{% else %}flat{% endif %}">
          <span class="arrow">{% if delta > 0 %}▲{% elif delta < 0 %}▼{% else %}—{% endif %}</span>{{ (delta|round(1)) }} pts vs last month
        </div>
      {% else %}
        <div class="delta flat">Baseline month — no prior data to compare</div>
      {% endif %}
    {% else %}
      <div class="score muted">—</div>
      <div class="delta flat">Tracking baseline not yet established</div>
    {% endif %}
    <div class="summary">{{ sections.summary | safe }}</div>
  </div>
  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">2</div>
  </div>
</div>

<!-- PAGE 3 — Visibility change + content shipped -->
<div class="page">
  <h2>Visibility change</h2>
  <div class="card">{{ sections.visibility | safe }}</div>

  <h2>Content shipped</h2>
  <div class="card">
    {% if data.drafts_by_platform %}
      <ul style="margin: 0; padding-left: 16pt;">
        {% for platform, count in data.drafts_by_platform.items() %}
          <li><strong>{{ platform }}</strong> — {{ count }} post{{ '' if count == 1 else 's' }}</li>
        {% endfor %}
      </ul>
    {% else %}
      <span class="muted">No content posted this month.</span>
    {% endif %}
  </div>

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">3</div>
  </div>
</div>

<!-- PAGE 4 — Activity + next month -->
<div class="page">
  <h2>Notable activity</h2>
  <div class="card">{{ sections.activity | safe }}</div>

  <h2>Next month</h2>
  <div>{{ sections.next_month | safe }}</div>

  <div class="footer">
    <div class="wordmark">Lumidian</div>
    <div>{{ data.client.name }}</div>
    <div class="right">4</div>
  </div>
</div>

{% endblock %}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_html_monthly_report_has_cover_and_summary -v`
Expected: PASS.

- [ ] **Step 5: Run the entire document PDF test suite**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py tests/test_agency_pdf_report.py tests/test_agency_weekly_report.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/document_engine/templates/monthly_report.html.j2 backend/tests/test_document_pdf_rendering.py
git commit -m "feat(docs): monthly report PDF template (report personality)"
```

---

## Task 13: PDF render smoke test (all 5 kinds → real bytes)

**Files:**
- Test: extend `backend/tests/test_document_pdf_rendering.py`

- [ ] **Step 1: Write the all-kinds render test**

Append:

```python
@pytest.mark.asyncio
@pytest.mark.parametrize("kind,body,snapshot", [
    ("sow",
     "# SOW\n## 1. Engagement Summary\n\nx\n## 2. Scope of Services\n\nx\n## 3. Deliverables\n\nx\n## 4. Term\n\nx\n## 5. Payment Terms\n\nx\n## 6. Termination\n\nx\n## 7. Signatures\n\nx\n",
     {"client": {"name": "C", "primary_contact_name": "N", "primary_contact_email": "e@e.com", "retainer_amount_usd": 1000, "retainer_started_at": None}, "brand": {"name": "C", "website_url": "x"}, "brand_profile": None, "today": "May 18, 2026"}),
    ("kickoff_checklist",
     "# K\n## What we have\n\n- [x] a\n## What the client still owes\n\n- [ ] b\n## Suggested first call\n\n- c\n",
     {"client": {"name": "C", "primary_contact_name": True, "primary_contact_email": True}, "brand": {"name": "C", "website_url": True}, "brand_profile": None, "prompt_count": 3}),
    ("audit_initial",
     "# A\n## Current State\n\nx\n## What's Working\n\n- y\n## Gaps\n\n- z\n## Recommendations (next 30 days)\n\n- q\n## Open Questions for the Client\n\n- r?\n",
     {"client": {"name": "C", "slug": "c", "status": "active"}, "brand": {"name": "C", "website_url": "x"}, "brand_profile": None, "prompts": [], "competitors": [], "latest_run": None, "generated_at": "2026-05-18T12:00:00", "has_data": False}),
    ("monthly_report",
     "# M\n## Summary\n\nx\n## Visibility Change\n\ny\n## Content Shipped\n\nz\n## Notable Activity\n\nq\n## Next Month\n\nr\n",
     {"client": {"name": "C"}, "period": {"label": "May 2026"}, "this_month_run": None, "last_month_run": None, "drafts_posted_this_month": 0, "drafts_by_platform": {}, "activity_events_count": 0, "activity_sample": [], "has_data": False}),
])
async def test_render_pdf_produces_nonempty_bytes_for_each_kind(kind, body, snapshot):
    doc_id = await _make_client_with_doc(f"Pdf{kind}", kind, body, snapshot)
    async with AsyncSessionLocal() as db:
        doc = await db.get(ClientDocument, doc_id)
        from app.services.document_engine.pdf_renderer import render_pdf
        pdf = await render_pdf(db, doc)
    assert isinstance(pdf, bytes)
    assert len(pdf) > 1000  # any real PDF is well over a KB
    assert pdf.startswith(b"%PDF-")
```

- [ ] **Step 2: Run the parametrized PDF smoke test**

Run: `cd backend && pytest tests/test_document_pdf_rendering.py::test_render_pdf_produces_nonempty_bytes_for_each_kind -v`
Expected: 4 PASS (one per kind). This actually launches Playwright, so it takes 30-60s total. If Playwright is not installed, run `playwright install chromium` first.

- [ ] **Step 3: Run the entire test suite to ensure no regressions**

Run: `cd backend && pytest tests/ -x --ff -q`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_document_pdf_rendering.py
git commit -m "test(docs): parametrized PDF render smoke for all 4 new kinds"
```

---

# Phase 4 — Public Review Endpoints

## Task 14: `GET /public/review/{token}/documents` endpoint

**Files:**
- Modify: `backend/app/routers/review_public.py`
- Modify: `backend/app/schemas.py` (new response schema)
- Test: `backend/tests/test_public_review_documents.py` (new file)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_public_review_documents.py
"""Tests for the public client review document endpoints (no auth)."""
from __future__ import annotations

import pytest

from app.database import AsyncSessionLocal
from app.models import AgencyClient, Brand, ClientDocument, ClientReviewLink


async def _setup(client_name: str = "DocsClient") -> tuple[str, int, int]:
    """Returns (token, client_id, doc_id)."""
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name=client_name, slug=client_name.lower().replace(" ", "-"))
        db.add(ac)
        await db.flush()
        Brand_ = Brand(name=client_name, slug=f"b-{ac.slug}", agency_client_id=ac.id, brand_type="agency")
        db.add(Brand_)
        link = ClientReviewLink(agency_client_id=ac.id, token=f"tok-docs-{ac.slug}")
        db.add(link)
        doc = ClientDocument(
            agency_client_id=ac.id,
            kind="sow",
            title=f"SOW — {client_name}",
            body_markdown="# SOW\n\n## 1. Engagement Summary\n\nx\n",
        )
        db.add(doc)
        await db.commit()
        return link.token, ac.id, doc.id


@pytest.mark.asyncio
async def test_list_documents_invalid_token_returns_404(client):
    resp = await client.get("/api/public/review/does-not-exist/documents")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_documents_returns_only_this_clients_docs(client):
    token, client_id, doc_id = await _setup("AClient")
    other_token, _, other_doc_id = await _setup("BClient")

    resp = await client.get(f"/api/public/review/{token}/documents")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    ids = [d["id"] for d in body]
    assert doc_id in ids
    assert other_doc_id not in ids
    for d in body:
        assert "kind" in d
        assert "title" in d
        assert "generated_at" in d


@pytest.mark.asyncio
async def test_list_documents_empty_when_no_docs(client):
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name="Empty", slug="empty")
        db.add(ac)
        await db.flush()
        link = ClientReviewLink(agency_client_id=ac.id, token="tok-empty")
        db.add(link)
        await db.commit()

    resp = await client.get("/api/public/review/tok-empty/documents")
    assert resp.status_code == 200
    assert resp.json() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_public_review_documents.py -v`
Expected: tests fail with 404 (endpoint not defined yet).

- [ ] **Step 3: Add the response schema**

Open `backend/app/schemas.py` and add (near other public-review schemas like `ReviewDraftOut`):

```python
class PublicDocumentSummaryOut(BaseModel):
    id: int
    kind: str
    title: str
    generated_at: datetime
    pdf_available: bool

    model_config = ConfigDict(from_attributes=True)
```

(If `from datetime import datetime` and `from pydantic import BaseModel, ConfigDict` aren't already imported in `schemas.py`, add them.)

- [ ] **Step 4: Add the endpoint**

Open `backend/app/routers/review_public.py` and add (after the existing `reject_draft` handler):

```python
# ── Document library endpoints ────────────────────────────────────────────────

# Kinds that have a registered PDF template — must stay in sync with
# pdf_renderer._KIND_TO_TEMPLATE.
_PDF_AVAILABLE_KINDS = {"agency_weekly_report", "monthly_report", "sow", "audit_initial", "kickoff_checklist"}


@router.get("/{token}/documents", response_model=list[PublicDocumentSummaryOut])
async def list_documents(token: str, db: AsyncSession = Depends(get_db)):
    client_id = await _resolve_client_id(db, token)
    q = await db.execute(
        select(ClientDocument)
        .where(ClientDocument.agency_client_id == client_id)
        .order_by(ClientDocument.generated_at.desc())
    )
    docs = list(q.scalars().all())
    return [
        PublicDocumentSummaryOut(
            id=d.id,
            kind=d.kind,
            title=d.title,
            generated_at=d.generated_at,
            pdf_available=d.kind in _PDF_AVAILABLE_KINDS,
        )
        for d in docs
    ]
```

Add the import at the top of the file:

```python
from app.models import (
    AgencyClient,
    AgencyStaff,
    Brand,
    ClientDocument,                # NEW
    ClientReviewLink,
    ContentDraft,
    Notification,
)
from app.schemas import (
    ChangesRequestIn,
    PublicDocumentSummaryOut,      # NEW
    RejectIn,
    ReviewClientPageOut,
    ReviewDraftOut,
)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_public_review_documents.py -v`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/review_public.py backend/app/schemas.py backend/tests/test_public_review_documents.py
git commit -m "feat(review): public endpoint to list client documents"
```

---

## Task 15: `GET /public/review/{token}/document/{id}` (HTML) endpoint

**Files:**
- Modify: `backend/app/routers/review_public.py`
- Test: extend `backend/tests/test_public_review_documents.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_get_document_html_returns_rendered_html(client):
    token, _, doc_id = await _setup("HtmlClient")
    resp = await client.get(f"/api/public/review/{token}/document/{doc_id}")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    body = resp.text
    assert "<!DOCTYPE html>" in body
    assert "HtmlClient" in body


@pytest.mark.asyncio
async def test_get_document_html_rejects_doc_from_other_client(client):
    token_a, _, _ = await _setup("AAA")
    _, _, doc_b = await _setup("BBB")
    resp = await client.get(f"/api/public/review/{token_a}/document/{doc_b}")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_public_review_documents.py::test_get_document_html_returns_rendered_html tests/test_public_review_documents.py::test_get_document_html_rejects_doc_from_other_client -v`
Expected: 404 / errors — endpoint doesn't exist.

- [ ] **Step 3: Add the endpoint**

Append to `backend/app/routers/review_public.py`:

```python
async def _resolve_client_doc(db: AsyncSession, token: str, doc_id: int) -> ClientDocument:
    client_id = await _resolve_client_id(db, token)
    doc = await db.get(ClientDocument, doc_id)
    if doc is None or doc.agency_client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{token}/document/{doc_id}", response_class=Response)
async def get_document_html(token: str, doc_id: int, db: AsyncSession = Depends(get_db)):
    from app.services.document_engine.pdf_renderer import render_html
    doc = await _resolve_client_doc(db, token, doc_id)
    # Resolve data the same way render_pdf does
    from app.services.document_engine.pdf_renderer import _resolve_data
    data = await _resolve_data(db, doc)
    html = render_html(doc, data)
    return Response(content=html, media_type="text/html; charset=utf-8")
```

Add at the top:

```python
from fastapi.responses import Response
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_public_review_documents.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/review_public.py backend/tests/test_public_review_documents.py
git commit -m "feat(review): public endpoint to render document HTML inline"
```

---

## Task 16: `GET /public/review/{token}/document/{id}/pdf` endpoint

**Files:**
- Modify: `backend/app/routers/review_public.py`
- Test: extend `backend/tests/test_public_review_documents.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
@pytest.mark.asyncio
async def test_get_document_pdf_returns_pdf_bytes(client):
    token, _, doc_id = await _setup("PdfClient")
    resp = await client.get(f"/api/public/review/{token}/document/{doc_id}/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:5] == b"%PDF-"


@pytest.mark.asyncio
async def test_get_document_pdf_rejects_doc_from_other_client(client):
    token_a, _, _ = await _setup("PdfA")
    _, _, doc_b = await _setup("PdfB")
    resp = await client.get(f"/api/public/review/{token_a}/document/{doc_b}/pdf")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_public_review_documents.py -v -k pdf`
Expected: failures.

- [ ] **Step 3: Add the endpoint**

Append to `backend/app/routers/review_public.py`:

```python
@router.get("/{token}/document/{doc_id}/pdf", response_class=Response)
async def get_document_pdf(token: str, doc_id: int, db: AsyncSession = Depends(get_db)):
    from app.services.document_engine.pdf_renderer import render_pdf
    doc = await _resolve_client_doc(db, token, doc_id)
    try:
        pdf_bytes = await render_pdf(db, doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render PDF: {e}") from e
    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in doc.title)[:120].strip() or f"document-{doc.id}"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_public_review_documents.py -v`
Expected: all PASS (this triggers Playwright, ~10s).

- [ ] **Step 5: Run the entire backend test suite**

Run: `cd backend && pytest tests/ -x --ff -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/review_public.py backend/tests/test_public_review_documents.py
git commit -m "feat(review): public endpoint to download document PDF"
```

---

# Phase 5 — Review Page Frontend

## Task 17: Frontend API client + middleware update

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/middleware.ts`

- [ ] **Step 1: Add new API types and methods**

Open `frontend/lib/api.ts`. Find the existing public-review section (around line 1151, `// ── Public review (no auth) ──`). Append after the existing methods:

```typescript
export interface PublicDocumentSummary {
  id: number;
  kind: string;
  title: string;
  generated_at: string;
  pdf_available: boolean;
}

export async function publicListDocuments(token: string): Promise<PublicDocumentSummary[]> {
  const res = await api.get<PublicDocumentSummary[]>(`/public/review/${token}/documents`);
  return res.data;
}

export async function publicGetDocumentHtml(token: string, docId: number): Promise<string> {
  const res = await api.get<string>(`/public/review/${token}/document/${docId}`, {
    responseType: 'text',
    transformResponse: (data) => data,
  });
  return res.data;
}

export function publicDocumentPdfUrl(token: string, docId: number): string {
  // Returns an absolute URL the browser can hit directly to trigger a download.
  const base = (api.defaults.baseURL || '').replace(/\/+$/, '');
  return `${base}/public/review/${token}/document/${docId}/pdf`;
}
```

- [ ] **Step 2: Update middleware to make `/review/*` public**

Open `frontend/middleware.ts`. Find the public-paths definition (an array or regex of public routes — e.g. `/`, `/login`, `/register`). Add `/review/` (or `/review/[token]` pattern) so it bypasses the auth redirect.

If the middleware uses an array of prefixes:

```typescript
const PUBLIC_PATHS = ['/', '/login', '/register', '/onboarding', '/forgot-password', '/reset-password', '/team/accept', '/review'];
```

If it uses a regex matcher, add `/review/.*` to the regex.

If it uses `startsWith` checks, add a check for `pathname.startsWith('/review/')`.

- [ ] **Step 3: Type-check the frontend**

Run: `cd frontend && npm run lint`
Expected: no new errors.

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/middleware.ts
git commit -m "feat(review): API client methods + middleware bypass for /review/*"
```

---

## Task 18: Review page layout + fonts

**Files:**
- Create: `frontend/app/review/[token]/layout.tsx`
- Create: `frontend/app/review/[token]/styles.module.css`

- [ ] **Step 1: Write the layout**

```tsx
// frontend/app/review/[token]/layout.tsx
import type { Metadata } from 'next';
import { Inter, Instrument_Serif, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', weight: ['400', '500', '600'] });
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], variable: '--font-instrument', weight: '400', style: ['normal', 'italic'] });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'Lumidian — Client Review',
  robots: 'noindex, nofollow',
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${instrumentSerif.variable} ${ibmPlexMono.variable}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write the global CSS for the review route**

```css
/* frontend/app/review/[token]/globals.css */
:root {
  /* paper & ink — mirrors backend _styles.css.j2 */
  --paper: #FAF7F2;
  --paper-elev: #FFFFFF;
  --ink: #0B1220;
  --ink-soft: #334155;
  --ink-mute: #6B7280;
  --ink-faint: #9AA4B2;
  --rule: #E6E1D8;

  --lumidian: #2447EE;
  --lumidian-tint: rgba(36, 71, 238, 0.08);

  --up: #047857;
  --down: #B91C1C;
}
```

- [ ] **Step 3: Write the page-local CSS module**

```css
/* frontend/app/review/[token]/styles.module.css */
.shell {
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink-soft);
  font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px 40px;
  max-width: 1100px;
  margin: 0 auto;
}

.lockup {
  display: flex;
  align-items: center;
  gap: 10px;
}
.lockup img {
  height: 28px;
  width: auto;
}
.lockup .wordmark {
  font-family: var(--font-instrument), Georgia, serif;
  font-size: 16px;
  color: var(--ink);
  letter-spacing: 0.4px;
}

.secureBadge {
  font-family: var(--font-mono), monospace;
  font-size: 10px;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.content {
  max-width: 880px;
  margin: 0 auto;
  padding: 24px 40px 120px;
}

.hero {
  padding: 32px 0 40px;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 48px;
}
.tracker {
  font-family: var(--font-inter), sans-serif;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 2.2px;
  text-transform: uppercase;
  color: var(--ink-mute);
}
.headline {
  font-family: var(--font-instrument), Georgia, serif;
  font-weight: 400;
  font-size: 40px;
  line-height: 1.15;
  color: var(--ink);
  margin: 16px 0 12px;
}
.headlineSub {
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.55;
}

.section {
  margin-bottom: 56px;
}
.sectionTitle {
  font-family: var(--font-instrument), Georgia, serif;
  font-weight: 400;
  font-size: 24px;
  color: var(--ink);
  margin: 0 0 20px;
}

.footer {
  position: sticky;
  bottom: 0;
  background: var(--paper);
  border-top: 1px solid var(--rule);
  padding: 14px 40px;
  font-family: var(--font-mono), monospace;
  font-size: 11px;
  color: var(--ink-faint);
  text-align: center;
}
.footer a {
  color: var(--ink-mute);
  text-decoration: none;
}
.footer a:hover { color: var(--ink); }
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/review/
git commit -m "feat(review): layout + fonts + design tokens for client review page"
```

---

## Task 19: Server page + initial data fetch

**Files:**
- Create: `frontend/app/review/[token]/page.tsx`
- Create: `frontend/app/review/[token]/RevokedState.tsx`

- [ ] **Step 1: Write the revoked-state component**

```tsx
// frontend/app/review/[token]/RevokedState.tsx
import styles from './styles.module.css';

export function RevokedState() {
  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div className={styles.lockup}>
          <img src="/logo.png" alt="Lumidian" />
          <span className="wordmark" style={{ fontFamily: 'var(--font-instrument), Georgia, serif', fontSize: 16, color: 'var(--ink)' }}>Lumidian</span>
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.hero}>
          <div className={styles.tracker}>REVIEW LINK</div>
          <h1 className={styles.headline}>This link is no longer active.</h1>
          <p className={styles.headlineSub}>Please contact your Lumidian point of contact for a new link.</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the server page**

```tsx
// frontend/app/review/[token]/page.tsx
import {
  publicGetReviewPage,
  publicListDocuments,
  type ReviewClientPage,
  type PublicDocumentSummary,
} from '@/lib/api';
import { ReviewPage } from './ReviewPage';
import { RevokedState } from './RevokedState';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function ReviewTokenPage({ params }: Props) {
  const { token } = await params;
  let page: ReviewClientPage;
  let documents: PublicDocumentSummary[];
  try {
    [page, documents] = await Promise.all([
      publicGetReviewPage(token),
      publicListDocuments(token),
    ]);
  } catch (err) {
    return <RevokedState />;
  }
  return <ReviewPage token={token} initial={page} initialDocuments={documents} />;
}
```

- [ ] **Step 3: Type-check + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: errors about `ReviewPage` not existing yet — that's fine, we build it in the next task. Note them and continue.

- [ ] **Step 4: Commit (intermediate — page won't compile yet, but the file structure stands)**

Skip commit until the next task completes — `page.tsx` references `ReviewPage.tsx` which doesn't exist yet. Move directly to Task 20.

---

## Task 20: `ReviewPage.tsx` (client component, optimistic state)

**Files:**
- Create: `frontend/app/review/[token]/ReviewPage.tsx`
- Create: `frontend/app/review/[token]/EmptyState.tsx`

- [ ] **Step 1: Write the empty state**

```tsx
// frontend/app/review/[token]/EmptyState.tsx
import styles from './styles.module.css';

interface Props {
  message: string;
}

export function EmptyState({ message }: Props) {
  return (
    <div style={{
      textAlign: 'center',
      color: 'var(--ink-mute)',
      fontSize: 14,
      padding: '64px 0',
      fontStyle: 'italic',
      fontFamily: 'var(--font-instrument), Georgia, serif',
    }}>
      {message}
    </div>
  );
}
```

- [ ] **Step 2: Write the page client component**

```tsx
// frontend/app/review/[token]/ReviewPage.tsx
'use client';

import { useState } from 'react';
import type { ReviewClientPage, ReviewDraft, PublicDocumentSummary } from '@/lib/api';
import { DraftCard } from './DraftCard';
import { DocumentCard } from './DocumentCard';
import { DocumentReader } from './DocumentReader';
import { EmptyState } from './EmptyState';
import styles from './styles.module.css';

interface DraftRowState {
  status: 'pending' | 'approved' | 'changes_requested' | 'rejected';
  reviewedAt?: Date;
}

interface Props {
  token: string;
  initial: ReviewClientPage;
  initialDocuments: PublicDocumentSummary[];
}

export function ReviewPage({ token, initial, initialDocuments }: Props) {
  const [draftStates, setDraftStates] = useState<Record<number, DraftRowState>>(
    Object.fromEntries(initial.drafts.map((d) => [d.id, { status: 'pending' as const }])),
  );
  const [openDocId, setOpenDocId] = useState<number | null>(null);

  const pendingDrafts = initial.drafts.filter((d) => draftStates[d.id]?.status === 'pending');
  const handledDrafts = initial.drafts.filter((d) => draftStates[d.id]?.status !== 'pending');

  const pendingCount = pendingDrafts.length;
  const headline =
    pendingCount === 1
      ? '1 draft ready for your review.'
      : pendingCount > 1
        ? `${pendingCount} drafts ready for your review.`
        : initialDocuments.length > 0
          ? 'Your Lumidian library.'
          : 'Nothing waiting for you right now.';

  const subhead = pendingCount > 0
    ? 'Approve, request changes, or reject each draft. We see your decision instantly.'
    : initialDocuments.length > 0
      ? `Every report Lumidian has published for ${initial.client_name}.`
      : 'Lumidian will email you when there’s something to review.';

  const openDoc = initialDocuments.find((d) => d.id === openDocId) ?? null;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.lockup}>
          <img src="/logo.png" alt="Lumidian" />
          <span className="wordmark" style={{ fontFamily: 'var(--font-instrument), Georgia, serif', fontSize: 16, color: 'var(--ink)' }}>Lumidian</span>
        </div>
        <div className={styles.secureBadge}>Secure review link</div>
      </header>

      <main className={styles.content}>
        <section className={styles.hero}>
          <div className={styles.tracker}>LUMIDIAN × {initial.client_name.toUpperCase()}</div>
          <h1 className={styles.headline}>{headline}</h1>
          <p className={styles.headlineSub}>{subhead}</p>
        </section>

        {initial.drafts.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Drafts</h2>
            {pendingDrafts.length === 0 && handledDrafts.length === 0 ? (
              <EmptyState message="No drafts waiting." />
            ) : (
              <>
                {pendingDrafts.map((d) => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    token={token}
                    onResolved={(status) =>
                      setDraftStates((prev) => ({ ...prev, [d.id]: { status, reviewedAt: new Date() } }))
                    }
                  />
                ))}
                {handledDrafts.map((d) => {
                  const st = draftStates[d.id];
                  return (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      token={token}
                      resolvedStatus={st.status as Exclude<DraftRowState['status'], 'pending'>}
                      resolvedAt={st.reviewedAt}
                      onResolved={() => {}}
                    />
                  );
                })}
              </>
            )}
          </section>
        )}

        {initialDocuments.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Documents</h2>
            {initialDocuments.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                token={token}
                onOpen={() => setOpenDocId(doc.id)}
              />
            ))}
          </section>
        )}

        {initial.drafts.length === 0 && initialDocuments.length === 0 && (
          <EmptyState message="Nothing here yet." />
        )}
      </main>

      <footer className={styles.footer}>
        Powered by <a href="https://lumidian.com" target="_blank" rel="noreferrer">Lumidian</a>
      </footer>

      {openDoc && (
        <DocumentReader
          token={token}
          doc={openDoc}
          onClose={() => setOpenDocId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit (still won't compile — DraftCard/DocumentCard/DocumentReader stubs needed next)**

Skip; proceed to Tasks 21–23.

---

## Task 21: `DraftCard.tsx` — the approval card

**Files:**
- Create: `frontend/app/review/[token]/DraftCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/app/review/[token]/DraftCard.tsx
'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { publicApproveDraft, publicRequestChanges, publicRejectDraft, type ReviewDraft } from '@/lib/api';

type Status = 'approved' | 'changes_requested' | 'rejected';

interface Props {
  draft: ReviewDraft;
  token: string;
  onResolved: (status: Status) => void;
  resolvedStatus?: Status;
  resolvedAt?: Date;
}

const STATUS_LABEL: Record<Status, string> = {
  approved: '✓ Approved',
  changes_requested: '⤴ Changes requested',
  rejected: '✕ Rejected',
};
const STATUS_COLOR: Record<Status, string> = {
  approved: 'var(--up)',
  changes_requested: 'var(--ink-soft)',
  rejected: 'var(--down)',
};

export function DraftCard({ draft, token, onResolved, resolvedStatus, resolvedAt }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (resolvedStatus) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{
          padding: '12px 18px',
          margin: '12px 0',
          borderLeft: `2px solid ${STATUS_COLOR[resolvedStatus]}`,
          color: STATUS_COLOR[resolvedStatus],
          fontSize: 13,
          fontFamily: 'var(--font-mono), monospace',
        }}
      >
        {STATUS_LABEL[resolvedStatus]} — {draft.title || 'Untitled'}
        {resolvedAt && (
          <span style={{ color: 'var(--ink-faint)', marginLeft: 8 }}>
            {resolvedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </motion.div>
    );
  }

  const handle = async (action: 'approve' | 'changes' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'approve') {
        await publicApproveDraft(token, draft.id);
        onResolved('approved');
      } else if (action === 'changes') {
        if (!feedback.trim()) {
          setError('Please tell us what you’d like changed.');
          setBusy(false);
          return;
        }
        await publicRequestChanges(token, draft.id, feedback);
        onResolved('changes_requested');
      } else {
        await publicRejectDraft(token, draft.id, rejectReason);
        onResolved('rejected');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      style={{
        background: 'var(--paper-elev)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        padding: 24,
        margin: '16px 0',
      }}
    >
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--lumidian-tint)',
        color: 'var(--lumidian)',
        padding: '4px 10px',
        borderRadius: 999,
        fontFamily: 'var(--font-mono), monospace',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        fontWeight: 600,
      }}>
        <span>●</span>{draft.platform}
      </div>

      <h3 style={{
        fontFamily: 'var(--font-instrument), Georgia, serif',
        fontWeight: 400,
        fontSize: 22,
        color: 'var(--ink)',
        margin: '12px 0 10px',
        lineHeight: 1.25,
      }}>
        {draft.title || `Draft #${draft.id}`}
      </h3>

      <div style={{
        color: 'var(--ink-soft)',
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        maxHeight: expanded ? 'none' : 110,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {draft.content_text}
        {!expanded && draft.content_text.length > 220 && (
          <div style={{
            position: 'absolute',
            bottom: 0, left: 0, right: 0, height: 40,
            background: 'linear-gradient(to bottom, transparent, var(--paper-elev))',
          }} />
        )}
      </div>
      {draft.content_text.length > 220 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            color: 'var(--lumidian)',
            fontSize: 13,
            cursor: 'pointer',
            marginTop: 8,
            fontWeight: 500,
          }}
        >
          {expanded ? 'Show less ↑' : 'Read full draft ↓'}
        </button>
      )}

      <AnimatePresence>
        {showChanges && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginTop: 16, overflow: 'hidden' }}
          >
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What would you like changed?"
              rows={4}
              style={{
                width: '100%',
                padding: 12,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                background: 'var(--paper)',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: 14,
                color: 'var(--ink)',
                resize: 'vertical',
                outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--lumidian)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => handle('changes')} disabled={busy}
                style={{ padding: '8px 16px', background: 'var(--ink)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                Send feedback
              </button>
              <button onClick={() => { setShowChanges(false); setFeedback(''); setError(null); }} disabled={busy}
                style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink-mute)', border: 0, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
        {showReject && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginTop: 16, overflow: 'hidden' }}
          >
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why are you rejecting this? (optional)"
              rows={3}
              style={{
                width: '100%',
                padding: 12,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                background: 'var(--paper)',
                fontFamily: 'var(--font-inter), sans-serif',
                fontSize: 14,
                color: 'var(--ink)',
                resize: 'vertical',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => handle('reject')} disabled={busy}
                style={{ padding: '8px 16px', background: 'var(--down)', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                Confirm reject
              </button>
              <button onClick={() => { setShowReject(false); setRejectReason(''); setError(null); }} disabled={busy}
                style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink-mute)', border: 0, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div style={{ color: 'var(--down)', fontSize: 13, marginTop: 12 }}>{error}</div>
      )}

      {!showChanges && !showReject && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            onClick={() => setShowReject(true)}
            disabled={busy}
            style={{ background: 'none', border: 0, color: 'var(--ink-mute)', fontSize: 13, cursor: 'pointer', padding: '8px 12px' }}
          >
            Reject
          </button>
          <button
            onClick={() => setShowChanges(true)}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '1px solid var(--rule)',
              borderRadius: 6,
              color: 'var(--ink)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '8px 14px',
              fontWeight: 500,
            }}
          >
            Request changes
          </button>
          <button
            onClick={() => handle('approve')}
            disabled={busy}
            style={{
              background: 'var(--lumidian)',
              border: 0,
              borderRadius: 6,
              color: 'white',
              fontSize: 13,
              cursor: 'pointer',
              padding: '10px 18px',
              fontWeight: 600,
              minHeight: 36,
            }}
          >
            {busy ? 'Saving…' : 'Approve →'}
          </button>
        </div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 2: Verify framer-motion is installed**

Run: `cd frontend && npm ls framer-motion`
Expected: a version is listed.

If missing: `npm install framer-motion`.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only on remaining stubs (DocumentCard, DocumentReader).

- [ ] **Step 4: Commit (defer to end of phase 5 — file still won't compile)**

---

## Task 22: `DocumentCard.tsx` — library row

**Files:**
- Create: `frontend/app/review/[token]/DocumentCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/app/review/[token]/DocumentCard.tsx
'use client';

import { publicDocumentPdfUrl, type PublicDocumentSummary } from '@/lib/api';

const KIND_LABEL: Record<string, string> = {
  agency_weekly_report: 'Weekly Report',
  monthly_report: 'Monthly Report',
  sow: 'Statement of Work',
  audit_initial: 'Initial Audit',
  kickoff_checklist: 'Kickoff Checklist',
};

interface Props {
  doc: PublicDocumentSummary;
  token: string;
  onOpen: () => void;
}

export function DocumentCard({ doc, token, onOpen }: Props) {
  const label = (KIND_LABEL[doc.kind] || doc.kind.replace(/_/g, ' ')).toUpperCase();
  const dateLabel = new Date(doc.generated_at + (doc.generated_at.endsWith('Z') ? '' : 'Z'))
    .toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div
      style={{
        background: 'var(--paper-elev)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        padding: 24,
        margin: '16px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-inter), sans-serif',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: 'var(--ink-mute)',
        }}>
          {label}
        </div>
        <h3 style={{
          fontFamily: 'var(--font-instrument), Georgia, serif',
          fontWeight: 400,
          fontSize: 20,
          color: 'var(--ink)',
          margin: '8px 0 6px',
          lineHeight: 1.3,
        }}>
          {doc.title}
        </h3>
        <div style={{
          fontFamily: 'var(--font-mono), monospace',
          fontSize: 11,
          color: 'var(--ink-mute)',
        }}>
          {dateLabel}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onOpen}
          style={{
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            color: 'var(--ink)',
            fontSize: 13,
            cursor: 'pointer',
            padding: '8px 16px',
            fontWeight: 500,
          }}
        >
          Open
        </button>
        {doc.pdf_available && (
          <a
            href={publicDocumentPdfUrl(token, doc.id)}
            download
            style={{
              background: 'var(--lumidian)',
              border: 0,
              borderRadius: 6,
              color: 'white',
              fontSize: 13,
              cursor: 'pointer',
              padding: '10px 16px',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Download ↓
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit (defer — DocumentReader still missing)**

---

## Task 23: `DocumentReader.tsx` — slide-in side panel

**Files:**
- Create: `frontend/app/review/[token]/DocumentReader.tsx`

- [ ] **Step 1: Write the component**

```tsx
// frontend/app/review/[token]/DocumentReader.tsx
'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { publicGetDocumentHtml, publicDocumentPdfUrl, type PublicDocumentSummary } from '@/lib/api';

interface Props {
  token: string;
  doc: PublicDocumentSummary;
  onClose: () => void;
}

export function DocumentReader({ token, doc, onClose }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicGetDocumentHtml(token, doc.id)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load document.'); });
    return () => { cancelled = true; };
  }, [token, doc.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(11, 18, 32, 0.4)',
          zIndex: 50,
        }}
      />
      <motion.div
        key="panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '60vw',
          minWidth: 480,
          background: 'var(--paper)',
          boxShadow: '-20px 0 60px rgba(11,18,32,0.15)',
          zIndex: 51,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: 13,
            color: 'var(--ink)',
            fontWeight: 500,
          }}>
            {doc.title}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {doc.pdf_available && (
              <a
                href={publicDocumentPdfUrl(token, doc.id)}
                download
                style={{
                  background: 'var(--lumidian)',
                  color: 'white',
                  borderRadius: 6,
                  textDecoration: 'none',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Download ↓
              </a>
            )}
            <button onClick={onClose}
              style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink)', cursor: 'pointer', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
              Close
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: 'var(--paper)' }}>
          {error && <div style={{ padding: 24, color: 'var(--down)' }}>{error}</div>}
          {!html && !error && <div style={{ padding: 24, color: 'var(--ink-mute)' }}>Loading…</div>}
          {html && (
            <iframe
              srcDoc={html}
              title={doc.title}
              style={{ width: '100%', height: '100%', border: 0, background: 'var(--paper)' }}
            />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

(Using `srcDoc` on an iframe isolates the document's CSS from the page chrome — important because the documents share token names that could conflict.)

- [ ] **Step 2: Type-check the whole frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: zero errors.

- [ ] **Step 4: Production build**

Run: `cd frontend && npm run build`
Expected: build succeeds; new route `/review/[token]` shown in the route summary as a dynamic page.

- [ ] **Step 5: Commit everything from Phase 5**

```bash
git add frontend/app/review/ frontend/lib/api.ts frontend/middleware.ts
git commit -m "feat(review): public client review page — drafts queue + document library"
```

---

## Task 24: End-to-end smoke verification

**Files:** none — manual verification.

- [ ] **Step 1: Start both servers**

```bash
# Terminal A
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001

# Terminal B
cd frontend && npm run dev -- --port 3002
```

- [ ] **Step 2: Get a real review token**

In the agency cockpit (`http://localhost:3002/agency/clients/{id}`), generate a review link. Copy the token from the URL.

Alternatively, hit the backend:

```bash
curl -s -b "clarity_token=$STAFF_JWT" -X POST http://localhost:3001/api/agency/clients/{client_id}/review-link
```

- [ ] **Step 3: Open the review page**

Visit `http://localhost:3002/review/{token}` in a private browser window (no auth cookies).

- [ ] **Step 4: Verify the page**

Check:
- [ ] Page loads with cream paper background, Lumidian logo top-left, "Secure review link" top-right
- [ ] Hero shows correct headline ("N drafts ready…" or library/empty variant)
- [ ] If drafts exist: each card has platform pill, title in serif, body preview, three CTAs
- [ ] Click "Approve" → card collapses to "✓ Approved" line; refresh page; draft still resolved
- [ ] Click "Request changes" → inline textarea appears; submit empty → inline error; submit with text → collapses
- [ ] Click "Reject" → confirm panel; cancel works; confirm with reason → collapses
- [ ] Documents section lists existing docs
- [ ] Click "Open" on a weekly report → side panel slides in with the document rendered
- [ ] Click "Download" → PDF downloads with the correct filename
- [ ] Try a known-revoked or fake token → revoked-state page

- [ ] **Step 5: Run the full backend test suite one more time**

Run: `cd backend && pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Update `CURRENT_STATE.md`**

Open `CURRENT_STATE.md` and:
- Update "Last updated" timestamp + surface
- Move agency-document-system entry to "Recent Decisions" with one-line summary
- Update "Current Task / WIP" + "Recently Changed" sections to reflect what shipped

- [ ] **Step 7: Commit the state update**

```bash
git add CURRENT_STATE.md
git commit -m "docs(state): agency document system shipped — PDFs + public review page"
```

---

## Done

All five PDF templates ship with their personality; the existing weekly report is unified with the system; the public client review page exists at `/review/[token]` with both the approval queue and the document library; PDFs render network-independently via embedded fonts.
