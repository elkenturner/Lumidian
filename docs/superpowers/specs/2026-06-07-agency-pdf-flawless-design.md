# Agency PDF Engine — Flawless Design

**Status:** Spec, awaiting review
**Author:** Claude Code (with Ken)
**Date:** 2026-06-07
**Branch (target):** new branch off `feat/aio-content-strategy-layer-a` or `main`

---

## Goal

When an agency-staff user clicks **"Generate doc"** in the cockpit, a flawlessly typeset, brand-consistent PDF is produced and downloaded in one step. The PDF is good enough to send to a client (or use internally) without manual edits. Coverage spans all seven document kinds: `kickoff_checklist`, `sow`, `audit_initial`, `agency_weekly_report`, `monthly_report`, `wikipedia_plan`, `site_plan`.

The current system produces markdown-in-a-modal that the user must download separately, with five rendered kinds (two missing), brittle page-break behavior, and no preflight against missing brand data. Two kinds (`wikipedia_plan`, `site_plan`) currently throw `ValueError("No PDF template registered…")` when their Generate-doc buttons are clicked.

This spec replaces the rendering engine (Playwright → Typst), restructures the flow (modal → download), tightens the data path (preflight + section omission), and rewrites the seven document templates in Typst with a shared design system.

## Why Typst

The current Playwright + Jinja2 + HTML/CSS stack is a strong "designed HTML" approach. To reach genuine *typesetting* quality — paragraph balancing, no orphan/widow lines, real hyphenation, ligature handling, beautiful tables, deterministic layout — the engine itself must change. Typst is the modern, programmatic, open-source successor to LaTeX. It ships:

- Best-in-class typography (Knuth-Plass paragraph breaking, proper microtypography)
- A native pagination model (no CSS Paged Media polyfill needed)
- 1350+ professionally typeset templates in Typst Universe to reference and fork
- A Rust-based, fast, deterministic compiler
- A clean DSL (more ergonomic than LaTeX, more declarative than HTML)

Trade-offs accepted:
- All seven templates must be rewritten in Typst syntax (~2-3 days of work, factored into the plan)
- The `typst` CLI must be added to the backend deployment image
- Charts move from Playwright-rendered DOM to either Typst's native `cetz` plotting package or pre-rendered SVG embeds (matplotlib)

WeasyPrint was the runner-up. Its quality ceiling is lower (HTML/CSS-bound) and the win wasn't worth the half-day saved.

## Scope

In scope:
1. New `pdf_renderer.py` that shells out to `typst compile`
2. Seven Typst templates with a shared design system (tokens, cover, header/footer, type scale)
3. Two new templates for the currently-missing kinds (`wikipedia_plan`, `site_plan`)
4. Embedded charts via Typst's `cetz` (for visibility-over-time, model-mix, scorecard heatmap, competitor compare)
5. Cockpit flow change: `Generate doc` → POST → returns PDF blob → browser downloads. Kill the markdown modal from the generate path.
6. Preflight data gate: each template declares `REQUIRED_FIELDS`; missing → 400 + inline frontend remediation message
7. Prompt audit + tune for each of seven templates, against real brand data (Spotitearly export available locally)
8. Section rendering robustness: tighten `markdown_sections.py` matcher; warn on unmapped sections
9. Per-kind visual review pass

Out of scope:
- Replacing the in-app `DocumentViewer` modal (it survives only as a "view/edit a past doc" tool, reachable from the Brand-tab Documents history; not opened from the generate path)
- The prospect-audit lane (`spotitearly_pilot_export/`, prospect-audit worktree) — that has its own data path and renders separately
- Markdown → PDF rendering for the SaaS report PDFs (`backend/app/services/reports/`) — different surface, different audience

## Architecture

### Data flow

```
User clicks "Generate doc" (kind=X, client_id=C)
        │
        ▼
POST /api/agency/clients/C/documents/X/render
        │
        ▼
Backend: generate_pdf(client, template):
  1. Load brand data (template.fetch_data)
  2. Preflight: check REQUIRED_FIELDS → raise MissingDataError(missing=[...]) if any unset
  3. LLM call: emit STRUCTURED JSON per template's schema (no longer free-form markdown)
  4. Render charts: matplotlib/cetz → SVG bytes
  5. Compose Typst input: { data: ..., sections: ..., charts: ... } → JSON file
  6. Run typst CLI: `typst compile main.typ output.pdf --input data=data.json`
  7. Read output.pdf bytes
  8. Persist ClientDocument (kind, title, structured_data_snapshot, pdf_bytes_path)
  9. Return PDF as binary response (Content-Disposition: attachment)
        │
        ▼
Browser downloads the PDF; toast confirms
```

