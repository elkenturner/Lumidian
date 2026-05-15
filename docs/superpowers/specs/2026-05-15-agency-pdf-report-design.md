# Agency Weekly Report PDF — Design

**Date:** 2026-05-15
**Status:** Approved (autonomous mode). Sub-project H of the agency-portal-OS roadmap.

---

## Context

Sub-project G ships a markdown weekly report stored as a `ClientDocument`. To deliver it to the client, agency staff need a **branded, print-quality PDF** they can attach to an email — not a markdown blob. This is the artifact the client actually sees, so design quality matters.

## Goals

1. New endpoint `GET /api/agency/documents/{id}/pdf` returns a polished, branded PDF of an `agency_weekly_report` document.
2. The PDF mixes the LLM-rendered narrative (executive summary, visibility commentary, next-week recs) with directly-rendered structured data (per-prompt table, competitor counts, content shipped, attribution). No data drift — the document carries its own data snapshot.
3. Cockpit gets a "Download PDF" button on every `agency_weekly_report` row.

## Non-Goals

- Other document kinds get PDF export later if needed; this sub-project only covers `agency_weekly_report`.
- No email-send-with-attachment (staff downloads + attaches manually — Ken's "manual email for now" rule).
- No async background rendering / queue. Playwright takes ~3–5s; that's fine for a synchronous download.
- No interactive PDF features (no fillable forms, no hyperlinks beyond basic `<a href>` for the review URL).
- No custom per-client branding (everything is Lumidian-branded; the client name appears as the report subject, not as a co-brand).

## Data Model

One additive change: persist the fetch_data output on the document so re-rendering doesn't drift.

```sql
ALTER TABLE client_documents ADD COLUMN data_snapshot TEXT NULL;
```

Stored as JSON-encoded string of the dict that `agency_weekly_report.fetch_data()` produced at generation time. Migration is added at the bottom of `database.py:run_migrations()`.

`ClientDocument` ORM model gets a `data_snapshot: Mapped[str | None]` column.

## Architecture

### Generation path (unchanged + 1 line)

`document_engine/generator.py:generate_document()` already calls `template.fetch_data(db, client)` to feed the LLM. We persist the same dict on the new `ClientDocument.data_snapshot` column. No behavior change for any other template.

### PDF render path (new)

New module: `backend/app/services/document_engine/pdf_renderer.py`.

```
render_pdf(document: ClientDocument) -> bytes
  ├─ parse_markdown_sections(document.body_markdown)  # {heading_slug: html}
  ├─ data = json.loads(document.data_snapshot) if present else fetch_data(...)
  ├─ html = render_html_template(document, data, sections)  # Jinja2
  └─ pdf = playwright_pdf_from_html(html)
```

#### Markdown section parsing

The system prompt in `agency_weekly_report.py` enforces exactly these headings. We split the markdown by lines starting with `## ` and key by normalized heading:

| Heading in markdown | Key |
|---|---|
| `## Executive summary` | `executive_summary` |
| `## Visibility this week` | `visibility` |
| `## Per-prompt scorecard` | `prompts` |
| `## Competitor delta` | `competitors` |
| `## Content shipped` | `content` |
| `## Impact of posted content` | `impact` |
| `## Top gaps to close` | `gaps` |
| `## Next week` | `next_week` |

For each section, convert the body to HTML using the `markdown` library. Sections we render from structured data (prompts table, competitor delta, content list) get their narrative paragraph from the markdown but the table from `data`. If a heading is missing, render an empty `<div>` and continue — never crash.

#### HTML template

Single Jinja2 template at `backend/app/services/document_engine/templates/weekly_report.html.j2`. Six `.page` divs. Inline CSS in `<style>` block — no external assets. Logo embedded as base64-encoded PNG read at template-render time from `frontend/public/logo.png` (single source of truth — the same logo the cockpit uses).

#### Playwright render

```python
from playwright.async_api import async_playwright

async def playwright_pdf_from_html(html: str) -> bytes:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.set_content(html, wait_until="networkidle")
        pdf = await page.pdf(format="Letter", margin={"top": "0", "bottom": "0", "left": "0", "right": "0"}, print_background=True)
        await browser.close()
        return pdf
```

`networkidle` is safe because we have zero external requests (everything inline). Letter format with zero margins — the CSS handles padding inside each page.

### Endpoint

`backend/app/routers/agency.py`:

```python
@router.get("/documents/{document_id}/pdf")
async def get_document_pdf(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    doc = await db.get(ClientDocument, document_id)
    if doc is None:
        raise HTTPException(404, "Document not found")
    if doc.kind != "agency_weekly_report":
        raise HTTPException(400, "PDF export is only available for weekly reports")
    pdf_bytes = await render_pdf(db, doc)
    safe_title = re.sub(r"[^a-zA-Z0-9_-]+", "-", doc.title or f"weekly-report-{doc.id}")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )
```

## PDF Layout (6 pages)

| Page | Contents |
|---|---|
| 1 — Cover | Lumidian logo (top-left, 120px). Centered: "Weekly visibility report" (small caps), client name (huge serif), week label (e.g., "Week of May 8 – May 15, 2026"). Bottom-left: prepared-by name + date. Bottom-right: tiny Lumidian wordmark. |
| 2 — Executive headline | Big number: this-week's `overall_score` with up/down arrow + delta vs last week. Below: 2–3 sentence executive summary paragraph (from markdown). |
| 3 — Visibility breakdown | Title "Visibility by model." Per-model horizontal SVG bars sized to score (0–100). Labels: model name, score, WoW delta. Below: visibility commentary paragraph (from markdown). |
| 4 — Prompt scorecard | Title "Prompt-by-prompt." Table sorted worst→best. Columns: Prompt | This week | Last week | Δ | Trend. Delta cells colored: red if ≤ -5, green if ≥ +5, neutral otherwise. Compact, full-width. |
| 5 — Competitor delta + Content shipped | Top half: competitor table — Name | This week mentions | Last week | Δ | direction. Bottom half: content shipped grouped by platform with counts. If `draft_attribution` is non-empty, a small section "Impact of posted content" listing top 3 wins. |
| 6 — Gaps + Next week | "Where we're losing": top 3 gap prompts with platforms_lacking. "Plan for next week": next-week recs from markdown (typically 2–3 bullets). |

### Style

- Font: Inter (system fallback `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica`). No webfont fetch — keeps render deterministic.
- Page background: `#fafafa`. Cards inside pages: pure white `#ffffff` with subtle `1px solid #ececec` borders, 8px radius.
- Accent color: pull from existing CSS tokens — `#22d3ee` (cyan-400) matches the dashboard. Used sparingly: heading underlines, bar fills, up-arrows. Down-arrows use `#fb7185` (rose-400). Neutral arrows / flat use `#94a3b8` (slate-400).
- Headings: lowercase tracking-wide for "small caps" effect (e.g., `weekly visibility report` in 11px, letter-spacing 2px, text-transform uppercase).
- Big numbers: serif (`Georgia, "Times New Roman"` fallback) at 80–96pt for the executive headline.
- Footer (pages 2–6 only): 9pt text, `#94a3b8`, three columns: "Lumidian" wordmark left, client name center, page # right.

## Frontend

### New API helper

In `frontend/lib/api.ts`:

```typescript
export async function agencyDownloadDocumentPdf(documentId: number): Promise<Blob> {
  const res = await api.get(`/agency/documents/${documentId}/pdf`, { responseType: 'blob' });
  return res.data as Blob;
}
```

### "Download PDF" button on weekly reports

In `frontend/components/agency/DocumentList.tsx`, when rendering each document row, if `doc.kind === "agency_weekly_report"` show a small "Download PDF" button next to the existing actions. Clicking it:

1. Calls `agencyDownloadDocumentPdf(doc.id)`
2. Creates a blob URL via `URL.createObjectURL(blob)`
3. Triggers a download by clicking a hidden `<a>` with `download="report.pdf"`
4. Revokes the blob URL

Show a small spinner during the ~3–5s render.

## Testing

- Backend: `render_pdf(...)` with a complete `data_snapshot` returns bytes that start with `b"%PDF-"` (PDF magic bytes).
- Backend: endpoint returns 200 + `application/pdf` for an `agency_weekly_report` doc; 400 for a different `kind`; 404 for unknown id; 403 (via `require_agency_staff`) for non-staff.
- Backend: section parser returns expected keys when given a well-formed markdown body; returns empty dict for empty body without raising.
- Backend: end-to-end test that posts a stubbed `agency_weekly_report` document and downloads its PDF — verifies bytes are non-empty and start with `%PDF-`.

We do NOT verify the visual layout in tests (that's done manually by opening the PDF). Snapshot tests on rendered HTML are noisy; skip them.

## Risks

- **Playwright cold-start latency** — first request after process boot can take 8–10s while Chromium spins up. Acceptable for v1; we can warm the browser at app startup later if it becomes annoying.
- **Memory** — Chromium uses ~200MB per render. Single concurrent renderer is fine; if we ever batch-generate for many clients we'll need a pool.
- **CSS bugs** — print rendering can surprise. Manual smoke required before declaring done.
- **Markdown parsing fragility** — relies on the LLM following the heading template. The system prompt is explicit; we parse defensively and never crash on missing headings. If the LLM drifts, sections silently empty out rather than the whole render failing.
- **Logo path** — reading `frontend/public/logo.png` from the backend assumes the working directory at startup. Resolve relative to `backend/` parent. Fallback to a text wordmark if the file is missing.

## Out of scope (becomes future polish)

- Email-with-attachment auto-send
- Async/queue-based generation for batch use
- Per-client branding / co-brand
- PDF export for other document kinds (monthly_report, sow, etc.)
- Print preview UI inside the cockpit
- Editing the PDF or regenerating from a UI control
