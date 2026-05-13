"""Tests for cluster_brief service."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, BrandProfile, ContentCluster, Prompt, User
from app.services.cluster_brief import build_brief

SAMPLE_LLM_JSON = """{
  "positioning": "Position Acme as the canonical source for brand-tracking-on-LLMs",
  "key_claims": ["Tracks 4 LLM providers", "Manual posting only"],
  "canonical_phrasings": ["Acme tracks brand visibility across ChatGPT, Claude, Perplexity, and Gemini"],
  "stats": [{"label": "models", "value": "4", "source": "internal"}],
  "narrative_spine": "Most brands don't know how they show up in AI answers.",
  "tone_notes": "Confident, technical, no hype."
}"""


@pytest_asyncio.fixture
async def registered_user(db_session: AsyncSession) -> User:
    """Create and persist a minimal User for direct-DB model tests."""
    user = User(email="brief_test@example.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.asyncio
async def test_build_brief_writes_row_with_llm_output(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-b1", user_id=registered_user.id, website_url="https://acme.example")
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(brand_id=brand.id, company_description="Acme tracks LLMs", tone_of_voice="confident"))
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="How is my brand cited by ChatGPT?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_LLM_JSON)):
        brief = await build_brief(db_session, cluster=cluster, tier=None)

    assert brief.cluster_id == cluster.id
    assert brief.positioning.startswith("Position Acme")
    assert "Acme tracks brand visibility" in brief.canonical_phrasings[0]
    assert brief.key_claims == ["Tracks 4 LLM providers", "Manual posting only"]
    assert brief.stats[0]["value"] == "4"
    assert brief.created_by == "system"


@pytest.mark.asyncio
async def test_build_brief_handles_malformed_llm_output(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-b2", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value="not json at all")):
        brief = await build_brief(db_session, cluster=cluster, tier=None)

    # Falls back to a templated minimal brief — no crash, sane defaults.
    assert brief.positioning != ""
    assert isinstance(brief.key_claims, list)
    assert isinstance(brief.canonical_phrasings, list)


@pytest.mark.asyncio
async def test_build_brief_increments_version(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-b3", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="briefing")
    db_session.add(cluster)
    await db_session.commit()

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=SAMPLE_LLM_JSON)):
        first = await build_brief(db_session, cluster=cluster, tier=None)
        second = await build_brief(db_session, cluster=cluster, tier=None)

    assert first.version == 1
    assert second.version == 2
