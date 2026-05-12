import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_generate_llm_rewrite_returns_none_on_failure():
    """If the Anthropic call fails, generate_llm_rewrite should return None."""
    from app.services.site_audit.recommendations import generate_llm_rewrite

    # Patch the import inside the function — anthropic.AsyncAnthropic
    with patch("anthropic.AsyncAnthropic") as MockClass:
        instance = MockClass.return_value
        instance.messages.create = AsyncMock(side_effect=RuntimeError("boom"))
        out = await generate_llm_rewrite(
            page_excerpt="some html",
            findings=[],
            brand_profile={"name": "x"},
            linked_prompts=["prompt"],
        )
    assert out is None


@pytest.mark.asyncio
async def test_llm_rewrite_skipped_for_basic_tier():
    """The orchestrator's LLM-rewrite helper should no-op for tier='basic' (llm_rewrites=0)."""
    from app.services.site_audit.auditor import _maybe_generate_llm_rewrites
    from app.database import AsyncSessionLocal
    from app.models import Brand, User, utcnow

    # Create a basic-tier user + brand, then call the helper with mocked generator
    async with AsyncSessionLocal() as db:
        u = User(email="basic@test.com", password_hash="x", email_verified=True,
                 subscription_tier="basic")
        db.add(u); await db.flush()
        b = Brand(name="X", slug="x_llm_basic", user_id=u.id, website_url="http://example.com")
        db.add(b); await db.commit()
        brand_id = b.id

    # Should run with no errors and call no LLM
    with patch("app.services.site_audit.recommendations.generate_llm_rewrite",
               new=AsyncMock(return_value="rewrite!")) as mock_llm:
        await _maybe_generate_llm_rewrites(
            audit_id=99999,  # nonexistent — we'll just verify no LLM call
            brand_id=brand_id,
            page_records=[],
            page_link_map={},
        )
    mock_llm.assert_not_called()
