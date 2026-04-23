"""Tests for the billing endpoints."""
from unittest.mock import MagicMock, patch

import httpx

from tests.conftest import create_brand, register_and_login


async def test_billing_status_free_tier(client: httpx.AsyncClient):
    """Free-tier user gets correct status response shape."""
    await register_and_login(client, email="billing_status@example.com", subscription_tier=None)
    resp = await client.get("/api/billing/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "subscription_tier" in data
    assert "subscription_status" in data
    assert "prompt_limit" in data
    assert "brand_limits" in data
    assert data["subscription_tier"] is None


async def test_billing_status_starter_tier(client: httpx.AsyncClient):
    """Starter-tier user gets correct prompt_limit."""
    await register_and_login(client, email="billing_starter@example.com", subscription_tier="starter")
    resp = await client.get("/api/billing/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["subscription_tier"] == "starter"
    assert isinstance(data["prompt_limit"], int)
    assert data["prompt_limit"] > 0


async def test_billing_status_requires_auth(client: httpx.AsyncClient):
    """Billing status returns 401 when unauthenticated."""
    resp = await client.get("/api/billing/status")
    assert resp.status_code == 401


async def test_billing_usage_empty(client: httpx.AsyncClient):
    """Usage endpoint returns zero counts for new user with no brands."""
    await register_and_login(client, email="billing_usage@example.com")
    resp = await client.get("/api/billing/usage")
    assert resp.status_code == 200
    data = resp.json()
    assert "manual_runs_today" in data
    assert "prompt_count" in data
    assert "standard_brand_count" in data
    assert data["manual_runs_today"] == 0
    assert data["prompt_count"] == 0
    assert data["standard_brand_count"] == 0


async def test_billing_usage_with_brand(client: httpx.AsyncClient):
    """Usage shows correct brand and prompt counts after creating a brand."""
    await register_and_login(client, email="billing_usage_brand@example.com")
    await create_brand(client, name="UsageBrand", prompts=["prompt one", "prompt two"])
    resp = await client.get("/api/billing/usage")
    assert resp.status_code == 200
    data = resp.json()
    assert data["standard_brand_count"] >= 1
    assert data["prompt_count"] >= 2


async def test_create_checkout_returns_url(client: httpx.AsyncClient):
    """create-checkout returns a Stripe checkout URL when Stripe is mocked."""
    await register_and_login(client, email="billing_checkout@example.com")

    mock_customer = MagicMock()
    mock_customer.id = "cus_test_fake456"

    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_test_fake123"

    with (
        patch("stripe.Customer.create", return_value=mock_customer),
        patch("stripe.checkout.Session.create", return_value=mock_session),
    ):
        # Set a fake price ID so the endpoint doesn't bail on missing config
        with patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter"}):
            resp = await client.post(
                "/api/billing/create-checkout",
                json={"tier": "starter"},
            )

    assert resp.status_code == 200
    data = resp.json()
    assert "checkout_url" in data
    assert data["checkout_url"] == "https://checkout.stripe.com/pay/cs_test_fake123"


async def test_create_checkout_invalid_tier(client: httpx.AsyncClient):
    """create-checkout rejects unknown tier names."""
    await register_and_login(client, email="billing_bad_tier@example.com")
    resp = await client.post(
        "/api/billing/create-checkout",
        json={"tier": "enterprise_super_ultra"},
    )
    assert resp.status_code in (400, 422)


async def test_create_checkout_has_no_trial(client: httpx.AsyncClient):
    """create-checkout must NOT include trial_period_days in subscription_data."""
    await register_and_login(client, email="billing_notrial@example.com")

    mock_customer = MagicMock()
    mock_customer.id = "cus_notrial_fake"

    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_notrial"

    captured_kwargs: dict = {}

    def capture_session(**kwargs):
        captured_kwargs.update(kwargs)
        return mock_session

    with (
        patch("stripe.Customer.create", return_value=mock_customer),
        patch("stripe.checkout.Session.create", side_effect=capture_session),
    ):
        with patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter"}):
            resp = await client.post(
                "/api/billing/create-checkout",
                json={"tier": "starter"},
            )

    assert resp.status_code == 200
    sub_data = captured_kwargs.get("subscription_data", {})
    assert "trial_period_days" not in sub_data, "Trial period must not be set on paid checkout"
    assert "trial_settings" not in sub_data, "Trial settings must not be set on paid checkout"


async def test_create_checkout_session_carries_tier_metadata(client: httpx.AsyncClient):
    """checkout session must carry tier in session-level metadata."""
    await register_and_login(client, email="billing_meta@example.com")

    mock_customer = MagicMock()
    mock_customer.id = "cus_meta_fake"

    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_meta"

    captured_kwargs: dict = {}

    def capture_session(**kwargs):
        captured_kwargs.update(kwargs)
        return mock_session

    with (
        patch("stripe.Customer.create", return_value=mock_customer),
        patch("stripe.checkout.Session.create", side_effect=capture_session),
    ):
        with patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter"}):
            resp = await client.post(
                "/api/billing/create-checkout",
                json={"tier": "starter"},
            )

    assert resp.status_code == 200
    session_meta = captured_kwargs.get("metadata", {})
    assert session_meta.get("tier") == "starter", "Session metadata must include tier"


async def test_billing_status_basic_tier(client: httpx.AsyncClient):
    """Basic-tier user ($100 Starter) gets correct prompt_limit of 10."""
    await register_and_login(client, email="billing_basic@example.com", subscription_tier="basic")
    resp = await client.get("/api/billing/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["subscription_tier"] == "basic"
    assert data["prompt_limit"] == 10


async def test_billing_status_basic_tier_brand_limits(client: httpx.AsyncClient):
    """Basic tier gets 1 standard brand, 0 pitch, 0 pro."""
    await register_and_login(client, email="billing_basic_brands@example.com", subscription_tier="basic")
    resp = await client.get("/api/billing/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["brand_limits"]["standard"] == 1
    assert data["brand_limits"]["pitch"] == 0


async def test_webhook_checkout_completed_basic_tier(client: httpx.AsyncClient):
    """checkout.session.completed with tier=basic upgrades pitch brand to standard with prompt_limit=10."""
    import json

    import stripe as _stripe

    await register_and_login(client, email="billing_basic_wh@example.com", subscription_tier=None)

    # Create a pitch brand (free-tier users can only create pitch brands)
    resp = await client.post("/api/brands", json={
        "name": "BasicTestBrand",
        "brand_type": "pitch",
        "website_url": "https://example.com",
        "prompts": ["test prompt"],
    })
    assert resp.status_code == 201
    brand_id = resp.json()["id"]

    customer_id = "cus_basic_webhook"

    from sqlalchemy import update

    from app.database import AsyncSessionLocal
    from app.models import User
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.email == "billing_basic_wh@example.com")
            .values(stripe_customer_id=customer_id)
        )
        await db.commit()

    payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": customer_id,
                "subscription": "sub_basic_test",
                "metadata": {"tier": "basic", "user_id": "1"},
            }
        },
    }
    body = json.dumps(payload).encode()

    with patch.dict("os.environ", {
        "STRIPE_SECRET_KEY": "sk_test_fake",
        "STRIPE_WEBHOOK_SECRET": "whsec_test_secret",
    }):
        with patch.object(_stripe.Webhook, "construct_event", return_value=payload):
            resp = await client.post(
                "/api/billing/webhook",
                content=body,
                headers={
                    "stripe-signature": "t=1,v1=fake",
                    "content-type": "application/json",
                },
            )

    assert resp.status_code == 200

    # Verify brand was upgraded
    from app.models import Brand
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = result.scalar_one()
        assert brand.brand_type == "standard"
        assert brand.prompt_limit == 10


