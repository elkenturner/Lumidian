"""Tests for the client portal (read-only token-gated mirror of SaaS surfaces)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClient, User


async def _make_agency_user(client, email: str = "staff@example.com") -> None:
    """Register/verify/login + flip is_agency_staff."""
    from tests.conftest import register_and_login
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User).where(User.email == email).values(is_agency_staff=True)
        )
        await db.commit()


@pytest_asyncio.fixture
async def agency_staff_user(client):
    """Log in as an agency staff user; return the httpx client (with cookies set)."""
    await _make_agency_user(client, email="staff@example.com")
    return client


@pytest.mark.asyncio
async def test_agency_client_has_proposal_columns(db_session):
    """AgencyClient table has current_proposal_doc_url and current_proposal_label columns."""
    ac = AgencyClient(
        name="Acme Inc",
        slug="acme-inc",
        status="active",
        current_proposal_doc_url="https://docs.google.com/document/d/abc",
        current_proposal_label="Week of May 22 — 5 pieces",
    )
    db_session.add(ac)
    await db_session.commit()
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc"
    assert ac.current_proposal_label == "Week of May 22 — 5 pieces"


@pytest.mark.asyncio
async def test_staff_can_set_proposal_pointer(client, db_session, agency_staff_user):
    """PATCH /api/agency/clients/{id}/proposal updates the doc_url + label."""
    # Create client (auto-assigns creator)
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    assert resp.status_code == 201
    client_id = resp.json()["id"]

    # Patch proposal pointer
    resp = await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={
            "current_proposal_doc_url": "https://docs.google.com/document/d/abc123",
            "current_proposal_label": "Week of May 22 — 5 pieces",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["current_proposal_doc_url"] == "https://docs.google.com/document/d/abc123"
    assert body["current_proposal_label"] == "Week of May 22 — 5 pieces"

    # Verify persisted
    ac = await db_session.get(AgencyClient, client_id)
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc123"


@pytest.mark.asyncio
async def test_staff_can_clear_proposal_pointer(client, db_session, agency_staff_user):
    """PATCH with null values clears the proposal pointer."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    client_id = resp.json()["id"]
    await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={"current_proposal_doc_url": "https://docs.google.com/document/d/abc", "current_proposal_label": "Test"},
    )
    # Clear
    resp = await client.patch(
        f"/api/agency/clients/{client_id}/proposal",
        json={"current_proposal_doc_url": None, "current_proposal_label": None},
    )
    assert resp.status_code == 200
    assert resp.json()["current_proposal_doc_url"] is None
    assert resp.json()["current_proposal_label"] is None

    # Verify the clear persisted to the DB
    ac = await db_session.get(AgencyClient, client_id)
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url is None
    assert ac.current_proposal_label is None


@pytest.mark.asyncio
async def test_review_link_emits_client_url(client, agency_staff_user):
    """POST /api/agency/clients/{id}/review-link returns a /client/{token} URL."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    client_id = resp.json()["id"]

    resp = await client.post(f"/api/agency/clients/{client_id}/review-link")
    assert resp.status_code == 201
    url = resp.json()["url"]
    assert "/client/" in url, f"Expected /client/ in URL, got {url}"
    assert "/review/" not in url, f"URL should not contain /review/ anymore: {url}"


@pytest.mark.asyncio
async def test_client_view_context_resolves_valid_token(client, agency_staff_user):
    """A valid token resolves to the right AgencyClient + Brand.

    Task 4 ships the dep but no route uses it yet, so the request 404s.
    Task 5 mounts /api/public/client/{token}/brand and this test starts passing.
    The strict xfail will then flip to XPASS, signaling: remove the marker.
    """
    # Create client and get token
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id


@pytest.mark.asyncio
async def test_client_view_context_rejects_unknown_token(client):
    """Unknown tokens return 404.

    Currently passes because the route is not yet mounted (Task 5 lands it);
    after Task 5 it will pass for the right reason — the dep itself raises 404.
    """
    resp = await client.get("/api/public/client/notatoken/brand")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_client_view_context_rejects_revoked_token(client, db_session, agency_staff_user):
    """Revoked review-link tokens return 404.

    Currently passes for the wrong reason (route not mounted); after Task 5
    the dep's revoked-link branch will trigger the 404 instead.
    """
    from app.models import ClientReviewLink
    from datetime import datetime

    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    # Revoke the link directly in the DB
    link_q = await db_session.execute(select(ClientReviewLink).where(ClientReviewLink.token == token))
    link = link_q.scalar_one()
    link.revoked_at = datetime.utcnow()
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_client_portal_brand_returns_brand_summary(client, agency_staff_user):
    """GET /api/public/client/{token}/brand returns brand id, name, slug, type."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme Inc"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/brand")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == brand_id
    assert body["name"] == "Acme Inc"
    assert body["brand_type"] == "agency"


