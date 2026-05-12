# Agency Document Engine — Design

**Date:** 2026-05-12
**Status:** Approved (autonomous mode). Sub-project C of the agency-portal-OS roadmap.

---

## Context

After sub-project A (activity log) and B (tasks), the agency has a workflow. Sub-project C delivers the deliverable: **one-click generation of the documents an agency actually sends or signs.** Ken specifically called this out in the original ask: "auto create every kind of document I might need on click. like initial audit, initial SOW, etc."

This sub-project ships the **engine** (template registry + data fetcher + LLM-fill + storage) plus **four starter templates**. Adding more templates later is a Python-only change — no schema or UI work needed.

## Goals

1. Four working one-click document generators: **Initial Audit**, **SOW** (statement of work), **Monthly Report**, **Kickoff Checklist**.
2. `ClientDocument` table storing generated artifacts (markdown body).
3. A template registry (Python module) — each template declares its kind, name, data-fetcher function, and LLM system prompt.
4. Generation flow: pick template → backend fetches data → calls Claude → returns markdown → user reviews / edits / saves.
5. Reports tab on client detail lists generated docs + a "Generate" picker.
6. Global Documents tab lists all documents across clients, filterable by client + kind.
7. Activity log integration: emit `document_generated` event.

## Non-Goals (v1)

- PDF export (markdown only; copy/paste into Google Doc / Notion is the workflow).
- Template editor UI (templates are code; editing them requires a deploy).
- Versioning / diff between regenerations (each generation is a new row).
- Multi-step "fill in placeholders" — whole-body LLM generation per template.
- Per-template scheduling (e.g., auto-generate monthly report on the 1st).
- Customer-facing document delivery (Ken copies the markdown out and uses elsewhere).

## Data Model

### New table: `client_documents`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `agency_client_id` | int FK → `agency_clients(id)` ON DELETE CASCADE | indexed |
| `kind` | varchar(64) not null | matches a registered template slug — `audit_initial`, `sow`, `monthly_report`, `kickoff_checklist` |
| `title` | varchar(255) not null | e.g. "Initial audit — Acme Co — May 2026" |
| `body_markdown` | text not null | the generated content |
| `generated_by_user_id` | int FK → users(id) ON DELETE SET NULL, nullable | who clicked "Generate" |
| `generated_at` | datetime indexed | |
| `updated_at` | datetime nullable | bumped on body edits |

Index: `idx_client_documents_client_kind` on `(agency_client_id, kind, generated_at DESC)` — primary read path.

## Backend Architecture

### Template registry (`services/document_engine/templates.py`)

A module-level dict of templates. Each template is a `Template` dataclass:

```python
@dataclass(frozen=True)
class Template:
    kind: str  # e.g. "audit_initial"
    name: str  # human label, e.g. "Initial audit"
    description: str  # one-line description for the picker
    title_factory: Callable[[AgencyClient], str]  # generates the document title at generation time
    fetch_data: Callable[[AsyncSession, AgencyClient], Awaitable[dict]]  # returns context dict
    system_prompt: str  # baseline LLM instructions
    user_prompt_template: str  # python-format string with `{data_json}` slot
    max_tokens: int  # output cap
```

Templates self-register via:
```python
TEMPLATES: dict[str, Template] = {}

def register(t: Template) -> Template:
    TEMPLATES[t.kind] = t
    return t
```

### Four templates (each in its own module under `services/document_engine/`)

- `audit_initial.py` — `fetch_data` pulls brand profile, latest tracking run scores, top 10 prompts by gap score, competitor list. System prompt: "Write a 1-page initial audit for this B2B SaaS client. Cover current visibility, gaps, opportunities, recommendations."
- `sow.py` — `fetch_data` pulls client name, retainer, primary contact, brand profile (positioning). System prompt: "Write a contract-style SOW (Statement of Work) with sections: Engagement Summary, Scope of Services, Deliverables, Term, Payment Terms, Termination, Signatures."
- `monthly_report.py` — `fetch_data` pulls this-month vs last-month tracking, drafts shipped this month (count by platform), recent activity timeline. System prompt: "Write a 1-page monthly client report covering: visibility change, content shipped, attribution insights, recommendations for next month."
- `kickoff_checklist.py` — `fetch_data` pulls brand profile completeness flags, prompt count, contacts presence. System prompt: "Write an onboarding kickoff checklist as a markdown checkbox list. Indicate which items are complete and which the client still owes."

### Generation service (`services/document_engine/generator.py`)

```python
async def generate_document(
    db: AsyncSession,
    *,
    client: AgencyClient,
    template: Template,
    actor_user_id: int | None,
) -> ClientDocument:
    """Fetch data, call LLM, persist + emit activity event, return the new row."""
    data = await template.fetch_data(db, client)
    user_prompt = template.user_prompt_template.format(data_json=json.dumps(data, default=str, indent=2))
    full_prompt = f"{template.system_prompt}\n\n{user_prompt}"
    body_markdown = await call_claude(full_prompt, max_tokens=template.max_tokens, model="claude-sonnet-4-6")

    doc = ClientDocument(
        agency_client_id=client.id,
        kind=template.kind,
        title=template.title_factory(client),
        body_markdown=body_markdown,
        generated_by_user_id=actor_user_id,
    )
    db.add(doc)
    await emit_event(
        db,
        agency_client_id=client.id,
        event_type=EVENT_DOCUMENT_GENERATED,
        body=f"Generated {template.name}",
        actor_user_id=actor_user_id,
        payload={"document_id": None, "kind": template.kind},  # id filled after flush
    )
    await db.commit()
    await db.refresh(doc)
    return doc
```

