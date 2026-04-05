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
# Prevent auto-seeding admin user during tests (no ADMIN_PASSWORD set)

# App imports after env vars are configured
from app.database import AsyncSessionLocal, Base, engine
from app.main import app

# ── Database setup ────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_test_db():
    """Create all tables once for the test session."""
    async with engine.begin() as conn:
        import app.models  # noqa: F401 — registers models
        await conn.run_sync(Base.metadata.create_all)
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
    # Reset in-memory rate limiters so tests don't affect each other
    from app.dependencies import _rate_store
    _rate_store.clear()
    from app.routers.auth import _login_attempts, _register_attempts, _resend_attempts, _totp_setup_attempts
    _login_attempts.clear()
    _register_attempts.clear()
    _totp_setup_attempts.clear()
    _resend_attempts.clear()
    # Reset shared background-task state sets
    from app import state
    state.generating_brands.clear()
    state.scanning_brands.clear()

    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        # Order matters for FK constraints
        for table in [
            "analytics_events", "content_attribution", "content_posts",
            "content_drafts", "content_gaps", "content_opportunities",
            "run_model_scores", "query_results", "tracking_runs",
            "competitors", "prompts", "brand_profiles",
            "brand_content_settings", "account_connections",
            "system_settings", "brands", "users",
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
        # Mock email background sender to prevent dangling async tasks
        patch("app.services.email_service.send_email_background"),
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
    password: str = "password123",
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
    password: str = "password123",
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
    password: str = "password123",
    subscription_tier: str = "starter",
) -> None:
    """Register + login in one call — sets cookies on the client.

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