@pytest.mark.asyncio
async def test_client_portal_proposal_returns_pointer(client, agency_staff_user):
    """GET /api/public/client/{token}/proposal returns current proposal fields."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    await client.patch(
        f"/api/agency/clients/{ac_id}/proposal",
        json={"current_proposal_doc_url": "https://docs.google.com/document/d/abc", "current_proposal_label": "Week of May 22"},
    )
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_url"] == "https://docs.google.com/document/d/abc"
    assert body["label"] == "Week of May 22"


@pytest.mark.asyncio
async def test_client_portal_proposal_null_when_unset(client, agency_staff_user):
    """If proposal not set, endpoint returns nulls (not 404)."""
    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]

    resp = await client.get(f"/api/public/client/{token}/proposal")
    assert resp.status_code == 200
    body = resp.json()
    assert body["doc_url"] is None
    assert body["label"] is None


@pytest_asyncio.fixture
async def agency_brand_with_run(client, db_session, agency_staff_user):
    """Create an agency client + completed tracking run + return (ac_id, brand_id, token)."""
    from datetime import datetime
    from app.models import TrackingRun

    resp = await client.post("/api/agency/clients", json={"name": "Acme"})
    ac_id = resp.json()["id"]
    brand_id = resp.json()["brand_id"]

    # Insert a completed run directly
    run = TrackingRun(
        brand_id=brand_id,
        status="completed",
        run_type="manual",
        overall_score=42.0,
        total_queries=10,
        total_mentions=4,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db_session.add(run)
    await db_session.commit()

    resp = await client.post(f"/api/agency/clients/{ac_id}/review-link")
    token = resp.json()["token"]
    return ac_id, brand_id, token


@pytest.mark.asyncio
async def test_client_portal_dashboard_returns_overview(client, agency_brand_with_run):
    """GET /api/public/client/{token}/dashboard returns visibility overview."""
    ac_id, _brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/dashboard")
    assert resp.status_code == 200
    body = resp.json()
    assert "overall_score" in body
    assert "total_runs" in body


@pytest.mark.asyncio
async def test_client_portal_runs_returns_recent_runs(client, agency_brand_with_run):
    """GET /api/public/client/{token}/runs returns the run list."""
    ac_id, brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/runs")
    assert resp.status_code == 200
    runs = resp.json()
    assert isinstance(runs, list)
    assert len(runs) >= 1
    assert all(r.get("brand_id") == brand_id for r in runs)


@pytest.mark.asyncio
async def test_client_portal_responses_returns_transcripts(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/responses returns raw LLM transcripts for the latest run."""
    from app.models import QueryResult, Prompt, TrackingRun
    from sqlalchemy import select

    ac_id, brand_id, token = agency_brand_with_run

    # Add a prompt and a query result
    prompt = Prompt(brand_id=brand_id, text="best CRM for startups")
    db_session.add(prompt)
    await db_session.commit()
    await db_session.refresh(prompt)

    run_q = await db_session.execute(select(TrackingRun).where(TrackingRun.brand_id == brand_id).limit(1))
    run = run_q.scalar_one()

    qr = QueryResult(
        tracking_run_id=run.id,
        prompt_id=prompt.id,
        model="chatgpt",
        run_number=1,
        response_text="Acme is the best CRM for startups.",
        mentioned=True,
    )
    db_session.add(qr)
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/responses")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert any(r.get("response_text") == "Acme is the best CRM for startups." for r in rows)


