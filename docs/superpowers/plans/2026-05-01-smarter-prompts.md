# Smarter Prompt Suggestions + Pre-History Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-suggested prompts always end with `?`, scope them to the brand's actual market reach, and let users fix typos on prompts that have not yet been tracked.

**Architecture:**
- **Backend:** Two new columns on `brand_profiles` (`market_scope`, `geography`); a `POST /infer-scope` endpoint; question-mark enforcement in both suggest endpoints; scope context fed into `suggest_prompts`; new `PATCH /prompts/{id}` endpoint that 409s when a prompt already has `query_results`; a `has_history` boolean on `PromptResponse`.
- **Frontend:** `ManagePromptsModal.tsx` gains a pre-suggest scope-confirmation step (only shown when the brand profile has no scope set yet), a pencil icon for inline edits on `!has_history` prompts, and the Brand Profile tab on the settings page surfaces the new scope fields so they can be edited later.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Anthropic Python SDK, Next.js 15, Tailwind, Axios.

**Spec:** `docs/superpowers/specs/2026-05-01-smarter-prompts-design.md`

---

## File Map

**Backend — modify:**
- `backend/app/models.py` — add columns to `BrandProfile`
- `backend/app/database.py` — append two ALTER TABLE migrations
- `backend/app/schemas.py` — extend `BrandProfileUpdate`, `BrandProfileResponse`, `PromptResponse`; add `PromptUpdate`, `InferScopeResponse`
- `backend/app/routers/brand_profile.py` — read/write the two new fields
- `backend/app/routers/brands.py` — question-mark helper, `/infer-scope`, scope-aware suggester, `PATCH /prompts/{id}`, `has_history` attached during brand load

**Backend — create:**
- (none — all new endpoints live in existing routers)

**Backend — tests (modify/create):**
- `backend/tests/test_brands.py` — extend with new tests for PATCH, infer-scope, has_history, question-mark enforcement, scope injection

**Frontend — modify:**
- `frontend/lib/api.ts` — extend `Prompt`, `BrandProfile` types; add `updatePrompt`, `inferBrandScope`
- `frontend/components/ManagePromptsModal.tsx` — pencil icon, inline edit, scope-confirmation flow
- `frontend/app/settings/page.tsx` — add scope dropdown + geography input to Brand Profile tab

**Valid scope values (single source of truth — used in both backend and frontend):**
- `local` — city / region scope
- `national` — country-wide scope
- `global` — multi-country scope
- `niche` — narrow B2B vertical (geography-agnostic)

---

## Task 1: Schema migration — add `market_scope` and `geography` to `brand_profiles`

**Files:**
- Modify: `backend/app/models.py` (BrandProfile class, ~line 418-435)
- Modify: `backend/app/database.py` (migrations list, end at ~line 339 before the closing `]`)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_brands.py` (append at end):

```python
import pytest
import httpx
from tests.conftest import register_and_login, create_brand


@pytest.mark.asyncio
async def test_brand_profile_persists_market_scope_and_geography(client: httpx.AsyncClient):
    await register_and_login(client, email="scope_persist@example.com")
    brand = await create_brand(client, name="Scope Brand")

    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"market_scope": "local", "geography": "Portland, OR"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["market_scope"] == "local"
    assert resp.json()["geography"] == "Portland, OR"

    # Round-trip via GET
    get_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert get_resp.status_code == 200
    assert get_resp.json()["market_scope"] == "local"
    assert get_resp.json()["geography"] == "Portland, OR"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_brands.py::test_brand_profile_persists_market_scope_and_geography -v
```
Expected: FAIL — `BrandProfileUpdate` rejects unknown fields, or 200 with the new fields absent from the response.

- [ ] **Step 3: Add columns to the SQLAlchemy model**

In `backend/app/models.py`, inside the `BrandProfile` class (after the `internal_brand_context` line, before `created_at`):

```python
    market_scope: Mapped[str | None] = mapped_column(String(20), nullable=True)
    geography: Mapped[str | None] = mapped_column(String(200), nullable=True)
```

`String` is already imported at the top of the file.

- [ ] **Step 4: Add migrations**

In `backend/app/database.py`, inside `run_migrations()`'s `migrations = [...]` list, append before the closing `]` (around line 339):

```python
        # 2026-05-01: Smarter prompt suggestions — market scope on brand_profiles
        "ALTER TABLE brand_profiles ADD COLUMN market_scope VARCHAR(20)",
        "ALTER TABLE brand_profiles ADD COLUMN geography VARCHAR(200)",
```

- [ ] **Step 5: Extend `BrandProfileUpdate` and `BrandProfileResponse`**

In `backend/app/schemas.py`, edit `BrandProfileUpdate` (around line 583) — add inside the class, after `publications`:

```python
    market_scope: str | None = Field(None, max_length=20)
    geography: str | None = Field(None, max_length=200)

    @field_validator("market_scope")
    @classmethod
    def validate_market_scope(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = {"local", "national", "global", "niche"}
        if v not in allowed:
            raise ValueError(f"market_scope must be one of {sorted(allowed)}")
        return v
```

In the same file, edit `BrandProfileResponse` (around line 624) — add inside the class, after `publications`:

```python
    market_scope: str | None = None
    geography: str | None = None
```

- [ ] **Step 6: Persist the new fields in the brand_profile router**

In `backend/app/routers/brand_profile.py`, inside `update_brand_profile` (around line 147), after the existing `if payload.publications is not None:` block:

```python
    if payload.market_scope is not None:
        profile.market_scope = payload.market_scope or None
    if payload.geography is not None:
        profile.geography = payload.geography.strip() or None
```

In the same file, edit `_profile_to_response` (around line 80) — add to the `BrandProfileResponse(...)` construction (after `publications=...`):

```python
        market_scope=profile.market_scope,
        geography=profile.geography,
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd backend && pytest tests/test_brands.py::test_brand_profile_persists_market_scope_and_geography -v
```
Expected: PASS.

- [ ] **Step 8: Add a validation test for bad scope values**

Append to `backend/tests/test_brands.py`:

```python
@pytest.mark.asyncio
async def test_brand_profile_rejects_invalid_market_scope(client: httpx.AsyncClient):
    await register_and_login(client, email="scope_bad@example.com")
    brand = await create_brand(client, name="Bad Scope")
    resp = await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"market_scope": "interplanetary"},
    )
    assert resp.status_code == 422