async def test_create_checkout_basic_tier(client: httpx.AsyncClient):
    """create-checkout accepts 'basic' as a valid tier."""
    from unittest.mock import MagicMock

    await register_and_login(client, email="billing_basic_co@example.com")

    mock_customer = MagicMock()
    mock_customer.id = "cus_basic_co"
    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_basic"

    with (
        patch("stripe.Customer.create", return_value=mock_customer),
        patch("stripe.checkout.Session.create", return_value=mock_session),
    ):
        with patch.dict("os.environ", {"STRIPE_BASIC_PRICE_ID": "price_test_basic"}):
            resp = await client.post(
                "/api/billing/create-checkout",
                json={"tier": "basic"},
            )

    assert resp.status_code == 200
    assert "checkout_url" in resp.json()


async def test_webhook_checkout_completed_sets_active_tier(client: httpx.AsyncClient):
    """checkout.session.completed webhook must set subscription_tier and status='active'."""
    import json

    import stripe as _stripe

    await register_and_login(client, email="billing_webhook@example.com", subscription_tier=None)

    customer_id = "cus_webhook_test"

    from sqlalchemy import update

    from app.database import AsyncSessionLocal
    from app.models import User
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(User)
            .where(User.email == "billing_webhook@example.com")
            .values(stripe_customer_id=customer_id)
        )
        await db.commit()

    payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": customer_id,
                "subscription": "sub_webhook_test",
                "metadata": {"tier": "starter", "user_id": "1"},
            }
        },
    }
    body = json.dumps(payload).encode()

    with patch.dict("os.environ", {
        "STRIPE_SECRET_KEY": "sk_test_fake",
        "STRIPE_WEBHOOK_SECRET": "whsec_test_secret",
    }):
        with patch.object(_stripe.Webhook, "construct_event", return_value=payload):
            resp = await client.post(
                "/api/billing/webhook",
                content=body,
                headers={
                    "stripe-signature": "t=1,v1=fake",
                    "content-type": "application/json",
                },
            )

    assert resp.status_code == 200

    resp2 = await client.get("/api/billing/status")
    data = resp2.json()
    assert data["subscription_tier"] == "starter", f"Expected starter, got {data['subscription_tier']}"
    assert data["subscription_status"] == "active", f"Expected active, got {data['subscription_status']}"
    assert data.get("subscription_trial_end") is None, "Trial end must be None after paid checkout"


