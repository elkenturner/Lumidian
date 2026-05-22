# Agency Client Portal — Design

**Date:** 2026-05-22
**Surface:** new `/client/{token}` route in the main Next.js frontend; backend dependency + small `AgencyClient` migration.
**Goal:** Give agency clients a real-time, read-only view of their brand's data so they can see the work happening between weekly content cycles, without building a custom collaboration UI.

## Problem

Today, agency clients have one window into Lumidian: the existing tokenized `ClientReviewLink` page, which only shows drafts in `awaiting_client` status. They cannot see:

- Visibility scores, trends, or per-prompt breakdowns
- Raw LLM transcripts (the "we cite what we said" transparency play)
- Competitor positioning
- Site audit findings or recommendations
- Cluster strategy
- Wikipedia candidates
- Posted content history + attribution-back-to-visibility
- The weekly report (already generated as a `ClientDocument` row, but only staff sees it)

For a $2,500–$5,000/mo retainer this is a thin surface. Clients have no way to feel the work between deliverables, no transparency into the data the agency is acting on, and no place to look at strategy.

Separately, Ken has been thinking about closing a **content review loop** inside Lumidian (propose batch → client comments → revise → approve → post). After discussion, the conclusion was that the *review cycle itself* is best handled in Google Docs (mature collaboration tooling, native commenting, free, already in client muscle memory). Building threaded comments + revision tracking inside Lumidian would be rebuilding a solved problem.

This spec defines what Lumidian *does* surface — the data layer — and how clients enter it.

## Goal & Scope

**In scope:**

1. New `/client/{token}` portal route that renders read-only versions of the SaaS surfaces (dashboard / results / clusters / site-audit / wikipedia / reports / posted content), scoped to the brand attached to the token's `AgencyClient`.
2. Backend `is_client_view` flag propagated through the request, plus a `require_not_client_view` dependency on every write endpoint as a backstop.
3. Frontend `useClientView()` hook + audit pass to hide every action button across the SaaS UI when in client context.
4. Tiny `current_proposal_doc_url` / `current_proposal_label` fields on `AgencyClient` so staff can paste a weekly Google Doc link visible from the portal home.
5. Keep the existing `ClientReviewLink` model and "Copy review link" button — they become the portal entry, not just a draft-approval entry.

**Out of scope:**

- No `ClientUser` model. No password reset flows. No magic-link email login. The tokenized review-link remains the only auth mechanism for client access.
- No `ContentBatch` model. No `DraftComment` model. No threaded comments. No revision tracking. The review cycle happens in Google Docs.
- No Google Docs API integration. Staff manually creates the weekly doc, manually pastes drafts in, manually shares with the client. (This is "Path A" in the brainstorm — automation comes later if/when it hurts.)
- No exposure of in-progress drafts in the portal. Drafts in `draft` / `awaiting_client` / `changes_requested` status are not visible. The portal only shows what has been *posted* in the content history view.
- No `/settings`, `/team`, `/billing`, `/account`, `/admin` routes mounted in the portal shell.

## Design

### Workflow split (this is the conceptual model, not code)

| Job | Tool | Mechanism |
|---|---|---|
| Threaded comments, suggesting edits, accept/reject | Google Docs | Manual: staff creates doc, shares with client, both work in it |
| Visibility scores, transcripts, audit findings, attribution, strategy | Lumidian portal | This spec |
| Draft status, posting, attribution-back-to-tracking | Lumidian DB | Existing — unchanged |

The portal does not replace Google Docs and does not host the review loop. It is purely the data-transparency surface.

### Portal entry mechanism

Reuse the existing `ClientReviewLink` model:

- One active token per `AgencyClient` (already revocable / rotatable via the existing `POST /api/agency/clients/{id}/review-link` endpoint).
- Token format unchanged: `secrets.token_urlsafe(32)`.
- Link URL changes from `{PUBLIC_BASE_URL}/review/{token}` to `{PUBLIC_BASE_URL}/client/{token}`. The backend URL builder in `app/routers/agency.py:_link_to_out` updates to emit the new path. The old `/review/{token}` Next.js route is kept as a thin redirect to `/client/{token}` so any link Ken previously shared keeps working.
- The frontend `CopyReviewLinkButton` consumes the URL from the API response and is not coupled to the path — no frontend change needed. The button's *behavior* changes (it now copies a portal URL instead of a draft-approval URL) but its code does not.