```

Run it:

```bash
cd backend && pytest tests/test_brands.py::test_brand_profile_rejects_invalid_market_scope -v
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/app/schemas.py backend/app/routers/brand_profile.py backend/tests/test_brands.py
git commit -m "feat(brand-profile): add market_scope and geography fields"
```

---

## Task 2: Question-mark enforcement on suggested prompts

**Files:**
- Modify: `backend/app/routers/brands.py` (suggest_prompts ~line 611, suggest_prompts_preview ~line 781)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_brands.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch


def _mock_anthropic_returning(json_text: str):
    """Patch context manager that makes anthropic.AsyncAnthropic return json_text from messages.create."""
    msg = MagicMock()
    msg.content = [MagicMock(text=json_text)]
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(return_value=msg)
    return patch("anthropic.AsyncAnthropic", return_value=fake_client), patch.dict(
        "os.environ", {"ANTHROPIC_API_KEY": "test-key"}
    )


@pytest.mark.asyncio
async def test_suggest_prompts_appends_missing_question_mark(client: httpx.AsyncClient):
    await register_and_login(client, email="qmark@example.com")
    brand = await create_brand(client, name="QMark Brand")

    bad_payload = '["Best CRM for startups", "Top sales tools.", "Comparison of A and B!"]'
    anth_patch, env_patch = _mock_anthropic_returning(bad_payload)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/suggest-prompts")
    assert resp.status_code == 200, resp.text
    suggestions = resp.json()
    assert len(suggestions) == 3
    for s in suggestions:
        assert s.endswith("?"), f"Suggestion missing '?': {s!r}"
    # Trailing punctuation should be cleaned, not duplicated
    assert "?" in suggestions[1] and not suggestions[1].endswith(".?")
    assert not suggestions[2].endswith("!?")


@pytest.mark.asyncio
async def test_suggest_prompts_preview_appends_missing_question_mark(client: httpx.AsyncClient):
    await register_and_login(client, email="qmark2@example.com")
    bad_payload = '["What about X", "Y comparison"]'
    anth_patch, env_patch = _mock_anthropic_returning(bad_payload)
    with anth_patch, env_patch:
        resp = await client.post(
            "/api/brands/suggest-prompts-preview",
            json={"name": "Acme", "description": "", "website_context": ""},
        )
    assert resp.status_code == 200, resp.text
    for s in resp.json():
        assert s.endswith("?")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_brands.py::test_suggest_prompts_appends_missing_question_mark tests/test_brands.py::test_suggest_prompts_preview_appends_missing_question_mark -v
```
Expected: FAIL on the question-mark assertions.

- [ ] **Step 3: Add the helper and apply it**

In `backend/app/routers/brands.py`, add this helper near the top of the file (just below the existing imports, before the first endpoint):

```python
def _ensure_question_mark(text: str) -> str:
    """Strip trailing whitespace and trailing terminal punctuation, then append '?'."""
    cleaned = text.strip().rstrip("?.!,;:")
    if not cleaned:
        return cleaned
    return cleaned + "?"
```

Then in `suggest_prompts` (around line 690) replace:

```python
        return [s for s in suggestions if isinstance(s, str)][:15]
```

with:

```python
        cleaned = [_ensure_question_mark(s) for s in suggestions if isinstance(s, str)]
        return [s for s in cleaned if s][:15]
```

In the system prompt string (the `f"""You generate AI visibility tracking prompts...` block), add this line after the `Return ONLY a valid JSON array of strings — no explanation, no markdown, no comments. 12-15 prompts total.` line:

```
EVERY prompt MUST be phrased as a question and end with "?".
```

In `suggest_prompts_preview` (around line 820) replace:

```python
        suggestions = _json.loads(m.group() if m else text)
        return [s for s in suggestions if isinstance(s, str)][:12]
```

with:

```python
        suggestions = _json.loads(m.group() if m else text)
        cleaned = [_ensure_question_mark(s) for s in suggestions if isinstance(s, str)]
        return [s for s in cleaned if s][:12]
```

In the preview's system prompt string, add the same line after `Return ONLY a valid JSON array of 12 strings — no explanation, no markdown.`:

```
EVERY prompt MUST be phrased as a question and end with "?".
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_brands.py::test_suggest_prompts_appends_missing_question_mark tests/test_brands.py::test_suggest_prompts_preview_appends_missing_question_mark -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/brands.py backend/tests/test_brands.py
git commit -m "feat(prompts): enforce trailing '?' on AI-suggested prompts"
```

---

## Task 3: `POST /infer-scope` endpoint

**Files:**
- Modify: `backend/app/routers/brands.py` (add new endpoint)
- Modify: `backend/app/schemas.py` (add `InferScopeResponse`)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_brands.py`:

```python
@pytest.mark.asyncio
async def test_infer_scope_returns_inferred_values_without_persisting(client: httpx.AsyncClient):
    await register_and_login(client, email="infer@example.com")
    brand = await create_brand(client, name="Infer Brand")

    fake_json = '{"market_scope": "local", "geography": "Portland, OR"}'
    anth_patch, env_patch = _mock_anthropic_returning(fake_json)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/infer-scope")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["market_scope"] == "local"
    assert body["geography"] == "Portland, OR"

    # Confirm we did NOT persist — profile market_scope should still be null
    profile_resp = await client.get(f"/api/brands/{brand['id']}/profile")
    assert profile_resp.json()["market_scope"] is None


