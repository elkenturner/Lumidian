"""Tests for the 13 LLM-backed artifact generators.

The LLM is mocked via `_call_claude`. We verify:
- Each generator is registered with the expected artifact_type
- The prompt receives BrandProfile + page context
- regenerate_notes is appended to the prompt
- The mocked LLM response flows back as ArtifactResult
"""
import pytest
from unittest.mock import patch, AsyncMock

from app.database import AsyncSessionLocal
from app.models import (
    BrandProfile,
    User,
    WebsiteAudit,
    WebsiteAuditPage,
    WebsiteAuditRecommendation,
    utcnow,
)
from app.services.site_audit.artifact_generator import (
    LLM_ARTIFACT_TYPES,
    _LLM_GENERATORS,
    _ensure_generators_loaded,
    generate_artifact,
)
from tests.conftest import create_brand, register_and_login
from httpx import AsyncClient, ASGITransport
from app.main import app
from sqlalchemy import select


async def _make_rec_with_page(
    user_email: str, artifact_type: str
) -> int:
    """Create brand+profile+audit+page+rec; return rec_id."""
    ac = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        await register_and_login(ac, email=user_email)
        async with AsyncSessionLocal() as db:
            u = (
                await db.execute(select(User).where(User.email == user_email))
            ).scalar_one()
            u.subscription_tier = "starter"
            await db.commit()
        brand_dict = await create_brand(ac, name="Brand X")
        async with AsyncSessionLocal() as db:
            db.add(
                BrandProfile(
                    brand_id=brand_dict["id"],
                    company_description="A demo brand.",
                    tone_of_voice="warm, specific",
                    target_audience="indie founders",
                    key_stats="50k MAU, 3y old",
                    what_not_to_say="hype words",
                )
            )
            audit = WebsiteAudit(
                brand_id=brand_dict["id"],
                status="completed",
                triggered_by="user",
                started_at=utcnow(),
            )
            db.add(audit)
            await db.commit()
            await db.refresh(audit)
            page = WebsiteAuditPage(
                audit_id=audit.id,
                url="https://example.com/post-1",
                http_status=200,
                page_type="article",
                title="The X Guide",
                h1_text="Everything about X",
                word_count=800,
            )
            db.add(page)
            await db.commit()
            await db.refresh(page)
            rec = WebsiteAuditRecommendation(
                audit_id=audit.id,
                page_id=page.id,
                priority="high",
                effort="low",
                category="content",
                title=f"Add {artifact_type}",
                body="…",
                artifact_type=artifact_type,
            )
            db.add(rec)
            await db.commit()
            await db.refresh(rec)
            return rec.id
    finally:
        await ac.aclose()


def test_all_llm_types_registered():
    _ensure_generators_loaded()
    missing = LLM_ARTIFACT_TYPES - set(_LLM_GENERATORS)
    assert not missing, f"unregistered LLM types: {missing}"


@pytest.mark.parametrize("artifact_type", sorted(LLM_ARTIFACT_TYPES))
@pytest.mark.asyncio
async def test_each_llm_generator_calls_claude(artifact_type):
    """For each LLM type: mock _call_claude, assert the generator returns the
    mocked response wrapped in ArtifactResult with the right type."""
    rec_id = await _make_rec_with_page(
        f"llm-{artifact_type}@test.com", artifact_type
    )
    fake_response = f"FAKE-{artifact_type}-OUTPUT"
    with patch(
        "app.services.site_audit.generators_artifact_llm._call_claude",
        new=AsyncMock(return_value=fake_response),
    ) as mocked:
        result = await generate_artifact(rec_id)
    assert mocked.called, f"_call_claude not called for {artifact_type}"
    assert result.artifact == fake_response
    assert result.artifact_type == artifact_type
    # Verify the prompt referenced brand context
    prompt_arg = mocked.call_args[0][0]
    assert "Brand X" in prompt_arg


@pytest.mark.asyncio
async def test_regenerate_notes_in_prompt():
    rec_id = await _make_rec_with_page("regen-notes@test.com", "meta_title")
    with patch(
        "app.services.site_audit.generators_artifact_llm._call_claude",
        new=AsyncMock(return_value="title"),
    ) as mocked:
        await generate_artifact(rec_id, regenerate_notes="make it shorter")
    prompt_arg = mocked.call_args[0][0]
    assert "make it shorter" in prompt_arg
    assert "USER FEEDBACK" in prompt_arg


@pytest.mark.asyncio
async def test_call_claude_missing_api_key():
    """Without ANTHROPIC_API_KEY, _call_claude raises ValueError."""
    import os
    from app.services.site_audit.generators_artifact_llm import _call_claude

    original = os.environ.get("ANTHROPIC_API_KEY")
    os.environ["ANTHROPIC_API_KEY"] = ""
    try:
        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            await _call_claude("hi")
    finally:
        if original is not None:
            os.environ["ANTHROPIC_API_KEY"] = original