No new auth surface. No `ClientUser`. No password reset emails. The token is the entire auth mechanism.

### Backend: `is_client_view` flag + write-endpoint backstop

A new dependency resolves a token to its `AgencyClient` + `Brand`:

```python
# app/dependencies.py

async def get_client_view_context(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> ClientViewContext:
    """Resolve a ClientReviewLink token to (agency_client, brand). 404 if invalid/revoked."""
    ...

class ClientViewContext:
    agency_client: AgencyClient
    brand: Brand
    is_client_view: bool = True
```

New read-side routes mount under `/api/client/{token}/...` and depend on `get_client_view_context` instead of `get_current_user`. These routes return the same payloads as their SaaS counterparts (brand stats, results, transcripts, audit findings, etc.) but scoped to the resolved brand.

A new `require_not_client_view` dependency is added as a backstop on every write endpoint (`POST` / `PATCH` / `DELETE` across all routers). It currently does nothing — no client-view request ever reaches a write endpoint by routing, because the `/api/client/{token}/...` namespace never exposes write routes. The dependency exists so a future refactor can't accidentally let a token-scoped request hit a write path.

This is the "hide and block" pattern: routes that perform writes are not mounted in the client namespace, *and* writes are guarded at the dependency layer.

### Backend: read endpoints exposed under `/api/client/{token}/...`

The portal needs read access to:

| Data | Existing SaaS endpoint | New client endpoint |
|---|---|---|
| Brand info | `GET /api/brands/{id}` | `GET /api/client/{token}/brand` |
| Visibility runs / scores / trends | `GET /api/results/{brand_id}/*`, `GET /api/dashboard/{brand_id}` | `GET /api/client/{token}/dashboard`, `GET /api/client/{token}/results/*` |
| Per-prompt + transcripts | `GET /api/results/{brand_id}/responses` | `GET /api/client/{token}/results/responses` |
| Competitors | `GET /api/brands/{id}/competitors`, `GET /api/dashboard/{brand_id}/competitor-analysis` | `GET /api/client/{token}/competitors`, `GET /api/client/{token}/competitor-analysis` |
| Site audit | `GET /api/site-audit/{brand_id}/...` | `GET /api/client/{token}/site-audit/...` |
| Clusters | `GET /api/clusters/{brand_id}/...` | `GET /api/client/{token}/clusters/...` |
| Wikipedia candidates | `GET /api/wikipedia/{brand_id}/candidates` | `GET /api/client/{token}/wikipedia/candidates` |
| Reports / weekly documents | `GET /api/agency/clients/{id}/documents` | `GET /api/client/{token}/documents`, `GET /api/client/{token}/documents/{doc_id}`, `GET /api/client/{token}/documents/{doc_id}/pdf` |
| Posted content history | derived from `ContentDraft.status='posted'` + `ContentAttribution` | `GET /api/client/{token}/content/posted` |
| Current proposal pointer | new fields on `AgencyClient` | `GET /api/client/{token}/proposal` |

Each endpoint resolves the token, fetches the same data its SaaS counterpart would, and returns it. No new business logic. The endpoints are *shape-compatible* with the SaaS endpoints so the frontend components can be reused with minimal branching.

### Frontend: `/client/{token}` shell

A new Next.js route group:

```
app/client/[token]/
  layout.tsx          # Shell + sidebar nav (no /settings, /team, /billing, /account, /admin links)
  page.tsx            # Home: scores + "this week's proposal" pointer card
  results/page.tsx    # Visibility runs, transcripts
  competitors/page.tsx
  site-audit/page.tsx
  clusters/page.tsx
  wikipedia/page.tsx
  reports/page.tsx
  content/page.tsx    # Posted content history only
```

The shell sets a `ClientViewContext` (React context) with `{ token, isClientView: true, brandId }`. All child pages read this context.