@pytest.mark.asyncio
async def test_infer_scope_returns_404_for_other_users_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="owner@example.com")
    brand = await create_brand(client, name="Owner Brand")

    # Switch to a different user
    await client.post("/api/auth/logout")
    await register_and_login(client, email="intruder@example.com")
    resp = await client.post(f"/api/brands/{brand['id']}/infer-scope")
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_infer_scope_clamps_invalid_scope_value(client: httpx.AsyncClient):
    await register_and_login(client, email="clamp@example.com")
    brand = await create_brand(client, name="Clamp Brand")

    fake_json = '{"market_scope": "interstellar", "geography": "Mars"}'
    anth_patch, env_patch = _mock_anthropic_returning(fake_json)
    with anth_patch, env_patch:
        resp = await client.post(f"/api/brands/{brand['id']}/infer-scope")
    assert resp.status_code == 200, resp.text
    # Out-of-range scope falls back to "national"
    assert resp.json()["market_scope"] == "national"
    assert resp.json()["geography"] == "Mars"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_brands.py -k "infer_scope" -v
```
Expected: FAIL — endpoint does not exist (404).

- [ ] **Step 3: Add the response schema**

In `backend/app/schemas.py`, append after `BrandProfileResponse` (around line 640):

```python
class InferScopeResponse(BaseModel):
    market_scope: str
    geography: str | None = None
```

- [ ] **Step 4: Add the endpoint**

In `backend/app/routers/brands.py`, append after `suggest_prompts` (around line 696, before `# ── Fetch website context...`):

```python
@router.post("/{brand_id}/infer-scope", response_model="schemas.InferScopeResponse" if False else None)
async def infer_scope(brand_id: int, db: DbDep, user: CurrentUser):
    """Use Claude to infer the brand's market scope. Does NOT persist — caller saves via PUT /profile."""
    from app.models import BrandProfile as BrandProfileModel
    from app.schemas import InferScopeResponse

    check_rate_limit(user.id, limit=5)
    brand = await _get_brand_or_404(db, brand_id, user)

    profile_result = await db.execute(
        select(BrandProfileModel).where(BrandProfileModel.brand_id == brand_id)
    )
    profile = profile_result.scalar_one_or_none()

    comp_result = await db.execute(
        select(Competitor).where(Competitor.brand_id == brand_id)
    )
    competitors = comp_result.scalars().all()

    context_parts = [f"Brand name: {brand.name}"]
    if brand.website_url:
        context_parts.append(f"Website: {brand.website_url}")
    if profile and profile.company_description:
        context_parts.append(f"Description: {profile.company_description}")
    if profile and profile.target_audience:
        context_parts.append(f"Target audience: {profile.target_audience}")
    if profile and profile.internal_brand_context:
        context_parts.append(f"Website content excerpt:\n{profile.internal_brand_context[:3000]}")
    if competitors:
        context_parts.append(f"Known competitors: {', '.join(c.name for c in competitors)}")

    api_key = _os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ANTHROPIC_API_KEY not configured.",
        )

    prompt = f"""Classify the market scope of this brand based on the context below.

{chr(10).join(context_parts)}

Return ONLY a JSON object with two fields, no markdown, no explanation:
{{
  "market_scope": "local" | "national" | "global" | "niche",
  "geography": "<short string describing where this brand competes — city/region for local, country for national, region(s) for global, vertical descriptor for niche>"
}}

Definitions:
- "local"  — operates in a single city or metro area (a coffee roaster in Portland, a clinic in Berlin)
- "national" — operates across one country (a US-only SaaS, a UK retailer)
- "global" — operates across multiple countries (Salesforce, Notion)
- "niche" — narrow B2B vertical that competes regardless of geography (a kubernetes operator, a pharma billing tool)

If unsure, prefer "national"."""

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip() if response.content else "{}"
        m = re.search(r"\{[\s\S]*\}", text)
        data = _json.loads(m.group() if m else text)
    except Exception:
        logger.exception("infer_scope failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Scope inference failed. Please try again.",
        )

    raw_scope = (data.get("market_scope") or "").lower().strip()
    allowed = {"local", "national", "global", "niche"}
    scope = raw_scope if raw_scope in allowed else "national"
    geography = data.get("geography")
    if isinstance(geography, str):
        geography = geography.strip() or None
    else:
        geography = None
    return InferScopeResponse(market_scope=scope, geography=geography)
```

(The `response_model="..." if False else None` trick avoids a forward-reference issue; replace with the real import. Cleaner: remove the `response_model=` argument entirely and rely on the typed return. Use this version instead:)

```python
@router.post("/{brand_id}/infer-scope")
async def infer_scope(brand_id: int, db: DbDep, user: CurrentUser):
```

The function returns `InferScopeResponse` so FastAPI infers the response schema from the return type.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_brands.py -k "infer_scope" -v
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/brands.py backend/app/schemas.py backend/tests/test_brands.py
git commit -m "feat(prompts): add /infer-scope endpoint for market-scope inference"
```

---

## Task 4: Suggester injects scope context into the system prompt

**Files:**
- Modify: `backend/app/routers/brands.py` (`suggest_prompts` ~line 611)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_brands.py`:

```python
@pytest.mark.asyncio
async def test_suggest_prompts_includes_scope_in_system_prompt(client: httpx.AsyncClient):
    await register_and_login(client, email="scopeprompt@example.com")
    brand = await create_brand(client, name="ScopePrompt Brand")

    # Set scope on the profile
    await client.put(
        f"/api/brands/{brand['id']}/profile",
        json={"market_scope": "local", "geography": "Portland, OR"},
    )

    captured: dict = {}
    msg = MagicMock()
    msg.content = [MagicMock(text='["What are the best widgets in Portland?"]')]

    async def fake_create(**kwargs):
        captured["messages"] = kwargs.get("messages")
        return msg

    fake_client = AsyncMock()
    fake_client.messages.create = fake_create
    with patch("anthropic.AsyncAnthropic", return_value=fake_client), patch.dict(
        "os.environ", {"ANTHROPIC_API_KEY": "test-key"}
    ):
        resp = await client.post(f"/api/brands/{brand['id']}/suggest-prompts")

    assert resp.status_code == 200, resp.text
    sys_prompt = captured["messages"][0]["content"]
    assert "local" in sys_prompt.lower()
    assert "Portland, OR" in sys_prompt


@pytest.mark.asyncio
async def test_suggest_prompts_omits_scope_block_when_unset(client: httpx.AsyncClient):
    await register_and_login(client, email="noscope@example.com")
    brand = await create_brand(client, name="NoScope Brand")

    captured: dict = {}
    msg = MagicMock()
    msg.content = [MagicMock(text='["What is X?"]')]

    async def fake_create(**kwargs):
        captured["messages"] = kwargs.get("messages")
        return msg

    fake_client = AsyncMock()
    fake_client.messages.create = fake_create
    with patch("anthropic.AsyncAnthropic", return_value=fake_client), patch.dict(
        "os.environ", {"ANTHROPIC_API_KEY": "test-key"}
    ):
        resp = await client.post(f"/api/brands/{brand['id']}/suggest-prompts")

    assert resp.status_code == 200
    sys_prompt = captured["messages"][0]["content"]
    # The literal scope-instruction block should not appear when no scope is set
    assert "Market scope:" not in sys_prompt
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_brands.py -k "scope_in_system_prompt or omits_scope_block" -v
```
Expected: FAIL — `"Market scope:"` not yet emitted.

- [ ] **Step 3: Inject scope context into `suggest_prompts`**

In `backend/app/routers/brands.py`, edit `suggest_prompts` (around line 611). After the existing `context_parts.append(f"Already tracking (avoid duplicates): ...")` block and before `context = "\n".join(context_parts)`:

```python
    scope_block = ""
    if profile and profile.market_scope:
        geo_line = f"\nGeography: {profile.geography}" if profile.geography else ""
        scope_block = (
            f"\n\nMarket scope: {profile.market_scope}{geo_line}\n\n"
            "When generating queries, scope them to where this brand actually competes. "
            "For local scope, use the geography in queries (e.g. 'best X in {geo}', "
            "'{geo}-area X'). For national, prefer country-specific phrasings. "
            "For niche B2B, use vertical-specific phrasings rather than geographic ones. "
            "Avoid global/national phrasings the brand has no realistic chance of appearing in."
        )
        if profile.geography:
            scope_block = scope_block.replace("{geo}", profile.geography)
        else:
            scope_block = scope_block.replace("'best X in {geo}', '{geo}-area X'", "geographically scoped phrasings")

    context = "\n".join(context_parts) + scope_block
```

