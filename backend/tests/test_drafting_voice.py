import json
import pytest

from app.models import Brand, BrandProfile, ContentDraft, User
from app.services.drafting.voice import select_voice_sample


@pytest.mark.asyncio
async def test_select_voice_returns_user_uploaded_when_present(db_session):
    user = User(email="v1@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V1", slug="v1-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    profile = BrandProfile(
        brand_id=brand.id,
        voice_samples=json.dumps([
            {"title": "Latest", "text": "Latest sample text body content here."},
            {"title": "Older", "text": "Older sample text body content here."},
        ]),
    )
    db_session.add(profile)
    await db_session.commit()

    sample = await select_voice_sample(brand_id=brand.id, platform="medium", db=db_session)
    assert sample is not None
    assert "Latest sample" in sample


@pytest.mark.asyncio
async def test_select_voice_falls_back_to_best_approved_draft(db_session):
    user = User(email="v2@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V2", slug="v2-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()

    db_session.add_all([
        ContentDraft(brand_id=brand.id, platform="medium", status="approved",
                     content_text="Excellent draft content here.", quality_score=9.2),
        ContentDraft(brand_id=brand.id, platform="medium", status="approved",
                     content_text="Okay draft.", quality_score=6.0),
        ContentDraft(brand_id=brand.id, platform="medium", status="draft",
                     content_text="Unapproved.", quality_score=9.9),
    ])
    await db_session.commit()

    sample = await select_voice_sample(brand_id=brand.id, platform="medium", db=db_session)
    assert sample == "Excellent draft content here."


@pytest.mark.asyncio
async def test_select_voice_returns_none_when_nothing_available(db_session):
    user = User(email="v3@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V3", slug="v3-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.commit()
    sample = await select_voice_sample(brand_id=brand.id, platform="medium", db=db_session)
    assert sample is None
