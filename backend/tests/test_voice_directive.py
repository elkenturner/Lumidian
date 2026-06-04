"""B2 Phase 1 — brand voice directive (reuses existing BrandProfile fields)."""
import json

import pytest

from app.services.drafting import PLATFORM_SPECS, build_prompt
from app.services.drafting_service import _load_voice_directive


def _prompt(voice_directive=None):
    return build_prompt(
        brand_name="SpotitEarly",
        platform="medium",
        prompt_text="best early cancer screening startups",
        visibility_pct=12.0,
        profile_context="Brand: SpotitEarly",
        response_analysis="(none)",
        platform_spec=PLATFORM_SPECS["medium"],
        voice_directive=voice_directive,
    )


def test_voice_directive_appears_prominently():
    p = _prompt("Tone: terse, clinical, first-person plural. Never use: 'cure'.")
    assert "BRAND VOICE" in p
    assert "terse, clinical, first-person plural" in p
    # It must sit before the platform rules so it governs the write.
    assert p.index("BRAND VOICE") < p.index("PLATFORM RULES")


def test_no_voice_directive_no_section():
    p = _prompt(None)
    assert "BRAND VOICE" not in p


# ── Loader (reuses tone_of_voice / approved_language / what_not_to_say) ──────

@pytest.mark.asyncio
async def test_load_voice_directive_builds_from_profile_fields(db_session):
    from app.models import Brand, BrandProfile, User

    user = User(email="voice@test.com", password_hash="x", name="V")
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="SpotitEarly", slug="spotitearly-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()
    db_session.add(BrandProfile(
        brand_id=brand.id,
        tone_of_voice="terse, clinical, no hype",
        approved_language=json.dumps(["breath test", "early detection"]),
        what_not_to_say=json.dumps(["FDA approved", "cure"]),
    ))
    await db_session.flush()

    directive = await _load_voice_directive(db_session, brand.id)
    assert directive is not None
    assert "Tone: terse, clinical, no hype" in directive
    assert "breath test" in directive
    assert "Never use these phrases or claims: FDA approved, cure" in directive


@pytest.mark.asyncio
async def test_load_voice_directive_none_when_no_profile(db_session):
    from app.models import Brand, User

    user = User(email="novoice@test.com", password_hash="x", name="N")
    db_session.add(user)
    await db_session.flush()
    brand = Brand(name="NoProfile", slug="noprofile-voice", user_id=user.id)
    db_session.add(brand)
    await db_session.flush()

    assert await _load_voice_directive(db_session, brand.id) is None
