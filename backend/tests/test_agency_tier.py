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


# ── End-to-end: tracking run on an agency brand ──────────────────────────────


@pytest.mark.asyncio
async def test_agency_tracking_run_uses_4_models_and_5_runs(client, monkeypatch):
    """A tracking run on an agency brand produces 4 models × 5 runs × N prompts QueryResults,
    and query_model is called with pro=True for every query."""
    from app.database import AsyncSessionLocal
    from app.models import AgencyClient, Brand, Prompt, QueryResult, TrackingRun, User
    from sqlalchemy import select

    # Stub query_model so we don't hit real LLM APIs.
    captured_calls: list[dict] = []

    async def fake_query_model(model, prompt, brand_name, *, pro: bool = False, brand_type: str = "standard", cancel_event=None):
        captured_calls.append({"model": model, "pro": pro})
        return {
            "response_text": f"sample response mentioning {brand_name}",
            "mentioned": True,
            "latency_ms": 1,
            "error": None,
        }

    monkeypatch.setattr("app.services.tracking_service.query_model", fake_query_model)

    # Seed: an admin user + agency client + agency brand + 2 prompts (no HTTP needed).
    async with AsyncSessionLocal() as db:
        user = User(email="admin-int@example.com", password_hash="x", name="A",
                    email_verified=True, is_admin=True, is_agency_staff=True)
        db.add(user); await db.flush()
        agency_client = AgencyClient(name="IntegrationCo", slug="integration-co", status="active")
        db.add(agency_client); await db.flush()
        brand = Brand(
            name="IntegrationCo Brand",
            slug=f"agency-integration-co",
            user_id=user.id,
            agency_client_id=agency_client.id,
            brand_type="agency",
            website_url="https://integration.example",
        )
        db.add(brand); await db.flush()
        db.add(Prompt(brand_id=brand.id, text="Prompt one?", prompt_type="standard"))
        db.add(Prompt(brand_id=brand.id, text="Prompt two?", prompt_type="standard"))
        await db.commit()
        brand_id = brand.id

    from app.services.tracking_service import run_tracking

    run_id = await run_tracking(brand_id=brand_id, run_type="manual", schedule_slot=None)
    assert run_id is not None

    async with AsyncSessionLocal() as db:
        run = (await db.execute(select(TrackingRun).where(TrackingRun.id == run_id))).scalar_one()
        assert run.status == "completed"
        rows = (await db.execute(select(QueryResult).where(QueryResult.tracking_run_id == run_id))).scalars().all()

    # 2 prompts × 4 models × 5 runs = 40 QueryResult rows.
    assert len(rows) == 40, f"Expected 40 query results, got {len(rows)}"
    models_seen = {r.model for r in rows}
    assert models_seen == {"chatgpt", "claude", "perplexity", "gemini"}
    # Every call should have used pro=True.
    assert all(c["pro"] is True for c in captured_calls), (
        f"Expected pro=True on every call, got {[c for c in captured_calls if not c['pro']]}"
    )


def test_max_attempts_for_agency_vs_standard():
    """Agency brands get higher per-call retry budgets than standard brands."""
    from app.services.llm_service import max_attempts_for

    # Agency budgets are strictly higher than standard for the three rate-limited models.
    assert max_attempts_for("claude", "agency") > max_attempts_for("claude", "standard")
    assert max_attempts_for("perplexity", "agency") > max_attempts_for("perplexity", "standard")
    assert max_attempts_for("gemini", "agency") > max_attempts_for("gemini", "standard")
    # Specific values (locks in the contract documented in llm_service):
    assert max_attempts_for("claude", "agency") == 9
    assert max_attempts_for("perplexity", "agency") == 7
    assert max_attempts_for("gemini", "agency") == 7
    # Unknown model falls back to the default for that brand_type.
    assert max_attempts_for("unknown-model", "agency") == 5
    assert max_attempts_for("unknown-model", "standard") == 3
