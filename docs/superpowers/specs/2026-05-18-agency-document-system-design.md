# Agency Document System — Design Spec

**Date:** 2026-05-18
**Status:** Design approved by Ken; awaiting implementation plan
**Scope:** Polish the agency document engine end-to-end — a coherent "Lumidian document system" that covers all 5 PDF templates plus the client review page.

---

## Why

Two real problems sit on top of the agency cockpit:

1. **4 of 5 document templates have no PDF design.** Only `agency_weekly_report` has a polished Jinja2 + Playwright treatment; the other four (`sow`, `audit_initial`, `kickoff_checklist`, `monthly_report`) render as raw markdown inside a `<pre>` block in `DocumentViewer`. The PDF endpoint actively rejects them with `HTTP 400 — "PDF export is only available for weekly reports"`. Agency clients receive professional weekly reports and amateurish everything else.
2. **The client review link is broken.** The backend at `backend/app/routers/agency.py:321` generates URLs like `{base}/review/{token}`, the `/api/public/review/*` endpoints exist and work, the frontend API client in `frontend/lib/api.ts:1167` is wired up — but **there is no Next.js route at `frontend/app/review/[token]/`**. Every review link Lumidian has sent or will send goes to a 404. The entire client-side approval flow is dead in the water.

This spec fixes both as a single design effort so the deliverables and the review surface share one visual language.

---

## What we are building

A **Lumidian document system** with three coordinated surfaces:

1. A **shared design system** (tokens, typography, motifs) used by every PDF template and the review page.
2. **Five PDF templates** spanning three personalities — Contract, Briefing, Report — each fit-for-purpose.
3. A **client review page** at `/review/[token]` that serves as both the approval queue and the client's permanent document library.

All three surfaces visibly belong to the same brand, share the same fonts and colors, and use the same logo lockup.

---

## Design system foundations

### Color tokens

```css
/* Paper & ink */
--paper:        #FAF7F2;   /* cream — every doc background */
--paper-elev:   #FFFFFF;   /* cards, document body on review page */
--ink:          #0B1220;   /* primary type, hero numbers */
--ink-soft:     #334155;   /* body */
--ink-mute:     #6B7280;   /* meta, captions */
--ink-faint:    #9AA4B2;   /* dates, footers */
--rule:         #E6E1D8;   /* warm hairlines, never solid black borders */

/* Brand */
--lumidian:        #2447EE;   /* logo blue */
--lumidian-tint:   rgba(36,71,238,0.08);  /* hover, soft bars */

/* Semantic — used sparingly */
--up:    #047857;
--down:  #B91C1C;
--flat:  #9AA4B2;
```

The cyan `#22d3ee` currently used for bars in the existing weekly report is dropped from the system.

### Typography

All three faces are free Google Fonts, embedded as base64 in PDF CSS so renders are network-independent.

| Role | Face | Weights | Use |
|---|---|---|---|
| Display | Instrument Serif | 400, 400-italic | Cover heroes, hero numbers, large section openers |
| Body | Inter | 400, 500, 600 | All body text, table headers, buttons |
| Numbers | IBM Plex Mono | 400, 500 | Tabular numbers, scores, dates, monetary values |

### Grid + rhythm

- Page: US Letter (8.5in × 11in), 0.75in margin
- Baseline: 6pt grid — vertical rhythm of body = 12pt
- Max measure: 5.5in for body text on Letter pages
- Hairlines: 0.5pt at `--rule`, never above 1pt
- Cards: white (`--paper-elev`) on cream paper, 1px hairline border, no shadows (depth from contrast, not shadow)

### Recurring motifs

1. **Tracker eyebrow** — 9pt Inter 600, 2pt letter-spacing, uppercase, `--ink-mute`. Sits above every section title and cover headline.
2. **Logo lockup** — the eye logo at 28px height + `Lumidian` wordmark in Instrument Serif 14pt to its right. Single source of brand identity across every surface.

---

## The three personalities

### Contract personality — `sow`

**No cover page.** Opens directly into the document.

