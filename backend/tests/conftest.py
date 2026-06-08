"""
Shared pytest fixtures for Lumidian backend tests.

Env vars are set BEFORE any app module is imported so that:
  - app.database creates its engine pointing at the test DB
  - app.dependencies reads the correct JWT_SECRET
"""
from __future__ import annotations

import os
import tempfile
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import pytest_asyncio

# ── Must come before all app imports ─────────────────────────────────────────
_db_fd, _db_path = tempfile.mkstemp(suffix=".test.db")
os.close(_db_fd)

os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_db_path}")
os.environ["JWT_SECRET"] = "test-jwt-secret-minimum-32-chars-lumidian-test"
os.environ["ENVIRONMENT"] = "development"
os.environ["ADMIN_EMAILS"] = "admin@test.com"
os.environ["STRIPE_SECRET_KEY"] = "sk_test_placeholder"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test_placeholder"
# Force email service into console-mode so tests never call the real Resend API.
# Without this, every test that registers a user blocks ~5s on a real HTTPS call
# (and sends real verification emails to fake test addresses).
os.environ["RESEND_API_KEY"] = ""
os.environ["SMTP_PASS"] = ""
# Prevent auto-seeding admin user during tests (no ADMIN_PASSWORD set)

# App imports after env vars are configured
from app.database import AsyncSessionLocal, Base, engine
from app.main import app

# Force SQLite into WAL mode for tests. WAL lets readers coexist with writers,
# which eliminates the reader-writer lock contention between fire-and-forget
# background tasks (scanners, drafters) and the cleanup fixture's truncates.
from sqlalchemy import event as _sa_event

@_sa_event.listens_for(engine.sync_engine, "connect")
def _set_test_pragmas(dbapi_conn, _connection_record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()

# ── Database setup ────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_test_db():
    """Create all tables once for the test session."""
    async with engine.begin() as conn:
        import app.models  # noqa: F401 — registers models
        await conn.run_sync(Base.metadata.create_all)
    # Apply raw-SQL migrations (e.g. rate_limits, processed_webhook_events)
    from app.database import run_migrations
    await run_migrations()
    yield
    await engine.dispose()
    try:
        os.unlink(_db_path)
    except OSError:
        pass


@pytest_asyncio.fixture(autouse=True)
async def clean_tables():
    """Truncate all data-bearing tables and reset rate store between tests."""
    yield
    # Cancel any fire-and-forget tasks the test spawned (scanners, draft generators,
    # tracking runs, etc.) before truncating tables. Otherwise their in-flight
    # writes contend with our DELETEs and hit SQLite's busy_timeout.
    import asyncio
    current = asyncio.current_task()
    pending = [t for t in asyncio.all_tasks() if t is not current and not t.done()]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)

    # Reset in-memory rate limiters so tests don't affect each other
    from app.dependencies import _rate_store
    _rate_store.clear()
    from app.routers.auth import (
        _login_attempts,
        _register_attempts,
        _resend_attempts,
        _reset_attempts,
        _totp_setup_attempts,
        _verify_attempts,
    )
    _login_attempts.clear()
    _register_attempts.clear()
    _totp_setup_attempts.clear()
    _resend_attempts.clear()
    _verify_attempts.clear()
    _reset_attempts.clear()
    # Reset shared background-task state sets
    from app import state
    state.generating_brands.clear()
    state.scanning_brands.clear()

    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        # Order matters for FK constraints
        for table in [
            "prompt_run_scores", "content_events",
            "analytics_events", "draft_attributions", "content_attribution", "content_posts",
            "content_drafts", "content_clusters", "content_briefs", "content_gaps", "content_opportunities",
            "competitor_mentions", "run_model_scores", "query_results", "tracking_runs",
            "citation_sources",
            "website_audit_recommendations",
            "website_audit_findings",
            "website_audit_pages",
            "website_audits",
            "competitors", "prompts", "brand_profiles",
            "brand_content_settings", "account_connections",
            "notifications", "team_members", "password_reset_tokens",
            "agency_client_milestones",
            "client_documents", "client_activity_events", "client_review_links", "agency_tasks", "agency_client_assignments", "agency_staff",
            "prospect_audits",
            "system_settings", "brands", "agency_clients", "users",
            "rate_limits",
        ]:
            await db.execute(text(f"DELETE FROM {table}"))
        await db.commit()


# ── DB session fixture ───────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def db_session():
    """Yield an async DB session for direct database inspection in tests."""
    async with AsyncSessionLocal() as session:
        yield session


# ── HTTP client ───────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client():
    """Async HTTP test client with scheduler and email mocked out."""
    with (
        patch("app.scheduler.start_scheduler"),
        patch("app.scheduler.stop_scheduler"),
        patch(
            "app.services.auth_seeder.seed_admin_user",
            new_callable=lambda: lambda: AsyncMock(return_value=None),
        ),
        # Mock email senders to prevent dangling async tasks AND real outbound HTTP.
        # send_email_awaited is used for blocking sends (registration verification, password
        # reset) — left unmocked, it would call the Resend API and tie each test up for ~5s.
        patch("app.services.email_service.send_email_background"),
        patch("app.services.email_service.send_email_awaited", new=AsyncMock(return_value=True)),
        # log_event opens its own session and contends with the request's session
        # for the SQLite write lock. With the default 5s busy_timeout this adds
        # ~5s to every endpoint that logs an analytics event. Skip it in tests.
        patch("app.services.analytics_service.log_event", new=AsyncMock(return_value=None)),
    ):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            yield ac