(Be sure to delete the old `context = "\n".join(context_parts)` line — there must only be one `context = ...` assignment.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_brands.py -k "scope_in_system_prompt or omits_scope_block" -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/brands.py backend/tests/test_brands.py
git commit -m "feat(prompts): suggester reads market_scope and geography from brand profile"
```

---

## Task 5: Add `has_history` to `PromptResponse` and `BrandDetail`

**Files:**
- Modify: `backend/app/schemas.py` (`PromptResponse` ~line 23)
- Modify: `backend/app/routers/brands.py` (`_get_brand_or_404` ~line 65, `create_brand` ~line 326, `update_brand` ~line 388, `add_prompt` ~line 486)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_brands.py`:

```python
@pytest.mark.asyncio
async def test_prompt_response_has_history_flag(client: httpx.AsyncClient, db_session):
    await register_and_login(client, email="hashistory@example.com")
    brand = await create_brand(client, name="History Brand", prompts=["What is the best X?"])

    # Initially: no history → has_history is False
    detail = await client.get(f"/api/brands/{brand['id']}")
    prompts = detail.json()["prompts"]
    assert all(p["has_history"] is False for p in prompts)

    # Insert a fake QueryResult against the prompt
    from app.models import QueryResult, TrackingRun
    from datetime import datetime, UTC
    run = TrackingRun(brand_id=brand["id"], status="completed", run_type="manual")
    db_session.add(run)
    await db_session.flush()
    qr = QueryResult(
        tracking_run_id=run.id,
        prompt_id=prompts[0]["id"],
        model="chatgpt",
        run_number=1,
        response_text="hi",
        mentioned=False,
    )
    db_session.add(qr)
    await db_session.commit()

    detail2 = await client.get(f"/api/brands/{brand['id']}")
    p = next(x for x in detail2.json()["prompts"] if x["id"] == prompts[0]["id"])
    assert p["has_history"] is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && pytest tests/test_brands.py::test_prompt_response_has_history_flag -v
```
Expected: FAIL — `has_history` field absent.

- [ ] **Step 3: Add the field to `PromptResponse`**

In `backend/app/schemas.py`, edit `PromptResponse` (around line 23):

```python
class PromptResponse(PromptBase):
    id: int
    brand_id: int
    prompt_type: str = "standard"
    created_at: datetime
    has_history: bool = False

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Annotate prompts with `has_history` after loading**

In `backend/app/routers/brands.py`, add this helper near the top of the file (after the `_ensure_question_mark` helper from Task 2):

```python
async def _attach_has_history(db: AsyncSession, brand: Brand) -> None:
    """Set `has_history` (transient attribute) on each of the brand's prompts."""
    if not brand.prompts:
        return
    prompt_ids = [p.id for p in brand.prompts]
    rows = await db.execute(
        select(QueryResult.prompt_id)
        .where(QueryResult.prompt_id.in_(prompt_ids))
        .distinct()
    )
    with_history = {r[0] for r in rows.all()}
    for p in brand.prompts:
        p.has_history = p.id in with_history
```

`QueryResult` is already imported at the top of the file (line 32).

- [ ] **Step 5: Call the helper from every endpoint that returns `BrandDetail`**

In `backend/app/routers/brands.py`:

In `get_brand` (around line 337), after `brand = await _get_brand_or_404(brand_id, ...)`:

```python
    await _attach_has_history(db, brand)
    return BrandDetail.model_validate(brand)
```

In `create_brand` (around line 327), after the final `brand = result.scalar_one()`:

```python
    await _attach_has_history(db, brand)
    return BrandDetail.model_validate(brand)
```

In `update_brand` (around line 391), after the final `brand = result.scalar_one()`:

```python
    await _attach_has_history(db, brand)
    return BrandDetail.model_validate(brand)
```

In `add_prompt` (around line 486) — `add_prompt` returns a single `PromptResponse`, not the brand. New prompts have no history, so just set the flag:

```python
    prompt.has_history = False
    return PromptResponse.model_validate(prompt)
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd backend && pytest tests/test_brands.py::test_prompt_response_has_history_flag -v
```
Expected: PASS.

- [ ] **Step 7: Run the full brands test file to confirm nothing else regressed**

```bash
cd backend && pytest tests/test_brands.py -v
```
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/brands.py backend/app/schemas.py backend/tests/test_brands.py
git commit -m "feat(prompts): expose has_history on PromptResponse"
```

---

## Task 6: `PATCH /brands/{id}/prompts/{pid}` — edit text when no history exists

**Files:**
- Modify: `backend/app/schemas.py` (add `PromptUpdate`)
- Modify: `backend/app/routers/brands.py` (add new endpoint after `delete_prompt`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_brands.py`:

```python
@pytest.mark.asyncio
async def test_patch_prompt_succeeds_when_no_history(client: httpx.AsyncClient):
    await register_and_login(client, email="patch1@example.com")
    brand = await create_brand(client, name="Patch Brand", prompts=["What is X?"])
    prompt_id = brand["prompts"][0]["id"]

    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{prompt_id}",
        json={"text": "What is the best X?"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "What is the best X?"
    assert resp.json()["has_history"] is False


@pytest.mark.asyncio
async def test_patch_prompt_409_when_history_exists(client: httpx.AsyncClient, db_session):
    await register_and_login(client, email="patch2@example.com")
    brand = await create_brand(client, name="Patch History", prompts=["What is X?"])
    prompt_id = brand["prompts"][0]["id"]

    # Seed a query result against the prompt
    from app.models import QueryResult, TrackingRun
    run = TrackingRun(brand_id=brand["id"], status="completed", run_type="manual")
    db_session.add(run)
    await db_session.flush()
    db_session.add(QueryResult(
        tracking_run_id=run.id, prompt_id=prompt_id, model="chatgpt",
        run_number=1, response_text="hi", mentioned=False,
    ))
    await db_session.commit()

    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{prompt_id}",
        json={"text": "What is the best X?"},
    )
    assert resp.status_code == 409
    assert "history" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_prompt_409_during_active_run(client: httpx.AsyncClient, db_session):
    await register_and_login(client, email="patch3@example.com")
    brand = await create_brand(client, name="Patch Active", prompts=["What is X?"])
    prompt_id = brand["prompts"][0]["id"]

    from app.models import TrackingRun
    from datetime import datetime, UTC
    db_session.add(TrackingRun(
        brand_id=brand["id"], status="running", run_type="manual",
        created_at=datetime.now(UTC).replace(tzinfo=None),
    ))
    await db_session.commit()

    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{prompt_id}",
        json={"text": "Anything"},
    )
    assert resp.status_code == 409
    assert "report is running" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_prompt_409_on_duplicate_text(client: httpx.AsyncClient):
    await register_and_login(client, email="patch4@example.com")
    brand = await create_brand(
        client, name="Patch Dup",
        prompts=["What is X?", "What is Y?"],
    )
    target_id = brand["prompts"][0]["id"]
    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{target_id}",
        json={"text": "What is Y?"},
    )
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_patch_prompt_same_text_is_noop_success(client: httpx.AsyncClient):
    await register_and_login(client, email="patch5@example.com")
    brand = await create_brand(client, name="Patch Noop", prompts=["What is X?"])
    prompt_id = brand["prompts"][0]["id"]
    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{prompt_id}",
        json={"text": "What is X?"},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_patch_prompt_403_for_other_users_brand(client: httpx.AsyncClient):
    await register_and_login(client, email="patchowner@example.com")
    brand = await create_brand(client, name="Owner", prompts=["What is X?"])
    prompt_id = brand["prompts"][0]["id"]

    await client.post("/api/auth/logout")
    await register_and_login(client, email="patchintruder@example.com")
    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{prompt_id}",
        json={"text": "Pwned"},
    )
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_patch_prompt_422_on_empty_text(client: httpx.AsyncClient):
    await register_and_login(client, email="patch6@example.com")
    brand = await create_brand(client, name="Patch Empty", prompts=["What is X?"])
    prompt_id = brand["prompts"][0]["id"]
    resp = await client.patch(
        f"/api/brands/{brand['id']}/prompts/{prompt_id}",
        json={"text": "   "},
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && pytest tests/test_brands.py -k "patch_prompt" -v
```
Expected: FAIL — endpoint missing (405 Method Not Allowed).

- [ ] **Step 3: Add the `PromptUpdate` schema**

In `backend/app/schemas.py`, append after `PromptCreate` (around line 21):

```python
class PromptUpdate(BaseModel):
    text: str
```

- [ ] **Step 4: Add the PATCH endpoint**

In `backend/app/routers/brands.py`, append after `delete_prompt` (around line 538). First, add `PromptUpdate` to the schemas import block at the top of the file (line 47-48 already imports `PromptCreate, PromptResponse` — add `PromptUpdate` to that list):

```python
from app.schemas import (
    ...
    PromptCreate,
    PromptResponse,
    PromptUpdate,
    ...
)
```

Then add the endpoint:

```python
@router.patch(
    "/{brand_id}/prompts/{prompt_id}",
    response_model=PromptResponse,
)
async def update_prompt(
    brand_id: int,
    prompt_id: int,
    payload: PromptUpdate,
    db: DbDep,
    user: CurrentUser,
):
    """Edit a prompt's text. Only allowed when the prompt has no QueryResult history."""
    await get_brand_for_user(brand_id, db, user)

    # Block edits while a run is active (mirrors add/delete)
    await fail_stale_runs_for_brand(db, brand_id)
    active_run = await db.execute(
        select(TrackingRun.id).where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status.in_(["pending", "running"]),
        ).limit(1)
    )
    if active_run.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot modify prompts while a report is running.",
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Prompt text cannot be empty",
        )

    # Load the prompt
    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id, Prompt.brand_id == brand_id)
    )
    prompt = result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt {prompt_id} not found for brand {brand_id}",
        )

    # No-op: same text → return success without re-checking history
    if prompt.text == text:
        prompt.has_history = False  # safe default; real value attached below
        history_check = await db.execute(
            select(QueryResult.id).where(QueryResult.prompt_id == prompt_id).limit(1)
        )
        prompt.has_history = history_check.scalar_one_or_none() is not None
        return PromptResponse.model_validate(prompt)

    # Block edits when the prompt already has tracking history
    history_check = await db.execute(
        select(QueryResult.id).where(QueryResult.prompt_id == prompt_id).limit(1)
    )
    if history_check.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Prompt is locked — has tracking history. Delete and re-add to change wording.",
        )

    # Duplicate check — exclude self
    dup = await db.execute(
        select(Prompt.id).where(
            Prompt.brand_id == brand_id,
            func.lower(Prompt.text) == text.lower(),
            Prompt.id != prompt_id,
        ).limit(1)
    )
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This prompt already exists for this brand.",
        )

    prompt.text = text
    await db.commit()
    await db.refresh(prompt)

    prompt.has_history = False  # we just confirmed above

    from app.services.analytics_service import log_event
    await log_event("prompt_edited", {"prompt_id": prompt_id, "new_text": text}, brand_id=brand_id)

    return PromptResponse.model_validate(prompt)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && pytest tests/test_brands.py -k "patch_prompt" -v