@pytest.mark.asyncio
async def test_client_portal_competitors_returns_list(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/competitors returns competitor list."""
    from app.models import Competitor

    ac_id, brand_id, token = agency_brand_with_run
    db_session.add(Competitor(brand_id=brand_id, name="Salesforce", website_url="https://salesforce.com"))
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/competitors")
    assert resp.status_code == 200
    competitors = resp.json()
    assert any(c["name"] == "Salesforce" for c in competitors)


@pytest.mark.asyncio
async def test_client_portal_posted_content_excludes_in_progress(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/content returns ONLY posted drafts (status='posted')."""
    from app.models import ContentDraft, Prompt
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    prompt = Prompt(brand_id=brand_id, text="best CRM")
    db_session.add(prompt)
    await db_session.commit()
    await db_session.refresh(prompt)

    posted = ContentDraft(brand_id=brand_id, prompt_id=prompt.id, platform="linkedin", status="posted", title="Posted piece", content_text="...", posted_at=datetime.utcnow())
    in_progress = ContentDraft(brand_id=brand_id, prompt_id=prompt.id, platform="linkedin", status="awaiting_client", title="In progress", content_text="...")
    db_session.add_all([posted, in_progress])
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/content")
    assert resp.status_code == 200
    drafts = resp.json()
    titles = [d["title"] for d in drafts]
    assert "Posted piece" in titles
    assert "In progress" not in titles


@pytest.mark.asyncio
async def test_client_portal_site_audit_returns_latest(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/site-audit returns the latest audit + findings."""
    from app.models import WebsiteAudit
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    audit = WebsiteAudit(brand_id=brand_id, status="completed", overall_score=72.0, started_at=datetime.utcnow(), completed_at=datetime.utcnow())
    db_session.add(audit)
    await db_session.commit()
    await db_session.refresh(audit)

    resp = await client.get(f"/api/public/client/{token}/site-audit")
    assert resp.status_code == 200
    body = resp.json()
    assert body["audit"]["id"] == audit.id
    assert body["audit"]["overall_score"] == 72.0


@pytest.mark.asyncio
async def test_client_portal_site_audit_returns_empty_when_no_audit(client, agency_brand_with_run):
    """GET /api/public/client/{token}/site-audit returns null audit when none exists."""
    ac_id, brand_id, token = agency_brand_with_run

    resp = await client.get(f"/api/public/client/{token}/site-audit")
    assert resp.status_code == 200
    body = resp.json()
    assert body["audit"] is None
    assert body["findings"] == []
    assert body["recommendations"] == []


@pytest.mark.asyncio
async def test_client_portal_clusters_returns_brand_clusters(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/clusters returns this brand's clusters."""
    from app.models import ContentCluster, Prompt

    ac_id, brand_id, token = agency_brand_with_run
    p = Prompt(brand_id=brand_id, text="best CRM")
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    c = ContentCluster(brand_id=brand_id, prompt_id=p.id, status="ready")
    db_session.add(c)
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/clusters")
    assert resp.status_code == 200
    body = resp.json()
    assert any(cl["prompt_id"] == p.id for cl in body)


@pytest.mark.asyncio
async def test_client_portal_wikipedia_candidates_returns_brand_scoped(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/wikipedia returns brand's wikipedia candidates."""
    from app.models import WikipediaCandidate, WikipediaScan
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    scan = WikipediaScan(brand_id=brand_id, status="completed", started_at=datetime.utcnow())
    db_session.add(scan)
    await db_session.commit()
    await db_session.refresh(scan)
    cand = WikipediaCandidate(
        brand_id=brand_id, scan_id=scan.id, article_title="Customer relationship management",
        article_url="https://en.wikipedia.org/wiki/CRM", pageid=12345, status="new",
    )
    db_session.add(cand)
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/wikipedia")
    assert resp.status_code == 200
    candidates = resp.json()
    assert any(c["article_title"] == "Customer relationship management" for c in candidates)


@pytest.mark.asyncio
async def test_client_portal_documents_returns_client_docs(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/documents returns the client's documents."""
    from app.models import ClientDocument
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    doc = ClientDocument(
        agency_client_id=ac_id, kind="agency_weekly_report",
        title="Week of May 22", body_markdown="# Weekly Report\n...",
        generated_at=datetime.utcnow(),
    )
    db_session.add(doc)
    await db_session.commit()

    resp = await client.get(f"/api/public/client/{token}/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert any(d["title"] == "Week of May 22" for d in docs)


@pytest.mark.asyncio
async def test_client_portal_document_detail_returns_body(client, db_session, agency_brand_with_run):
    """GET /api/public/client/{token}/documents/{id} returns body_markdown."""
    from app.models import ClientDocument
    from datetime import datetime

    ac_id, brand_id, token = agency_brand_with_run
    doc = ClientDocument(
        agency_client_id=ac_id, kind="agency_weekly_report",
        title="Week of May 22", body_markdown="# Hello",
        generated_at=datetime.utcnow(),
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    resp = await client.get(f"/api/public/client/{token}/documents/{doc.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["body_markdown"] == "# Hello"


@pytest.mark.asyncio
async def test_client_portal_token_isolated_to_own_brand(client, db_session, agency_staff_user):
    """A token for client A cannot access client B's data (multi-tenancy guard)."""
    from app.models import Competitor

    # Two separate clients
    r1 = await client.post("/api/agency/clients", json={"name": "Acme"})
    a_id = r1.json()["id"]
    a_brand = r1.json()["brand_id"]
    r2 = await client.post("/api/agency/clients", json={"name": "Globex"})
    b_brand = r2.json()["brand_id"]

    # Add a competitor to Acme (brand A)
    db_session.add(Competitor(brand_id=a_brand, name="OnlyOnA"))
    # Add a competitor to Globex (brand B)
    db_session.add(Competitor(brand_id=b_brand, name="OnlyOnB"))
    await db_session.commit()

    # Get token for Acme
    r = await client.post(f"/api/agency/clients/{a_id}/review-link")
    a_token = r.json()["token"]

    # Token A's competitors endpoint should NOT see OnlyOnB
    resp = await client.get(f"/api/public/client/{a_token}/competitors")
    names = [c["name"] for c in resp.json()]
    assert "OnlyOnA" in names
    assert "OnlyOnB" not in names
