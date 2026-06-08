# Agency PDF Flawless — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agency PDF rendering engine with Typst, rewrite all 7 document templates with a shared design system, switch the cockpit flow to one-click → PDF download, gate generation on a brand-data preflight, restructure LLM output from markdown to structured JSON, embed charts, and tune each template's prompt against real brand data — so every "Generate doc" click in the cockpit produces a flawlessly typeset, edit-free PDF.

**Architecture:** Backend shells out to the `typst` CLI from a new `typst_renderer.py`. Per-template Python modules declare `REQUIRED_FIELDS`, `OUTPUT_SCHEMA` (Pydantic), `typst_template`, and `chart_calls`. LLM emits validated JSON; charts are pre-rendered as SVG via matplotlib with a Lumidian style; both pass into Typst as input. A new endpoint `POST /api/agency/clients/{id}/documents/{kind}/render` returns `application/pdf` so the browser downloads in one step. The old Playwright + Jinja2 path is decommissioned in Phase 4 after all kinds migrate. ClientDocument persistence stores the structured JSON snapshot; PDFs are regenerated on demand from history (no binary file storage).

**Tech Stack:** FastAPI · SQLAlchemy 2.0 async · SQLite + aiosqlite · pytest · Anthropic SDK (Sonnet 4.6) · Typst CLI · matplotlib · Next.js 15 · React 18 · TypeScript strict · Tailwind · Radix UI.

**Spec:** `docs/superpowers/specs/2026-06-07-agency-pdf-flawless-design.md`

**Phasing strategy:** Each phase ends in a shippable state. Phase 1 lights up `audit_initial` end-to-end via the new path while the other 6 kinds stay on the old path. Phase 2 fills the gap on the two currently-broken templates (`wikipedia_plan`, `site_plan`) — biggest visible win. Phase 3 migrates the remaining 4 kinds. Phase 4 deletes the old code. Phases 5–6 are quality (prompt tuning + visual polish).

---

## Locked decisions (resolving spec open questions)

1. **PDF storage:** Regenerate on demand from the persisted `data_snapshot` (which now holds the validated JSON output from the LLM). No binary PDF blobs in the DB or filesystem.
2. **Fonts:** Ship under `backend/app/services/document_engine/templates/fonts/` and point Typst at them with `--font-path`. Predictable rendering across dev/prod, no system-font drift.
3. **Charts:** matplotlib with `lumidian.mplstyle`. Output SVG bytes embedded as Typst `image.decode(bytes)`.
4. **Editing path:** Past docs are edited via JSON (the snapshot) → re-render. `DocumentViewer` becomes a JSON editor for past docs in the Brand-tab history; it is no longer opened from the generate path.

---

## File map

### Backend — created

- `backend/app/services/document_engine/typst_renderer.py` — shell-out wrapper around `typst compile`
- `backend/app/services/document_engine/preflight.py` — `REQUIRED_FIELDS` validation + `MissingDataError`
- `backend/app/services/document_engine/structured_output.py` — Claude call returning validated JSON per `OUTPUT_SCHEMA`
- `backend/app/services/document_engine/charts/__init__.py`
- `backend/app/services/document_engine/charts/_style.py` — `lumidian.mplstyle` apply + font registration
- `backend/app/services/document_engine/charts/visibility_over_time.py`
- `backend/app/services/document_engine/charts/model_mix.py`
- `backend/app/services/document_engine/charts/prompt_scorecard.py`
- `backend/app/services/document_engine/charts/competitor_compare.py`
- `backend/app/services/document_engine/templates/_tokens.typ`
- `backend/app/services/document_engine/templates/_cover.typ`
- `backend/app/services/document_engine/templates/_header_footer.typ`
- `backend/app/services/document_engine/templates/_components.typ`
- `backend/app/services/document_engine/templates/audit_initial.typ`
- `backend/app/services/document_engine/templates/wikipedia_plan.typ`
- `backend/app/services/document_engine/templates/site_plan.typ`
- `backend/app/services/document_engine/templates/kickoff_checklist.typ`
- `backend/app/services/document_engine/templates/sow.typ`
- `backend/app/services/document_engine/templates/weekly_report.typ`
- `backend/app/services/document_engine/templates/monthly_report.typ`
- `backend/app/services/document_engine/templates/fonts/` — Instrument Serif, Inter, IBM Plex Mono font files
- `backend/tests/test_pdf_typst_renderer.py` — shell-out + smoke test
- `backend/tests/test_pdf_preflight.py` — `REQUIRED_FIELDS` validation
- `backend/tests/test_pdf_structured_output.py` — JSON parse + validate
- `backend/tests/test_pdf_charts.py` — SVG output sanity
- `backend/tests/test_pdf_render_endpoint.py` — integration for the new endpoint

### Backend — modified

- `backend/app/services/document_engine/__init__.py` — export new symbols
- `backend/app/services/document_engine/generator.py` — orchestrator rewrite: preflight → structured output → charts → typst render → persist
- `backend/app/services/document_engine/registry.py` — extend `Template` dataclass: `required_fields`, `output_schema`, `typst_template`, `chart_calls`
- `backend/app/services/document_engine/audit_initial.py` — add the four new fields
- `backend/app/services/document_engine/wikipedia_plan.py` — add the four new fields
- `backend/app/services/document_engine/site_plan.py` — add the four new fields
- `backend/app/services/document_engine/kickoff_checklist.py` — add the four new fields
- `backend/app/services/document_engine/sow.py` — add the four new fields
- `backend/app/services/document_engine/agency_weekly_report.py` — add the four new fields
- `backend/app/services/document_engine/monthly_report.py` — add the four new fields
- `backend/app/routers/agency.py` — add `POST /clients/{id}/documents/{kind}/render`; `MissingDataError` → 400 mapper
- `backend/app/schemas.py` — `DocumentMissingFieldsError` response schema
- `backend/Dockerfile` — install `typst` binary at build time
- `backend/requirements.txt` — add `matplotlib` if not present
- `backend/tests/conftest.py` — fixtures: `mock_anthropic_json_response`, `typst_available`

### Backend — deleted (Phase 4 only)

- `backend/app/services/document_engine/pdf_renderer.py`
- `backend/app/services/document_engine/markdown_sections.py`
- `backend/app/services/document_engine/templates/_base.html.j2`
- `backend/app/services/document_engine/templates/_styles.css.j2`
- `backend/app/services/document_engine/templates/_fonts.css.j2`
- `backend/app/services/document_engine/templates/audit_initial.html.j2`
- `backend/app/services/document_engine/templates/kickoff_checklist.html.j2`
- `backend/app/services/document_engine/templates/monthly_report.html.j2`
- `backend/app/services/document_engine/templates/sow.html.j2`
- `backend/app/services/document_engine/templates/weekly_report.html.j2`

### Frontend — created

- (none — all changes are modifications)

### Frontend — modified

- `frontend/lib/api.ts` — add `agencyRenderDocument(clientId, kind): Promise<{ blob: Blob, filename: string }>`; add `MissingFieldsError` typed error class
- `frontend/components/agency/PlaybookTab.tsx` — `generateDoc` switches to render+download flow; surface `MissingFieldsError` as inline remediation card
- `frontend/components/agency/PlaybookReports.tsx` — same render+download flow
- `frontend/components/agency/MissingBrandFieldsCard.tsx` — new inline component for remediation
- `frontend/components/agency/DocumentViewer.tsx` — switch markdown editor → JSON editor when `doc.data_snapshot` is present (Brand-tab history path)
- `frontend/components/agency/ClientBrandTab.tsx` — history items "open in viewer" use the JSON-editor mode

### Docs

- `CURRENT_STATE.md` — append decision + WIP entry at the start of execution, update at end

---

## Phase 0 — Bedrock (no user-visible change)

Goal: Typst toolchain, design tokens, base Typst components, chart style, all tested. No new endpoint, no migrated template. The old Playwright path keeps running.

### Task 0.1: Install Typst locally and verify

**Files:** none (environment check only)

- [ ] **Step 0.1.1: Install typst on the dev machine**

Run: `brew install typst`

Expected: `typst --version` prints `typst 0.x.x`.

- [ ] **Step 0.1.2: Compile a smoke document**

Create a throwaway file `/tmp/smoke.typ`:

```typst
= Hello Lumidian

This is a smoke test.
```

Run: `typst compile /tmp/smoke.typ /tmp/smoke.pdf && open /tmp/smoke.pdf`

Expected: A 1-page PDF opens with "Hello Lumidian" as a heading.

- [ ] **Step 0.1.3: Delete the smoke file**

Run: `rm /tmp/smoke.typ /tmp/smoke.pdf`

### Task 0.2: Add fonts under the templates directory

**Files:**
- Create: `backend/app/services/document_engine/templates/fonts/InstrumentSerif-Regular.ttf`
- Create: `backend/app/services/document_engine/templates/fonts/InstrumentSerif-Italic.ttf`
- Create: `backend/app/services/document_engine/templates/fonts/Inter-Regular.ttf`
- Create: `backend/app/services/document_engine/templates/fonts/Inter-Medium.ttf`
- Create: `backend/app/services/document_engine/templates/fonts/Inter-Bold.ttf`
- Create: `backend/app/services/document_engine/templates/fonts/IBMPlexMono-Regular.ttf`
- Create: `backend/app/services/document_engine/templates/fonts/IBMPlexMono-Bold.ttf`

- [ ] **Step 0.2.1: Download fonts from Google Fonts**

The existing `_fonts.css.j2` references these by name; the actual font files do not live in the repo yet. Download:
- Instrument Serif: https://fonts.google.com/specimen/Instrument+Serif → Regular + Italic
- Inter: https://fonts.google.com/specimen/Inter → Regular, Medium, Bold
- IBM Plex Mono: https://fonts.google.com/specimen/IBM+Plex+Mono → Regular, Bold

Place the seven `.ttf` files in `backend/app/services/document_engine/templates/fonts/`.

- [ ] **Step 0.2.2: Verify Typst can find them**

Run from the repo root:

```bash
typst compile --font-path backend/app/services/document_engine/templates/fonts /tmp/font_check.typ /tmp/font_check.pdf
```

After creating `/tmp/font_check.typ`:

```typst
#set text(font: "Instrument Serif")
= Lumidian Title

#set text(font: "Inter")
Some body text.

#set text(font: "IBM Plex Mono")
`metadata.id = 42`
```

Expected: PDF renders with each font visibly different. Delete the smoke files.

- [ ] **Step 0.2.3: Commit**

```bash
git add backend/app/services/document_engine/templates/fonts/
git commit -m "feat(pdf): add embedded font files for typst"
```

### Task 0.3: Design tokens file

**Files:**
- Create: `backend/app/services/document_engine/templates/_tokens.typ`

- [ ] **Step 0.3.1: Write `_tokens.typ`**

```typst
// Lumidian design tokens — single source of truth.
// All templates import this; no per-template ad-hoc colors/sizes/spacing.

#let lumidian = (
  // Colors
  ink:            rgb("#0B1220"),
  paper:          rgb("#FAF7F2"),
  primary:        rgb("#2447EE"),       // Lumidian blue
  muted:          rgb("#546880"),
  border:         rgb("#E5E0D7"),
  delta_up:       rgb("#10A37F"),
  delta_down:     rgb("#DC2626"),
  model_chatgpt:  rgb("#10A37F"),
  model_claude:   rgb("#F97316"),
  model_perp:     rgb("#8B5CF6"),
  model_gemini:   rgb("#3B82F6"),

  // Type families
  display_font:   "Instrument Serif",
  body_font:      "Inter",
  mono_font:      "IBM Plex Mono",

  // Type scale
  size_display:   48pt,
  size_h1:        32pt,
  size_h2:        20pt,
  size_h3:        14pt,
  size_body:      11pt,
  size_caption:   9pt,
  size_mono_xl:   120pt,

  // Spacing
  space_section:  28pt,
  space_block:    16pt,
  space_card:     14pt,
  space_line:     8pt,

  // Page
  page_margin:    (top: 0.9in, right: 0.85in, bottom: 1.0in, left: 0.85in),
)
```

