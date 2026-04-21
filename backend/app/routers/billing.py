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
from datetime import UTC
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

# ── Tier display names ───────────────────────────────────────────────────────
# Internal key → user-facing name.
# IMPORTANT: Internal keys are stored in the database (subscription_tier),
# Stripe metadata, and throughout the codebase. The "starter" key predates
# the current naming — it displays as "Growth" in the UI.
# Do NOT rename internal keys without a data migration.
TIER_DISPLAY_NAMES: dict[str | None, str] = {
    None: "Free",
    "": "Free",
    "basic": "Starter",      # $100/mo — entry-level paid tier
    "starter": "Growth",     # $300/mo — formerly called "Starter" in the UI
    "pro": "Pro",            # $500/mo
}

# Canonical tier ordering for UI rendering (lowest → highest).
TIER_ORDER: list[str | None] = [None, "basic", "starter", "pro"]

TIER_LIMITS = {"basic": 10, "starter": 25, "pro": 30}
TIER_PRICES = {
    "basic": os.getenv("STRIPE_BASIC_PRICE_ID", ""),
    "starter": os.getenv("STRIPE_STARTER_PRICE_ID", ""),
    "pro": os.getenv("STRIPE_PRO_PRICE_ID", ""),
}
def _brand_limits_for_api(tier: str | None) -> dict[str, int]:
    """Derive {standard, pitch} brand limits from BRAND_TYPE_LIMITS.

    The API uses "standard" to mean paid brand slots (standard or pro brand_type)
    and "pitch" for free trial brand slots.
    """
    type_limits = BRAND_TYPE_LIMITS.get(tier, BRAND_TYPE_LIMITS[None])
    return {
        "standard": type_limits.get("standard", 0) + type_limits.get("pro", 0),
        "pitch": type_limits.get("pitch", 0),
    }
# Manual run limits per tier (per day, UTC). None = unlimited.
DAILY_RUN_LIMITS: dict = {
    None: 1,
    "": 1,
    "basic": 2,
    "starter": 3,
    "pro": None,  # unlimited
}
# Competitor tracking limits per brand (across all brands, enforced at add time)
COMPETITOR_LIMITS: dict = {
    None: 3, "": 3,
    "basic": 3,
    "starter": 5,
    "pro": 15,
}
# Team member seat limits (total invited/accepted members per account owner)
TEAM_MEMBER_LIMITS: dict = {
    None: 0, "": 0,
    "basic": 0,
    "starter": 1,
    "pro": 3,
}
# Weekly manual opp-scan limits per brand (on-demand only, no auto-scans).
WEEKLY_SCAN_LIMITS: dict = {
    None: 0, "": 0,
    "basic": 5,
    "starter": 10,
    "pro": 25,
}

# Prompt limits per brand type
PROMPT_LIMITS: dict[str, int] = {
    "pitch": 10,
    "standard": 25,
    "pro": 30,
}

# Brand type limits per subscription tier: {tier: {brand_type: max_count}}
BRAND_TYPE_LIMITS: dict = {
    None: {"pitch": 1, "standard": 0, "pro": 0},
    "": {"pitch": 1, "standard": 0, "pro": 0},
    "basic": {"pitch": 0, "standard": 1, "pro": 0},
    "starter": {"pitch": 0, "standard": 1, "pro": 0},
    "pro": {"pitch": 0, "standard": 0, "pro": 2},
}

# Daily manual run limit for pitch brands (all tiers)
DAILY_RUN_LIMITS_PITCH: int = 1

# Weekly manual scan limit for pitch brands (all tiers)
WEEKLY_SCAN_LIMITS_PITCH: int = 1


def get_stripe():
    import stripe as _stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY", "")
    if not secret_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe not configured. Set STRIPE_SECRET_KEY in environment.",
        )
    _stripe.api_key = secret_key
    _stripe.max_network_retries = 2
    return _stripe


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def billing_status(user: Annotated[User, Depends(get_current_user)]):
    from datetime import datetime
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    brand_limits = _brand_limits_for_api(user.subscription_tier)
    trial_end_dt = getattr(user, "subscription_trial_end", None)
    trial_end = trial_end_dt.isoformat() if trial_end_dt else None
    # Days remaining in trial (None when not in trial or no end date stored)
    days_remaining: int | None = None
    if user.subscription_status == "trialing" and trial_end_dt:
        delta = trial_end_dt - datetime.now(UTC).replace(tzinfo=None)
        days_remaining = max(0, delta.days)
    return {
        "subscription_tier": user.subscription_tier,
        "subscription_status": user.subscription_status,
        "subscription_trial_end": trial_end,
        "days_remaining": days_remaining,
        "prompt_limit": limit,
        "brand_limits": brand_limits,
        "is_admin": user.is_admin,
        "has_payment_method": bool(user.stripe_customer_id),
    }