Sidebar nav inside the portal:

```
Lumidian (logo, links to /client/{token})
─────────
Dashboard
Visibility
Competitors
Site audit
Strategy        # Clusters tab
Wikipedia
Content posted
Reports
```

No "Settings," "Team," "Billing," "Account," "Admin," "Trigger Run," "New Brand" — those routes are not mounted in this shell at all.

### Frontend: `useClientView()` hook + action-button audit

Inside the `/client/{token}/...` shell, the shared SaaS components (DashboardCard, ResultsTable, ClusterCard, AuditFindingsList, etc.) are reused. They need to hide their action buttons.

A single hook:

```tsx
// frontend/lib/client-view.ts
export function useClientView(): boolean {
  return useContext(ClientViewContext)?.isClientView ?? false;
}
```

Every component currently rendering an action button gets wrapped:

```tsx
const isClientView = useClientView();
// ...
{!isClientView && <Button onClick={handleRegenerate}>Regenerate</Button>}
```

The audit pass touches these components (non-exhaustive — implementation plan will enumerate from a grep of action handlers):

- `RunTrackingButton` — hide entirely
- `GenerateDraftButton` / draft pipeline write actions — hide
- `RegenerateClusterButton`, `EditBriefButton`, `AcceptPillarButton`, `RejectPillarButton` — hide
- `ApproveDraftButton`, `MarkPostedButton`, `RequestChangesButton` — hide (in-progress drafts aren't shown anyway, but defense-in-depth)
- `TriggerAuditButton`, `DraftRecommendationButton`, `ApplyRecommendationButton` — hide
- `WikipediaScanButton`, `WikipediaDraftButton` — hide
- `AddCompetitorButton`, `EditPromptButton`, `DeletePromptButton`, `AddPromptButton` — hide
- `GenerateReportButton`, `RegenerateDocumentButton` — hide
- `BrandProfile` form (tone of voice, target audience, key stats, publications, etc.) — render the values as plain text instead of input fields when in client view. `internal_brand_context` field hidden entirely (it's named that way for a reason).

A handful of components have inline action triggers (kebab menus, hover-reveal buttons) — those need the same gating.

The PDF download button on documents stays visible: it's a read action, not a write.

### Tiny addition: "this week's proposal" pointer card

Two new nullable columns on `AgencyClient`:

```python
current_proposal_doc_url: Mapped[str | None] = mapped_column(String(500))
current_proposal_label: Mapped[str | None] = mapped_column(String(200))
```

A small UI affordance in the staff cockpit (Brand tab is the natural home) lets staff paste the URL + label after sending out the weekly Google Doc:

```
This week's proposal
  Label:  [Week of May 22 — 5 pieces                ]
  Doc URL: [https://docs.google.com/document/d/...   ]
                                              [Save]
```

The portal home page shows a card if both fields are set:

```
┌──────────────────────────────────────────────┐
│ This week's proposal                         │
│ Week of May 22 — 5 pieces                    │
│ [Open in Google Docs →]                      │
└──────────────────────────────────────────────┘
```

If both fields are null, the card doesn't render.

This is the *entire* tie between the Google Docs review cycle and the Lumidian portal. No automation, no sync, no API call to Google. Just a text field staff sets manually each week.

### What clients see on the home page

Layout sketch:

```
┌─────────────────────────────────────────────────────┐
│ {Brand name}                  · Last tracked: {date}│
├─────────────────────────────────────────────────────┤
│ Visibility score: {N}  · trend ↑/↓ vs last week     │
│ [Sparkline]                                         │
├─────────────────────────────────────────────────────┤
│ ┌─── This week's proposal ─────────────────────────┐│
│ │ {current_proposal_label}                         ││
│ │ [Open in Google Docs →]                          ││
│ └──────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│ Recent activity                                     │
│   • {date}  Posted: "{title}" → +X pp visibility    │
│   • {date}  Posted: "{title}" → +X pp visibility    │
│   ...                                               │
└─────────────────────────────────────────────────────┘
```

Recent activity reads from `ContentPost` rows (posted drafts) joined with `ContentAttribution` for the impact figure. No in-progress draft entries.

### Migration

One `ALTER TABLE` appended to `database.py:run_migrations()`:

```sql
ALTER TABLE agency_clients ADD COLUMN current_proposal_doc_url VARCHAR(500);
ALTER TABLE agency_clients ADD COLUMN current_proposal_label VARCHAR(200);
```

No destructive changes. No data backfill needed.

### Testing approach

- **Backend:** new test file `test_client_portal.py` covering: token resolves → brand data returned; revoked token → 404; expired token → 404; write endpoints called inside `/api/client/{token}/...` namespace → 405 (route not mounted); read endpoints filter to the client's brand only (multi-tenancy enforcement).
- **Frontend:** manual browser verification of: portal loads from a valid token; sidebar shows correct nav; action buttons absent across all surfaces; "Open in Google Docs" card appears when fields set, hidden when null; navigating to `/client/{token}/settings` (manually typed) returns 404.

## Implementation footprint

| Area | Files / changes |
|---|---|
| Backend models | `app/models.py` (+2 cols on `AgencyClient`) |
| Backend migrations | `app/database.py` (+2 ALTER TABLE) |
| Backend deps | `app/dependencies.py` (+`get_client_view_context`, +`require_not_client_view`) |
| Backend routes | new `app/routers/client_portal.py` (read-only mirror endpoints scoped to token) |
| Backend URL builder | `app/routers/agency.py:_link_to_out` (emit `/client/{token}` instead of `/review/{token}`) |
| Backend wiring | `app/main.py` (mount new router) |
| Backend tests | `tests/test_client_portal.py` |
| Frontend route | new `app/client/[token]/` directory with ~8 pages |
| Frontend hook | `frontend/lib/client-view.ts` |
| Frontend audit | gate ~20-30 action-button render sites across existing components |
| Frontend API | `frontend/lib/api.ts` (+`clientPortal` methods that hit `/api/client/{token}/...`) |
| Frontend cockpit | small "current proposal" form in `ClientCockpit.tsx` (or sub-component) |
| Aliasing | `app/review/[token]/page.tsx` redirects to `/client/[token]` |

Bulk of the work is the **frontend action-button audit** — mechanical but tedious. Component-by-component grep for `onClick` handlers that hit `lib/api.ts` write methods, wrap them in `!isClientView` checks.

## YAGNI: explicitly not building

- `ClientUser` model, password fields, password reset tokens, email magic-link login
- `ContentBatch` / `DraftComment` / threading / revision tracking
- Google Docs API integration (Path B from the brainstorm)
- Per-user identity inside a single client (one CMO seat vs. an intern seat)
- Real-time notifications to clients
- Client-side draft approval inside the portal (the existing review-link approval UI is a *separate concern* from the portal; we leave it alone for now)
- In-portal exposure of pipeline drafts (`draft`, `awaiting_client`, `changes_requested` statuses)

## Future paths (deferred until signal)

These are the natural follow-ups if/when this v1 hurts:

- **Path B — Google Docs integration.** "Send proposal" button creates a Google Doc with drafts pre-populated; "Pull approved" button fetches doc content back into `ContentDraft` rows. Real engineering work (OAuth, markdown↔Docs converter). Build when Path A's copy-paste becomes the bottleneck.
- **Email magic-link login.** Per-user identity, better revocation, survives leaked links. Build when clients ask for multi-seat access or when a token leak forces a rotation that breaks all bookmarks.
- **Portal commenting on the portal data itself.** Currently the portal is one-way. If clients want to leave notes on scores/audit findings, a lightweight `ClientNote` model could be added. Build when asked.
- **Push notifications / email digests.** "Your visibility ticked up this week" emails to clients. Easy lift on top of the existing Resend infra.

## Open questions

None blocking. One minor item to confirm during implementation:

- Token expiry: the existing `ClientReviewLink` has no `expires_at`. Should portal tokens expire after N days of inactivity? Suggest: no for v1 — staff can rotate manually via the existing `POST /api/agency/clients/{id}/review-link` endpoint.