# ── Auth helpers ──────────────────────────────────────────────────────────────

async def register_user(
    client: httpx.AsyncClient,
    email: str = "user@example.com",
    password: str = "Password123",
    name: str = "Test User",
) -> dict:
    resp = await client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def login_user(
    client: httpx.AsyncClient,
    email: str = "user@example.com",
    password: str = "Password123",
) -> httpx.Cookies:
    resp = await client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert resp.status_code == 200, resp.text
    return resp.cookies


async def register_and_login(
    client: httpx.AsyncClient,
    email: str = "user@example.com",
    password: str = "Password123",
    subscription_tier: str = "starter",
) -> None:
    """Register + verify + login in one call — sets cookies on the client.

    Grants 'starter' subscription by default so brand/prompt creation works.
    Pass subscription_tier=None to test free-tier limits.
    """
    await register_user(client, email, password)
    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        updates = "email_verified = 1"
        params: dict = {"email": email}
        if subscription_tier:
            updates += ", subscription_tier = :tier"
            params["tier"] = subscription_tier
        await db.execute(
            text(f"UPDATE users SET {updates} WHERE email = :email"),
            params,
        )
        await db.commit()
    await login_user(client, email, password)


async def create_brand(
    client: httpx.AsyncClient,
    name: str = "Test Brand",
    prompts: list | None = None,
) -> dict:
    resp = await client.post(
        "/api/brands",
        json={
            "name": name,
            "tier": "basic",
            "website_url": "https://example.com",
            "prompts": prompts or ["What are the best tools for X?"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _seed_minimal_user_brand_prompt(db, *, slug: str) -> tuple[int, int]:
    """Create one user → brand → prompt → empty cluster and return
    (cluster_id, prompt_id). Use only inside async tests that hold an
    AsyncSessionLocal session."""
    from app.models import Brand, ContentCluster, Prompt, User
    user = User(email=f"{slug}@p.com", password_hash="x", name="t")
    db.add(user); await db.flush()
    brand = Brand(name="B", slug=slug, user_id=user.id)
    db.add(brand); await db.flush()
    prompt = Prompt(brand_id=brand.id, text="best CRM")
    db.add(prompt); await db.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="pending")
    db.add(cluster); await db.commit(); await db.refresh(cluster)
    return cluster.id, prompt.id


class _TmpDb:
    """Minimal async helper for reddit scanner integration tests."""

    async def create_brand_with_prompt(self, name: str, prompt: str) -> int:
        import secrets

        from app.models import Brand, Prompt, User
        async with AsyncSessionLocal() as session:
            user = User(
                email=f"test_{secrets.token_hex(4)}@example.com",
                password_hash="x",
                email_verified=1,
            )
            session.add(user)
            await session.flush()
            brand = Brand(name=name, slug=f"{name.lower()}-{secrets.token_hex(4)}", user_id=user.id)
            session.add(brand)
            await session.flush()
            p = Prompt(brand_id=brand.id, text=prompt)
            session.add(p)
            await session.commit()
            return brand.id


@pytest.fixture
def tmp_db():
    return _TmpDb()


async def factory_agency_client_full(
    db,
    creator_user_id: int,
    *,
    brand_name: str = "Test Brand",
    website_url: str = "https://example.com",
    company_description: str = "Test company description",
) -> tuple[int, int]:
    """Create an AgencyClient + Brand + BrandProfile linked together.

    Returns (agency_client_id, brand_id). All required fields populated so
    REQUIRED_FIELDS preflight passes.
    """
    import secrets as _secrets
    from app.models import AgencyClient, Brand, BrandProfile
    slug = brand_name.lower().replace(" ", "-") + "-" + _secrets.token_hex(4)
    agency_client = AgencyClient(
        name=brand_name,
        slug=slug,
        status="active",
    )
    db.add(agency_client)
    await db.flush()

    brand = Brand(
        user_id=creator_user_id,
        name=brand_name,
        slug=f"{slug}-brand",
        website_url=website_url,
        brand_type="standard",
        agency_client_id=agency_client.id,
    )
    db.add(brand)
    await db.flush()

    profile = BrandProfile(
        brand_id=brand.id,
        company_description=company_description,
    )
    db.add(profile)
    await db.commit()
    return agency_client.id, brand.id


async def factory_agency_client_only(db, creator_user_id: int) -> int:
    """Create a bare AgencyClient with no Brand/BrandProfile attached.

    Used to test missing-data preflight failures.
    """
    import secrets as _secrets
    from app.models import AgencyClient
    agency_client = AgencyClient(
        name="Bare client",
        slug="bare-client-" + _secrets.token_hex(4),
        status="active",
    )
    db.add(agency_client)
    await db.commit()
    return agency_client.id