# ── Usage ─────────────────────────────────────────────────────────────────────

@router.get("/usage")
async def billing_usage(user: Annotated[User, Depends(get_current_user)], db: DbDep):
    """Returns today's manual run count and prompt/brand counts vs tier limits."""
    from datetime import datetime

    from sqlalchemy import func
    from sqlalchemy import select as sa_select

    from app.models import Brand, Prompt, TrackingRun

    tier = user.subscription_tier or ""
    is_admin = user.is_admin

    # Manual runs today (UTC midnight boundary)
    today_start = datetime.now(UTC).replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=None
    )
    runs_today_result = await db.execute(
        sa_select(func.count(TrackingRun.id)).where(
            TrackingRun.brand_id.in_(
                sa_select(Brand.id).where(Brand.user_id == user.id)
            ),
            TrackingRun.run_type == "manual",
            TrackingRun.created_at >= today_start,
        )
    )
    manual_runs_today = runs_today_result.scalar_one()

    manual_run_limit = DAILY_RUN_LIMITS.get(tier, 1) if not is_admin else None

    # Pro users create "pro" brand_type; starter users create "standard".
    # Count the effective type for the user's tier.
    effective_brand_type = "pro" if tier == "pro" else "standard"

    # Total prompts across all brands of the effective type
    prompt_count_result = await db.execute(
        sa_select(func.count(Prompt.id)).where(
            Prompt.brand_id.in_(
                sa_select(Brand.id).where(
                    Brand.user_id == user.id,
                    Brand.brand_type == effective_brand_type,
                )
            )
        )
    )
    prompt_count = prompt_count_result.scalar_one()

    # Brand counts by type
    brand_counts_result = await db.execute(
        sa_select(Brand.brand_type, func.count(Brand.id))
        .where(Brand.user_id == user.id)
        .group_by(Brand.brand_type)
    )
    brand_counts = {row[0]: row[1] for row in brand_counts_result.all()}

    prompt_limit = 999999 if is_admin else TIER_LIMITS.get(tier, 10)
    brand_limits = _brand_limits_for_api(tier)

    return {
        "manual_runs_today": manual_runs_today,
        "manual_run_limit": manual_run_limit,
        "prompt_count": prompt_count,
        "prompt_limit": prompt_limit,
        "standard_brand_count": brand_counts.get(effective_brand_type, 0),
        "standard_brand_limit": brand_limits["standard"],
        "pitch_brand_count": brand_counts.get("pitch", 0),
        "pitch_brand_limit": brand_limits["pitch"],
    }


# ── Create checkout ───────────────────────────────────────────────────────────

def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000")


def _validate_redirect_url(url: str) -> str:
    """Ensure redirect URL belongs to the frontend domain. Returns sanitized URL."""
    from urllib.parse import urlparse
    base = _frontend_url()
    base_parsed = urlparse(base)
    url_parsed = urlparse(url)
    if url_parsed.netloc and url_parsed.netloc != base_parsed.netloc:
        return base  # reject external domains
    return url


class CheckoutRequest(BaseModel):
    tier: str  # 'basic' | 'starter' | 'pro'
    success_url: str = ""
    cancel_url: str = ""

    def model_post_init(self, __context: object) -> None:
        base = _frontend_url()
        if not self.success_url:
            self.success_url = f"{base}/settings/billing?success=true"
        else:
            self.success_url = _validate_redirect_url(self.success_url)
        if not self.cancel_url:
            self.cancel_url = f"{base}/settings/billing"
        else:
            self.cancel_url = _validate_redirect_url(self.cancel_url)


