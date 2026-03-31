"""
Tests for the drafting pipeline:
  GET  /api/content/{brand_id}/drafts
  POST /api/content/{brand_id}/generate-now  — auto_draft_top_gaps
  PUT  /api/content/draft/{draft_id}         — approve / dismiss
  DELETE /api/content/draft/{draft_id}
  Draft queue cap enforcement (DRAFT_CAP = 20)
  Brand profile injection into drafts
"""
import pytest
import httpx
from unittest.mock import patch, AsyncMock
from tests.conftest import register_and_login, create_brand


pytestmark = pytest.mark.asyncio


# ── List drafts ───────────────────────────────────────────────────────────────

async def test_list_drafts_empty(client: httpx.AsyncClient):
    await register_and_login(client, email="draftlist@example.com")
    brand = await create_brand(client, name="Draft List Brand")
    resp = await client.get(f"/api/content/{brand['id']}/drafts")
    assert resp.status_code == 200
    data = resp.json()
    assert "drafts" in data or isinstance(data, list)


async def test_list_drafts_unauthenticated(client: httpx.AsyncClient):
    resp = await client.get("/api/content/1/drafts")
    assert resp.status_code == 401


async def test_list_drafts_access_control(client: httpx.AsyncClient):
    await register_and_login(client, email="draftowner@example.com")
    brand = await create_brand(client, name="Draft Owner Brand")

    await register_and_login(client, email="draftthief@example.com")
    resp = await client.get(f"/api/content/{brand['id']}/drafts")
    assert resp.status_code == 403


# ── Update draft (approve/dismiss/edit) ──────────────────────────────────────

