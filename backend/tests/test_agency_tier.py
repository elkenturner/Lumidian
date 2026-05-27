"""Tests for agency tier-up (model list, runs/prompt, admin-only client creation)."""
from __future__ import annotations

import pytest
from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models import User
from tests.conftest import register_and_login


async def _promote(client, email: str, *, agency_staff: bool = False, admin: bool = False) -> None:
    """Register + verify + login, then set is_agency_staff / is_admin flags."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.email == email)
            .values(is_agency_staff=agency_staff, is_admin=admin)
        )
        await db.commit()


@pytest.mark.asyncio
async def test_create_client_blocked_for_non_admin_staff(client):
    """Non-admin agency staff cannot create new clients."""
    await _promote(client, "staff@example.com", agency_staff=True, admin=False)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 403
    assert "admin" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_client_allowed_for_admin(client):
    """Admins can create new agency clients."""
    await _promote(client, "admin@example.com", agency_staff=False, admin=True)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Acme"


# ── llm_service tier-up helpers ──────────────────────────────────────────────


def test_models_for_tier_agency_returns_pro_list():
    """Agency brands get all 4 models regardless of subscription tier."""
    from app.services.llm_service import models_for_tier

    expected = ["chatgpt", "claude", "perplexity", "gemini"]
    assert models_for_tier("agency", None) == expected
    assert models_for_tier("agency", "basic") == expected
    assert models_for_tier("agency", "starter") == expected
    assert models_for_tier("agency", "pro") == expected


def test_models_for_tier_non_agency_unchanged():
    """Regression: standard/pitch brands keep their existing tier-based model lists."""
    from app.services.llm_service import models_for_tier

    # Pitch always gets free models regardless of tier.
    assert models_for_tier("pitch", "pro") == ["perplexity", "gemini"]
    # Standard brand on no subscription gets free models.
    assert models_for_tier("standard", None) == ["perplexity", "gemini"]
    # Standard brand on basic gets paid non-pro list (no Claude).
    assert models_for_tier("standard", "basic") == ["chatgpt", "perplexity", "gemini"]
    # Standard brand on pro gets all 4.
    assert models_for_tier("standard", "pro") == ["chatgpt", "claude", "perplexity", "gemini"]


def test_runs_per_prompt_for_brand():
    """Agency = 5 runs/prompt, all others = 3."""
    from app.services.llm_service import runs_per_prompt_for_brand

    assert runs_per_prompt_for_brand("agency") == 5
    assert runs_per_prompt_for_brand("standard") == 3
    assert runs_per_prompt_for_brand("pitch") == 3


def test_is_pro_for_brand():
    """Agency is always Pro; standard depends on subscription tier."""
    from app.services.llm_service import is_pro_for_brand

    # Agency: always Pro regardless of tier.
    assert is_pro_for_brand("agency", None) is True
    assert is_pro_for_brand("agency", "basic") is True
    assert is_pro_for_brand("agency", "pro") is True
    # Standard: follows subscription.
    assert is_pro_for_brand("standard", None) is False
    assert is_pro_for_brand("standard", "basic") is True   # is_paid_tier == True for basic+
    assert is_pro_for_brand("standard", "pro") is True
    # Pitch: never Pro.
    assert is_pro_for_brand("pitch", "pro") is False