- **Letterhead** (page 1, top): logo lockup left; Instrument Serif italic 14pt `Statement of Work` right; hairline beneath.
- **Document meta row** under the rule, in mono: `SOW-{id}` · `Effective {date}` · `Lumidian × {client}`.
- **Body**: numbered sections `1. — 7.`, Inter 11pt, line-height 1.55. Section titles in Instrument Serif 16pt with tracker eyebrow above each.
- **Money + dates** always in IBM Plex Mono.
- **Signature block** at the bottom of the final page: two columns (Agency / Client), hairline underline for signature + date, names in mono below.
- **Footer**: `Confidential` left · `Lumidian × {client}` center · page number right. 8pt `--ink-faint`.

### Briefing personality — `kickoff_checklist`, `audit_initial`

**Soft cover** — half-page hero on the same page as the body, not a separate page.

- Top half: logo lockup, tracker eyebrow (`INITIAL AUDIT` / `KICKOFF CHECKLIST`), client name in Instrument Serif 48pt, period/date in mono below. Hairline rule divides hero from body.
- Body starts immediately. Total document length: 1–2 pages.

**Kickoff checklist specifics:**
- Replace markdown `- [x]` / `- [ ]` with rendered circle glyphs:
  - `●` in `--lumidian` for completed
  - `○` in `--ink-faint` for missing
- "What we have" and "What the client still owes" sit in two side-by-side columns when total item count ≤ 12; otherwise stack.

**Audit specifics:**
- "Current State" gets an inset card: latest visibility score in Instrument Serif 40pt + delta + sample size in mono.
- "Gaps" and "Recommendations" side-by-side on page 2 (or below the fold of page 1 if they fit).
- "Open Questions for the Client" closes the doc, each question prefixed by a Lumidian-blue `?` glyph.

### Report personality — `monthly_report`, `weekly_report`

**Full cover page.**

- Logo lockup top-left, restrained, no decorative graphics
- Centered hero, vertically anchored:
  - Tracker eyebrow (`WEEKLY VISIBILITY REPORT` / `MONTHLY REPORT`)
  - Client name in Instrument Serif **64pt**
  - Period label below in Instrument Serif italic 18pt, `--ink-soft`
- Meta row at bottom: `Prepared by Lumidian` left · date right · hairline rule above

**Page 2 — the headline number:**
- Tracker eyebrow `EXECUTIVE SUMMARY`
- Hero score in Instrument Serif **120pt** (existing weekly is 96pt — promote)
- Delta below in `--up`/`--down`/`--flat` with arrow glyph; "vs last week" in mono
- 5.5in narrow summary paragraph in Inter 12pt

**Data pages** (visibility breakdown, prompt scorecard, competitor table, gaps):
- Cards on `--paper-elev` with hairline border on cream
- Bars: `--lumidian` blue (not cyan) with `--lumidian-tint` track
- All numbers in IBM Plex Mono; deltas in `--up`/`--down`
- Tables: 9pt uppercase headers in `--ink-mute` with 1pt letter-spacing; rows in Inter 10pt with mono numerics

**Footer**: Lumidian wordmark left · client name center · page number right.

---

## Client review page

### Route + chrome

- New route at `frontend/app/review/[token]/page.tsx` (server component) + `ReviewPage.tsx` (client component)
- Added to `frontend/middleware.ts` public-paths list — bypasses the auth redirect
- Background: `--paper`. Max content width: 880px centered.
- Header: logo lockup top-left; "Secure review link" wordmark in mono 9pt `--ink-faint` top-right
- Sticky footer: hairline above, `Powered by Lumidian` + link to lumidian.com

### Hero

- Tracker eyebrow: `LUMIDIAN × {CLIENT NAME}`
- Headline in Instrument Serif 36pt (contextual):
  - Drafts pending, N == 1: `1 draft ready for your review.`
  - Drafts pending, N > 1: `{N} drafts ready for your review.`
  - No drafts, some docs: `Your Lumidian library.`
  - Both empty: `Nothing waiting for you right now.`
