"""Tests for the billing endpoints."""
import httpx
import pytest
from unittest.mock import patch, MagicMock
from tests.conftest import register_and_login, create_brand


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