```
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full brands test file as a regression check**

```bash
cd backend && pytest tests/test_brands.py -v
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/brands.py backend/app/schemas.py backend/tests/test_brands.py
git commit -m "feat(prompts): allow editing prompts that have no tracking history"
```

---

## Task 7: Frontend — extend `lib/api.ts` types and functions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Extend the `Prompt` type**

In `frontend/lib/api.ts` (around line 126):

```typescript
export interface Prompt {
  id: number;
  brand_id: number;
  text: string;
  prompt_type: 'standard' | 'pitch';
  has_history: boolean;
}
```

- [ ] **Step 2: Extend the `BrandProfile` type**

Find the `BrandProfile` interface in `frontend/lib/api.ts` (search for `export interface BrandProfile`). Add the two new fields:

```typescript
export interface BrandProfile {
  // ... existing fields ...
  market_scope: 'local' | 'national' | 'global' | 'niche' | null;
  geography: string | null;
}
```

If the `BrandProfileUpdate` payload type is defined separately in this file, add the same two optional fields there:

```typescript
  market_scope?: 'local' | 'national' | 'global' | 'niche' | null;
  geography?: string | null;
```

- [ ] **Step 3: Add `updatePrompt` and `inferBrandScope` functions**

Add to `frontend/lib/api.ts` (anywhere among the prompt-related exports, e.g. just below `deletePrompt` at ~line 337):

```typescript
export async function updatePrompt(brandId: number, promptId: number, text: string): Promise<Prompt> {
  const res = await api.patch<Prompt>(`/brands/${brandId}/prompts/${promptId}`, { text });
  return res.data;
}

export interface InferScopeResult {
  market_scope: 'local' | 'national' | 'global' | 'niche';
  geography: string | null;
}