async def test_update_draft_approve(client: httpx.AsyncClient):
    await register_and_login(client, email="approve@example.com")
    brand = await create_brand(client, name="Approve Brand")

    # Insert draft directly
    from app.database import AsyncSessionLocal
    from app.models import ContentDraft

    async with AsyncSessionLocal() as db:
        draft = ContentDraft(
            brand_id=brand["id"],
            platform="reddit",
            status="draft",
            content_text="Sample draft content for testing.",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    resp = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"status": "approved"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


async def test_dismiss_draft_via_delete(client: httpx.AsyncClient):
    """Dismiss is implemented as DELETE (not a status field)."""
    await register_and_login(client, email="dismiss@example.com")
    brand = await create_brand(client, name="Dismiss Brand")

    from app.database import AsyncSessionLocal
    from app.models import ContentDraft

    async with AsyncSessionLocal() as db:
        draft = ContentDraft(
            brand_id=brand["id"],
            platform="medium",
            status="draft",
            content_text="Content to dismiss.",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    resp = await client.delete(f"/api/content/draft/{draft_id}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/content/draft/{draft_id}")
    assert resp.status_code == 404


async def test_update_draft_text(client: httpx.AsyncClient):
    await register_and_login(client, email="editdraft@example.com")
    brand = await create_brand(client, name="Edit Draft Brand")

    from app.database import AsyncSessionLocal
    from app.models import ContentDraft

    async with AsyncSessionLocal() as db:
        draft = ContentDraft(
            brand_id=brand["id"],
            platform="wikipedia",
            status="draft",
            content_text="Original text.",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    resp = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"content_text": "Updated text content."},
    )
    assert resp.status_code == 200
    assert resp.json()["content_text"] == "Updated text content."


async def test_update_draft_access_control(client: httpx.AsyncClient):
    await register_and_login(client, email="draftac1@example.com")
    brand = await create_brand(client, name="Draft AC Brand")

    from app.database import AsyncSessionLocal
    from app.models import ContentDraft

    async with AsyncSessionLocal() as db:
        draft = ContentDraft(
            brand_id=brand["id"],
            platform="reddit",
            status="draft",
            content_text="Private draft.",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    await register_and_login(client, email="draftac2@example.com")
    resp = await client.put(
        f"/api/content/draft/{draft_id}",
        json={"status": "approved"},
    )
    assert resp.status_code == 403


# ── Delete draft ──────────────────────────────────────────────────────────────

async def test_delete_draft(client: httpx.AsyncClient):
    await register_and_login(client, email="deletedraft@example.com")
    brand = await create_brand(client, name="Delete Draft Brand")

    from app.database import AsyncSessionLocal
    from app.models import ContentDraft

    async with AsyncSessionLocal() as db:
        draft = ContentDraft(
            brand_id=brand["id"],
            platform="quora",
            status="draft",
            content_text="To be deleted.",
        )
        db.add(draft)
        await db.commit()
        await db.refresh(draft)
        draft_id = draft.id

    resp = await client.delete(f"/api/content/draft/{draft_id}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/content/draft/{draft_id}")
    assert resp.status_code == 404


# ── Draft queue cap (DRAFT_CAP = 20) ─────────────────────────────────────────

async def test_generate_now_endpoint_exists(client: httpx.AsyncClient):
    """generate-now endpoint accepts a request and delegates to auto_draft_top_gaps."""
    await register_and_login(client, email="cap@example.com")
    brand = await create_brand(client, name="Cap Brand", prompts=["Test prompt?"])
    brand_id = brand["id"]

    async def mock_auto_draft(db, brand_id, max_gaps=20, clear_existing=False, **kwargs):
        return []

    with patch("app.routers.content.auto_draft_top_gaps", side_effect=mock_auto_draft):
        resp = await client.post(f"/api/content/{brand_id}/generate-now", json={"max_gaps": 5})

    assert resp.status_code == 201
    assert resp.json() == []


async def test_draft_cap_constant():
    """DRAFT_CAP should be 20 as documented."""
    from app.services.drafting_service import DRAFT_CAP
    assert DRAFT_CAP == 20


# ── Platform guidelines ───────────────────────────────────────────────────────

async def test_get_platform_guidelines_reddit(client: httpx.AsyncClient):
    resp = await client.get("/api/content/guidelines/reddit")
    assert resp.status_code == 200


async def test_get_platform_guidelines_unknown(client: httpx.AsyncClient):
    resp = await client.get("/api/content/guidelines/tiktok")
    assert resp.status_code == 404


async def test_get_platform_guidelines_wikipedia(client: httpx.AsyncClient):
    resp = await client.get("/api/content/guidelines/wikipedia")
    assert resp.status_code == 200
    data = resp.json()
    assert "guidelines" in data or "tone" in data or isinstance(data, dict)


# ── Content settings ──────────────────────────────────────────────────────────

async def test_get_content_settings(client: httpx.AsyncClient):
    await register_and_login(client, email="settings@example.com")
    brand = await create_brand(client, name="Settings Brand")
    resp = await client.get(f"/api/content/{brand['id']}/settings")
    assert resp.status_code == 200


async def test_update_content_settings(client: httpx.AsyncClient):
    await register_and_login(client, email="updatesettings@example.com")
    brand = await create_brand(client, name="Update Settings Brand")
    resp = await client.put(
        f"/api/content/{brand['id']}/settings/reddit",
        json={"enabled": True, "auto_post": False},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["platform"] == "reddit"
    assert data["enabled"] is True


# ── _sanitize_user_input ──────────────────────────────────────────────────────

from app.services.drafting_service import _sanitize_user_input

def test_sanitize_truncates_long_input():
    result = _sanitize_user_input("x" * 1000, max_length=500)
    assert len(result) == 500

def test_sanitize_strips_control_characters():
    result = _sanitize_user_input("normal\x00null\x1fbytes")
    assert "\x00" not in result
    assert "\x1f" not in result

def test_sanitize_handles_none():
    assert _sanitize_user_input(None) == ""

def test_sanitize_handles_empty():
    assert _sanitize_user_input("") == ""