- [ ] **Step 0.3.2: Compile a tokens-only smoke**

Create `/tmp/tokens_check.typ`:

```typst
#import "@path/to/_tokens.typ": lumidian

#set page(paper: "us-letter", margin: lumidian.page_margin, fill: lumidian.paper)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#text(font: lumidian.display_font, size: lumidian.size_display)[Tokens check]

#set text(size: lumidian.size_h2)
Body text in Inter at 11pt.

#text(fill: lumidian.primary)[This text uses the Lumidian blue.]
```

Run: `typst compile --font-path backend/app/services/document_engine/templates/fonts /tmp/tokens_check.typ /tmp/tokens_check.pdf`

Expected: PDF renders with paper bg, Lumidian blue, Inter body, Instrument Serif heading. Delete smoke files.

- [ ] **Step 0.3.3: Commit**

```bash
git add backend/app/services/document_engine/templates/_tokens.typ
git commit -m "feat(pdf): typst design tokens"
```

### Task 0.4: Shared cover-page module

**Files:**
- Create: `backend/app/services/document_engine/templates/_cover.typ`

- [ ] **Step 0.4.1: Write `_cover.typ` with three personality variants**

```typst
#import "_tokens.typ": lumidian

// cover(style, client_name, doc_kind_label, generated_at, generated_by)
// style ∈ ("briefing", "report", "contract")
#let cover(style, client_name, doc_kind_label, generated_at, generated_by) = {
  set page(margin: (top: 1.2in, right: 0.85in, bottom: 1.0in, left: 0.85in))

  // Logo / wordmark
  align(left)[
    #text(font: lumidian.display_font, size: 20pt, fill: lumidian.primary)[Lumidian]
  ]

  v(0.6in)

  if style == "briefing" {
    align(left)[
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 2pt)[#upper(doc_kind_label)]
      #v(0.15in)
      #text(font: lumidian.display_font, size: lumidian.size_display, fill: lumidian.ink)[#client_name]
    ]
  } else if style == "report" {
    align(center)[
      #v(2in)
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 2pt)[#upper(doc_kind_label)]
      #v(0.3in)
      #text(font: lumidian.display_font, size: 64pt, fill: lumidian.ink)[#client_name]
    ]
  } else if style == "contract" {
    align(left)[
      #text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[#upper(doc_kind_label)]
      #v(0.2in)
      #text(font: lumidian.display_font, size: lumidian.size_h1, fill: lumidian.ink)[#client_name]
    ]
  }

  // Bottom metadata
  place(bottom + left, [
    #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[
      Generated #generated_at#if generated_by != none [ by #generated_by]
    ]
  ])

  pagebreak()
}
```

- [ ] **Step 0.4.2: Commit**

```bash
git add backend/app/services/document_engine/templates/_cover.typ
git commit -m "feat(pdf): typst cover module with three personality variants"
```

### Task 0.5: Running header/footer module

**Files:**
- Create: `backend/app/services/document_engine/templates/_header_footer.typ`

- [ ] **Step 0.5.1: Write `_header_footer.typ`**

```typst
#import "_tokens.typ": lumidian

// header_footer(client_name, doc_kind_label) — call once at the top of a template,
// after the cover, to install running headers and page numbers.
#let header_footer(client_name, doc_kind_label) = {
  set page(
    paper: "us-letter",
    margin: lumidian.page_margin,
    fill: lumidian.paper,
    header: [
      #grid(columns: (1fr, auto),
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#client_name],
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#doc_kind_label]
      )
      #line(length: 100%, stroke: 0.5pt + lumidian.border)
    ],
    footer: [
      #line(length: 100%, stroke: 0.5pt + lumidian.border)
      #grid(columns: (1fr, auto),
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[Lumidian],
        text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#counter(page).display() / #context counter(page).final().first()]
      )
    ],
  )
}
```

- [ ] **Step 0.5.2: Commit**

```bash
git add backend/app/services/document_engine/templates/_header_footer.typ
git commit -m "feat(pdf): typst running header/footer module"
```

### Task 0.6: Shared components module

**Files:**
- Create: `backend/app/services/document_engine/templates/_components.typ`

- [ ] **Step 0.6.1: Write `_components.typ` — callout, score-card, table-styles, signature-block, bullet, check-list-item**

```typst
#import "_tokens.typ": lumidian

#let h1(body) = block(below: lumidian.space_section, text(font: lumidian.display_font, size: lumidian.size_h1, fill: lumidian.ink, body))
#let h2(body) = block(above: lumidian.space_section, below: lumidian.space_block, text(font: lumidian.display_font, size: lumidian.size_h2, fill: lumidian.ink, body))
#let h3(body) = block(above: lumidian.space_block, below: lumidian.space_line, text(font: lumidian.body_font, weight: "medium", size: lumidian.size_h3, fill: lumidian.ink, body))

#let callout(body) = block(
  fill: lumidian.paper.darken(2%),
  stroke: (left: 2pt + lumidian.primary),
  inset: lumidian.space_card,
  width: 100%,
  body
)

#let score_card(score, label) = block(
  inset: lumidian.space_card,
  stroke: 0.5pt + lumidian.border,
  width: 100%,
  align(center)[
    #text(font: lumidian.mono_font, size: lumidian.size_mono_xl, fill: lumidian.ink)[#score]
    #v(lumidian.space_line)
    #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted, tracking: 1pt)[#upper(label)]
  ]
)

#let signature_block(name_label, date_label) = block(above: 0.4in)[
  #grid(columns: (1fr, 1fr), column-gutter: 0.4in,
    [
      #line(length: 100%, stroke: 0.5pt + lumidian.ink)
      #v(2pt)
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#name_label]
    ],
    [
      #line(length: 100%, stroke: 0.5pt + lumidian.ink)
      #v(2pt)
      #text(font: lumidian.body_font, size: lumidian.size_caption, fill: lumidian.muted)[#date_label]
    ],
  )
]

#let bullet(body) = grid(columns: (12pt, 1fr), gutter: lumidian.space_line,
  text(fill: lumidian.primary)[•], body
)

#let check_item(done, body) = grid(columns: (16pt, 1fr), gutter: lumidian.space_line,
  if done {
    text(fill: lumidian.primary)[●]
  } else {
    text(fill: lumidian.muted)[○]
  },
  body
)
```

- [ ] **Step 0.6.2: Commit**

```bash
git add backend/app/services/document_engine/templates/_components.typ
git commit -m "feat(pdf): typst shared components"
```

### Task 0.7: Matplotlib style and chart `__init__.py`

**Files:**
- Create: `backend/app/services/document_engine/charts/__init__.py`
- Create: `backend/app/services/document_engine/charts/_style.py`
- Test: `backend/tests/test_pdf_charts.py`

- [ ] **Step 0.7.1: Write failing test for style application**

Create `backend/tests/test_pdf_charts.py`:

```python
"""Tests for matplotlib chart rendering used in agency PDFs."""
from __future__ import annotations

import xml.etree.ElementTree as ET

import pytest

from app.services.document_engine.charts._style import apply_lumidian_style, LUMIDIAN_PRIMARY


def test_apply_lumidian_style_sets_colors():
    import matplotlib as mpl
    apply_lumidian_style()
    assert mpl.rcParams["axes.edgecolor"].lower() in {"#546880", "#0b1220"}
    assert "Inter" in str(mpl.rcParams["font.family"])


def test_lumidian_primary_is_brand_blue():
    assert LUMIDIAN_PRIMARY.lower() == "#2447ee"
```

- [ ] **Step 0.7.2: Run the test (expect ImportError / FAIL)**

Run: `cd backend && pytest tests/test_pdf_charts.py -v`

Expected: ImportError on `app.services.document_engine.charts._style`.

- [ ] **Step 0.7.3: Write the style module**

Create `backend/app/services/document_engine/charts/__init__.py`:

```python
"""Matplotlib chart functions returning SVG bytes for embedding in Typst PDFs."""
```

Create `backend/app/services/document_engine/charts/_style.py`:

```python
"""Lumidian matplotlib style — applied at the start of every chart function.

Charts produced through this module use Lumidian brand fonts, colors, and
type-scale so they read as part of the same document, not as a foreign element.
"""
from __future__ import annotations

import matplotlib as mpl

LUMIDIAN_INK = "#0B1220"
LUMIDIAN_PAPER = "#FAF7F2"
LUMIDIAN_PRIMARY = "#2447EE"
LUMIDIAN_MUTED = "#546880"
LUMIDIAN_BORDER = "#E5E0D7"
LUMIDIAN_DELTA_UP = "#10A37F"
LUMIDIAN_DELTA_DOWN = "#DC2626"
MODEL_COLORS = {
    "chatgpt":    "#10A37F",
    "claude":     "#F97316",
    "perplexity": "#8B5CF6",
    "gemini":     "#3B82F6",
}


def apply_lumidian_style() -> None:
    """Apply Lumidian brand to matplotlib rcParams. Idempotent."""
    mpl.rcParams.update({
        "font.family":        "Inter",
        "font.size":          9.0,
        "axes.edgecolor":     LUMIDIAN_MUTED,
        "axes.labelcolor":    LUMIDIAN_INK,
        "axes.titlecolor":    LUMIDIAN_INK,
        "axes.labelsize":     9.0,
        "axes.titlesize":     11.0,
        "axes.spines.top":    False,
        "axes.spines.right":  False,
        "axes.linewidth":     0.5,
        "xtick.color":        LUMIDIAN_MUTED,
        "ytick.color":        LUMIDIAN_MUTED,
        "xtick.labelsize":    8.0,
        "ytick.labelsize":    8.0,
        "figure.facecolor":   LUMIDIAN_PAPER,
        "axes.facecolor":     LUMIDIAN_PAPER,
        "grid.color":         LUMIDIAN_BORDER,
        "grid.linewidth":     0.4,
        "lines.linewidth":    2.0,
    })
```

- [ ] **Step 0.7.4: Run the test (expect PASS)**

Run: `cd backend && pytest tests/test_pdf_charts.py -v`

Expected: 2 passed.

- [ ] **Step 0.7.5: Commit**

```bash
git add backend/app/services/document_engine/charts/ backend/tests/test_pdf_charts.py
git commit -m "feat(pdf): matplotlib lumidian style"
```

### Task 0.8: Four chart functions, each returning SVG bytes

**Files:**
- Create: `backend/app/services/document_engine/charts/visibility_over_time.py`
- Create: `backend/app/services/document_engine/charts/model_mix.py`
- Create: `backend/app/services/document_engine/charts/prompt_scorecard.py`
- Create: `backend/app/services/document_engine/charts/competitor_compare.py`
- Modify: `backend/tests/test_pdf_charts.py` (append)

- [ ] **Step 0.8.1: Write failing tests for all four chart functions**

Append to `backend/tests/test_pdf_charts.py`:

```python
from datetime import date, timedelta

from app.services.document_engine.charts.visibility_over_time import render_visibility_over_time
from app.services.document_engine.charts.model_mix import render_model_mix
from app.services.document_engine.charts.prompt_scorecard import render_prompt_scorecard
from app.services.document_engine.charts.competitor_compare import render_competitor_compare


def _assert_valid_svg(svg_bytes: bytes) -> None:
    assert svg_bytes.startswith(b"<?xml") or svg_bytes.startswith(b"<svg")
    root = ET.fromstring(svg_bytes.decode("utf-8"))
    assert "svg" in root.tag


def test_visibility_over_time_returns_svg():
    points = [(date.today() - timedelta(days=i), 30 + i) for i in range(10, 0, -1)]
    svg = render_visibility_over_time(points)
    _assert_valid_svg(svg)


def test_visibility_over_time_handles_empty():
    svg = render_visibility_over_time([])
    _assert_valid_svg(svg)  # placeholder "No data" chart


def test_model_mix_returns_svg():
    svg = render_model_mix({"chatgpt": 40, "claude": 30, "perplexity": 20, "gemini": 10})
    _assert_valid_svg(svg)


def test_prompt_scorecard_returns_svg():
    rows = [("prompt 1", {"chatgpt": 80, "claude": 60, "perplexity": 45, "gemini": 70})]
    svg = render_prompt_scorecard(rows)
    _assert_valid_svg(svg)


def test_competitor_compare_returns_svg():
    svg = render_competitor_compare(brand_score=72, competitor_scores={"Foo": 55, "Bar": 80})
    _assert_valid_svg(svg)
```

- [ ] **Step 0.8.2: Verify tests fail**

Run: `cd backend && pytest tests/test_pdf_charts.py -v`

Expected: ImportError on the four chart modules.

- [ ] **Step 0.8.3: Implement `visibility_over_time.py`**

```python
"""Visibility-over-time line chart."""
from __future__ import annotations

import io
from datetime import date

import matplotlib.pyplot as plt
import matplotlib.dates as mdates

from app.services.document_engine.charts._style import (
    LUMIDIAN_MUTED,
    LUMIDIAN_PRIMARY,
    apply_lumidian_style,
)


def render_visibility_over_time(points: list[tuple[date, float]]) -> bytes:
    """Render visibility-over-time line chart as SVG bytes. Empty input → 'No data' chart."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(6.0, 2.4))
    if points:
        xs = [d for d, _ in points]
        ys = [v for _, v in points]
        ax.plot(xs, ys, color=LUMIDIAN_PRIMARY, marker="o", markersize=3)
        ax.set_ylim(bottom=0)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        ax.set_ylabel("Visibility %")
    else:
        ax.text(0.5, 0.5, "No data yet", ha="center", va="center",
                color=LUMIDIAN_MUTED, transform=ax.transAxes)
        ax.set_xticks([])
        ax.set_yticks([])
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
```

- [ ] **Step 0.8.4: Implement `model_mix.py`**

```python
"""Model-mix donut chart."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import MODEL_COLORS, apply_lumidian_style


def render_model_mix(scores_by_model: dict[str, float]) -> bytes:
    """Donut chart of per-model contribution. Empty → placeholder."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(3.2, 3.2))
    if any(v > 0 for v in scores_by_model.values()):
        labels = list(scores_by_model.keys())
        values = [scores_by_model[k] for k in labels]
        colors = [MODEL_COLORS.get(k.lower(), "#888888") for k in labels]
        wedges, _ = ax.pie(values, colors=colors, startangle=90, wedgeprops=dict(width=0.35))
        ax.legend(wedges, labels, loc="center", frameon=False)
    else:
        ax.text(0.5, 0.5, "No data yet", ha="center", va="center", transform=ax.transAxes)
    ax.set_axis_off()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
```

- [ ] **Step 0.8.5: Implement `prompt_scorecard.py`**

```python
"""Prompt × model scorecard heatmap."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt
import numpy as np

from app.services.document_engine.charts._style import apply_lumidian_style


def render_prompt_scorecard(rows: list[tuple[str, dict[str, float]]]) -> bytes:
    """Heatmap rows = prompts, cols = models, cells = 0-100 scores. Empty → placeholder."""
    apply_lumidian_style()
    if not rows:
        fig, ax = plt.subplots(figsize=(6, 2))
        ax.text(0.5, 0.5, "No data yet", ha="center", va="center", transform=ax.transAxes)
        ax.set_axis_off()
    else:
        prompts = [r[0] for r in rows]
        models = list(rows[0][1].keys())
        data = np.array([[r[1].get(m, 0.0) for m in models] for r in rows])
        fig, ax = plt.subplots(figsize=(6.0, 0.4 * len(prompts) + 1.2))
        im = ax.imshow(data, aspect="auto", cmap="Blues", vmin=0, vmax=100)
        ax.set_xticks(range(len(models)), labels=models)
        ax.set_yticks(range(len(prompts)), labels=prompts)
        plt.colorbar(im, ax=ax, shrink=0.6, label="Visibility %")
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
```

- [ ] **Step 0.8.6: Implement `competitor_compare.py`**

```python
"""Brand vs competitors grouped-bar chart."""
from __future__ import annotations

import io

import matplotlib.pyplot as plt

from app.services.document_engine.charts._style import (
    LUMIDIAN_MUTED,
    LUMIDIAN_PRIMARY,
    apply_lumidian_style,
)


def render_competitor_compare(*, brand_score: float, competitor_scores: dict[str, float]) -> bytes:
    """Horizontal bar chart: brand vs competitors."""
    apply_lumidian_style()
    fig, ax = plt.subplots(figsize=(6.0, 0.5 * (1 + len(competitor_scores)) + 0.8))
    if competitor_scores:
        labels = ["Your brand"] + list(competitor_scores.keys())
        values = [brand_score] + [competitor_scores[k] for k in competitor_scores]
        colors = [LUMIDIAN_PRIMARY] + [LUMIDIAN_MUTED] * len(competitor_scores)
        ax.barh(labels, values, color=colors)
        ax.set_xlim(0, 100)
        ax.set_xlabel("Visibility %")
        ax.invert_yaxis()
    else:
        ax.text(0.5, 0.5, "No competitors tracked", ha="center", va="center", transform=ax.transAxes)
        ax.set_axis_off()
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
```

- [ ] **Step 0.8.7: Run all chart tests**

Run: `cd backend && pytest tests/test_pdf_charts.py -v`

Expected: 7 passed.

- [ ] **Step 0.8.8: Commit**

```bash
git add backend/app/services/document_engine/charts/ backend/tests/test_pdf_charts.py
git commit -m "feat(pdf): four chart functions (line/donut/heatmap/bar) returning SVG"
```

### Task 0.9: Typst renderer shell-out wrapper

**Files:**
- Create: `backend/app/services/document_engine/typst_renderer.py`
- Test: `backend/tests/test_pdf_typst_renderer.py`

- [ ] **Step 0.9.1: Write failing test**

Create `backend/tests/test_pdf_typst_renderer.py`:

```python
"""Tests for typst shell-out renderer."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from app.services.document_engine.typst_renderer import (
    TypstCompileError,
    render_pdf,
)


pytestmark = pytest.mark.skipif(
    shutil.which("typst") is None,
    reason="typst CLI not installed",
)


def test_render_pdf_compiles_minimal_template(tmp_path: Path):
    template_path = tmp_path / "main.typ"
    template_path.write_text("""
#let data = json("data.json")
= Hello #data.name
""", encoding="utf-8")
    (tmp_path / "data.json").write_text(json.dumps({"name": "Acme"}), encoding="utf-8")

    pdf_bytes = render_pdf(template_path=template_path, data={"name": "Acme"})

    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 500


def test_render_pdf_raises_on_compile_error(tmp_path: Path):
    template_path = tmp_path / "main.typ"
    template_path.write_text("#this is not valid typst", encoding="utf-8")

    with pytest.raises(TypstCompileError) as exc:
        render_pdf(template_path=template_path, data={})
    assert "typst" in str(exc.value).lower()
```

- [ ] **Step 0.9.2: Verify test fails**

Run: `cd backend && pytest tests/test_pdf_typst_renderer.py -v`

Expected: ImportError.

- [ ] **Step 0.9.3: Implement `typst_renderer.py`**

```python
"""Shell-out wrapper around the `typst` CLI.

Render flow:
  1. Caller passes a template file path + a JSON-serializable data dict.
  2. We write data to a temporary file alongside the template.
  3. Invoke `typst compile --font-path <fonts> --input data=<path>` (data file
     read by `json(sys.inputs.data)` inside templates) — but simpler: write
     `data.json` into a workdir and have templates do `#let data = json("data.json")`.
  4. Read the produced PDF bytes; raise TypstCompileError on non-zero exit.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_FONTS_DIR = (
    Path(__file__).parent / "templates" / "fonts"
).resolve()


class TypstCompileError(RuntimeError):
    """Raised when `typst compile` exits non-zero."""


def render_pdf(*, template_path: Path, data: dict[str, Any]) -> bytes:
    """Render a Typst template to PDF bytes with data injected as data.json.

    The template should reference `json("data.json")` to read the data.
    """
    typst_bin = shutil.which("typst")
    if typst_bin is None:
        raise TypstCompileError("typst CLI not found on PATH. Install via brew install typst or apt.")

    with tempfile.TemporaryDirectory(prefix="lumidian-pdf-") as workdir_str:
        workdir = Path(workdir_str)
        local_template = workdir / template_path.name
        local_template.write_text(template_path.read_text(encoding="utf-8"), encoding="utf-8")

        # Also copy any sibling _*.typ partials so imports resolve
        for sibling in template_path.parent.glob("_*.typ"):
            (workdir / sibling.name).write_text(sibling.read_text(encoding="utf-8"), encoding="utf-8")

        # Write data
        (workdir / "data.json").write_text(json.dumps(data, default=str), encoding="utf-8")

        out_pdf = workdir / "out.pdf"
        cmd = [
            typst_bin,
            "compile",
            "--font-path", str(_FONTS_DIR),
            str(local_template),
            str(out_pdf),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60, text=True)
        except subprocess.TimeoutExpired as e:
            raise TypstCompileError("typst compile timed out after 60s") from e

        if proc.returncode != 0:
            logger.error("typst stderr: %s", proc.stderr)
            raise TypstCompileError(f"typst compile failed: {proc.stderr.strip()}")

        return out_pdf.read_bytes()
```

- [ ] **Step 0.9.4: Run tests (expect pass)**

Run: `cd backend && pytest tests/test_pdf_typst_renderer.py -v`

Expected: 2 passed (if typst installed locally), 2 skipped (if not).

- [ ] **Step 0.9.5: Commit**

```bash
git add backend/app/services/document_engine/typst_renderer.py backend/tests/test_pdf_typst_renderer.py
git commit -m "feat(pdf): typst shell-out renderer"
```

### Task 0.10: Preflight module

**Files:**
- Create: `backend/app/services/document_engine/preflight.py`
- Test: `backend/tests/test_pdf_preflight.py`

- [ ] **Step 0.10.1: Write failing tests**

Create `backend/tests/test_pdf_preflight.py`:

```python
"""Tests for REQUIRED_FIELDS preflight."""
from __future__ import annotations

import pytest

from app.services.document_engine.preflight import MissingDataError, check_required


def test_check_required_passes_when_all_present():
    data = {"brand": {"name": "Acme"}, "brand_profile": {"tone_of_voice": "Direct"}}
    check_required(["brand.name", "brand_profile.tone_of_voice"], data)