export async function inferBrandScope(brandId: number): Promise<InferScopeResult> {
  const res = await api.post<InferScopeResult>(`/brands/${brandId}/infer-scope`);
  return res.data;
}
```

- [ ] **Step 4: Type-check the frontend**

```bash
cd frontend && npm run build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): add updatePrompt and inferBrandScope client methods"
```

---

## Task 8: Frontend — pencil icon + inline edit in `ManagePromptsModal`

**Files:**
- Modify: `frontend/components/ManagePromptsModal.tsx`

- [ ] **Step 1: Import the new dependencies**

At the top of `frontend/components/ManagePromptsModal.tsx`, change:

```typescript
import { Plus, Loader2, Sparkles, Trash2, MessageSquare } from 'lucide-react';
import { addPrompt, deletePrompt, getSuggestedPrompts, Prompt } from '@/lib/api';
```

to:

```typescript
import { Plus, Loader2, Sparkles, Trash2, MessageSquare, Pencil, Check, X } from 'lucide-react';
import { addPrompt, deletePrompt, getSuggestedPrompts, updatePrompt, Prompt } from '@/lib/api';
```

- [ ] **Step 2: Add edit state**

Inside the component body, alongside the other `useState` calls (around line 31), add:

```typescript
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
```

- [ ] **Step 3: Add the edit handlers**

After `handleDelete` (around line 67), add:

```typescript
  function startEdit(p: Prompt) {
    setEditingId(p.id);
    setEditText(p.text);
    setAddError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function saveEdit() {
    if (editingId == null || !editText.trim()) return;
    setSavingEdit(true);
    setAddError('');
    try {
      const updated = await updatePrompt(brandId, editingId, editText.trim());
      const next = localPrompts.map((p) => (p.id === updated.id ? updated : p));
      setLocalPrompts(next);
      onChanged(next);
      setEditingId(null);
      setEditText('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAddError(e?.response?.data?.detail || 'Failed to save prompt.');
    } finally {
      setSavingEdit(false);
    }
  }
```

- [ ] **Step 4: Render the pencil and inline editor**

Replace the existing prompt-row JSX (the `localPrompts.map((p) => (...))` block, around line 101-114) with:

```tsx
            localPrompts.map((p) => {
              const isEditing = editingId === p.id;
              const editable = !p.has_history && !locked;
              return (
                <div key={p.id} className="flex items-start gap-3 bg-[rgba(95,126,166,0.06)] border border-[rgba(95,126,166,0.12)] rounded-lg px-3 py-2.5">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                      className="flex-1 bg-transparent border-b border-[var(--accent)]/40 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] py-0.5"
                    />
                  ) : (
                    <p className="text-sm text-[var(--text-secondary)] flex-1 leading-snug">{p.text}</p>
                  )}

                  {isEditing ? (
                    <>
                      <button
                        onClick={saveEdit}
                        disabled={savingEdit || !editText.trim()}
                        aria-label="Save prompt"
                        className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors shrink-0 disabled:opacity-40"
                      >
                        {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        aria-label="Cancel edit"
                        className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      {editable && (
                        <button
                          onClick={() => startEdit(p)}
                          aria-label="Edit prompt"
                          className="text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors shrink-0"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(p.id)}
                        disabled={deletingId === p.id || locked}
                        aria-label="Delete prompt"
                        title={p.has_history ? 'Delete to remove tracking history.' : undefined}
                        className="text-[var(--text-faint)] hover:text-[var(--danger)] transition-colors shrink-0 disabled:opacity-40"
                      >
                        {deletingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </>
                  )}
                </div>
              );
            })
```

- [ ] **Step 5: Manual-verify in the dev server**

Start backend and frontend (per CLAUDE.md memory: backend on 3001, frontend on 3002):

```bash
# in one terminal
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001

# in another terminal
cd frontend && npm run dev -- -p 3002
```

Open the brand management modal:
- A freshly added prompt shows the pencil icon. Click → input swaps in. Type a change. Press Enter → saves; row updates with new text.
- Press Escape inside the editor → cancels without saving.
- A prompt that already has tracking history shows no pencil icon (only the trash icon).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ManagePromptsModal.tsx
git commit -m "feat(ui): inline-edit prompts with no tracking history"
```

---

## Task 9: Frontend — scope-confirmation step in `ManagePromptsModal`

**Files:**
- Modify: `frontend/components/ManagePromptsModal.tsx`
- Modify: any callers of `ManagePromptsModal` that need to pass through the brand profile fetch (only if profile is not already loaded — likely none)

- [ ] **Step 1: Import the new helpers**

At the top of `frontend/components/ManagePromptsModal.tsx`, extend the API imports:

```typescript
import {
  addPrompt,
  deletePrompt,
  getSuggestedPrompts,
  updatePrompt,
  inferBrandScope,
  getBrandProfile,
  updateBrandProfile,
  Prompt,
} from '@/lib/api';
```

(Verify the exact names of `getBrandProfile` and `updateBrandProfile` in `lib/api.ts` — adjust import names accordingly. If `updateBrandProfile` is named differently, e.g. `saveBrandProfile`, use that.)

- [ ] **Step 2: Add scope-confirmation state**

Inside the component, alongside the other `useState` hooks:

```typescript
  const [scopeStep, setScopeStep] = useState<'idle' | 'inferring' | 'confirming' | 'suggesting'>('idle');
  const [scopeValue, setScopeValue] = useState<'local' | 'national' | 'global' | 'niche'>('national');
  const [geographyValue, setGeographyValue] = useState('');
  const [scopeError, setScopeError] = useState('');
```

- [ ] **Step 3: Replace `handleSuggest` with the scoped flow**

Replace the existing `handleSuggest` body (around lines 69-77) with:

```typescript
  async function handleSuggest() {
    setSuggesting(true);
    setScopeError('');
    try {
      const profile = await getBrandProfile(brandId);
      if (profile.market_scope) {
        const s = await getSuggestedPrompts(brandId);
        setSuggestions(s);
        return;
      }
      // No scope set — infer, then confirm
      setScopeStep('inferring');
      const inferred = await inferBrandScope(brandId);
      setScopeValue(inferred.market_scope);
      setGeographyValue(inferred.geography ?? '');
      setScopeStep('confirming');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setScopeError(e?.response?.data?.detail || 'Could not generate suggestions.');
      setScopeStep('idle');
    } finally {
      setSuggesting(false);
    }
  }

  async function confirmScopeAndSuggest() {
    setScopeStep('suggesting');
    setScopeError('');
    try {
      await updateBrandProfile(brandId, {
        market_scope: scopeValue,
        geography: geographyValue.trim() || null,
      });
      const s = await getSuggestedPrompts(brandId);
      setSuggestions(s);
      setScopeStep('idle');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setScopeError(e?.response?.data?.detail || 'Could not generate suggestions.');
      setScopeStep('confirming');
    }
  }
```

- [ ] **Step 4: Render the scope chip**

Place the scope-confirmation block above the existing `Suggestions` block (around line 117). Insert before the `{suggestions.length > 0 && (...)}` block:

```tsx
        {scopeStep === 'confirming' && (
          <div className="mb-4 p-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 shrink-0">
            <p className="text-xs text-[var(--text-secondary)] mb-2">
              Where does this brand actually compete? Suggestions will be scoped to match.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value as typeof scopeValue)}
                className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="local">Local — city/region</option>
                <option value="national">National — single country</option>
                <option value="global">Global — multi-country</option>
                <option value="niche">Niche — narrow B2B vertical</option>
              </select>
              <input
                type="text"
                value={geographyValue}
                onChange={(e) => setGeographyValue(e.target.value)}
                placeholder={scopeValue === 'local' ? 'e.g. Portland, OR' : scopeValue === 'national' ? 'e.g. United States' : 'optional'}
                className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-xs placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={confirmScopeAndSuggest}
                disabled={scopeStep === 'suggesting'}
                className="text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-md px-3 py-1.5 transition-colors shrink-0 inline-flex items-center gap-1.5"
              >
                {scopeStep === 'suggesting' ? <Loader2 size={11} className="animate-spin" /> : null}
                Use & suggest
              </button>
            </div>
            {scopeError && (
              <p className="text-xs text-[var(--danger)] mt-2">{scopeError}</p>
            )}
          </div>
        )}
```

- [ ] **Step 5: Update the Suggest button to reflect the inferring state**

Replace the existing "Suggest prompts with AI" button label expression (around line 169) with:

```tsx
            {suggesting || scopeStep === 'inferring' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {scopeStep === 'inferring'
              ? 'Detecting market scope...'
              : suggesting
              ? 'Generating suggestions...'
              : 'Suggest prompts with AI'}
```

- [ ] **Step 6: Manual-verify in the dev server**

- For a brand whose profile already has `market_scope` set: clicking "Suggest" goes straight to suggestions.
- For a brand with no scope set: clicking "Suggest" shows "Detecting market scope...", then renders the chip with inferred values. Edit the dropdown / textbox, click "Use & suggest" → suggestions appear and the value is persisted.
- Reload the page and click "Suggest" again — it skips the scope step (already saved).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/ManagePromptsModal.tsx
git commit -m "feat(ui): scope-aware prompt suggestions with confirmation chip"
```

---

## Task 10: Frontend — surface market scope on the Brand Profile settings tab

**Files:**
- Modify: `frontend/app/settings/page.tsx`

- [ ] **Step 1: Locate the Brand Profile section**

Search the file for where `target_audience` (or `tone_of_voice`) inputs are rendered. The new fields should sit in the same form section so users can edit them later.

```bash
grep -n "target_audience\|tone_of_voice\|company_description" frontend/app/settings/page.tsx
```

- [ ] **Step 2: Add a Market Scope group**

In `frontend/app/settings/page.tsx`, immediately above the `target_audience` field in the Brand Profile form, add:

```tsx
<div className="space-y-1.5">
  <label className="text-xs font-medium text-[var(--text-secondary)]">Market scope</label>
  <p className="text-[11px] text-[var(--text-faint)]">Where does this brand actually compete? Used to scope AI prompt suggestions.</p>
  <div className="flex flex-col gap-2 sm:flex-row">
    <select
      value={profile.market_scope ?? ''}
      onChange={(e) => setProfile({
        ...profile,
        market_scope: (e.target.value || null) as typeof profile.market_scope,
      })}
      className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--accent)]"
    >
      <option value="">Not set</option>
      <option value="local">Local — city/region</option>
      <option value="national">National — single country</option>
      <option value="global">Global — multi-country</option>
      <option value="niche">Niche — narrow B2B vertical</option>
    </select>
    <input
      type="text"
      value={profile.geography ?? ''}
      onChange={(e) => setProfile({ ...profile, geography: e.target.value })}
      placeholder="e.g. Portland, OR · United States · DACH region"
      className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.10)] text-[var(--text-primary)] rounded-md px-2 py-1.5 text-sm placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]"
    />
  </div>
