"""Tests for cluster_pillar service."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand,
    ContentCluster,
    Prompt,
    User,
    WebsiteAudit,
    WebsiteAuditPage,
)
from app.services.cluster_pillar import propose_pillar


@pytest_asyncio.fixture
async def registered_user(db_session: AsyncSession) -> User:
    """Create and persist a minimal User for direct-DB model tests."""
    user = User(email="pillar_test@example.com", password_hash="x", email_verified=1)
    db_session.add(user)
    await db_session.flush()
    return user


async def _setup_cluster_with_audit_page(db: AsyncSession, user: User, prompt_text: str = "What is X?"):
    brand = Brand(name="Acme", slug=f"acme-p-{user.id}", user_id=user.id, website_url="https://acme.example")
    db.add(brand)
    await db.flush()
    prompt = Prompt(brand_id=brand.id, text=prompt_text, prompt_type="standard")
    db.add(prompt)
    await db.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db.add(cluster)
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db.add(audit)
    await db.flush()
    page = WebsiteAuditPage(
        audit_id=audit.id,
        url="https://acme.example/blog/x",
        title="A guide to X",
        page_type="blog",
        depth=1,
        http_status=200,
        word_count=900,
    )
    db.add(page)
    await db.commit()
    return cluster, page


@pytest.mark.asyncio
async def test_propose_pillar_returns_candidate_when_page_passes_tone_gate(db_session: AsyncSession, registered_user: User) -> None:
    cluster, page = await _setup_cluster_with_audit_page(db_session, registered_user)

    with patch(
        "app.services.cluster_pillar._score_tone",
        new=AsyncMock(return_value=(0.85, "Neutral and informative.")),
    ):
        candidate = await propose_pillar(db_session, cluster)

    assert candidate is not None
    assert candidate.page_id == page.id
    assert candidate.tone_score == 0.85
    assert "Neutral" in candidate.tone_reasoning


@pytest.mark.asyncio
async def test_propose_pillar_returns_none_when_no_pages(db_session: AsyncSession, registered_user: User) -> None:
    brand = Brand(name="Acme", slug="acme-p-empty", user_id=registered_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="Q", prompt_type="standard")
    db_session.add(prompt)
    await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="ready")
    db_session.add(cluster)
    await db_session.commit()

    candidate = await propose_pillar(db_session, cluster)
    assert candidate is None


@pytest.mark.asyncio
async def test_propose_pillar_returns_none_when_tone_gate_fails(db_session: AsyncSession, registered_user: User) -> None:
    cluster, _page = await _setup_cluster_with_audit_page(db_session, registered_user)

    with patch(
        "app.services.cluster_pillar._score_tone",
        new=AsyncMock(return_value=(0.3, "Marketing-coded, promotional CTA in opening paragraph.")),
    ):
        candidate = await propose_pillar(db_session, cluster)

    assert candidate is None
