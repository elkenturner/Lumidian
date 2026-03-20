"""
Billing router — Stripe subscription management.

Routes
------
GET  /api/billing/status          — current subscription status
POST /api/billing/create-checkout — create Stripe checkout session
POST /api/billing/portal          — create Stripe billing portal session
POST /api/billing/webhook         — Stripe webhook handler
"""
from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

TIER_LIMITS = {"starter": 25, "pro": 100}
TIER_PRICES = {
    "starter": os.getenv("STRIPE_STARTER_PRICE_ID", ""),
    "pro": os.getenv("STRIPE_PRO_PRICE_ID", ""),
}
# Tiers that include a 7-day free trial
TRIAL_TIERS = {"pro"}
# Brand limits per tier: {"standard": N, "pitch": M}
BRAND_LIMITS = {
    "starter": {"standard": 1, "pitch": 1},
    "pro": {"standard": 5, "pitch": 10},
}


def get_stripe():
    import stripe as _stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY", "")
    if not secret_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe not configured. Set STRIPE_SECRET_KEY in environment.",
        )
    _stripe.api_key = secret_key
    return _stripe


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def billing_status(user: Annotated[User, Depends(get_current_user)]):
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    brand_limits = BRAND_LIMITS.get(user.subscription_tier or "", {"standard": 0, "pitch": 1})
    return {
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "prompt_limit": limit,
        "brand_limits": brand_limits,
        "is_admin": user.is_admin,
        "stripe_customer_id": user.stripe_customer_id,
        "stripe_subscription_id": user.stripe_subscription_id,
    }


# ── Create checkout ───────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    tier: str  # 'starter' | 'pro'
    success_url: str = "http://localhost:3000/settings/billing?success=true"
    cancel_url: str = "http://localhost:3000/settings/billing"


@router.post("/create-checkout")
async def create_checkout(
    request: CheckoutRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    if request.tier not in TIER_PRICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier")
    price_id = TIER_PRICES[request.tier]
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe price ID for '{request.tier}' not configured. Set STRIPE_{request.tier.upper()}_PRICE_ID.",
        )

    stripe = get_stripe()

    # Create or retrieve Stripe customer
    customer_id = user.stripe_customer_id
    if not customer_id:
        customer = stripe.Customer.create(email=user.email, name=user.name or user.email)
        customer_id = customer.id
        user.stripe_customer_id = customer_id
        user.updated_at = utcnow()
        await db.commit()

    session_kwargs: dict = dict(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=request.success_url,
        cancel_url=request.cancel_url,
        subscription_data={
            "metadata": {"user_id": str(user.id), "tier": request.tier},
        },
    )
    if request.tier in TRIAL_TIERS:
        session_kwargs["subscription_data"]["trial_period_days"] = 7

    session = stripe.checkout.Session.create(**session_kwargs)
    return {"checkout_url": session.url}


# ── Customer portal ────────────────────────────────────────────────────────────

class PortalRequest(BaseModel):
    return_url: str = "http://localhost:3000/settings/billing"


@router.post("/portal")
async def customer_portal(
    request: PortalRequest,
    user: Annotated[User, Depends(get_current_user)],
):
    if not user.stripe_customer_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No billing account found")
    stripe = get_stripe()
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=request.return_url,
    )
    return {"portal_url": session.url}


# ── Cancel subscription ────────────────────────────────────────────────────────

@router.post("/cancel")
async def cancel_subscription(
    user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """Cancel the user's subscription at end of billing period."""
    if not user.stripe_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription found",
        )
    stripe = get_stripe()
    try:
        stripe.Subscription.modify(
            user.stripe_subscription_id,
            cancel_at_period_end=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not cancel subscription: {exc}",
        )

    user.subscription_status = "canceling"
    user.updated_at = utcnow()
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event("subscription_cancel_requested", {}, user_id=user.id)

    return {"message": "Subscription will be canceled at the end of the current billing period"}


# ── Webhook ───────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(request: Request, db: DbDep):
    import stripe as _stripe
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    stripe_key = os.getenv("STRIPE_SECRET_KEY", "")
    if not stripe_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stripe not configured")
    _stripe.api_key = stripe_key

    if not webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="STRIPE_WEBHOOK_SECRET is not configured — webhook rejected for security.",
        )
    try:
        event = _stripe.Webhook.construct_event(body, sig_header, webhook_secret)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    from sqlalchemy import select as sa_select
    from app.models import User as UserModel

    event_type = event.get("type", "")
    data_obj = event.get("data", {}).get("object", {})

    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        customer_id = data_obj.get("customer")
        sub_status = data_obj.get("status")
        sub_id = data_obj.get("id")
        metadata = data_obj.get("metadata", {})
        tier = metadata.get("tier")

        # Try metadata first, then look up by customer_id
        result = await db.execute(
            sa_select(UserModel).where(UserModel.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if user:
            old_tier = user.subscription_tier
            user.subscription_status = sub_status
            user.stripe_subscription_id = sub_id
            if tier:
                user.subscription_tier = tier
            user.updated_at = utcnow()
            await db.commit()
            if tier and tier != old_tier:
                from app.services.analytics_service import log_event
                await log_event(
                    "plan_upgraded",
                    {"old_plan": old_tier, "new_plan": tier},
                    user_id=user.id,
                )

    elif event_type == "customer.subscription.deleted":
        customer_id = data_obj.get("customer")
        result = await db.execute(
            sa_select(UserModel).where(UserModel.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if user:
            old_tier = user.subscription_tier
            user.subscription_status = "canceled"
            user.subscription_tier = None
            user.stripe_subscription_id = None
            user.updated_at = utcnow()
            await db.commit()
            logger.warning(
                "Subscription canceled for user %s (was %s). customer=%s",
                user.email, old_tier, customer_id,
            )
            from app.services.analytics_service import log_event
            await log_event(
                "subscription_canceled",
                {"old_plan": old_tier, "customer_id": customer_id},
                user_id=user.id,
            )

    elif event_type == "invoice.payment_failed":
        # invoice object is at data.object; customer is top-level field
        customer_id = data_obj.get("customer")
        attempt_count = data_obj.get("attempt_count", 1)
        result = await db.execute(
            sa_select(UserModel).where(UserModel.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if user:
            user.subscription_status = "past_due"
            user.updated_at = utcnow()
            await db.commit()
            logger.warning(
                "Payment failed for user %s (attempt %d). customer=%s",
                user.email, attempt_count, customer_id,
            )
            from app.services.analytics_service import log_event
            await log_event(
                "payment_failed",
                {"customer_id": customer_id, "attempt_count": attempt_count},
                user_id=user.id,
            )

    return {"received": True}