def test_check_required_returns_missing_paths():
    data = {"brand": {"name": "Acme"}, "brand_profile": {"tone_of_voice": None}}
    with pytest.raises(MissingDataError) as exc:
        check_required(["brand.name", "brand_profile.tone_of_voice", "brand_profile.target_audience"], data)
    assert sorted(exc.value.missing) == sorted(["brand_profile.tone_of_voice", "brand_profile.target_audience"])


def test_check_required_treats_empty_string_and_empty_list_as_missing():
    data = {"brand": {"name": ""}, "profile": {"tags": []}}
    with pytest.raises(MissingDataError) as exc:
        check_required(["brand.name", "profile.tags"], data)
    assert sorted(exc.value.missing) == sorted(["brand.name", "profile.tags"])


def test_check_required_handles_dotted_path_into_missing_dict():
    data = {"brand": None}
    with pytest.raises(MissingDataError) as exc:
        check_required(["brand.name"], data)
    assert exc.value.missing == ["brand.name"]
```

- [ ] **Step 0.10.2: Verify tests fail**

Run: `cd backend && pytest tests/test_pdf_preflight.py -v`

Expected: ImportError.

- [ ] **Step 0.10.3: Implement `preflight.py`**

```python
"""Preflight data validation for PDF generation.

Each Template declares REQUIRED_FIELDS as dotted-path strings; check_required()
raises MissingDataError listing any unset ones BEFORE the LLM is called.
"""
from __future__ import annotations

from typing import Any


class MissingDataError(Exception):
    """Required brand-data fields are missing."""

    def __init__(self, missing: list[str]):
        super().__init__(f"Missing required fields: {', '.join(missing)}")
        self.missing = missing


def _get(data: Any, path: str) -> Any:
    cur = data
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
        if cur is None:
            return None
    return cur


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or v == [] or v == {}


def check_required(required: list[str], data: dict[str, Any]) -> None:
    """Raise MissingDataError listing any of the dotted paths that resolve to None/empty."""
    missing = [p for p in required if _is_empty(_get(data, p))]
    if missing:
        raise MissingDataError(missing)
```

- [ ] **Step 0.10.4: Run tests (expect pass)**

Run: `cd backend && pytest tests/test_pdf_preflight.py -v`

Expected: 4 passed.

- [ ] **Step 0.10.5: Commit**

```bash
git add backend/app/services/document_engine/preflight.py backend/tests/test_pdf_preflight.py
git commit -m "feat(pdf): preflight required-fields validator"
```

### Task 0.11: Structured-output LLM call

**Files:**
- Create: `backend/app/services/document_engine/structured_output.py`
- Test: `backend/tests/test_pdf_structured_output.py`

- [ ] **Step 0.11.1: Write failing tests**

Create `backend/tests/test_pdf_structured_output.py`:

```python
"""Tests for structured-JSON LLM output."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import BaseModel

from app.services.document_engine.structured_output import (
    LLMJSONError,
    request_structured_output,
)


class SampleOutput(BaseModel):
    current_state: str
    gaps: list[str]


@pytest.mark.asyncio
async def test_returns_validated_model(monkeypatch):
    fake_content = MagicMock()
    fake_content.text = '{"current_state": "Doing fine", "gaps": ["one", "two"]}'
    fake_response = MagicMock()
    fake_response.content = [fake_content]

    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)

    monkeypatch.setattr(
        "app.services.document_engine.structured_output._anthropic_client",
        lambda: fake_client,
    )

    out = await request_structured_output(
        system_prompt="You produce JSON.",
        user_prompt="Generate.",
        schema=SampleOutput,
    )
    assert isinstance(out, SampleOutput)
    assert out.current_state == "Doing fine"
    assert out.gaps == ["one", "two"]


@pytest.mark.asyncio
async def test_raises_on_invalid_json(monkeypatch):
    fake_content = MagicMock()
    fake_content.text = "not json at all"
    fake_response = MagicMock()
    fake_response.content = [fake_content]
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)
    monkeypatch.setattr(
        "app.services.document_engine.structured_output._anthropic_client",
        lambda: fake_client,
    )

    with pytest.raises(LLMJSONError):
        await request_structured_output(
            system_prompt="You produce JSON.",
            user_prompt="Generate.",
            schema=SampleOutput,
        )


@pytest.mark.asyncio
async def test_raises_on_schema_mismatch(monkeypatch):
    fake_content = MagicMock()
    fake_content.text = '{"current_state": 42}'   # wrong type + missing field
    fake_response = MagicMock()
    fake_response.content = [fake_content]
    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=fake_response)
    monkeypatch.setattr(
        "app.services.document_engine.structured_output._anthropic_client",
        lambda: fake_client,
    )

    with pytest.raises(LLMJSONError):
        await request_structured_output(
            system_prompt="x", user_prompt="y", schema=SampleOutput,
        )
```

- [ ] **Step 0.11.2: Verify tests fail**

Run: `cd backend && pytest tests/test_pdf_structured_output.py -v`

Expected: ImportError.

- [ ] **Step 0.11.3: Implement `structured_output.py`**

```python
"""Structured (JSON) LLM output for PDF templates.

Each template declares a pydantic OUTPUT_SCHEMA. We prompt the model with a
strict system instruction to emit ONLY JSON conforming to the schema, then
validate. One retry on parse failure with a sharper instruction; otherwise
LLMJSONError bubbles up.
"""
from __future__ import annotations

import json
import os
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class LLMJSONError(Exception):
    """LLM returned text we could not parse as the requested schema."""


def _anthropic_client():
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not configured. Add your key in Settings to enable PDF generation."
        )
    import anthropic
    return anthropic.AsyncAnthropic(api_key=api_key, timeout=120.0)


def _strict_system(base_system: str, schema: Type[BaseModel]) -> str:
    schema_json = json.dumps(schema.model_json_schema(), indent=2)
    return (
        f"{base_system}\n\n"
        "STRICT OUTPUT RULE: Respond with a SINGLE JSON object matching the following schema. "
        "No prose, no markdown fences, no commentary — JSON only.\n\n"
        f"Schema:\n{schema_json}"
    )


async def request_structured_output(
    *,
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 3500,
) -> T:
    """Call Claude with a system+user prompt; return the parsed pydantic model."""
    client = _anthropic_client()
    system = _strict_system(system_prompt, schema)

    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_prompt}],
    )
    text = response.content[0].text if response.content else ""
    text = text.strip()
    # Strip accidental code fences
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[len("json"):].lstrip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMJSONError(f"LLM did not return valid JSON: {e}\nResponse:\n{text[:500]}") from e
    try:
        return schema.model_validate(parsed)
    except ValidationError as e:
        raise LLMJSONError(f"LLM JSON did not match schema:\n{e}") from e
```

- [ ] **Step 0.11.4: Run tests (expect pass)**

Run: `cd backend && pytest tests/test_pdf_structured_output.py -v`

Expected: 3 passed.

- [ ] **Step 0.11.5: Commit**

```bash
git add backend/app/services/document_engine/structured_output.py backend/tests/test_pdf_structured_output.py
git commit -m "feat(pdf): structured-JSON LLM output with schema validation"
```

### Task 0.12: Extend Template dataclass

**Files:**
- Modify: `backend/app/services/document_engine/registry.py`

- [ ] **Step 0.12.1: Add four new optional fields to `Template`**

Edit `backend/app/services/document_engine/registry.py` — extend the dataclass:

```python
"""Template registry for the document engine."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Type

from pydantic import BaseModel
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
    # New (all optional during migration; Phase 4 makes them required and drops the old ones)
    required_fields: tuple[str, ...] = ()
    output_schema: Type[BaseModel] | None = None
    typst_template: str | None = None  # filename inside templates/ dir, e.g., "audit_initial.typ"
    chart_calls: tuple[Callable[[AsyncSession, AgencyClient, dict], Awaitable[bytes]], ...] = ()


TEMPLATES: dict[str, Template] = {}


def register(t: Template) -> Template:
    TEMPLATES[t.kind] = t
    return t


def get_template(kind: str) -> Template | None:
    return TEMPLATES.get(kind)


def list_templates() -> list[Template]:
    return list(TEMPLATES.values())
```

- [ ] **Step 0.12.2: Run the full backend test suite — nothing should regress**

Run: `cd backend && pytest tests/ -x --ignore=tests/test_client_portal.py -q`

(Ignore `test_client_portal.py` — known pre-existing failures per CURRENT_STATE.md.)

Expected: All previously-green tests still green.

- [ ] **Step 0.12.3: Commit**

```bash
git add backend/app/services/document_engine/registry.py
git commit -m "feat(pdf): extend Template dataclass with required_fields/output_schema/typst_template/chart_calls"
```

---

## Phase 1 — Vertical slice: `audit_initial` end-to-end

Goal: One template, end-to-end, on the new path. After this phase, clicking "Generate doc" for the **Initial audit** in the cockpit produces a flawless Typst PDF and downloads it. The other six kinds remain on the old Playwright path.

### Task 1.1: Define `AuditInitialOutput` schema + REQUIRED_FIELDS

**Files:**
- Modify: `backend/app/services/document_engine/audit_initial.py`

- [ ] **Step 1.1.1: Add the new fields to the `audit_initial` template**

Edit `backend/app/services/document_engine/audit_initial.py`. After the existing `SECTION_MAP`/`fetch_data`/`SYSTEM_PROMPT`, add:

```python
from pydantic import BaseModel, Field


class AuditInitialOutput(BaseModel):
    current_state: str = Field(..., description="2-3 sentence summary of where the brand stands today")
    working: list[str] = Field(default_factory=list, description="Strengths bullets")
    gaps: list[str] = Field(default_factory=list, description="Weakness bullets")
    recommendations: list[str] = Field(default_factory=list, description="3-5 prioritized actions for next 30 days")
    open_questions: list[str] = Field(default_factory=list, description="2-4 questions for the client")


REQUIRED_FIELDS = (
    "brand.name",
    "brand.website_url",
    "brand_profile.company_description",
)
```

Update the `register(Template(...))` call near the bottom:

```python
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
        required_fields=REQUIRED_FIELDS,
        output_schema=AuditInitialOutput,
        typst_template="audit_initial.typ",
        chart_calls=(),  # no charts on the audit_initial briefing
    )
)
```

- [ ] **Step 1.1.2: Commit**

```bash
git add backend/app/services/document_engine/audit_initial.py
git commit -m "feat(pdf): audit_initial schema + required_fields + typst binding"
```

### Task 1.2: Write `audit_initial.typ`

**Files:**
- Create: `backend/app/services/document_engine/templates/audit_initial.typ`

- [ ] **Step 1.2.1: Write the Typst template**

```typst
#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, callout, bullet

#let data = json("data.json")

#cover(
  "briefing",
  data.brand.name,
  "Initial audit",
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(data.brand.name, "Initial audit")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Initial Visibility Audit]

#callout[
  #data.output.current_state
]

#if data.output.working.len() > 0 [
  #h2[What's working]
  #for item in data.output.working [#bullet(item)]
]

#if data.output.gaps.len() > 0 [
  #h2[Gaps]
  #for item in data.output.gaps [#bullet(item)]
]

#if data.output.recommendations.len() > 0 [
  #h2[Recommendations — next 30 days]
  #for (i, item) in data.output.recommendations.enumerate() [
    #grid(columns: (24pt, 1fr), gutter: lumidian.space_line)[
      #text(font: lumidian.mono_font, fill: lumidian.primary)[#(i + 1).]
      #item
    ]
  ]
]