async def test_billing_usage_basic_tier(client: httpx.AsyncClient):
    """Basic-tier user gets correct run limit (2) and prompt limit (10)."""
    await register_and_login(client, email="billing_basic_usage@example.com", subscription_tier="basic")
    resp = await client.get("/api/billing/usage")
    assert resp.status_code == 200
    data = resp.json()
    assert data["manual_run_limit"] == 2
    assert data["prompt_limit"] == 10


async def test_sync_brands_for_tier_downgrades_pro_brands_to_starter():
    """When a user downgrades to starter (Growth), any brand_type='pro' brand
    must be moved back to 'standard' with prompt_limit=25."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, User, utcnow
    from app.routers.billing import _sync_brands_for_tier

    async with AsyncSessionLocal() as db:
        user = User(email="sync_dg_starter@example.com", password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()
        brand = Brand(
            user_id=user.id, name="Pro Brand", slug="pro-brand-sync-starter",
            tier="basic", brand_type="pro", prompt_limit=30,
        )
        db.add(brand)
        await db.commit()
        brand_id = brand.id
        await _sync_brands_for_tier(db, user.id, "starter")
        await db.commit()
        await db.refresh(brand)
        assert brand.brand_type == "standard"
        assert brand.prompt_limit == 25


async def test_sync_brands_for_tier_downgrades_pro_brands_to_basic():
    """Starter (basic) downgrade: pro brand → standard with prompt_limit=10."""
    from app.database import AsyncSessionLocal
    from app.models import Brand, User
    from app.routers.billing import _sync_brands_for_tier

    async with AsyncSessionLocal() as db:
        user = User(email="sync_dg_basic@example.com", password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()
        brand = Brand(
            user_id=user.id, name="Pro Brand B", slug="pro-brand-sync-basic",
            tier="basic", brand_type="pro", prompt_limit=30,
        )
        db.add(brand)
        await db.commit()
        await _sync_brands_for_tier(db, user.id, "basic")
        await db.commit()
        await db.refresh(brand)
        assert brand.brand_type == "standard"
        assert brand.prompt_limit == 10


async def test_change_plan_downgrade_creates_schedule_and_keeps_current_tier(client: httpx.AsyncClient):
    """Pro → Growth downgrade: creates SubscriptionSchedule, sets pending fields,
    does NOT change subscription_tier locally."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="dg_create@example.com", subscription_tier="pro")
    # Give the test user a fake stripe subscription id
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE users SET stripe_subscription_id = :sid WHERE email = :email"),
            {"sid": "sub_test_fake", "email": "dg_create@example.com"},
        )
        await db.commit()

    # Mock Stripe: SubscriptionSchedule.create returns an object with phases
    fake_schedule = {
        "id": "sub_sched_fake",
        "phases": [{
            "items": [{"price": "price_test_pro", "quantity": 1}],
            "start_date": 1713200000,
            "end_date": 1715792000,
        }],
    }
    with (
        patch.dict("os.environ", {"STRIPE_STARTER_PRICE_ID": "price_test_starter", "STRIPE_PRO_PRICE_ID": "price_test_pro"}),
        patch("stripe.SubscriptionSchedule.create", return_value=fake_schedule) as mock_create,
        patch("stripe.SubscriptionSchedule.modify", return_value=fake_schedule) as mock_modify,
    ):
        resp = await client.post("/api/billing/change-plan", json={"tier": "starter"})

    assert resp.status_code == 200, resp.text
    mock_create.assert_called_once_with(from_subscription="sub_test_fake")
    mock_modify.assert_called_once()

    # Verify local state
    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "dg_create@example.com"))).scalar_one()
        assert u.subscription_tier == "pro"  # unchanged!
        assert u.pending_tier == "starter"
        assert u.stripe_schedule_id == "sub_sched_fake"
        assert u.pending_tier_effective_at is not None


