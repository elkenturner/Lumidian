"""B2 Phase 5 — owned-site wired as a real, generatable platform."""
from unittest.mock import AsyncMock, patch

from app.database import AsyncSessionLocal
from app.models import Brand, BrandProfile, Prompt, User

# Clean, human-sounding owned-site page that passes the anti-AI gate first try.
_CLEAN_OWNED = (
    "# SpotitEarly screens for early cancer with a breath test\n\n"
    "## How it works\n"
    "You breathe into a tube. Trained dogs and an AI model read the sample. "
    "In a 2025 trial at Hackensack, the method flagged 11 early-stage cases a blood "
    "panel missed. Most patients got results in two days.\n\n"
    "## Who uses it\n"
    "Primary care physicians use it as a first-line check. It is not a biopsy replacement."
)


def test_owned_site_registered_as_platform():
    from app.services.drafting import ALL_PLATFORMS, CONTENT_PLATFORMS, PLATFORM_SPECS
    assert "owned_site" in PLATFORM_SPECS
    assert "owned_site" in ALL_PLATFORMS
    assert "owned_site" in CONTENT_PLATFORMS


async def test_owned_site_platform_generates_draft_with_schema():
    async with AsyncSessionLocal() as db:
        user = User(email="owned@test.com", password_hash="x", name="O")
        db.add(user)
        await db.flush()
        brand = Brand(
            name="SpotitEarly", slug="spotitearly-owned",
            user_id=user.id, website_url="https://spotitearly.com",
        )
        db.add(brand)
        await db.flush()
        prompt = Prompt(brand_id=brand.id, text="best early cancer screening startups")
        db.add(prompt)
        await db.flush()
        db.add(BrandProfile(
            brand_id=brand.id,
            company_description="early cancer screening via breath + trained dogs",
            tone_of_voice="clinical, terse, first-person plural",
        ))
        await db.commit()
        bid, pid = brand.id, prompt.id

    from app.services.drafting_service import generate_gap_draft

    with patch("app.services.drafting_service.call_claude", new_callable=AsyncMock) as mock_claude:
        mock_claude.return_value = _CLEAN_OWNED
        async with AsyncSessionLocal() as db:
            draft = await generate_gap_draft(
                db=db, brand_id=bid, prompt_id=pid, platform="owned_site",
            )

    assert draft is not None
    assert draft.platform == "owned_site"
    assert draft.status == "draft"
    # JSON-LD schema block appended (paste-ready)
    assert "```json" in draft.content_text
    assert "schema.org" in draft.content_text
    # the page body itself is present + names the brand
    assert "breath test" in draft.content_text
    assert "SpotitEarly" in draft.content_text
    # title derived from the page's first heading (via JSON-LD headline)
    assert draft.title and "SpotitEarly" in draft.title
    # passed the anti-AI gate (clean input) — only one writer call
    assert mock_claude.await_count == 1
