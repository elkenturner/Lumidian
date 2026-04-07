"""Tests for Content Impact Intelligence feature."""
from __future__ import annotations

import json

import pytest

from tests.conftest import AsyncSessionLocal, register_and_login, create_brand


@pytest.mark.asyncio
async def test_log_content_event(db_session):
    """log_content_event creates a ContentEvent row."""
    from app.models import Brand, Prompt, User
    from app.services.content_event_service import log_content_event

    user = User(email="evt@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="EvtBrand", slug="evtbrand", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="test prompt")
    db_session.add(prompt)
    await db_session.commit()

    await log_content_event(
        event_type="draft_posted",
        brand_id=brand.id,
        prompt_id=prompt.id,
        data={"draft_id": 1, "platform": "reddit"},
    )

    from sqlalchemy import select
    from app.models import ContentEvent
    async with AsyncSessionLocal() as check_db:
        result = await check_db.execute(
            select(ContentEvent).where(ContentEvent.brand_id == brand.id)
        )
        events = result.scalars().all()
        assert len(events) == 1
        assert events[0].event_type == "draft_posted"
        assert json.loads(events[0].data)["platform"] == "reddit"
        assert events[0].prompt_id == prompt.id
