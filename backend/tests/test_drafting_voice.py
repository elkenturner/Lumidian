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


from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_select_related_draft_returns_summary(db_session):
    from app.services.drafting.voice import select_related_draft

    user = User(email="v4@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V4", slug="v4-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    from app.models import Prompt
    prompt = Prompt(brand_id=brand.id, text="how does X work")
    db_session.add(prompt)
    await db_session.flush()

    db_session.add(ContentDraft(
        brand_id=brand.id, platform="linkedin_article", prompt_id=prompt.id,
        status="approved", content_text="Body...",
        title="X for industry leaders",
        summary="Argues that X reduces error rates by 40%.",
    ))
    await db_session.commit()

    out = await select_related_draft(
        brand_id=brand.id, prompt_id=prompt.id,
        exclude_platform="medium", db=db_session,
    )
    assert out is not None
    assert "X for industry leaders" in out
    assert "40%" in out


@pytest.mark.asyncio
async def test_select_related_draft_returns_none_when_excluded_platform_only(db_session):
    from app.services.drafting.voice import select_related_draft

    user = User(email="v5@test.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="V5", slug="v5-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    from app.models import Prompt
    prompt = Prompt(brand_id=brand.id, text="q")
    db_session.add(prompt)
    await db_session.flush()
    db_session.add(ContentDraft(
        brand_id=brand.id, platform="medium", prompt_id=prompt.id,
        status="approved", content_text="x", title="t", summary="s",
    ))
    await db_session.commit()
    out = await select_related_draft(
        brand_id=brand.id, prompt_id=prompt.id, exclude_platform="medium", db=db_session,
    )
    assert out is None


@pytest.mark.asyncio
async def test_generate_summary_returns_string():
    from app.services.drafting.voice import generate_draft_summary

    fake_response = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = "Argues that X reduces error rates by 40%."
    fake_response.content = [block]

    with patch("app.services.drafting.voice._anthropic_client") as mock_factory:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_factory.return_value = mock_client

        summary = await generate_draft_summary(
            draft_text="A long draft about X...",
            query="how does X work",
        )
    assert "40%" in summary