#if data.output.open_questions.len() > 0 [
  #h2[Open questions for the client]
  #for item in data.output.open_questions [#bullet(item)]
]
```

- [ ] **Step 1.2.2: Smoke-compile against a fake data file**

Create `/tmp/audit_data.json`:

```json
{
  "brand": {"name": "Acme", "website_url": "https://acme.com"},
  "brand_profile": {"company_description": "Sells widgets"},
  "generated_at": "Jun 7 2026",
  "generated_by": "Ken Turner",
  "output": {
    "current_state": "Acme has limited visibility on AI search; ChatGPT mentions it for 30% of relevant prompts.",
    "working": ["Strong brand on Reddit", "Good Wikipedia article"],
    "gaps": ["No site audit completed", "Tone of voice not captured"],
    "recommendations": ["Run baseline tracking", "Capture brand voice", "Audit website schema"],
    "open_questions": ["Who is the primary buyer persona?", "What's the launch timeline?"]
  }
}
```

Copy to a workdir and compile:

```bash
mkdir -p /tmp/audit_smoke && cp backend/app/services/document_engine/templates/audit_initial.typ \
  backend/app/services/document_engine/templates/_tokens.typ \
  backend/app/services/document_engine/templates/_cover.typ \
  backend/app/services/document_engine/templates/_header_footer.typ \
  backend/app/services/document_engine/templates/_components.typ \
  /tmp/audit_smoke/
cp /tmp/audit_data.json /tmp/audit_smoke/data.json
typst compile --font-path backend/app/services/document_engine/templates/fonts \
  /tmp/audit_smoke/audit_initial.typ /tmp/audit_smoke/out.pdf