- One-line subtext in `--ink-soft`; hairline rule below

### Sections (continuous scroll, no tabs)

Continuous scroll reads more document-like than tabs and works better for the client's mental model ("this is my Lumidian page" rather than "this is an app").

**1. Drafts awaiting review** (omitted entirely if zero)

Each draft = a card on `--paper-elev` with hairline border, 24px padding:

- **Platform pill**: solid `--lumidian-tint` background, mono 9pt uppercase, blue dot `●`
- **Title**: Instrument Serif 22pt
- **Body**: Inter 11pt; first 4 lines visible, expander reveals the rest inline (no modal jump)
- **CTAs, right-aligned, three weights:**
  - `Approve` — solid `--lumidian`, white text, Inter 600, 36px tall
  - `Request changes` — outlined; opens inline textarea below the card with "What would you like changed?" + Submit
  - `Reject` — text-only `--ink-mute`; opens small confirm with "Reason (optional)" + Confirm

**Optimistic flow** (Emil-style motion):
- Approve clicked → button scales to 0.98 then springs back → card collapses with `layout` animation → replaced with quiet `✓ Approved {timestamp}` row in `--up`
- Request changes submit → card collapses → `⤴ Changes requested` row
- Reject confirm → card collapses → `✕ Rejected` row in `--down`
- All transitions ~220ms, easing `cubic-bezier(0.32, 0.72, 0, 1)`
- No page reload. On API error, card flashes red `--down` border for 600ms and surfaces the error inline.

**2. Document library** (omitted entirely if zero)

Single-column list (not a grid — preserves editorial feel). Each row:

- Tracker eyebrow: kind in uppercase (`WEEKLY REPORT`, `STATEMENT OF WORK`, `INITIAL AUDIT`, etc.)
- Title in Instrument Serif 20pt
- Generated date in mono (page count omitted — PDF page count is only knowable post-render; not worth the round-trip)
- Two right-aligned actions:
  - `Open` → slides in a 60%-viewport side panel from the right that renders the document HTML inline (using the same Jinja2 template the PDF uses — single source of truth)
  - `Download` → triggers PDF download

### Error / revoked-token state

Same chrome, body collapses to one block:

> This review link is no longer active. Please contact your Lumidian point of contact for a new link.

Wordmark below. No CTAs. No marketing.

### Empty states

- Both empty: `Nothing here yet. Lumidian will email you when there's something to review.`
- Zero drafts + some docs: drafts section omitted entirely (no awkward "0 drafts" header)
- Some drafts + zero docs: docs section omitted

---

## Backend architecture

### PDF rendering refactor

The existing `backend/app/services/document_engine/pdf_renderer.py` only handles `agency_weekly_report`. Generalize:

```
backend/app/services/document_engine/
  pdf_renderer.py             # public entry: render_pdf(db, document) — dispatches by document.kind
  templates/
    _base.html.j2             # shared <head>, fonts, CSS reset, layout primitives, footer macro
    _styles.css.j2            # all design tokens — imported by _base
    sow.html.j2               # contract personality
    kickoff_checklist.html.j2 # briefing personality
    audit_initial.html.j2     # briefing personality
    monthly_report.html.j2    # report personality
    weekly_report.html.j2     # report personality (refactored to extend _base)
  markdown_sections.py        # generalized section parser
```

**Dispatch:** `render_pdf` looks up the template file based on `document.kind` and renders. The current per-kind 400 in `routers/agency.py:853` is dropped.

**Markdown section parser** — currently has the hardcoded `_SECTION_MAP` in `pdf_renderer.py:24`. Move to a per-template declaration: each template module exports its own `SECTION_MAP`, parser reads it dynamically.

### Font embedding

Embed Instrument Serif, Inter, and IBM Plex Mono as base64 inside `_styles.css.j2` via a small build script (`backend/scripts/embed_fonts.py`) run once at setup time. The script downloads the font files from Google Fonts, base64-encodes, writes `_styles.css.j2` with `@font-face` blocks. This makes PDF renders network-independent (critical for CI + cold-start Playwright).

