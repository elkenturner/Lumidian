"""Router endpoints — auth, multi-tenancy, basic state transitions."""
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import User
from tests.conftest import register_and_login


async def _make_staff(client: httpx.AsyncClient, email: str = "staff1@example.com") -> None:
    """Register (or re-login) the given email AND promote to agency staff.
    Cookies are set on the client; no headers needed.

    Safe to call multiple times with the same email within one test — will
    skip registration and just login if the account already exists.
    """
    from tests.conftest import login_user, register_user

    client.cookies.clear()

    # Try to register; if the account already exists (409) just skip.
    resp = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "Password123", "name": "Staff User"},
    )
    if resp.status_code == 201:
        # New account — mark email verified + grant tier so login works.
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            await db.execute(
                text("UPDATE users SET email_verified = 1, subscription_tier = 'starter' WHERE email = :e"),
                {"e": email},
            )
            await db.commit()

    await login_user(client, email=email)

    # Ensure is_agency_staff is set (idempotent).
    async with AsyncSessionLocal() as db:
        u = (await db.execute(select(User).where(User.email == email))).scalar_one()
        u.is_agency_staff = True
        await db.commit()


@pytest.mark.asyncio
async def test_post_creates_audit_and_schedules_task(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit") as mock_run:
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["id"]
    mock_run.assert_called_once_with(body["id"])


@pytest.mark.asyncio
async def test_post_stores_staff_selected_prompts(client: httpx.AsyncClient):
    await _make_staff(client)
    chosen = ["Best dentist in Austin?", "implant cost in austin"]  # 2nd missing "?" → coerced
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False, "prompts": chosen},
        )
    assert resp.status_code == 201, resp.text
    audit_id = resp.json()["id"]

    from app.models import ProspectAudit
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        assert a.prompts == ["Best dentist in Austin?", "implant cost in austin?"]