@router.post("/create-checkout")
async def create_checkout(
    request: CheckoutRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    if request.tier not in TIER_PRICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier")
    # Re-read from env at request time so runtime patches (tests, Railway env
    # var injection) take effect even after the module-level TIER_PRICES was
    # computed at import time.
    env_key = f"STRIPE_{request.tier.upper()}_PRICE_ID"
    price_id = os.getenv(env_key, "") or TIER_PRICES.get(request.tier, "")
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe price ID for '{request.tier}' not configured. Set STRIPE_{request.tier.upper()}_PRICE_ID.",
        )

    stripe = get_stripe()

    # Create or retrieve Stripe customer
    customer_id = user.stripe_customer_id
    if not customer_id:
        try:
            customer = stripe.Customer.create(email=user.email, name=user.name or user.email)
        except stripe.error.APIConnectionError as exc:
            logger.error("Stripe connection error during Customer.create: %s", exc)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
        except stripe.error.RateLimitError as exc:
            logger.warning("Stripe rate limit during Customer.create: %s", exc)
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
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
        metadata={"user_id": str(user.id), "tier": request.tier},
        subscription_data={
            "metadata": {"user_id": str(user.id), "tier": request.tier},
        },
    )

    try:
        session = stripe.checkout.Session.create(**session_kwargs)
    except stripe.error.APIConnectionError as exc:
        logger.error("Stripe connection error during checkout.Session.create: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
    except stripe.error.RateLimitError as exc:
        logger.warning("Stripe rate limit during checkout.Session.create: %s", exc)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
    return {"checkout_url": session.url}


# ── Customer portal ────────────────────────────────────────────────────────────

class PortalRequest(BaseModel):
    return_url: str = ""

    def model_post_init(self, __context: object) -> None:
        if not self.return_url:
            self.return_url = f"{_frontend_url()}/account"
        else:
            self.return_url = _validate_redirect_url(self.return_url)


@router.post("/portal")
async def customer_portal(
    request: PortalRequest,
    user: Annotated[User, Depends(get_current_user)],
):
    if not user.stripe_customer_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No billing account found")
    stripe = get_stripe()
    try:
        session = stripe.billing_portal.Session.create(
            customer=user.stripe_customer_id,
            return_url=request.return_url,
        )
    except stripe.error.APIConnectionError as exc:
        logger.error("Stripe connection error during portal.Session.create: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
    except stripe.error.RateLimitError as exc:
        logger.warning("Stripe rate limit during portal.Session.create: %s", exc)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
    return {"portal_url": session.url}


# ── Change plan ───────────────────────────────────────────────────────────────

class ChangePlanRequest(BaseModel):
    tier: str  # 'basic' | 'starter' | 'pro'


@router.post("/change-plan")
async def change_plan(
    request: ChangePlanRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: DbDep,
):
    """Switch the user's subscription tier with no proration. Billing adjusts at next renewal."""
    if request.tier not in TIER_PRICES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier")
    if not user.stripe_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription found. Use checkout to start a new subscription.",
        )
    if user.subscription_tier == request.tier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already on this plan")

    price_id = TIER_PRICES[request.tier]
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe price ID for '{request.tier}' not configured",
        )

    stripe = get_stripe()

    try:
        subscription = stripe.Subscription.retrieve(user.stripe_subscription_id)
        items_data = subscription.get("items", {}).get("data", [])
        if not items_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not retrieve subscription items from Stripe",
            )
        item_id = items_data[0]["id"]

        stripe.Subscription.modify(
            user.stripe_subscription_id,
            items=[{"id": item_id, "price": price_id}],
            proration_behavior="none",
            metadata={"tier": request.tier, "user_id": str(user.id)},
        )
    except HTTPException:
        raise
    except stripe.error.APIConnectionError as exc:
        logger.error("Stripe connection error during plan switch: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
    except stripe.error.RateLimitError as exc:
        logger.warning("Stripe rate limit during plan switch: %s", exc)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
    except Exception as exc:
        logger.exception("Plan switch failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not switch plan. Please try again or contact support.",
        )

    old_tier = user.subscription_tier
    user.subscription_tier = request.tier
    user.updated_at = utcnow()
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event(
        "plan_switched",
        {"old_plan": old_tier, "new_plan": request.tier},
        user_id=user.id,
    )

    display_name = TIER_DISPLAY_NAMES.get(request.tier, request.tier)
    return {"message": f"Plan switched to {display_name}. Billing adjusts at your next renewal."}


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
    except stripe.error.APIConnectionError as exc:
        logger.error("Stripe connection error during subscription cancellation: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Payment service temporarily unavailable. Please try again.")
    except stripe.error.RateLimitError as exc:
        logger.warning("Stripe rate limit during subscription cancellation: %s", exc)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests to payment service. Please wait a moment and try again.")
    except Exception as exc:
        logger.exception("Subscription cancellation failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not cancel subscription. Please try again or contact support.",
        )

    user.subscription_status = "canceling"
    user.updated_at = utcnow()
    await db.commit()

    from app.services.analytics_service import log_event
    await log_event("subscription_cancel_requested", {}, user_id=user.id)

    return {"message": "Subscription will be canceled at the end of the current billing period"}


# ── Brand upgrade helper (idempotent) ────────────────────────────────────────

async def _upgrade_brands_for_tier(db: AsyncSession, user_id: int, tier: str) -> None:
    """Upgrade a user's brands to match their subscription tier.

    Idempotent — safe to call from multiple webhook events.
    """
    from sqlalchemy import update as sa_update

    from app.models import Brand

    if tier == "pro":
        result = await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type.in_(["standard", "pitch"]))
            .values(brand_type="pro", prompt_limit=100)
        )
        if result.rowcount > 0:
            logger.info("Auto-upgraded %d brand(s) to pro for user %d", result.rowcount, user_id)
    elif tier == "basic":
        result = await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type == "pitch")
            .values(brand_type="standard", prompt_limit=10)
        )
        if result.rowcount > 0:
            logger.info("Auto-upgraded %d pitch brand(s) to standard (basic) for user %d", result.rowcount, user_id)
    elif tier == "starter":
        result = await db.execute(
            sa_update(Brand)
            .where(Brand.user_id == user_id, Brand.brand_type == "pitch")
            .values(brand_type="standard", prompt_limit=25)
        )
        if result.rowcount > 0:
            logger.info("Auto-upgraded %d pitch brand(s) to standard for user %d", result.rowcount, user_id)


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
        logger.warning("Webhook signature verification failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook signature verification failed")

    from sqlalchemy import select as sa_select

    from app.models import ProcessedWebhookEvent, User as UserModel

    event_type = event.get("type", "")
    event_id = event.get("id", "")
    data_obj = event.get("data", {}).get("object", {})

    # ── Idempotency: skip already-processed events (Stripe retries on failure) ──
    if event_id:
        try:
            already = await db.execute(
                sa_select(ProcessedWebhookEvent.id).where(
                    ProcessedWebhookEvent.stripe_event_id == event_id
                )
            )
            if already.scalar_one_or_none() is not None:
                logger.info("Skipping duplicate webhook event %s (%s)", event_id, event_type)
                return {"received": True}
        except Exception:
            # Fail-open: if the dedup check itself fails, continue processing
            logger.warning("Idempotency check failed for event %s, proceeding anyway", event_id, exc_info=True)

    if event_type == "checkout.session.completed":
        # Fires immediately when the user finishes checkout. Sets tier + active status.
        customer_id = data_obj.get("customer")
        sub_id = data_obj.get("subscription")
        result = await db.execute(
            sa_select(UserModel).where(UserModel.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if user:
            tier = data_obj.get("metadata", {}).get("tier")
            changed = False
            if sub_id and not user.stripe_subscription_id:
                user.stripe_subscription_id = sub_id
                changed = True
            if tier and user.subscription_tier != tier:
                if getattr(user, "admin_tier_override", False):
                    logger.info("Skipping tier update for user %s — admin override active", user.email)
                else:
                    user.subscription_tier = tier
                    changed = True
            if user.subscription_status != "active":
                user.subscription_status = "active"
                changed = True
            if user.subscription_trial_end is not None:
                user.subscription_trial_end = None
                changed = True
            if changed:
                user.updated_at = utcnow()
            await db.flush()
            # Upgrade brands to match the new tier (idempotent).
            # This must happen here because checkout.session.completed fires
            # before customer.subscription.created — if we only upgrade in
            # the subscription handler, it sees old_tier == tier and skips.
            if tier:
                await _upgrade_brands_for_tier(db, user.id, tier)
            logger.info(
                "checkout.session.completed for user %s (customer=%s, subscription=%s)",
                user.email, customer_id, sub_id,
            )
            from app.services.analytics_service import log_event
            await log_event("checkout_completed", {"customer_id": customer_id}, user_id=user.id)

    elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
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
            from datetime import datetime
            old_tier = user.subscription_tier
            user.subscription_status = sub_status
            user.stripe_subscription_id = sub_id
            if tier:
                if getattr(user, "admin_tier_override", False):
                    logger.info("Skipping tier update for user %s — admin override active", user.email)
                else:
                    user.subscription_tier = tier
            # Store trial end date if present (Stripe sends unix timestamp)
            trial_end_ts = data_obj.get("trial_end")
            if trial_end_ts:
                user.subscription_trial_end = datetime.fromtimestamp(
                    trial_end_ts, tz=UTC
                ).replace(tzinfo=None)
            elif sub_status not in ("trialing",):
                user.subscription_trial_end = None
            user.updated_at = utcnow()
            await db.flush()
            if tier and tier != old_tier:
                from app.services.analytics_service import log_event
                await log_event(
                    "plan_upgraded",
                    {"old_plan": old_tier, "new_plan": tier},
                    user_id=user.id,
                )
            # Upgrade brands to match tier (idempotent — safe even if
            # checkout.session.completed already handled this).
            if tier:
                await _upgrade_brands_for_tier(db, user.id, tier)

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
            user.admin_tier_override = False  # Clear override on cancellation
            user.updated_at = utcnow()
            await db.flush()

            # Brands are NOT downgraded on cancellation. They stay as-is
            # (standard/pro with their prompts intact) but become read-only
            # because subscription_status="canceled" triggers the freeze in
            # require_brand_active(). When the user resubscribes, the freeze
            # lifts automatically and all their data is still there.

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
            await db.flush()
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

    # ── Record event for idempotency + single atomic commit ──────────────────
    if event_id:
        try:
            db.add(ProcessedWebhookEvent(
                stripe_event_id=event_id,
                event_type=event_type,
                processed_at=utcnow(),
            ))
        except Exception:
            logger.warning("Failed to record webhook event %s for idempotency", event_id, exc_info=True)

    await db.commit()
    return {"received": True}