Cost: ~300KB added to each PDF. Acceptable for the guarantee that PDFs render identically everywhere.

### Endpoint changes

Existing endpoint (`routers/agency.py:838`):
- `GET /api/agency/documents/{document_id}/pdf` — drop the per-kind whitelist; allow all kinds via dispatch.

New public endpoints (added to `routers/review_public.py`):
- `GET  /api/public/review/{token}/documents` → list `ClientDocument` for this client (id, kind, title, generated_at, pdf_available)
- `GET  /api/public/review/{token}/document/{id}` → return rendered HTML (for in-browser viewer)
- `GET  /api/public/review/{token}/document/{id}/pdf` → return PDF bytes

All three go through `_resolve_client_id(token)` then filter `ClientDocument` by `agency_client_id`. No new tables.

---

## Frontend architecture

```
frontend/app/review/[token]/
  page.tsx              # server component, fetches initial drafts + docs in parallel
  ReviewPage.tsx        # client component, holds optimistic state
  DraftCard.tsx         # approval card with three CTAs + inline expander
  DocumentCard.tsx      # library row
  DocumentReader.tsx    # 60% side panel that renders HTML inline
  EmptyState.tsx
  RevokedState.tsx
  styles.module.css     # paper/ink palette, fonts loaded via next/font

frontend/lib/api.ts     # +publicListDocuments, +publicGetDocumentHtml, +publicDownloadDocumentPdf
frontend/middleware.ts  # add `/review/*` to public-paths
```

Fonts loaded via `next/font/google` for the three families — same faces as the PDFs, identical rendering surface.

### Cockpit `DocumentViewer` (out of scope)

`frontend/components/agency/DocumentViewer.tsx` is the staff-side editor in the cockpit. It stays as-is — the design polish is for client-facing surfaces, not for the staff editing experience. We are not touching it in this work.

---

## Existing weekly report refactor

Three backward-compatible changes for visual consistency:

1. **Color swap**: `#22d3ee` → `#2447EE` (Lumidian blue); `#0f172a` → `var(--ink)`; `#fafafa` → `var(--paper)`
2. **Hero number**: 96pt → 120pt; promote tracker eyebrow above
3. **Extend `_base.html.j2`**: drop ~150 lines of duplicated CSS, inherit shared tokens

Same data shape, same `_SECTION_MAP`, same output structure — purely visual unification.

---

## Tests

For each new PDF template (`sow`, `audit_initial`, `kickoff_checklist`, `monthly_report`):
- Unit: `render_pdf(db, ClientDocument(kind=X))` returns non-empty bytes
- Smoke: rendered HTML contains client name and the key section markers; PDF parses cleanly

For the public review endpoints:
- `GET /documents` filters by token's client correctly
- `GET /document/{id}` rejects docs from another client (404)
- `GET /document/{id}/pdf` returns valid PDF bytes for every kind
- All three return 404 on revoked token

No frontend tests — repo has no frontend test infrastructure per `CLAUDE.md`.

---

## What we are NOT doing (scope guardrails)

- **No doc thumbnails** on the library — premature, just adds complexity for a small N
- **No search/filter** on the review page — sub-10 docs, scroll handles it
- **No doc editing** on the review page — that's the staff cockpit's job
- **No new email delivery** — the existing `agency_weekly_report` email path is unchanged, separate scope
- **No changes to cockpit `DocumentViewer`** — staff editor stays the same
- **No new database tables or columns** — `ClientDocument`, `ClientReviewLink`, and `ContentDraft` already hold everything we need

---

## Open follow-ups (not in this scope but worth flagging)

- The existing `POST /api/agency/clients` bug noted in `CURRENT_STATE.md` ("returns a different `brand_id` than passed") is unrelated; leave for a separate fix.
- Email delivery of the review link to the client primary contact is not in this scope but would be a natural sub-project H+ — the review page becomes the destination, the email becomes the carrier.