</div>
```

The exact state-update shape (`setProfile(...)`) must match how this file already manages the profile object. Inspect the surrounding code first — if the file uses field-by-field state (`setMarketScope`, `setGeography`) instead of one `profile` object, mirror that pattern.

- [ ] **Step 3: Confirm the save button persists the new fields**

The existing save handler should already POST/PUT the entire `profile` object via `updateBrandProfile`. Since the API client now accepts `market_scope` and `geography`, no further wiring is needed. Quick check — search for the save call and confirm it sends the full `profile` (or all known keys including the two new ones). If the call enumerates fields, add the two new keys to the payload.

```bash
grep -n "updateBrandProfile\|put.*profile" frontend/app/settings/page.tsx
```

If the call uses a manual whitelist, add `market_scope` and `geography` to it.

- [ ] **Step 4: Type-check**

```bash
cd frontend && npm run build
```
Expected: succeeds.

- [ ] **Step 5: Manual verification**

In the running dev server, open Settings → Brand Profile, change market scope and geography, save, refresh — the values persist. Open the prompt manager — clicking "Suggest" now skips the inference step (scope is set).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/settings/page.tsx
git commit -m "feat(ui): edit market scope and geography on the Brand Profile tab"
```

---

## Self-Review

- **Spec coverage**
  - Question-mark fix → Task 2 ✓ (suggester rule + post-process; preview gets the post-process too)
  - `market_scope` + `geography` columns + migration → Task 1 ✓
  - `POST /infer-scope` endpoint → Task 3 ✓
  - Suggester reads scope → Task 4 ✓
  - `has_history` on `PromptResponse` → Task 5 ✓
  - `PATCH /prompts/{id}` with all four 409 paths (history, running, duplicate, ownership) + 422 + no-op + 422 → Task 6 ✓
  - Frontend pencil icon for `!has_history` prompts → Task 8 ✓
  - Frontend scope-confirmation chip flow → Task 9 ✓
  - Brand Profile tab edits scope later → Task 10 ✓
  - Onboarding (`suggest-prompts-preview`) gets question-mark fix only, not scope → Task 2 ✓ (matches spec "Out of Scope" entry)

- **Placeholder scan** — every step has full code; no TBDs, TODOs, or "fill in" markers. Frontend tasks where exact existing-state shape may vary include a `grep` step to locate the right insertion point and explicit instruction to mirror the file's pattern.

- **Type consistency** — `has_history` is used in identical shape across `PromptResponse` (backend), `Prompt` interface (frontend), and the `localPrompts.map((p) => p.has_history)` UI usage. `market_scope` literal union (`'local' | 'national' | 'global' | 'niche'`) is the same in `BrandProfile`, `InferScopeResult`, and the modal/settings dropdowns. `InferScopeResponse` (Pydantic) and `InferScopeResult` (TS) match field-for-field.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-01-smarter-prompts.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks in this session using the executing-plans skill, batching with checkpoints for review.

Which approach?
