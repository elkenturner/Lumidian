"""
Tests for draft generation limits and queue-filling behaviour.

Verifies:
  - Weekly limits raised (Starter=50, Pro=100)
  - Approved drafts do NOT block regeneration (weekly or per-combo)
  - generate_now passes max_gaps=20 for paid users
  - auto_draft_top_gaps fills the queue to max_gaps when API succeeds
  - Per-combo ceiling still limits brands with few prompts
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.models import Brand, ContentDraft, Prompt, User
from tests.conftest import AsyncSessionLocal, create_brand, register_and_login


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_brand_direct(db, user_id: int, name: str, prompts: list[str]) -> tuple[int, list[int]]:
    """Insert brand + prompts via ORM (bypasses tier checks). Returns (brand_id, [prompt_ids])."""
    import secrets
    brand = Brand(name=name, slug=f"{name.lower().replace(' ', '-')}-{secrets.token_hex(4)}",
                  user_id=user_id, tier="basic", brand_type="standard", prompt_limit=25)
    db.add(brand)
    await db.flush()
    prompt_ids = []
    for p in prompts:
        pr = Prompt(brand_id=brand.id, text=p)
        db.add(pr)
        await db.flush()
        prompt_ids.append(pr.id)
    await db.commit()
    return brand.id, prompt_ids


async def _set_user_tier(db, user_id: int, tier: str | None) -> None:
    """Force a user's subscription_tier directly in the DB."""
    from sqlalchemy import text
    await db.execute(
        text("UPDATE users SET subscription_tier = :t WHERE id = :uid"),
        {"t": tier, "uid": user_id},
    )
    await db.commit()


async def _insert_drafts(db, brand_id: int, prompt_id: int, count: int,
                          status: str = "approved", source: str = "manual"):
    """Bulk-insert drafts for testing quota checks."""
    ts = datetime.now(timezone.utc).replace(tzinfo=None)
    for i in range(count):
        db.add(ContentDraft(
            brand_id=brand_id, prompt_id=prompt_id, platform="reddit",
            status=status, source=source,
            title=f"{status} #{i}", content_text="body", created_at=ts,
        ))
    await db.commit()


async def _get_or_create_user(db, email: str) -> int:
    """Get user id by email, or create a minimal user."""
    from sqlalchemy import text
    row = await db.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})
    uid = row.scalar_one_or_none()
    if uid:
        return uid
    user = User(email=email, password_hash="x", email_verified=True)
    db.add(user)
    await db.flush()
    await db.commit()
    return user.id


# ── Tier draft caps ──────────────────────────────────────────────────────────

def test_tier_draft_caps():
    """Draft queue caps scale with tier: free=5, starter=10, pro=20."""
    from app.services.drafting_service import get_draft_cap
    assert get_draft_cap(None) == 5
    assert get_draft_cap("starter") == 20
    assert get_draft_cap("pro") == 20
    assert get_draft_cap(None, brand_type="pitch") == 5


# ── generate_now: paid users have no weekly limit ────────────────────────────

async def test_generate_now_pro_unlimited_weekly(client):
    """Pro user with 200 approved manual drafts this week still gets max_gaps=20."""
    await register_and_login(client, email="pro@example.com", subscription_tier="pro")

    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "pro@example.com")
        bid, pids = await _create_brand_direct(db, uid, "Pro Brand", ["test prompt?"])
        await _insert_drafts(db, bid, pids[0], 200, status="approved", source="manual")

    captured = {}

    async def _capture_bg(brand_id, max_gaps, source, skip_ready=False, retry_failed=False):
        captured["max_gaps"] = max_gaps

    with patch("app.routers.content._bg_generate_drafts", side_effect=_capture_bg):
        resp = await client.post(f"/api/content/{bid}/generate-now", json={"max_gaps": 20})

    assert resp.status_code == 202
    assert captured["max_gaps"] == 20