@pytest.mark.asyncio
async def test_post_rejects_empty_prompts_list(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False, "prompts": ["   ", ""]},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_suggest_prompts_returns_list(client: httpx.AsyncClient):
    from unittest.mock import AsyncMock

    await _make_staff(client)
    fake = [f"Question {i}?" for i in range(10)]
    with patch("app.routers.prospect_audit._scrape_homepage", new=AsyncMock(return_value="excerpt")), \
         patch("app.routers.prospect_audit.generate_prompts", new=AsyncMock(return_value=fake)):
        resp = await client.post(
            "/api/agency/prospects/suggest-prompts",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["prompts"] == fake


@pytest.mark.asyncio
async def test_suggest_prompts_blocks_non_staff(client: httpx.AsyncClient):
    client.cookies.clear()
    await register_and_login(client, email="regular-suggest@example.com")
    resp = await client.post(
        "/api/agency/prospects/suggest-prompts",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_post_requires_location_when_local(client: httpx.AsyncClient):
    await _make_staff(client)
    resp = await client.post(
        "/api/agency/prospects",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": True},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_post_blocks_non_staff(client: httpx.AsyncClient):
    client.cookies.clear()
    await register_and_login(client, email="regular@example.com")
    resp = await client.post(
        "/api/agency/prospects",
        json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_returns_only_callers_audits(client: httpx.AsyncClient):
    await _make_staff(client, email="s1@example.com")
    with patch("app.routers.prospect_audit.run_audit"):
        await client.post("/api/agency/prospects", json={"business_name": "A", "website_url": "https://a.com", "is_local": False})

    # Switch to a second staff user
    await _make_staff(client, email="s2@example.com")
    with patch("app.routers.prospect_audit.run_audit"):
        await client.post("/api/agency/prospects", json={"business_name": "B", "website_url": "https://b.com", "is_local": False})

    # User s2's list should only show their own audit
    list2 = await client.get("/api/agency/prospects")
    assert list2.status_code == 200
    items2 = list2.json()
    assert len(items2) == 1
    assert items2[0]["business_name"] == "B"

    # Switch back to s1 and check theirs (already registered — just re-login)
    await _make_staff(client, email="s1@example.com")
    list1 = await client.get("/api/agency/prospects")
    assert list1.status_code == 200
    items1 = list1.json()
    assert len(items1) == 1
    assert items1[0]["business_name"] == "A"


@pytest.mark.asyncio
async def test_get_single_audit(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        post_resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = post_resp.json()["id"]
    detail = await client.get(f"/api/agency/prospects/{audit_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["business_name"] == "Acme"
    assert body["status"] == "pending"
    assert "has_pdf" in body


@pytest.mark.asyncio
async def test_get_404_when_not_owner(client: httpx.AsyncClient):
    await _make_staff(client, email="s1@example.com")
    with patch("app.routers.prospect_audit.run_audit"):
        post_resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = post_resp.json()["id"]

    # Switch to staff #2
    await _make_staff(client, email="s2@example.com")
    resp = await client.get(f"/api/agency/prospects/{audit_id}")
    assert resp.status_code == 404


# ── Task 14: cancel / retry / delete / pdf endpoints ─────────────────────────


@pytest.mark.asyncio
async def test_cancel_sets_event_and_db_flag(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = resp.json()["id"]

    import asyncio
    from app.state import prospect_audit_cancel_events
    prospect_audit_cancel_events[audit_id] = asyncio.Event()

    cancel = await client.post(f"/api/agency/prospects/{audit_id}/cancel")
    assert cancel.status_code == 204
    assert prospect_audit_cancel_events[audit_id].is_set()

    detail = await client.get(f"/api/agency/prospects/{audit_id}")
    assert detail.json()["cancel_requested"] is True


@pytest.mark.asyncio
async def test_retry_409_when_non_terminal(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = resp.json()["id"]
    retry = await client.post(f"/api/agency/prospects/{audit_id}/retry")
    assert retry.status_code == 409


@pytest.mark.asyncio
async def test_retry_succeeds_when_failed(client: httpx.AsyncClient, tmp_path):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = resp.json()["id"]

    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit
    from sqlalchemy import select
    stale_pdf = tmp_path / "stale.pdf"
    stale_pdf.write_bytes(b"%PDF stale")
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        a.status = "failed"
        a.error_message = "boom"
        a.pdf_path = str(stale_pdf)
        await db.commit()

    with patch("app.routers.prospect_audit.run_audit") as mock_run:
        retry = await client.post(f"/api/agency/prospects/{audit_id}/retry")
    assert retry.status_code == 200, retry.text
    body = retry.json()
    assert body["status"] == "pending"
    assert body["error_message"] is None
    assert not stale_pdf.exists()
    mock_run.assert_called_once_with(audit_id)


@pytest.mark.asyncio
async def test_delete_removes_row_and_pdf(client: httpx.AsyncClient, tmp_path):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = resp.json()["id"]

    pdf_file = tmp_path / "del.pdf"
    pdf_file.write_bytes(b"%PDF")
    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        a.pdf_path = str(pdf_file)
        await db.commit()

    del_resp = await client.delete(f"/api/agency/prospects/{audit_id}")
    assert del_resp.status_code == 204
    assert not pdf_file.exists()

    after = await client.get(f"/api/agency/prospects/{audit_id}")
    assert after.status_code == 404


@pytest.mark.asyncio
async def test_pdf_returns_404_when_not_completed(client: httpx.AsyncClient):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = resp.json()["id"]
    pdf = await client.get(f"/api/agency/prospects/{audit_id}/pdf")
    assert pdf.status_code == 404


@pytest.mark.asyncio
async def test_pdf_streams_when_completed(client: httpx.AsyncClient, tmp_path):
    await _make_staff(client)
    with patch("app.routers.prospect_audit.run_audit"):
        resp = await client.post(
            "/api/agency/prospects",
            json={"business_name": "Acme", "website_url": "https://acme.com", "is_local": False},
        )
    audit_id = resp.json()["id"]

    pdf_bytes = b"%PDF-1.4\nfake"
    pdf_file = tmp_path / "stream.pdf"
    pdf_file.write_bytes(pdf_bytes)
    from app.database import AsyncSessionLocal
    from app.models import ProspectAudit
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        a = (await db.execute(select(ProspectAudit).where(ProspectAudit.id == audit_id))).scalar_one()
        a.status = "completed"
        a.pdf_path = str(pdf_file)
        await db.commit()

    pdf = await client.get(f"/api/agency/prospects/{audit_id}/pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert "attachment" in pdf.headers["content-disposition"].lower()
    assert pdf.content == pdf_bytes