A new event constant in `services/agency_activity.py`: `EVENT_DOCUMENT_GENERATED = "document_generated"`.

## Backend API

All under `/api/agency`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/document-templates` | List available templates (kind, name, description) |
| GET | `/clients/{client_id}/documents?kind=` | List documents for a client, optionally filtered by kind |
| GET | `/documents/{document_id}` | Get one document (full body) |
| POST | `/clients/{client_id}/documents` | Generate. Body: `{kind: str}`. Returns the new document. **Slow** (~10-30s LLM call). |
| PATCH | `/documents/{document_id}` | Edit body_markdown. Body: `{body_markdown: str}` |
| DELETE | `/documents/{document_id}` | Hard delete |
| GET | `/documents/recent?limit=20` | Cross-client list (for global Documents tab). Joins client name. |

All require `require_agency_staff`.

### Pydantic schemas

- `DocumentTemplateOut` — `{kind: str, name: str, description: str}`
- `DocumentOut` — id, agency_client_id, kind, title, body_markdown, generated_by_user_id, generated_by_name, generated_at, updated_at
- `DocumentWithClientOut` — extends DocumentOut with `client_id, client_name`
- `DocumentGenerateIn` — `{kind: str}`
- `DocumentUpdateIn` — `{body_markdown: str = Field(min_length=1, max_length=200000)}`

## Frontend

### Components

- `frontend/components/agency/DocumentList.tsx` — per-client list. Props `{clientId, kind?}`. Shows title, kind badge, generated date, generator name; click → opens viewer.
- `frontend/components/agency/DocumentViewer.tsx` — modal/drawer showing full markdown + Edit / Copy / Delete affordances. Used by both per-client and global.
- `frontend/components/agency/GenerateDocumentButton.tsx` — dropdown of available templates. Click → POST to generate → on success, opens DocumentViewer with the new doc. Shows a loading state during the LLM call.

### Wiring

- **Reports tab** (`ClientReportsTab.tsx`): replace the placeholder with `<GenerateDocumentButton clientId={...} />` + `<DocumentList clientId={...} />`.
- **Global Documents stub** (`frontend/app/agency/documents/page.tsx`): replace stub with a real list using `GET /documents/recent` + filter dropdown by kind.
- **Activity-icons update**: add `document_generated: FileText` mapping.

### Generation UX

The POST is slow (~10-30s). UI:
1. User clicks "Generate" → picks template from dropdown.
2. Button shows spinner + "Generating…" label. Other generate clicks disabled.
3. On 201, the new document opens in DocumentViewer. User can review / edit / copy.
4. On error, show inline error message + leave the picker open.

## Markdown Rendering

Documents render as preformatted markdown (preserve whitespace and line breaks). No fancy renderer in v1 — the user copies the body to their target tool (Google Doc, email, etc.). If a Markdown renderer is available in the existing frontend, use it; otherwise plain `<pre>` is acceptable.

## Activity log integration

Each `generate_document` call emits a `document_generated` event with payload `{kind}`. The activity feed (sub-project A) automatically picks this up — no UI change needed in the feed component.

## Testing

Backend (`tests/test_agency_documents.py`):
- Mock `call_claude` to return a fixed markdown body (avoid real LLM calls)
- `GET /document-templates` returns 4 templates
- `POST /clients/{id}/documents` with `kind=audit_initial` → creates row, returns DocumentOut, emits `document_generated` event
- `POST` with invalid kind → 400
- `GET /clients/{id}/documents` lists; filter by kind works
- `PATCH /documents/{id}` updates body; sets updated_at
- `DELETE /documents/{id}` removes the row
- `GET /documents/recent` returns cross-client list with client_name

Frontend: smoke via UI (Playwright if available, else manual).

## Risks / Edge Cases

- **LLM rate limits / errors** — `call_claude` already wraps Anthropic. On 429, return 503 to the client. UI shows "LLM busy, try again."
- **Empty data sources** — e.g., monthly report on a brand-new client with no tracking runs. fetch_data must handle empty gracefully; the system prompt should tell the LLM to acknowledge the empty data rather than hallucinate. Each template's `fetch_data` includes a `has_data: bool` flag in the payload.
- **Very long bodies** — `max_tokens` per template caps. SOW ~4000, audit ~3000, monthly_report ~3000, kickoff_checklist ~1500.
- **Concurrent generations** — fine; each is independent. No locking needed.

## Out of Scope (future iterations)

- PDF export
- Template editor in admin UI
- Version diffs between regenerations
- Auto-scheduled monthly reports
- Templates that need user input mid-flow (e.g., "what's the deal size?" for SOW) — v1 inferred from existing data only
- Multi-step generations (placeholder fills)
- Document signing / approval flow