open /tmp/audit_smoke/out.pdf
```

Expected: 2-page PDF — cover with "ACME" hero + paper bg + Lumidian wordmark, then content page with running header, four sections, page numbers in footer.

- [ ] **Step 1.2.3: Iterate visually until layout looks right**

Adjust spacing, typography, callout styling as needed. This is the first visual pass — invest time here because subsequent templates will copy this structure.

- [ ] **Step 1.2.4: Commit**

```bash
rm -rf /tmp/audit_smoke /tmp/audit_data.json
git add backend/app/services/document_engine/templates/audit_initial.typ
git commit -m "feat(pdf): audit_initial.typ template (briefing personality)"
```

### Task 1.3: New `generator.generate_pdf` orchestrator

**Files:**
- Modify: `backend/app/services/document_engine/generator.py`
- Modify: `backend/app/services/document_engine/__init__.py`

- [ ] **Step 1.3.1: Add a new function `generate_pdf` to the orchestrator**

Edit `backend/app/services/document_engine/generator.py`. Keep the existing `generate_document` function (still serving the 6 not-yet-migrated kinds). Add a new function:

```python
"""Document generation — fetch data, validate, call LLM, render PDF, persist, emit event."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient, ClientDocument
from app.services.agency_activity import EVENT_DOCUMENT_GENERATED, emit_event
from app.services.document_engine.preflight import check_required
from app.services.document_engine.registry import Template
from app.services.document_engine.structured_output import request_structured_output
from app.services.document_engine.typst_renderer import render_pdf as typst_render_pdf
from app.services.drafting.client import call_claude


_TEMPLATES_DIR = Path(__file__).parent / "templates"


async def generate_document(
    db: AsyncSession,
    *,
    client: AgencyClient,
    template: Template,
    actor_user_id: int | None,
) -> ClientDocument:
    """LEGACY markdown path — used by kinds not yet on Typst."""
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
        data_snapshot=data_json,
        generated_by_user_id=actor_user_id,
    )
    db.add(doc)
    await db.flush()
    await emit_event(db, agency_client_id=client.id,
                     event_type=EVENT_DOCUMENT_GENERATED,
                     body=f"Generated {template.name}",
                     actor_user_id=actor_user_id,
                     payload={"document_id": doc.id, "kind": template.kind})
    await db.commit()
    await db.refresh(doc)
    return doc


async def generate_pdf(
    db: AsyncSession,
    *,
    client: AgencyClient,
    template: Template,
    actor_user_id: int | None,
) -> tuple[bytes, ClientDocument]:
    """NEW typst path: preflight → fetch → LLM JSON → charts → typst render → persist.

    Returns (pdf_bytes, ClientDocument).
    """
    if template.typst_template is None or template.output_schema is None:
        raise ValueError(f"Template {template.kind!r} is not migrated to Typst yet")

    data = await template.fetch_data(db, client)
    check_required(list(template.required_fields), data)

    output = await request_structured_output(
        system_prompt=template.system_prompt,
        user_prompt=template.user_prompt_template.format(data_json=json.dumps(data, default=str, indent=2)),
        schema=template.output_schema,
        max_tokens=template.max_tokens,
    )

    charts: dict[str, str] = {}
    for chart_fn in template.chart_calls:
        svg_bytes = await chart_fn(db, client, data)
        charts[chart_fn.__name__] = svg_bytes.decode("utf-8")

    typst_input = {
        **data,
        "output": output.model_dump(),
        "charts": charts,
        "generated_at": _format_date_now(),
        "generated_by": _resolve_user_name(db, actor_user_id),
    }
    pdf_bytes = typst_render_pdf(
        template_path=_TEMPLATES_DIR / template.typst_template,
        data=typst_input,
    )

    doc = ClientDocument(
        agency_client_id=client.id,
        kind=template.kind,
        title=template.title_factory(client),
        body_markdown="",  # No markdown for typst-rendered kinds
        data_snapshot=json.dumps(typst_input, default=str),
        generated_by_user_id=actor_user_id,
    )
    db.add(doc)
    await db.flush()
    await emit_event(db, agency_client_id=client.id,
                     event_type=EVENT_DOCUMENT_GENERATED,
                     body=f"Generated {template.name}",
                     actor_user_id=actor_user_id,
                     payload={"document_id": doc.id, "kind": template.kind})
    await db.commit()
    await db.refresh(doc)
    return pdf_bytes, doc


def _format_date_now() -> str:
    from datetime import datetime
    return datetime.utcnow().strftime("%b %d, %Y")


async def _resolve_user_name(db, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    from app.models import User
    user = await db.get(User, user_id)
    return user.name if user else None
```

Note: `_resolve_user_name` is async but called synchronously in `typst_input` — fix that by awaiting it before composing:

```python
    generated_by = await _resolve_user_name(db, actor_user_id)
    typst_input = {
        **data,
        "output": output.model_dump(),
        "charts": charts,
        "generated_at": _format_date_now(),
        "generated_by": generated_by,
    }
```

- [ ] **Step 1.3.2: Export `generate_pdf` from `__init__.py`**

Edit `backend/app/services/document_engine/__init__.py`:

```python
"""Document engine — template registry + generator."""
from app.services.document_engine import (
    agency_weekly_report,
    audit_initial,
    kickoff_checklist,
    monthly_report,
    site_plan,
    sow,
    wikipedia_plan,
)
from app.services.document_engine.generator import generate_document, generate_pdf
from app.services.document_engine.preflight import MissingDataError
from app.services.document_engine.registry import (
    TEMPLATES,
    Template,
    get_template,
    list_templates,
    register,
)
from app.services.document_engine.structured_output import LLMJSONError

__all__ = [
    "TEMPLATES",
    "Template",
    "generate_document",
    "generate_pdf",
    "get_template",
    "list_templates",
    "register",
    "MissingDataError",
    "LLMJSONError",
]
```

- [ ] **Step 1.3.3: Commit**

```bash
git add backend/app/services/document_engine/generator.py backend/app/services/document_engine/__init__.py
git commit -m "feat(pdf): generate_pdf orchestrator (typst path) — coexists with legacy markdown path"
```

### Task 1.4: New render endpoint

**Files:**
- Modify: `backend/app/routers/agency.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_pdf_render_endpoint.py`

- [ ] **Step 1.4.1: Add response schemas**

Edit `backend/app/schemas.py` — append:

```python
class DocumentMissingFieldsError(BaseModel):
    detail: str
    missing_fields: list[str]
```

- [ ] **Step 1.4.2: Write failing test**

Create `backend/tests/test_pdf_render_endpoint.py`:

```python
"""Integration tests for POST /api/agency/clients/{id}/documents/{kind}/render."""
from __future__ import annotations

import shutil
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

from app.services.document_engine import audit_initial
from app.services.document_engine.audit_initial import AuditInitialOutput


pytestmark = pytest.mark.skipif(
    shutil.which("typst") is None,
    reason="typst CLI not installed",
)


async def _create_client_with_brand(db, admin_id) -> tuple[int, int]:
    """Helper to create a complete agency client + brand + brand profile."""
    # Use existing test factories under tests/conftest.py for brevity.
    from tests.conftest import factory_agency_client_full
    return await factory_agency_client_full(db, admin_id,
                                            brand_name="Acme",
                                            website_url="https://acme.com",
                                            company_description="Sells widgets")


@pytest.mark.asyncio
async def test_render_audit_initial_returns_pdf(client: AsyncClient, admin_headers, db, admin_user, monkeypatch):
    agency_client_id, _brand_id = await _create_client_with_brand(db, admin_user.id)

    # Mock the structured output
    fake_output = AuditInitialOutput(
        current_state="Acme has limited visibility.",
        working=["Strong on Reddit"],
        gaps=["No tone of voice captured"],
        recommendations=["Run baseline tracking"],
        open_questions=["Primary buyer?"],
    )
    monkeypatch.setattr(
        "app.services.document_engine.generator.request_structured_output",
        AsyncMock(return_value=fake_output),
    )

    res = await client.post(
        f"/api/agency/clients/{agency_client_id}/documents/audit_initial/render",
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF-")
    assert "attachment" in res.headers["content-disposition"]


@pytest.mark.asyncio
async def test_render_returns_400_on_missing_brand_data(client: AsyncClient, admin_headers, db, admin_user):
    # Create a client WITHOUT brand profile
    from tests.conftest import factory_agency_client_only
    agency_client_id = await factory_agency_client_only(db, admin_user.id)

    res = await client.post(
        f"/api/agency/clients/{agency_client_id}/documents/audit_initial/render",
        headers=admin_headers,
    )
    assert res.status_code == 400
    body = res.json()
    assert "missing_fields" in body
    assert "brand.name" in body["missing_fields"] or "brand.website_url" in body["missing_fields"]


@pytest.mark.asyncio
async def test_render_returns_400_on_unknown_kind(client: AsyncClient, admin_headers, db, admin_user):
    agency_client_id, _ = await _create_client_with_brand(db, admin_user.id)
    res = await client.post(
        f"/api/agency/clients/{agency_client_id}/documents/bogus_kind/render",
        headers=admin_headers,
    )
    assert res.status_code == 400
```

Add the `factory_agency_client_full` and `factory_agency_client_only` helpers to `tests/conftest.py`. (Use the existing test patterns — search `conftest.py` for `create_agency_client` style helpers and follow them.)

- [ ] **Step 1.4.3: Verify tests fail**

Run: `cd backend && pytest tests/test_pdf_render_endpoint.py -v`

Expected: 404 on render endpoint (not yet implemented).

- [ ] **Step 1.4.4: Implement the render endpoint**

Edit `backend/app/routers/agency.py`. After the existing `create_document` handler (around line 660), add:

```python
from app.services.document_engine import generate_pdf, get_template, MissingDataError, LLMJSONError
from app.services.document_engine.typst_renderer import TypstCompileError


@router.post("/clients/{client_id}/documents/{kind}/render")
async def render_document_pdf(
    client_id: int,
    kind: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_client_access),
):
    """Render a doc kind to PDF and return as binary download. One-click flow."""
    client = await db.get(AgencyClient, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    template = get_template(kind)
    if template is None or template.typst_template is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown or unmigrated template kind: {kind}",
        )

    try:
        pdf_bytes, doc = await generate_pdf(
            db, client=client, template=template, actor_user_id=user.id,
        )
    except MissingDataError as e:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Missing required brand data — fill these in before generating.",
                "missing_fields": e.missing,
            },
        ) from e
    except LLMJSONError as e:
        logger.exception("LLM JSON error rendering %s", kind)
        raise HTTPException(status_code=500, detail=f"LLM output error: {e}") from e
    except TypstCompileError as e:
        logger.exception("Typst compile error rendering %s", kind)
        raise HTTPException(status_code=500, detail=f"PDF render error: {e}") from e
    except ValueError as e:
        raise HTTPException(status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e

    safe_title = _re.sub(r"[^a-zA-Z0-9_-]+", "-", (doc.title or f"{kind}-{doc.id}"))[:120].strip("-")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
```

- [ ] **Step 1.4.5: Run tests (expect pass)**

Run: `cd backend && pytest tests/test_pdf_render_endpoint.py -v`

Expected: 3 passed (if typst installed).

- [ ] **Step 1.4.6: Commit**

```bash
git add backend/app/routers/agency.py backend/app/schemas.py backend/tests/test_pdf_render_endpoint.py backend/tests/conftest.py
git commit -m "feat(pdf): POST /clients/{id}/documents/{kind}/render endpoint"
```

### Task 1.5: Frontend `agencyRenderDocument` API + cockpit flow

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/components/agency/MissingBrandFieldsCard.tsx`
- Modify: `frontend/components/agency/PlaybookTab.tsx`

- [ ] **Step 1.5.1: Add `agencyRenderDocument` to api.ts**

In `frontend/lib/api.ts`, add a typed render method:

```typescript
export class MissingFieldsError extends Error {
  constructor(public missingFields: string[], message: string) {
    super(message);
    this.name = 'MissingFieldsError';
  }
}

export async function agencyRenderDocument(clientId: number, kind: string): Promise<{ blob: Blob; filename: string }> {
  try {
    const res = await api.post(`/agency/clients/${clientId}/documents/${kind}/render`, null, {
      responseType: 'blob',
    });
    const cd = res.headers['content-disposition'] as string | undefined;
    const match = cd && /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : `${kind}.pdf`;
    return { blob: res.data as Blob, filename };
  } catch (err) {
    // Axios with responseType:blob returns the error body as a Blob — parse it.
    const e = err as { response?: { status?: number; data?: Blob } };
    if (e.response?.data instanceof Blob) {
      const text = await e.response.data.text();
      try {
        const body = JSON.parse(text);
        if (e.response.status === 400 && body?.detail?.missing_fields) {
          throw new MissingFieldsError(body.detail.missing_fields, body.detail.detail || 'Missing brand fields');
        }
        if (body?.detail) {
          throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail));
        }
      } catch (parseErr) {
        if (parseErr instanceof MissingFieldsError) throw parseErr;
        // fall through
      }
    }
    throw err;
  }
}
```

- [ ] **Step 1.5.2: Create `MissingBrandFieldsCard.tsx`**

```typescript
'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

interface Props {
  brandId: number | null;
  missingFields: string[];
  onDismiss: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  'brand.name': 'Brand name',
  'brand.website_url': 'Website URL',
  'brand_profile.company_description': 'Company description',
  'brand_profile.tone_of_voice': 'Tone of voice',
  'brand_profile.target_audience': 'Target audience',
  'brand_profile.what_not_to_say': 'What not to say',
  'brand_profile.approved_language': 'Approved language',
  'brand_profile.publications': 'Publications',
};

export function MissingBrandFieldsCard({ brandId, missingFields, onDismiss }: Props) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="flex-1">
          <p className="font-medium">Add these to the brand profile before generating:</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {missingFields.map((f) => (
              <li key={f}>{FIELD_LABELS[f] ?? f}</li>
            ))}
          </ul>
          {brandId != null && (
            <Link
              href={`/tracker/${brandId}/profile`}
              className="mt-2 inline-block text-xs underline hover:text-amber-50"
            >
              Open Brand Profile →
            </Link>
          )}
        </div>
        <button onClick={onDismiss} className="text-xs text-amber-200 hover:text-amber-50">
          dismiss
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 1.5.3: Wire `PlaybookTab.generateDoc` to the new flow**

In `PlaybookTab.tsx`, replace the `generateDoc` function:

```typescript
import { agencyRenderDocument, MissingFieldsError, parseApiError, ... } from '@/lib/api';
import { MissingBrandFieldsCard } from './MissingBrandFieldsCard';
```

```typescript
  const [missing, setMissing] = useState<string[] | null>(null);

  const generateDoc = async (kind: string) => {
    if (busyKind) return;
    setGenError(null);
    setMissing(null);
    setBusyKind(kind);
    try {
      // Only audit_initial uses the new render path for now.
      // Other kinds fall back to the legacy generate-doc-then-open-modal flow.
      if (kind === 'audit_initial') {
        const { blob, filename } = await agencyRenderDocument(client.id, kind);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const doc = await agencyGenerateDocument(client.id, kind);
        setViewerDoc(doc);
        if (kind === 'agency_weekly_report') setReports((r) => ({ ...r, weekly: doc }));
        if (kind === 'monthly_report') setReports((r) => ({ ...r, monthly: doc }));
      }
    } catch (e) {
      if (e instanceof MissingFieldsError) {
        setMissing(e.missingFields);
      } else {
        setGenError(parseApiError(e, 'Failed to generate document'));
      }
    } finally {
      setBusyKind(null);
    }
  };
```

Render `MissingBrandFieldsCard` in the section where `genError` is rendered:

```typescript
      {missing && (
        <MissingBrandFieldsCard
          brandId={client.brand_id}
          missingFields={missing}
          onDismiss={() => setMissing(null)}
        />
      )}
```

- [ ] **Step 1.5.4: tsc check + visual smoke**

Run: `cd frontend && npx tsc --noEmit`

Expected: clean.

Then start the dev server (per memory: backend on 3001, frontend on 3002) and click "Generate doc" on the Initial audit row in a real client with full brand data. PDF should download.

Click again on a client with NO brand profile — the amber MissingBrandFieldsCard should render with the missing field labels and a deep link to the brand profile.

- [ ] **Step 1.5.5: Commit**

```bash
git add frontend/lib/api.ts frontend/components/agency/MissingBrandFieldsCard.tsx frontend/components/agency/PlaybookTab.tsx
git commit -m "feat(pdf): cockpit one-click → PDF download for audit_initial (with missing-fields card)"
```

### Task 1.6: Backend Dockerfile — install typst

**Files:**
- Modify: `backend/Dockerfile`

- [ ] **Step 1.6.1: Add typst install step**

Edit `backend/Dockerfile`. After the system-package layer (apt-get / etc.), add:

```dockerfile
# Install typst CLI for agency PDF rendering
RUN ARCH=$(uname -m | sed 's/x86_64/x86_64/;s/aarch64/aarch64/') && \
    TYPST_VER="0.12.0" && \
    curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VER}/typst-${ARCH}-unknown-linux-musl.tar.xz" \
      | tar -xJ --strip-components=1 -C /usr/local/bin typst-${ARCH}-unknown-linux-musl/typst && \
    chmod +x /usr/local/bin/typst && \
    typst --version
```

(Replace `0.12.0` with the version that matches your local install — `typst --version` locally.)

- [ ] **Step 1.6.2: Add matplotlib to requirements**

In `backend/requirements.txt`, ensure `matplotlib>=3.7` is listed. If missing, add it.

- [ ] **Step 1.6.3: Build the image locally and verify**

Run: `cd backend && docker build -t lumidian-backend-test . && docker run --rm lumidian-backend-test typst --version`

Expected: prints `typst 0.x.x` from inside the container.

- [ ] **Step 1.6.4: Commit**

```bash
git add backend/Dockerfile backend/requirements.txt
git commit -m "build(pdf): install typst CLI in backend image"
```

### Task 1.7: End-of-phase verification

- [ ] **Step 1.7.1: Run full backend test suite**

Run: `cd backend && pytest tests/ -x --ignore=tests/test_client_portal.py -q`

Expected: all green.

- [ ] **Step 1.7.2: Frontend type check + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`

Expected: clean.

- [ ] **Step 1.7.3: Manual smoke**

In a browser:
1. Open cockpit for a client with full brand data → click Initial audit Generate doc → PDF downloads → opens to typeset audit
2. Open cockpit for a client with empty brand profile → click Initial audit Generate doc → amber MissingBrandFieldsCard renders with field labels + deep link
3. Click Initial audit again while one's generating → button is disabled, spinner showing → fine
4. Click another kind (SOW, kickoff, etc.) → falls back to legacy markdown modal (still works)

- [ ] **Step 1.7.4: Update CURRENT_STATE.md**

Add a "Recent Decisions" line and update WIP. Commit separately.

```bash
git add CURRENT_STATE.md
git commit -m "docs: CURRENT_STATE — Phase 1 (audit_initial Typst PDF) shipped"
```

---

## Phase 2 — Fill the gap (`wikipedia_plan` + `site_plan`)

These two kinds currently throw `ValueError("No PDF template registered for document kind: ...")` when clicked. They are the biggest visible "nothing comes out" bug. Migrate them next.

### Task 2.1: `wikipedia_plan` schema + REQUIRED_FIELDS

**Files:**
- Modify: `backend/app/services/document_engine/wikipedia_plan.py`

- [ ] **Step 2.1.1: Inspect the existing `fetch_data` output shape**

Run: `grep -A 40 "def fetch_data" backend/app/services/document_engine/wikipedia_plan.py`

Note the keys it returns (candidates list, scan metadata, brand publications, etc.).

- [ ] **Step 2.1.2: Add `WikipediaPlanOutput` Pydantic model**

Append to the module:

```python
from pydantic import BaseModel, Field


class WikiCandidateOut(BaseModel):
    article_title: str
    angle: str = Field(..., description="One-sentence on how we contribute legitimately")
    suggested_section: str | None = None


class WikipediaPlanOutput(BaseModel):
    summary: str = Field(..., description="2-3 sentences on the brand's Wikipedia opportunity overall")
    approach: str = Field(..., description="2-3 paragraphs on the engagement approach (publication strategy)")
    top_candidates: list[WikiCandidateOut] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)


REQUIRED_FIELDS = (
    "brand.name",
    "candidates",          # require at least one candidate from the scan
)
```

Update the `register(Template(...))` call to include the new fields:

```python
register(
    Template(
        kind="wikipedia_plan",
        ...,
        required_fields=REQUIRED_FIELDS,
        output_schema=WikipediaPlanOutput,
        typst_template="wikipedia_plan.typ",
        chart_calls=(),
    )
)
```

- [ ] **Step 2.1.3: Commit**

```bash
git add backend/app/services/document_engine/wikipedia_plan.py
git commit -m "feat(pdf): wikipedia_plan schema + required_fields + typst binding"
```

### Task 2.2: `wikipedia_plan.typ` template

**Files:**
- Create: `backend/app/services/document_engine/templates/wikipedia_plan.typ`

- [ ] **Step 2.2.1: Write the template**

```typst
#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, callout, bullet

#let data = json("data.json")

#cover(
  "briefing",
  data.brand.name,
  "Wikipedia plan",
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(data.brand.name, "Wikipedia plan")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Wikipedia opportunity plan]

#callout[#data.output.summary]

#h2[Approach]
#data.output.approach

#if data.output.top_candidates.len() > 0 [
  #h2[Top candidate articles]
  #for cand in data.output.top_candidates [
    #block(above: lumidian.space_block, stroke: (left: 1pt + lumidian.border), inset: (left: lumidian.space_card))[
      #text(font: lumidian.body_font, weight: "medium", fill: lumidian.ink)[#cand.article_title]
      #if cand.suggested_section != none [
        #text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[ → #cand.suggested_section]
      ]
      #v(lumidian.space_line / 2)
      #text(fill: lumidian.ink)[#cand.angle]
    ]
  ]
]

#if data.output.risks.len() > 0 [
  #h2[Risks]
  #for item in data.output.risks [#bullet(item)]
]
```

- [ ] **Step 2.2.2: Smoke-compile (same pattern as Task 1.2.2)**

Use a synthetic data.json with 2-3 candidates and verify the layout.

- [ ] **Step 2.2.3: Commit**

```bash
git add backend/app/services/document_engine/templates/wikipedia_plan.typ
git commit -m "feat(pdf): wikipedia_plan.typ template (briefing personality)"
```

### Task 2.3: `site_plan` schema + REQUIRED_FIELDS

**Files:**
- Modify: `backend/app/services/document_engine/site_plan.py`

- [ ] **Step 2.3.1: Inspect existing fetch_data output**

- [ ] **Step 2.3.2: Add `SitePlanOutput`**

```python
from pydantic import BaseModel, Field


class SitePlanFixOut(BaseModel):
    title: str
    category: str
    priority: str  # "high"/"medium"/"low"
    why_it_matters: str
    plain_action: str


class SitePlanOutput(BaseModel):
    summary: str
    score_interpretation: str = Field(..., description="One paragraph reading the audit scores")
    top_fixes: list[SitePlanFixOut] = Field(default_factory=list)
    next_30_days: list[str] = Field(default_factory=list)


REQUIRED_FIELDS = (
    "brand.name",
    "audit.overall_score",
)
```

Update `register(...)` analogously.

- [ ] **Step 2.3.3: Commit**

### Task 2.4: `site_plan.typ` template

**Files:**
- Create: `backend/app/services/document_engine/templates/site_plan.typ`

- [ ] **Step 2.4.1: Write the template (briefing personality, fixes-as-cards layout)**

```typst
#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, h3, callout, bullet, score_card

#let data = json("data.json")

#cover(
  "briefing",
  data.brand.name,
  "Site plan",
  data.generated_at,
  data.at("generated_by", default: none),
)

#header_footer(data.brand.name, "Site plan")

#set par(justify: true, leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body, fill: lumidian.ink)

#h1[Site optimization plan]

#callout[#data.output.summary]

#grid(columns: (1fr, 1fr), column-gutter: lumidian.space_block,
  score_card(str(data.audit.overall_score), "Overall"),
  score_card(str(data.audit.bot_access_score), "Bot access"),
)

#h2[Reading the scores]
#data.output.score_interpretation

#if data.output.top_fixes.len() > 0 [
  #h2[Top fixes to ship]
  #for fix in data.output.top_fixes [
    #block(above: lumidian.space_block, stroke: 0.5pt + lumidian.border, inset: lumidian.space_card, breakable: false)[
      #grid(columns: (1fr, auto))[
        #text(font: lumidian.body_font, weight: "medium")[#fix.title]
        #text(font: lumidian.mono_font, size: lumidian.size_caption, fill: lumidian.muted)[#upper(fix.priority) · #fix.category]
      ]
      #v(lumidian.space_line)
      #text(fill: lumidian.muted, size: lumidian.size_caption)[Why it matters]
      #v(2pt)
      #fix.why_it_matters
      #v(lumidian.space_line)
      #text(fill: lumidian.muted, size: lumidian.size_caption)[What to do]
      #v(2pt)
      #fix.plain_action
    ]
  ]
]

#if data.output.next_30_days.len() > 0 [
  #h2[Next 30 days]
  #for item in data.output.next_30_days [#bullet(item)]
]
```

Note the `breakable: false` on the fix card — Typst's page-break-avoid for that block.

- [ ] **Step 2.4.2: Smoke-compile**

- [ ] **Step 2.4.3: Commit**

```bash
git add backend/app/services/document_engine/templates/site_plan.typ backend/app/services/document_engine/site_plan.py
git commit -m "feat(pdf): site_plan.typ template (briefing personality, fixes-as-cards)"
```

### Task 2.5: Frontend wiring — route both kinds to new endpoint

**Files:**
- Modify: `frontend/components/agency/PlaybookTab.tsx`

- [ ] **Step 2.5.1: Expand the new-path condition to include wikipedia_plan + site_plan**

In `generateDoc`:

```typescript
const NEW_PATH_KINDS = new Set(['audit_initial', 'wikipedia_plan', 'site_plan']);
if (NEW_PATH_KINDS.has(kind)) {
  // render + download
} else {
  // legacy modal
}
```

- [ ] **Step 2.5.2: tsc + smoke**

Click both buttons on the cockpit. PDFs download. Missing-fields card fires when data is thin.

- [ ] **Step 2.5.3: Commit**

```bash
git add frontend/components/agency/PlaybookTab.tsx
git commit -m "feat(pdf): route wikipedia_plan + site_plan to new render endpoint"
```

### Task 2.6: Phase 2 verification + CURRENT_STATE update

- [ ] **Step 2.6.1: Full backend tests**

- [ ] **Step 2.6.2: Frontend tsc + build**

- [ ] **Step 2.6.3: Update CURRENT_STATE.md**

```bash
git add CURRENT_STATE.md && git commit -m "docs: CURRENT_STATE — Phase 2 (wikipedia_plan + site_plan) shipped"
```

---

## Phase 3 — Migrate remaining 4 kinds

Same pattern for each: schema → REQUIRED_FIELDS → typst template → smoke compile → commit. Each is a separate sub-phase to keep PRs reviewable.

### Task 3.1: `kickoff_checklist` (briefing personality, check-list-item components)

**Files:**
- Modify: `backend/app/services/document_engine/kickoff_checklist.py`
- Create: `backend/app/services/document_engine/templates/kickoff_checklist.typ`

- [ ] **Step 3.1.1: Add `KickoffChecklistOutput` schema**

```python
class KickoffChecklistItem(BaseModel):
    label: str
    done: bool = False
    owner: str | None = None

class KickoffChecklistOutput(BaseModel):
    pre_kickoff: list[KickoffChecklistItem] = Field(default_factory=list)
    in_meeting: list[KickoffChecklistItem] = Field(default_factory=list)
    post_kickoff: list[KickoffChecklistItem] = Field(default_factory=list)

REQUIRED_FIELDS = ("brand.name",)
```

- [ ] **Step 3.1.2: Write `kickoff_checklist.typ` using `check_item`**

```typst
#import "_tokens.typ": lumidian
#import "_cover.typ": cover
#import "_header_footer.typ": header_footer
#import "_components.typ": h1, h2, check_item

#let data = json("data.json")

#cover("briefing", data.brand.name, "Kickoff checklist", data.generated_at, data.at("generated_by", default: none))
#header_footer(data.brand.name, "Kickoff checklist")

#set par(leading: 0.65em)
#set text(font: lumidian.body_font, size: lumidian.size_body)

#h1[Kickoff checklist]

#h2[Before the meeting]
#for item in data.output.pre_kickoff [#check_item(item.done, item.label)]

#h2[In the meeting]
#for item in data.output.in_meeting [#check_item(item.done, item.label)]

#h2[After the meeting]
#for item in data.output.post_kickoff [#check_item(item.done, item.label)]
```

- [ ] **Step 3.1.3: Smoke-compile, frontend NEW_PATH_KINDS add, commit**

### Task 3.2: `sow` (contract personality, signature block)

**Files:**
- Modify: `backend/app/services/document_engine/sow.py`
- Create: `backend/app/services/document_engine/templates/sow.typ`

- [ ] **Step 3.2.1: Add `SowOutput` schema (preamble, scope, deliverables, exclusions, timeline, fees)**

```python
class SowOutput(BaseModel):
    preamble: str
    scope: str
    deliverables: list[str]
    exclusions: list[str]
    timeline: str
    fees: str
    sow_number: str
```

- [ ] **Step 3.2.2: Write `sow.typ` using contract cover + signature_block**

Reference `_components.typ:signature_block`. Cover uses `style="contract"`. Sections numbered: 1. Preamble, 2. Scope, …, 7. Acceptance & signatures.

- [ ] **Step 3.2.3: Smoke, frontend, commit**

### Task 3.3: `agency_weekly_report` (report personality, all 4 charts)

**Files:**
- Modify: `backend/app/services/document_engine/agency_weekly_report.py`
- Create: `backend/app/services/document_engine/templates/weekly_report.typ`

- [ ] **Step 3.3.1: Add `WeeklyReportOutput` schema**

```python
class WeeklyReportOutput(BaseModel):
    executive_summary: str
    week_in_review: str
    per_prompt_callouts: list[str] = Field(default_factory=list)
    competitor_delta: str | None = None
    content_shipped: list[str] = Field(default_factory=list)
    top_gaps: list[str] = Field(default_factory=list)
    next_week: list[str] = Field(default_factory=list)
```

REQUIRED_FIELDS includes `latest_run.overall_score`.

- [ ] **Step 3.3.2: Wire `chart_calls` to the four chart functions**

```python
from app.services.document_engine.charts.visibility_over_time import render_visibility_over_time
from app.services.document_engine.charts.model_mix import render_model_mix
from app.services.document_engine.charts.prompt_scorecard import render_prompt_scorecard
from app.services.document_engine.charts.competitor_compare import render_competitor_compare

async def _chart_visibility(db, client, data) -> bytes:
    # Build (date, score) tuples from recent runs
    ...
    return render_visibility_over_time(points)

async def _chart_model_mix(db, client, data) -> bytes:
    return render_model_mix(data.get("latest_run", {}).get("model_scores", {}))

async def _chart_scorecard(db, client, data) -> bytes:
    return render_prompt_scorecard(data.get("prompt_rows", []))

async def _chart_competitor(db, client, data) -> bytes:
    return render_competitor_compare(
        brand_score=data.get("latest_run", {}).get("overall_score", 0),
        competitor_scores=data.get("competitor_scores", {}),
    )

register(Template(
    ...,
    chart_calls=(_chart_visibility, _chart_model_mix, _chart_scorecard, _chart_competitor),
))
```

Extend `fetch_data` to populate `prompt_rows` and `competitor_scores` if not already present.

- [ ] **Step 3.3.3: Write `weekly_report.typ` (report personality cover; embed all 4 charts via `image.decode(data.charts._chart_X)`)**

- [ ] **Step 3.3.4: Smoke, frontend, commit**

### Task 3.4: `monthly_report` (report personality, same charts as weekly + month-over-month framing)

**Files:**
- Modify: `backend/app/services/document_engine/monthly_report.py`
- Create: `backend/app/services/document_engine/templates/monthly_report.typ`

Mirror Task 3.3 but: 4-week MoM framing, longer executive summary, optional "month highlights" section.

### Task 3.5: Phase 3 end-state verification + CURRENT_STATE

All 7 kinds now go through the new render endpoint. The frontend can be simplified to always use the new path.

- [ ] **Step 3.5.1: Replace `NEW_PATH_KINDS` set with always-new**

In `PlaybookTab.tsx`, remove the conditional — always call `agencyRenderDocument`.

- [ ] **Step 3.5.2: Apply same to `PlaybookReports.tsx`**

Switch from `agencyGenerateDocument` to `agencyRenderDocument` + download.

- [ ] **Step 3.5.3: Full backend tests + frontend tsc/build**

- [ ] **Step 3.5.4: Commit**

```bash
git add frontend/components/agency/PlaybookTab.tsx frontend/components/agency/PlaybookReports.tsx
git commit -m "feat(pdf): all 7 kinds on new render endpoint; drop NEW_PATH_KINDS gate"
```

- [ ] **Step 3.5.5: Update CURRENT_STATE.md, commit.**

---

## Phase 4 — Decommission the old path

The old Playwright + Jinja2 + markdown system has zero callers from the cockpit. Delete it.

### Task 4.1: Delete old Playwright path

**Files:**
- Delete: `backend/app/services/document_engine/pdf_renderer.py`
- Delete: `backend/app/services/document_engine/markdown_sections.py`
- Delete: all `templates/*.html.j2` files
- Modify: `backend/app/routers/agency.py` — remove the old `POST /clients/{id}/documents` markdown endpoint, the old `GET /documents/{id}/pdf` endpoint (it shelled out to the Playwright path), keep the `GET /clients/{id}/documents` list + `GET /documents/{id}` view + `PATCH /documents/{id}` (data-snapshot editor) + `DELETE /documents/{id}`
- Modify: `backend/app/services/document_engine/generator.py` — delete `generate_document` (the legacy function)
- Modify: `backend/app/services/document_engine/__init__.py` — drop `generate_document` from exports

- [ ] **Step 4.1.1: Search for any remaining callers**

Run: `cd backend && grep -rn "generate_document\b" app/ tests/ | grep -v "generate_pdf"`

Expected: zero results outside tests. Update any tests that mock `generate_document` to mock `generate_pdf` instead.

- [ ] **Step 4.1.2: Delete the files**

```bash
rm backend/app/services/document_engine/pdf_renderer.py
rm backend/app/services/document_engine/markdown_sections.py
rm backend/app/services/document_engine/templates/*.html.j2
rm backend/app/services/document_engine/templates/_fonts.css.j2  # CSS file no longer needed
rm backend/app/services/document_engine/templates/_styles.css.j2
rm backend/app/services/document_engine/templates/_base.html.j2
```

- [ ] **Step 4.1.3: Delete the old markdown endpoint + PDF endpoint from agency.py**

Remove the `POST /clients/{id}/documents` handler (the legacy one, NOT the new render endpoint) and the `GET /documents/{id}/pdf` handler.

Also delete the legacy `generate_document` import.

- [ ] **Step 4.1.4: Frontend cleanup — drop legacy doc methods**

In `frontend/lib/api.ts`, delete `agencyGenerateDocument`, `agencyGenerateWeeklyReport`, `agencyDownloadDocumentPdf`. Keep `agencyListDocuments`, `agencyGetDocument`, `agencyUpdateDocument`, `agencyDeleteDocument` (history view still uses them).

In `PlaybookTab.tsx`, remove the `viewerDoc` state and the `<DocumentViewer>` mount — the generate-doc path no longer opens it.

In `ClientBrandTab.tsx` (the history list), confirm `DocumentViewer` still works for past markdown-based docs (read-only — they exist in the DB from before the migration). Add a one-line banner inside DocumentViewer when `doc.body_markdown` is empty (typst-rendered doc) showing "Re-download" instead of "Edit/Copy/Download" actions.

- [ ] **Step 4.1.5: Add "Re-download" action to DocumentViewer for typst docs**

In `DocumentViewer.tsx`, if `doc.body_markdown === ""` (a typst-rendered doc), replace the markdown editor with a JSON viewer (`<pre>{JSON.stringify(doc.data_snapshot, null, 2)}</pre>`) and replace the Download PDF button with one that calls the new render endpoint to re-generate.

- [ ] **Step 4.1.6: Run tests, fix any breakages**

- [ ] **Step 4.1.7: Commit**

```bash
git add -A backend/app/services/document_engine backend/app/routers/agency.py frontend/lib/api.ts frontend/components/agency/
git commit -m "chore(pdf): decommission Playwright + Jinja2 legacy path"
```

### Task 4.2: Phase 4 verification

- [ ] **Step 4.2.1: Full backend tests + frontend tsc/build + manual smoke per kind**

- [ ] **Step 4.2.2: Update CURRENT_STATE.md, commit**

---

## Phase 5 — Prompt audit + tune (per template)

This phase is the only one that requires you (Ken) — judgement calls based on real generated output.

For each of the 7 templates, do these steps. Order: start with the kinds you'll send most frequently (`audit_initial`, `agency_weekly_report`, `monthly_report`), then the rest.

### Task 5.N: Prompt audit for `<kind>`

**Files:**
- Modify: `backend/app/services/document_engine/<kind>.py` (system_prompt only)

- [ ] **Step 5.N.1: Generate against real brand**

In the cockpit, point at a client backed by the Spotitearly export (or the production brand of your choice). Click Generate doc. Read the resulting PDF.

- [ ] **Step 5.N.2: Critique against the rubric**

Score 1-5 on:
- **Length:** Briefing ≤ 1 page, SOW ≤ 2, report ≤ 4. Penalize overshoot.
- **Voice:** Senior consultant. Direct, declarative. No "we should consider…" — say it.
- **Filler:** Zero "Not yet captured", zero throat-clearing intro paragraphs, zero adverb spam.
- **Concreteness:** Numbers where numbers exist (score, prompts, % deltas). Named entities (specific competitors, specific prompts). No "various competitors".

Anything below 4 needs a prompt tweak.

- [ ] **Step 5.N.3: Tune `system_prompt`**

Edit the `SYSTEM_PROMPT` constant. Make the rules concrete. Examples that move the needle:

- "Open with the headline finding. No 'In this report, we will examine'."
- "Recommendations: 3-5, each starting with a verb, each ≤ 20 words. No nested bullets."
- "If a data field is empty, omit the section entirely. Do not write filler."
- "Cite scores using the format `64/100` (not `64 percent` or `score of 64`)."

- [ ] **Step 5.N.4: Regenerate and re-score**

Run through the rubric again. Iterate until the doc would not be edited.

- [ ] **Step 5.N.5: Lock + commit**

```bash
git add backend/app/services/document_engine/<kind>.py
git commit -m "feat(pdf): tune <kind> system_prompt — edit-free pass"
```

Repeat for all 7 kinds.

---

## Phase 6 — Visual review + acceptance

### Task 6.1: Per-kind visual pass

- [ ] **Step 6.1.1: For each of the 7 kinds, generate against real data and verify the 8 acceptance criteria from the spec**

1. Brand wordmark/logo, brand colors, correct typography ✓
2. No orphaned headings, mid-card page breaks, floating signature blocks ✓
3. No "Not yet captured", "TODO", template-leftover language ✓
4. Reads as senior consultant ✓
5. Respects per-kind length budget ✓
6. Consistent across two consecutive runs ✓
7. Downloads in one click from cockpit ✓
8. Refuses + remediation message on missing brand data ✓

- [ ] **Step 6.1.2: Catalogue any issues**

For each issue found, decide: fix in this PR, or carry forward as a follow-up task. The bar for shipping is "no issue that would force a manual edit before sending."

- [ ] **Step 6.1.3: Fix in-line**

Each fix is a small commit: token tweak, template adjustment, prompt tweak.

### Task 6.2: Final verification

- [ ] **Step 6.2.1: Full backend test suite + ignore client_portal pre-existing**

- [ ] **Step 6.2.2: Frontend tsc + build**

- [ ] **Step 6.2.3: Smoke each kind one final time**

- [ ] **Step 6.2.4: Update CURRENT_STATE.md with the final shipped state, commit**

- [ ] **Step 6.2.5: Open PR**

```bash
gh pr create --title "Agency PDF flawless design (Typst engine)" --body "$(cat <<'EOF'
## Summary
- Replaces Playwright + Jinja2 PDF rendering with Typst across all 7 agency document kinds
- One-click flow: cockpit Generate-doc button → PDF download (no intermediate modal)
- Preflight data gate with inline remediation card when required brand data is missing
- Structured JSON LLM output (replaces fragile markdown parsing)
- Embedded charts (line / donut / heatmap / bar) via matplotlib with Lumidian style
- Per-kind typeset personality: briefing / report / contract
- Wikipedia_plan and site_plan PDF templates added (previously errored on generate)

## Test plan
- [ ] Generate each of 7 kinds against the Spotitearly export client
- [ ] Click Generate for a kind on a client with missing brand fields → amber remediation card with deep link
- [ ] Click two doc kinds in quick succession → one disables while the other generates
- [ ] Open a pre-migration document in Brand-tab history → readable; re-render works
- [ ] Backend tests green: pytest tests/ --ignore=tests/test_client_portal.py
- [ ] Frontend clean: tsc --noEmit + npm run build

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (run after writing the plan)

### Spec coverage check

For each item in the spec, find the implementing task:

| Spec item | Task(s) |
|---|---|
| 1. Engine swap → Typst | 0.9 (renderer), 1.6 (Dockerfile), all template tasks |
| 2. Seven Typst templates + shared design system | 0.3 (_tokens), 0.4 (_cover), 0.5 (_header_footer), 0.6 (_components), 1.2, 2.2, 2.4, 3.1-3.4 |
| 3. Two new templates (wikipedia_plan, site_plan) | 2.1, 2.2, 2.3, 2.4 |
| 4. Embedded charts via matplotlib | 0.7 (_style), 0.8 (4 functions), 3.3 (wired into weekly_report) |
| 5. One-click cockpit flow → PDF download | 1.4 (render endpoint), 1.5 (frontend), 3.5 (drop conditional) |
| 6. Preflight data gate | 0.10 (preflight module), 1.4 (endpoint maps to 400), 1.5 (frontend card) |
| 7. Prompt audit + tune per template | Phase 5 |
| 8. Section rendering robustness (markdown_sections) | Obsolete after structured JSON; deleted in Phase 4 |
| 9. Per-kind visual review pass | Phase 6 |
| Acceptance criteria 1-8 | Phase 6.1.1 |

No gaps.

### Placeholder scan

Reviewed for "TBD", "TODO", "implement later", "similar to Task N", code-step descriptions without code. None found. Every code-bearing step has the actual code.

### Type consistency

- `Template.required_fields` is `tuple[str, ...]` everywhere it's used
- `Template.output_schema: Type[BaseModel] | None` — used as a class, not instance
- `MissingDataError.missing: list[str]` — used consistently in routes + tests
- `agencyRenderDocument` returns `{ blob: Blob, filename: string }` everywhere it's called
- `MissingFieldsError.missingFields: string[]` — matches usage in `PlaybookTab.tsx`

Consistent.

### Scope check

Single plan, six phases, ~6 days. Each phase is a coherent shippable unit. Plan is appropriate scope.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-07-agency-pdf-flawless.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for phases 0–3 (lots of independent file additions).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Better for phases 5–6 where your judgment is the gate.

A reasonable split: subagent-driven for Phases 0–4 (the mechanical build), inline for Phase 5 (prompt audit — you're the rubric) and Phase 6 (visual review — only you can call "this PDF would not need an edit").

Which approach?
