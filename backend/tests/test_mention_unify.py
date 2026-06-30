"""Mention-detection unification: all run paths must use the canonical
_detect_mention (URL-citation stripping + fuzzy normalized match) via the
shared run_one_query helper — not query_model's simple substring flag."""
import asyncio
from unittest.mock import patch

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Brand, Prompt, QueryResult, TrackingRun, User
from app.services.tracking_service import run_one_query


async def _call_run_one(brand_name, response_text, *, simple_flag, citations=None):
    """Invoke run_one_query with query_model mocked to return a given response
    and (deliberately divergent) simple `mentioned` flag."""
    sem = asyncio.Semaphore(1)

    async def fake_qm(model, prompt_text, brand_name_arg, **kwargs):
        return {
            "response_text": response_text,
            "mentioned": simple_flag,   # what query_model's simple matcher said
            "latency_ms": 1,
            "error": None,
            "citations": citations,
        }

    with patch("app.services.tracking_service.query_model", side_effect=fake_qm):
        return await run_one_query(
            run_id=1, prompt_id=1, prompt_text="q", model="gemini", run_number=1,
            brand_name=brand_name, is_paid=True, brand_type="pro", semaphore=sem,
        )


async def test_run_one_query_ignores_url_only_mention():
    # Brand appears ONLY inside a URL → canonical detection strips it → not
    # mentioned, even though query_model's simple flag claimed True.
    qr = await _call_run_one("Stripe", "Source: https://stripe.com/pricing", simple_flag=True)
    assert qr.mentioned is False


async def test_run_one_query_catches_fuzzy_mention():
    # Normalized match: "Spotit Early" == "spotitearly"; simple exact flag was False.
    qr = await _call_run_one("Spotit Early", "Check out spotitearly for tracking.", simple_flag=False)
    assert qr.mentioned is True


async def test_run_one_query_passes_citations_through():
    cites = [{"url": "https://example.com", "title": "x"}]
    qr = await _call_run_one("Acme", "Acme is great.", simple_flag=True, citations=cites)
    assert qr.mentioned is True
    assert qr.citations == cites


async def _make_pro_brand(name: str) -> int:
    async with AsyncSessionLocal() as db:
        user = User(email="unify@example.com", password_hash="x", subscription_tier="pro",
                    subscription_status="active", email_verified=True)
        db.add(user); await db.flush()
        brand = Brand(name=name, slug=name.lower().replace(" ", "-"), user_id=user.id, brand_type="pro")
        db.add(brand); await db.flush()
        db.add(Prompt(brand_id=brand.id, text="what is the best tool?", prompt_type="standard"))
        await db.commit()
        return brand.id


async def test_manual_run_uses_canonical_mention_detection():
    """_execute_run_with_id (manual path) must persist mentions per _detect_mention,
    not query_model's simple flag. Brand-only-in-URL → 0 mentions even when the
    simple flag says True."""
    from app.routers.tracking import _execute_run_with_id

    brand_id = await _make_pro_brand("Inc Brand")
    async with AsyncSessionLocal() as db:
        run = TrackingRun(brand_id=brand_id, status="running", run_type="manual")
        db.add(run); await db.commit(); await db.refresh(run)
        run_id = run.id

    async def fake_qm(model, prompt_text, brand_name, **kwargs):
        # brand name only inside a URL; simple flag True (old behavior)
        slug = brand_name.lower().replace(" ", "")
        return {"response_text": f"See https://{slug}.com for details.",
                "mentioned": True, "latency_ms": 1, "error": None, "citations": None}

    # run_one_query resolves query_model via the tracking_service binding.
    with patch("app.services.tracking_service.query_model", side_effect=fake_qm):
        await _execute_run_with_id(run_id=run_id, brand_id=brand_id)

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(QueryResult).where(QueryResult.tracking_run_id == run_id)
        )).scalars().all()
        assert rows, "expected persisted query results"
        assert all(r.mentioned is False for r in rows), "URL-only mention must not count"
        run = await db.get(TrackingRun, run_id)
        assert run.status == "completed"
        assert run.total_mentions == 0