async def test_generate_now_starter_unlimited_weekly(client):
    """Starter with 200 approved drafts this week still gets max_gaps=20."""
    await register_and_login(client, email="starter@example.com", subscription_tier="starter")
    brand = await create_brand(client, name="Starter Brand", prompts=["starter prompt?"])

    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        pr = await db.execute(text("SELECT id FROM prompts WHERE brand_id = :bid"),
                              {"bid": brand["id"]})
        pid = pr.scalar_one()
        await _insert_drafts(db, brand["id"], pid, 200, status="approved", source="manual")

    captured = {}

    async def _capture_bg(brand_id, max_gaps, source, skip_ready=False, retry_failed=False):
        captured["max_gaps"] = max_gaps

    with patch("app.routers.content._bg_generate_drafts", side_effect=_capture_bg):
        resp = await client.post(f"/api/content/{brand['id']}/generate-now", json={"max_gaps": 20})

    assert resp.status_code == 202
    assert captured["max_gaps"] == 20


# ── Per-combo limit: approved drafts don't block ─────────────────────────────

async def test_per_combo_allows_generation_with_approved_existing():
    """generate_gap_draft succeeds when 5 approved drafts exist for the same
    prompt/platform combo — only 'draft' status counts toward the 3-cap."""
    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "combo@test.com")
        bid, pids = await _create_brand_direct(db, uid, "ComboTest", ["combo prompt?"])
        await _insert_drafts(db, bid, pids[0], 5, status="approved")

    from app.services.drafting_service import generate_gap_draft

    with patch("app.services.drafting_service.call_claude", new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = "Great content about ComboTest here."
        async with AsyncSessionLocal() as db:
            draft = await generate_gap_draft(
                db=db, brand_id=bid, prompt_id=pids[0], platform="reddit",
            )
    assert draft is not None
    assert draft.status == "draft"


# ── auto_draft_top_gaps: queue filling ───────────────────────────────────────

async def test_auto_draft_fills_queue_to_max_gaps():
    """With mocked generate_gap_draft (no per-combo limit), auto_draft_top_gaps
    creates exactly max_gaps=20 drafts even with only 2 prompts × 2 platforms."""
    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "fill@test.com")
        bid, _ = await _create_brand_direct(db, uid, "FillTest", ["prompt A?", "prompt B?"])

    from app.services.drafting_service import auto_draft_top_gaps

    call_count = 0

    async def _mock_generate(db, brand_id, prompt_id, platform, **kwargs):
        nonlocal call_count
        call_count += 1
        draft = ContentDraft(
            brand_id=brand_id, prompt_id=prompt_id, platform=platform,
            status="draft", title=f"Draft {call_count}",
            content_text=f"Content {call_count}",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        return draft

    with patch("app.services.drafting_service.generate_gap_draft", side_effect=_mock_generate):
        async with AsyncSessionLocal() as db:
            drafts = await auto_draft_top_gaps(
                db=db, brand_id=bid, max_gaps=20, clear_existing=True,
            )

    assert len(drafts) == 20, f"Expected 20 drafts but got {len(drafts)}"


async def test_draft_status_basic_tier_caps(client):
    """Basic tier should have draft_cap=10 and scheduled_cap=25."""
    from tests.conftest import create_brand, register_and_login

    await register_and_login(client, email="draft_basic@example.com", subscription_tier="basic")
    brand = await create_brand(client, name="DraftBasicBrand")
    resp = await client.get(f"/api/content/{brand['id']}/draft-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["draft_cap"] == 10
    assert data["scheduled_cap"] == 25
    # basic is a paid tier, so show_upgrade should be False
    assert data["show_upgrade"] is False


async def test_auto_draft_dynamic_combo_cap_fills_queue():
    """With dynamic per-combo cap, 2 prompts × 2 platforms should still reach 20.
    The cap scales to ceil(20 / 4) = 5 per combo, so 4 × 5 = 20."""
    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "dyn@test.com")
        bid, _ = await _create_brand_direct(db, uid, "DynTest", ["prompt X?", "prompt Y?"])

    from app.services.drafting_service import auto_draft_top_gaps

    call_count = 0

    async def _mock_generate_with_combo_cap(db, brand_id, prompt_id, platform, **kwargs):
        """Simulates the real per-combo check with the dynamic cap."""
        nonlocal call_count
        from sqlalchemy import select, func as sqlfunc

        max_per_combo = kwargs.get("max_per_combo", 3)

        existing = await db.execute(
            select(sqlfunc.count(ContentDraft.id)).where(
                ContentDraft.brand_id == brand_id,
                ContentDraft.prompt_id == prompt_id,
                ContentDraft.platform == platform,
                ContentDraft.status == "draft",
            )
        )
        if existing.scalar_one() >= max_per_combo:
            raise ValueError(
                f"{max_per_combo} or more pending drafts already exist for this prompt on " + platform
            )

        call_count += 1
        draft = ContentDraft(
            brand_id=brand_id, prompt_id=prompt_id, platform=platform,
            status="draft", title=f"Draft {call_count}",
            content_text=f"Content {call_count}",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        return draft

    with patch("app.services.drafting_service.generate_gap_draft",
               side_effect=_mock_generate_with_combo_cap):
        async with AsyncSessionLocal() as db:
            drafts = await auto_draft_top_gaps(
                db=db, brand_id=bid, max_gaps=20, clear_existing=True,
            )

    # Dynamic cap: ceil(20 / 4) = 5 per combo.  4 combos × 5 = 20.
    assert len(drafts) == 20, f"Expected 20 but got {len(drafts)}"


# ── Per-tier cap enforcement at draft-creation level ────────────────────────


async def test_generate_gap_draft_blocks_at_basic_tier_cap():
    """generate_gap_draft must respect the basic-tier cap (10), not DRAFT_CAP (20).
    Regression: beseen-health (basic tier) generated 20 drafts because the inner
    cap check was hardcoded to DRAFT_CAP."""
    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "basic_cap@test.com")
        await _set_user_tier(db, uid, "basic")
        bid, pids = await _create_brand_direct(
            db, uid, "BasicCapTest", ["basic cap prompt?"]
        )
        # Fill the queue to exactly the basic-tier cap (10)
        await _insert_drafts(db, bid, pids[0], 10, status="draft")

    from app.services.drafting_service import generate_gap_draft

    with patch("app.services.drafting_service.call_claude", new_callable=AsyncMock) as mock:
        mock.return_value = "irrelevant — should never be called"
        async with AsyncSessionLocal() as db:
            with pytest.raises(ValueError, match=r"queue is full|10/10"):
                await generate_gap_draft(
                    db=db, brand_id=bid, prompt_id=pids[0], platform="reddit",
                )


async def test_generate_opportunity_draft_blocks_at_basic_tier_cap():
    """generate_opportunity_draft must respect the per-tier cap.
    Basic tier cap is 10 — fill to 10 and the next opportunity draft must fail.
    (Using basic tier exposes the bug; starter cap=20 equals DRAFT_CAP and would mask it.)"""
    from app.models import ContentOpportunity

    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "opp_cap@test.com")
        await _set_user_tier(db, uid, "basic")
        bid, pids = await _create_brand_direct(
            db, uid, "OppCapTest", ["opp cap prompt?"]
        )
        await _insert_drafts(db, bid, pids[0], 10, status="draft")
        opp = ContentOpportunity(
            brand_id=bid, prompt_id=pids[0], platform="reddit",
            thread_url="https://reddit.com/r/test/x", thread_title="test thread",
            subreddit="test", relevance_score=80.0, status="new",
        )
        db.add(opp)
        await db.commit()
        await db.refresh(opp)
        opp_id = opp.id

    from app.services.drafting_service import generate_opportunity_draft

    with patch("app.services.drafting_service.call_claude", new_callable=AsyncMock) as mock:
        mock.return_value = "irrelevant"
        async with AsyncSessionLocal() as db:
            with pytest.raises(ValueError, match=r"queue is full|10/10"):
                await generate_opportunity_draft(db=db, opportunity_id=opp_id)


async def test_store_draft_atomic_recount_uses_tier_cap():
    """The atomic recount inside _store_draft must compare against the per-tier
    cap, not DRAFT_CAP. Insert (cap) drafts, then call _store_draft directly —
    must raise. Regression for the line-430 hardcode."""
    async with AsyncSessionLocal() as db:
        uid = await _get_or_create_user(db, "atomic_cap@test.com")
        await _set_user_tier(db, uid, "basic")
        bid, pids = await _create_brand_direct(
            db, uid, "AtomicCapTest", ["atomic cap prompt?"]
        )
        await _insert_drafts(db, bid, pids[0], 10, status="draft")

    from app.services.drafting_service import _store_draft

    async with AsyncSessionLocal() as db:
        with pytest.raises(ValueError, match=r"queue is full|10/10"):
            await _store_draft(
                db=db, brand_id=bid, prompt_id=pids[0], platform="reddit",
                title="t", content_body="b", brief="x",
                visibility_pct=0.0, estimated_impact=0.0,
            )