### Module structure (new)

```
backend/app/services/document_engine/
  __init__.py
  registry.py                      # Template registry (kept)
  generator.py                     # Orchestrator (rewritten)
  preflight.py                     # NEW: validate REQUIRED_FIELDS
  typst_renderer.py                # NEW: shell-out to typst CLI
  charts/                          # NEW: chart functions returning SVG bytes
    visibility_over_time.py
    model_mix.py
    prompt_scorecard.py
    competitor_compare.py
  templates/                       # REWRITTEN as Typst sources
    _tokens.typ                    # color, type, spacing tokens
    _cover.typ                     # shared cover-page function
    _header_footer.typ             # running header/footer
    _components.typ                # callout, signature_block, score_card, table styles
    kickoff_checklist.typ
    sow.typ
    audit_initial.typ
    weekly_report.typ
    monthly_report.typ
    wikipedia_plan.typ
    site_plan.typ
  audit_initial.py                 # KEEP (data fetch + REQUIRED_FIELDS + JSON schema)
  sow.py                           # KEEP
  ...etc per kind
```

The per-kind Python modules (`audit_initial.py`, `sow.py`, …) lose `SECTION_MAP` (no longer needed — output is JSON) and gain:

- `REQUIRED_FIELDS: list[str]` — dotted-path field names checked at preflight
- `OUTPUT_SCHEMA: dict` — JSON schema the LLM is asked to return
- `system_prompt: str` — tuned per the prompt audit
- `typst_template: str` — the matching `.typ` filename
- `chart_calls: list[Callable]` — which charts to render for this kind

### Design system (`_tokens.typ`)

```typst
#let lumidian = (
  // colors
  ink:            rgb("#0B1220"),
  paper:          rgb("#FAF7F2"),
  primary:        rgb("#2447EE"),      // Lumidian blue
  muted:          rgb("#546880"),
  border:         rgb("#E5E0D7"),
  delta_up:       rgb("#10A37F"),
  delta_down:     rgb("#DC2626"),

  // type
  display_font:   "Instrument Serif",
  body_font:      "Inter",
  mono_font:      "IBM Plex Mono",

  // type scale (pt)
  size_display:   48pt,
  size_h1:        32pt,
  size_h2:        20pt,
  size_h3:        14pt,
  size_body:      11pt,
  size_caption:   9pt,
  size_mono_xl:   120pt,   // hero scores

  // spacing
  space_section:  28pt,
  space_block:    16pt,
  space_card:     14pt,
  space_line:     8pt,

  // page
  page_size:      "us-letter",
  page_margin:    (top: 0.9in, right: 0.85in, bottom: 1.0in, left: 0.85in),
)
```

Every template imports `_tokens.typ` and uses these symbols. There is no per-template ad-hoc spacing or color.

### Per-kind personality

Three distinct visual identities, sharing the token base:

- **Briefing** (kickoff_checklist, audit_initial, wikipedia_plan, site_plan) — left-aligned, soft cover, headline questions, two-column flows where appropriate
- **Report** (weekly_report, monthly_report) — score-driven hero, centered cover, charts as the centerpiece, bar/grid tables, big numerics
- **Contract** (sow) — letterhead cover, monospace metadata, formal section numbering, signature blocks

The personality differences live in `_cover.typ` (each kind passes a different `style` argument) and in the per-template `.typ` file. The tokens are shared.

### LLM output: structured JSON, not markdown

Currently the LLM writes `## Heading\n...prose...` blobs and a parser splits on H2 against a `SECTION_MAP`. This is brittle: heading drift, missing sections, unwanted "Not yet captured" filler.

New approach: each template declares an `OUTPUT_SCHEMA` (Pydantic model). The LLM is asked to emit JSON matching the schema. The template renders only the fields present (no placeholders). Example:

```python
# audit_initial.py
class AuditInitialOutput(BaseModel):
    current_state: str
    working: list[str] = Field(default_factory=list)        # bullets
    gaps: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
```

Typst template:

```typst
#if data.working.len() > 0 [
  == What's working
  #for item in data.working [- #item]
]
```

Empty sections are *omitted*, not filled with placeholders.

