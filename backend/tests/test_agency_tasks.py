"""Tests for agency task CRUD + my-queue + staff endpoints."""
from __future__ import annotations

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyStaff, AgencyTask, Brand, ClientActivityEvent, ContentDraft, User
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "tasks@example.com") -> None:
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        existing = (await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()


async def _create_client_via_api(client, name: str = "TaskCo") -> tuple[int, int]:
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


@pytest.mark.asyncio
async def test_create_task_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    resp = await client.post(
        f"/api/agency/clients/{cid}/tasks",
        json={"title": "Call client about LinkedIn", "description": "Schedule for Tuesday"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Call client about LinkedIn"
    assert body["status"] == "open"
    assert body["assigned_to_user_id"] is None
    assert body["created_by_user_id"] is not None

    events = (await db_session.execute(
        select(ClientActivityEvent).where(
            ClientActivityEvent.agency_client_id == cid,
            ClientActivityEvent.event_type == "task_created",
        )
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_update_task_title_no_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "A"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"title": "B"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "B"
    events = (await db_session.execute(
        select(ClientActivityEvent).where(ClientActivityEvent.agency_client_id == cid)
    )).scalars().all()
    event_types = [e.event_type for e in events]
    assert event_types.count("task_created") == 1
    assert "task_assigned" not in event_types
    assert "task_completed" not in event_types


@pytest.mark.asyncio
async def test_assign_task_emits_event(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    me = (await db_session.execute(select(User).where(User.email == "tasks@example.com"))).scalar_one()
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"assigned_to_user_id": me.id})
    assert resp.status_code == 200
    assert resp.json()["assigned_to_user_id"] == me.id
    assert resp.json()["assigned_to_name"] is not None

    events = (await db_session.execute(
        select(ClientActivityEvent).where(ClientActivityEvent.event_type == "task_assigned")
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_complete_task_sets_completed_at(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"status": "done"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert resp.json()["completed_at"] is not None

    events = (await db_session.execute(
        select(ClientActivityEvent).where(ClientActivityEvent.event_type == "task_completed")
    )).scalars().all()
    assert len(events) == 1


@pytest.mark.asyncio
async def test_uncomplete_task_clears_completed_at(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    await client.patch(f"/api/agency/tasks/{tid}", json={"status": "done"})
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"status": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"
    assert resp.json()["completed_at"] is None


@pytest.mark.asyncio
async def test_invalid_status_returns_422(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.patch(f"/api/agency/tasks/{tid}", json={"status": "weird"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_delete_task(client, db_session):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "T"})
    tid = post.json()["id"]
    resp = await client.delete(f"/api/agency/tasks/{tid}")
    assert resp.status_code == 204
    refreshed = await db_session.get(AgencyTask, tid)
    assert refreshed is None


@pytest.mark.asyncio
async def test_my_queue_returns_drafts_and_tasks(client, db_session):
    await _make_agency_user(client)
    me = (await db_session.execute(select(User).where(User.email == "tasks@example.com"))).scalar_one()
    cid, brand_id = await _create_client_via_api(client)

    post = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "Mine"})
    await client.patch(f"/api/agency/tasks/{post.json()['id']}", json={"assigned_to_user_id": me.id})
    await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "Not mine"})

    draft = ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="draft", title="Mine draft", assigned_to_user_id=me.id)
    db_session.add(draft)
    db_session.add(ContentDraft(brand_id=brand_id, platform="medium", content_text="x", status="posted", title="Posted", assigned_to_user_id=me.id))
    await db_session.commit()

    resp = await client.get("/api/agency/my-queue")
    assert resp.status_code == 200
    body = resp.json()
    assert [t["title"] for t in body["tasks"]] == ["Mine"]
    assert [d["title"] for d in body["drafts"]] == ["Mine draft"]


@pytest.mark.asyncio
async def test_staff_returns_active_agency_users(client):
    await _make_agency_user(client, email="staff1@example.com")
    resp = await client.get("/api/agency/staff")
    assert resp.status_code == 200
    users = resp.json()
    assert any(u["email"] == "staff1@example.com" for u in users)


@pytest.mark.asyncio
async def test_list_tasks_filters_by_status(client):
    await _make_agency_user(client)
    cid, _ = await _create_client_via_api(client)
    await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "A"})
    second = await client.post(f"/api/agency/clients/{cid}/tasks", json={"title": "B"})
    await client.patch(f"/api/agency/tasks/{second.json()['id']}", json={"status": "done"})

    open_only = await client.get(f"/api/agency/clients/{cid}/tasks?status=open")
    assert [t["title"] for t in open_only.json()] == ["A"]

    done_only = await client.get(f"/api/agency/clients/{cid}/tasks?status=done")
    assert [t["title"] for t in done_only.json()] == ["B"]
