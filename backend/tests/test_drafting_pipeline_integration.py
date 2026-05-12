"""
End-to-end integration test for the new drafting pipeline.

Verifies which layers run per tier without making real LLM calls.
Tests call `_generate_with_new_pipeline` directly with mocked dependencies.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.models import (
    Brand, BrandProfile, ContentDraft, Prompt, User,
    WebsiteAudit, WebsiteAuditPage,
)


def _writer_response(text: str):
    """Mock for call_claude — returns a plain text string."""
    return text


def _critic_response(overall: float):
    """Mock for the critic call (tool_use response shape)."""
    block = MagicMock()
    block.type = "tool_use"
    block.input = {
        "claim_density": int(overall),
        "citation_coverage": int(overall),
        "query_mirroring": int(overall),
        "concrete_specificity": int(overall),
        "voice_authenticity": int(overall),
        "overall_score": overall,
        "flagged_paragraphs": [] if overall >= 7 else [{"index": 0, "issue": "x", "note": "fix"}],
    }
    resp = MagicMock()
    resp.content = [block]
    return resp


def _rewriter_response(text: str):
    """Mock for the rewriter (plain text response shape)."""
    block = MagicMock()
    block.type = "text"
    block.text = text
    resp = MagicMock()
    resp.content = [block]
    return resp


async def _setup_brand_with_audit(db_session, *, email: str, tier: str | None) -> tuple[User, Brand, Prompt]:
    user = User(email=email, password_hash="x", email_verified=1, subscription_tier=tier)
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="PipeCo", slug=f"pipe-{email}", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="how does PipeCo work")
    db_session.add(prompt)
    await db_session.flush()
    audit = WebsiteAudit(brand_id=brand.id, status="completed")
    db_session.add(audit)
    await db_session.flush()
    db_session.add(WebsiteAuditPage(
        audit_id=audit.id, url="https://pipe.co/x",
        title="how PipeCo works", h1_text="how it works",
        content_excerpt="PipeCo uses pumps.", fact_density=0.8,
    ))
    await db_session.commit()
    return user, brand, prompt


@pytest.mark.asyncio
async def test_starter_runs_evidence_and_writer_but_no_critic(db_session):
    """tier='basic' → Evidence Pack only, no critic."""
    user, brand, prompt = await _setup_brand_with_audit(
        db_session, email="t25-starter@test.com", tier="basic",
    )

    from app.services.drafting_service import _generate_with_new_pipeline

    with patch("app.services.drafting_service.call_claude",
               new=AsyncMock(return_value="Para body. [S1]")) as writer, \
         patch("app.services.drafting.evidence._serper_search",
               new=AsyncMock(return_value=[])), \
         patch("app.services.drafting.critic._anthropic_client") as critic_factory:
        critic_client = MagicMock()
        critic_client.messages.create = AsyncMock()
        critic_factory.return_value = critic_client

        text, score, citations = await _generate_with_new_pipeline(
            brand_id=brand.id, brand_name=brand.name,
            prompt_id=prompt.id, prompt_text=prompt.text,
            platform_key="medium", visibility_pct=0.0,
            profile_context="x", response_analysis="none",
            platform_spec={"format": "article", "word_range": (200, 500), "tone": "x", "rules": []},
            tier="basic", db=db_session,
        )
    assert writer.call_count == 1
    # Critic should never be called on Starter (basic tier).
    assert critic_client.messages.create.call_count == 0
    assert score is None


@pytest.mark.asyncio
async def test_growth_runs_critic_and_rewriter_when_score_low(db_session):
    """tier='starter' → Evidence + critic + rewriter."""
    user, brand, prompt = await _setup_brand_with_audit(
        db_session, email="t25-growth@test.com", tier="starter",
    )

    from app.services.drafting_service import _generate_with_new_pipeline

    with patch("app.services.drafting_service.call_claude",
               new=AsyncMock(return_value="Weak draft. [S1]")) as writer, \
         patch("app.services.drafting.evidence._serper_search",
               new=AsyncMock(return_value=[])), \
         patch("app.services.drafting.critic._anthropic_client") as crit_factory:
        mock_client = MagicMock()
        # Critic returns low score → triggers rewrite.
        # hard_fail threshold is 4.0; we use 5.0 so no hard retry, just rewrite.
        mock_client.messages.create = AsyncMock(side_effect=[
            _critic_response(5.0),
            _rewriter_response("Rewritten paragraph."),
        ])
        crit_factory.return_value = mock_client

        text, score, _ = await _generate_with_new_pipeline(
            brand_id=brand.id, brand_name=brand.name,
            prompt_id=prompt.id, prompt_text=prompt.text,
            platform_key="medium", visibility_pct=0.0,
            profile_context="x", response_analysis="none",
            platform_spec={"format": "article", "word_range": (200, 500), "tone": "x", "rules": []},
            tier="starter", db=db_session,
        )
    # Writer ran once (no hard retry at score 5.0).
    assert writer.call_count == 1
    # Critic + rewriter both fired → two anthropic calls.
    assert mock_client.messages.create.call_count == 2
    assert score == pytest.approx(5.0, abs=0.01)
    # Rewriter replaced the flagged paragraph (index 0) in a single-paragraph draft.
    assert "Rewritten" in text


@pytest.mark.asyncio
async def test_pro_injects_voice_and_cross_ref_into_prompt(db_session):
    """tier='pro' → Voice + cross-ref active. Verify the prompt the writer sees contains the voice sample."""
    user, brand, prompt = await _setup_brand_with_audit(
        db_session, email="t25-pro@test.com", tier="pro",
    )

    # Add a voice sample
    import json as _json
    profile = BrandProfile(
        brand_id=brand.id,
        voice_samples=_json.dumps([{"title": "ceo", "text": "Short concrete writing for PipeCo brand."}]),
    )
    db_session.add(profile)
    await db_session.commit()

    captured = {}

    async def capture_writer(prompt_str, **kwargs):
        captured["text"] = prompt_str
        return "Body. [S1]"

    from app.services.drafting_service import _generate_with_new_pipeline

    with patch("app.services.drafting_service.call_claude",
               new=AsyncMock(side_effect=capture_writer)), \
         patch("app.services.drafting.evidence._serper_search",
               new=AsyncMock(return_value=[])), \
         patch("app.services.drafting.critic._anthropic_client") as crit_factory:
        crit_client = MagicMock()
        crit_client.messages.create = AsyncMock(return_value=_critic_response(8.5))
        crit_factory.return_value = crit_client

        await _generate_with_new_pipeline(
            brand_id=brand.id, brand_name=brand.name,
            prompt_id=prompt.id, prompt_text=prompt.text,
            platform_key="medium", visibility_pct=0.0,
            profile_context="x", response_analysis="none",
            platform_spec={"format": "article", "word_range": (200, 500), "tone": "x", "rules": []},
            tier="pro", db=db_session,
        )
    assert "VOICE EXAMPLE" in captured["text"], "Voice sample should be in the prompt on Pro tier"
    assert "Short concrete writing for PipeCo brand." in captured["text"]