### Charts

Four chart functions, each returning SVG bytes:

- `visibility_over_time(brand_id, days=30)` — line chart, Lumidian blue, paper bg
- `model_mix(run_id)` — donut, model-color tokens
- `prompt_scorecard(brand_id)` — heatmap, prompts × models, score-colored cells
- `competitor_compare(brand_id)` — grouped bar, brand vs competitors

Implementation: matplotlib with a custom `lumidian.mplstyle` enforcing fonts/colors/sizes. Output SVG bytes embedded in Typst via `image.decode(<bytes>)`. (See Open Question #3 — `cetz` is the Typst-native alternative if we want to keep all template logic inside the `.typ` file.)

### Preflight

`preflight.py:check_required(template, data) -> list[str] | None`:

- Each template's `REQUIRED_FIELDS` is a list of dotted paths (`brand.name`, `brand_profile.tone_of_voice`)
- If any path resolves to None/empty, return the list of missing paths
- Generator raises `MissingDataError(missing=[...])` before the LLM call

Router catches `MissingDataError` → 400 with `{ "detail": "Missing brand data", "missing_fields": ["brand_profile.tone_of_voice", ...] }`.

Frontend renders:

> Add these to the brand profile before generating:
> • Tone of voice
> • Target audience
> [Open Brand Profile →]

### Cockpit flow change

Today: button → POST returns JSON → modal opens with markdown → user clicks Download.

New: button → POST returns `application/pdf` binary → browser downloads via `Content-Disposition: attachment` → toast appears in cockpit.

Implementation:
- New endpoint `POST /api/agency/clients/{id}/documents/{kind}/render` returns `Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="..."'})`
- Old endpoint `POST /api/agency/clients/{id}/documents` (returns `DocumentOut`) **kept** for the future case of "regenerate the markdown source for editing." Not called from the generate-button path.
- Frontend `agencyGenerateDocument` is replaced for the cockpit-button path; it now triggers a download instead of returning a doc object.
- `DocumentViewer` modal is no longer opened by `PlaybookTab.generateDoc`. It survives for the Brand-tab Documents history use case.

### Section rendering robustness

`markdown_sections.py` is mostly obsoleted by the structured-JSON output. It survives as a fallback for legacy markdown documents already in the DB. Hardening:

- Matcher normalizes: lowercase + strip punctuation + collapse whitespace
- Unmapped H2 sections logged as warnings (not silently dropped)
- Unit tests on the matcher

### Prompt audit + tune

Per template, before that template's PR ships:

1. Generate against a real brand (Spotitearly local export) with the current prompt → save the JSON output
2. Read it. Critique against the rubric:
   - **Length:** Briefings ≤ 1 page, SOWs ≤ 2, reports ≤ 4
   - **Voice:** Senior consultant. Direct, declarative, no hedging.
   - **Filler:** Zero "Not yet captured", zero throat-clearing, zero adverb spam
   - **Concreteness:** Numbers where numbers exist; named entities where present
3. Tune system prompt and re-test
4. Lock when the output passes the rubric without manual edits

This is the slow, manual, only-Ken-can-judge step. It cannot be skipped without sacrificing the "edit-free" requirement.

## Testing

Backend:
- Unit tests on `preflight.check_required` (happy path + each missing-field case)
- Unit tests on chart functions (returns SVG bytes; doesn't blow up on empty data)
- Unit tests on each template's `OUTPUT_SCHEMA` (LLM-mocked input passes validation)
- Integration test on `generate_pdf` for each of the 7 kinds (mocked LLM, real Typst compile, asserts PDF is generated)
- Integration test on the new render endpoint (returns 200 + `application/pdf` on happy path; 400 + missing_fields on data gap; 503 if `ANTHROPIC_API_KEY` missing)

Frontend:
- Unit test: `PlaybookTab.generateDoc` triggers a download (not a modal) on success
- Unit test: missing_fields response renders the inline remediation card with a working deep link to brand profile

## Error handling

| Case | Backend response | Frontend UX |
|---|---|---|
| Missing `ANTHROPIC_API_KEY` | 503, `detail: "ANTHROPIC_API_KEY not configured"` | Rose banner with detail, link to Settings |
| Required brand fields missing | 400, `missing_fields: [...]` | Inline remediation card, deep link to brand profile |
| Typst compile error | 500, `detail` includes Typst stderr (sanitized) | Rose banner, "Document generation failed — engineering has been notified" + Sentry capture |
| LLM JSON parse error (LLM returned malformed JSON) | One retry with a stricter "respond with valid JSON only" instruction, then 500 | Same as above |
| Unknown kind | 400, `detail: "Unknown template kind"` | Rose banner |

## Deployment

- Add `typst` binary to backend Dockerfile (single-binary install, ~20MB)
- Add `matplotlib` to `requirements.txt` (if not already present)
- Add fonts: Instrument Serif, Inter, IBM Plex Mono. Either ship as files under `backend/app/services/document_engine/templates/fonts/` and point Typst at them via `--font-path`, or rely on system fonts in the Railway container. Decision in the plan.

## Migration & rollback

This is a clean swap — the old Playwright path is replaced. No flag gate; the cutover is the PR landing.

Rollback strategy: revert the PR. `ClientDocument` records persist either way (the table is unchanged; only the rendering layer is swapped). PDFs from the old path are still downloadable from history (we still have the markdown body and can re-render under the new path if needed).

## Risks

| Risk | Mitigation |
|---|---|
| Typst learning curve eats more time than estimated | Reserve a day for template-1 in the plan; if it overruns, descope to WeasyPrint without rewriting the rest of the design |
| LLM doesn't consistently emit valid JSON | Use Anthropic's strict-JSON mode + one retry with stricter prompt; fall back to markdown for legacy kinds if needed |
| Typst binary deployment issues on Railway | Verify on staging early. If blocked, swap to WeasyPrint engine without re-architecting the rest. |
| Chart aesthetics drift across kinds | Single `lumidian.mplstyle` + lint test that asserts chart functions use it |
| "Edit-free" is subjective and may never be achieved | Codify the rubric (length / voice / filler / concreteness) and use it as the locked-template gate. If we can't pass the rubric in 2 tunes per template, escalate. |

## Acceptance criteria

A document is "shippable" when, against real brand data, the generated PDF:

1. Opens at full quality with the Lumidian wordmark/logo, brand colors, correct typography
2. Has no orphaned headings, mid-card page breaks, or floating signature blocks
3. Contains zero "Not yet captured", "TODO", or template-leftover language
4. Reads as written by a senior consultant: direct, dense, concrete
5. Respects the per-kind length budget
6. Renders consistently across two consecutive runs with the same data
7. Downloads in one click from the cockpit
8. Refuses to generate (with a clear remediation message) when required brand data is missing

All seven kinds meet all eight criteria. Visual review per kind is the close-out gate.

## Effort

| Stream | Estimate |
|---|---|
| Typst infrastructure: renderer, design tokens, cover/header/footer | 1 day |
| Two new templates (wikipedia_plan, site_plan) + briefing personality | 0.5 day |
| Three existing templates rewritten (audit_initial, weekly_report, monthly_report) + report personality | 1 day |
| Two existing templates rewritten (sow, kickoff_checklist) + contract/briefing personality | 0.5 day |
| Chart module (4 functions, lumidian.mplstyle) | 0.5 day |
| Preflight + structured-JSON LLM output schemas | 0.5 day |
| Cockpit flow change (one-click → download) + frontend remediation card | 0.5 day |
| Prompt audit + tune per template | 1 day |
| Visual review + polish per kind | 0.5 day |
| Testing (unit + integration) | 0.5 day |

**Total: 6 focused days.** Up from the earlier 4-day estimate because of Typst migration effort. Phased so each template can ship independently if needed.

## Open questions (to resolve before plan)

1. **Where do generated PDFs live?** Today `ClientDocument.body_markdown` is the source-of-truth. Under the new path, PDFs are binary — store them on disk (e.g., `backend/data/agency-pdfs/{client_id}/{document_id}.pdf`), in object storage (S3-like), or regenerate on demand from the structured JSON snapshot?
2. **Fonts:** ship our own font files (control + size) or rely on system fonts in Railway (smaller image)?
3. **Charts:** matplotlib or cetz (Typst native)? Recommend matplotlib for breadth, but cetz keeps everything in one file per template.
4. **Editing path:** if a user *does* want to tweak a generated doc, do they edit the JSON output (re-render) or the PDF? Recommend re-render from edited JSON; the markdown-editor modal becomes a JSON editor for past docs.

## Next step

Plan writing via `superpowers:writing-plans`. Plan should phase the work so a partial ship (e.g., 2 of 7 templates rewritten) is still a net improvement over current state.