async def test_change_plan_upgrade_while_pending_releases_schedule(client: httpx.AsyncClient):
    """If a downgrade is scheduled and the user upgrades, the schedule must
    be released before the immediate modify fires."""
    from sqlalchemy import text
    from app.database import AsyncSessionLocal

    await register_and_login(client, email="up_while_pending@example.com", subscription_tier="starter")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE users SET
                  stripe_subscription_id = :sid,
                  stripe_schedule_id = :schid,
                  pending_tier = :pt,
                  pending_tier_effective_at = :pte
                WHERE email = :email
            """),
            {
                "sid": "sub_fake_1", "schid": "sub_sched_fake_1",
                "pt": "basic", "pte": "2026-05-09 00:00:00",
                "email": "up_while_pending@example.com",
            },
        )
        await db.commit()

    fake_sub = {"items": {"data": [{"id": "si_fake_1"}]}}
    with (
        patch.dict("os.environ", {"STRIPE_PRO_PRICE_ID": "price_test_pro"}),
        patch("stripe.SubscriptionSchedule.release") as mock_release,
        patch("stripe.Subscription.retrieve", return_value=fake_sub),
        patch("stripe.Subscription.modify") as mock_modify,
    ):
        resp = await client.post("/api/billing/change-plan", json={"tier": "pro"})

    assert resp.status_code == 200, resp.text
    mock_release.assert_called_once_with("sub_sched_fake_1")
    mock_modify.assert_called_once()

    async with AsyncSessionLocal() as db:
        from app.models import User
        from sqlalchemy import select
        u = (await db.execute(select(User).where(User.email == "up_while_pending@example.com"))).scalar_one()
        assert u.subscription_tier == "pro"
        assert u.pending_tier is None
        assert u.stripe_schedule_id is None
        assert u.pending_tier_effective_at is None
