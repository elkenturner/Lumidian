"""Tests for content hub impact feature — orphan matching, late-attach attribution,
suggestion endpoint. Added 2026-04-23."""

import pytest

from app.services.drafting_service import rank_prompts_by_similarity


class _FakePrompt:
    """Stand-in for app.models.Prompt — we only need `id` and `text`."""
    def __init__(self, id: int, text: str) -> None:
        self.id = id
        self.text = text


def test_rank_identical_texts_scores_one():
    prompts = [_FakePrompt(1, "best ai tools for sales teams")]
    result = rank_prompts_by_similarity("best ai tools for sales teams", prompts)
    assert len(result) == 1
    p, score = result[0]
    assert p.id == 1
    assert score == pytest.approx(1.0)


def test_rank_disjoint_texts_scores_zero():
    prompts = [_FakePrompt(1, "submarine navigation deep ocean")]
    result = rank_prompts_by_similarity("vegetarian recipes weeknight dinner", prompts)
    p, score = result[0]
    assert score == 0.0


def test_rank_partial_overlap_between_zero_and_one():
    prompts = [_FakePrompt(1, "ai tools for sales teams")]
    result = rank_prompts_by_similarity("ai tools help founders ship faster", prompts)
    p, score = result[0]
    assert 0.0 < score < 1.0


def test_rank_orders_multiple_prompts_desc():
    prompts = [
        _FakePrompt(1, "submarine navigation"),
        _FakePrompt(2, "best ai tools for sales"),
        _FakePrompt(3, "ai tools for marketing"),
    ]
    result = rank_prompts_by_similarity("ai tools sales teams", prompts)
    ids_in_order = [p.id for p, _ in result]
    # Prompt 2 is most similar (3 tokens overlap), 3 second, 1 last
    assert ids_in_order[0] == 2
    assert ids_in_order[-1] == 1


def test_rank_ignores_short_tokens_and_stopwords():
    # "a", "to", "of" are stopwords; "ai" is too short (<3 chars).
    # Only "tools" remains on each side — full overlap.
    prompts = [_FakePrompt(1, "a tools of")]
    result = rank_prompts_by_similarity("to tools", prompts)
    p, score = result[0]
    assert score == pytest.approx(1.0)


def test_rank_empty_prompts_returns_empty():
    result = rank_prompts_by_similarity("anything", [])
    assert result == []


def test_rank_empty_draft_text_all_zero():
    prompts = [_FakePrompt(1, "ai tools for sales")]
    result = rank_prompts_by_similarity("", prompts)
    p, score = result[0]
    assert score == 0.0


from app.schemas import UpdateDraftRequest


def test_update_draft_request_accepts_prompt_id():
    req = UpdateDraftRequest(prompt_id=42)
    assert req.prompt_id == 42


def test_update_draft_request_prompt_id_defaults_none():
    req = UpdateDraftRequest(title="new title")
    assert req.prompt_id is None


def test_update_draft_request_prompt_id_rejects_negative():
    with pytest.raises(Exception):
        UpdateDraftRequest(prompt_id=-1)


def test_update_draft_request_all_fields_together():
    req = UpdateDraftRequest(prompt_id=7, status="posted", title="hi")
    assert req.prompt_id == 7
    assert req.status == "posted"
    assert req.title == "hi"


# -- Integration tests against /api/content/draft/{id} ------------------------

import httpx
from tests.conftest import register_and_login as _register_and_login


async def _create_draft_direct(db_session, brand_id: int, prompt_id: int | None = None, status: str = "draft"):
    """Insert a ContentDraft row directly -- bypasses the draft-generation flow."""
    from app.models import ContentDraft
    d = ContentDraft(
        brand_id=brand_id,
        prompt_id=prompt_id,
        platform="reddit",
        status=status,
        title="test",
        content_text="test body",
        content_brief="test brief",
        visibility_score_at_draft=0.0,
        estimated_impact=0.0,
        source="manual",
    )
    db_session.add(d)
    await db_session.commit()
    await db_session.refresh(d)
    return d


async def _current_user_id(email: str) -> int:
    """Look up the user id for a given email."""
    from app.database import AsyncSessionLocal
    from app.models import User
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User).where(User.email == email))
        user = res.scalar_one()
        return user.id


async def test_update_draft_attaches_prompt_id(client: httpx.AsyncClient):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt

    email = "attach1@example.com"
    await _register_and_login(client, email=email)
    user_id = await _current_user_id(email)

    async with AsyncSessionLocal() as db:
        brand = Brand(name="B1", slug="b1-attach", user_id=user_id)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="best ai tools for sales")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None)
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id},
    )
    assert r.status_code == 200, r.text
    assert r.json()["prompt_id"] == prompt_id


async def test_update_draft_rejects_prompt_from_different_brand(client: httpx.AsyncClient):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt

    email = "attach2@example.com"
    await _register_and_login(client, email=email)
    user_id = await _current_user_id(email)

    async with AsyncSessionLocal() as db:
        brand_a = Brand(name="A", slug="a-attach", user_id=user_id)
        brand_b = Brand(name="B", slug="b-attach", user_id=user_id)
        db.add_all([brand_a, brand_b]); await db.commit()
        await db.refresh(brand_a); await db.refresh(brand_b)
        prompt_b = Prompt(brand_id=brand_b.id, text="other brand prompt")
        db.add(prompt_b); await db.commit(); await db.refresh(prompt_b)
        draft_a = await _create_draft_direct(db, brand_a.id)
        draft_id, wrong_prompt_id = draft_a.id, prompt_b.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": wrong_prompt_id},
    )
    assert r.status_code == 400


async def test_update_draft_rejects_nonexistent_prompt(client: httpx.AsyncClient):
    from app.database import AsyncSessionLocal
    from app.models import Brand

    email = "attach3@example.com"
    await _register_and_login(client, email=email)
    user_id = await _current_user_id(email)

    async with AsyncSessionLocal() as db:
        brand = Brand(name="C", slug="c-attach", user_id=user_id)
        db.add(brand); await db.commit(); await db.refresh(brand)
        draft = await _create_draft_direct(db, brand.id)
        draft_id = draft.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": 999999},
    )
    assert r.status_code == 400


async def test_update_draft_attach_and_post_atomic(client: httpx.AsyncClient):
    """Attach + post in a single request: prompt_id is set BEFORE the status transition
    so visibility_at_post snapshot and _create_draft_attribution see a draft with a prompt."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, DraftAttribution
    from sqlalchemy import select

    email = "attach4@example.com"
    await _register_and_login(client, email=email)
    user_id = await _current_user_id(email)

    async with AsyncSessionLocal() as db:
        brand = Brand(name="D", slug="d-attach", user_id=user_id)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="test prompt")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None, status="approved")
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id, "status": "posted"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["prompt_id"] == prompt_id
    assert body["status"] == "posted"

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == draft_id)
        )).scalars().all()
        # Attribution row should exist; prompt_id attached before the posted-branch fired
        assert len(rows) == 1
        assert rows[0].prompt_id == prompt_id


async def test_late_attach_creates_null_baseline_attribution(client: httpx.AsyncClient):
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, DraftAttribution
    from sqlalchemy import select
    from datetime import datetime, timezone

    email = "late1@example.com"
    await _register_and_login(client, email=email)
    user_id = await _current_user_id(email)

    async with AsyncSessionLocal() as db:
        brand = Brand(name="LA", slug="la-attach", user_id=user_id)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="prompt text")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        # Draft is ALREADY posted with prompt_id=None (orphan)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None, status="posted")
        draft.posted_at = datetime.now(timezone.utc)
        await db.commit()
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id},
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == draft_id)
        )).scalars().all()
        assert len(rows) == 1
        row = rows[0]
        assert row.prompt_id == prompt_id
        assert row.score_at_posting is None
        assert row.delta is None
        assert row.runs_since_posting == 0


async def test_late_attach_does_not_create_duplicate_attribution(client: httpx.AsyncClient):
    """If an attribution row already exists (unlikely but possible), don't create a second."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, Prompt, DraftAttribution
    from datetime import datetime, timezone
    from sqlalchemy import select

    email = "late2@example.com"
    await _register_and_login(client, email=email)
    user_id = await _current_user_id(email)

    async with AsyncSessionLocal() as db:
        brand = Brand(name="LB", slug="lb-attach", user_id=user_id)
        db.add(brand); await db.commit(); await db.refresh(brand)
        prompt = Prompt(brand_id=brand.id, text="prompt text")
        db.add(prompt); await db.commit(); await db.refresh(prompt)
        draft = await _create_draft_direct(db, brand.id, prompt_id=None, status="posted")
        draft.posted_at = datetime.now(timezone.utc)
        await db.commit()
        # Pre-seed an attribution row (simulate a prior attach that was then undone)
        pre = DraftAttribution(
            draft_id=draft.id, brand_id=brand.id, prompt_id=prompt.id,
            posted_at=draft.posted_at,
            score_at_posting=None, current_score=None, delta=None, runs_since_posting=0,
        )
        db.add(pre); await db.commit()
        draft_id, prompt_id = draft.id, prompt.id

    r = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"prompt_id": prompt_id},
    )
    assert r.status_code == 200

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(DraftAttribution).where(DraftAttribution.draft_id == draft_id)
        )).scalars().all()
        assert len(rows) == 1  # no duplicate
