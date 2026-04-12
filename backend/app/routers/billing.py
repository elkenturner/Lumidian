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

TIER_LIMITS = {"starter": 25, "pro": 100}
TIER_PRICES = {
    "starter": os.getenv("STRIPE_STARTER_PRICE_ID", ""),
    "pro": os.getenv("STRIPE_PRO_PRICE_ID", ""),
}
# Brand limits per tier: {"standard": N, "pitch": M}
# 999 = effectively unlimited (frontend hides usage bars at >= 999)
BRAND_LIMITS = {
    None: {"standard": 0, "pitch": 1},       # free: 1 pitch deck, no standard brands
    "": {"standard": 0, "pitch": 1},
    "starter": {"standard": 1, "pitch": 0},
    "pro": {"standard": 2, "pitch": 0},
}
# Manual run limits per tier (per day, UTC). None = unlimited.
# Only free-plan users (no subscription_tier) are limited to 1 run/day.
DAILY_RUN_LIMITS: dict = {
    None: 1,
    "": 1,
    "starter": 3,
    "pro": None,  # unlimited
}
# Competitor tracking limits per brand (across all brands, enforced at add time)
COMPETITOR_LIMITS: dict = {
    None: 3, "": 3,
    "starter": 5,
    "pro": 15,
}
# Team member seat limits (total invited/accepted members per account owner)
TEAM_MEMBER_LIMITS: dict = {
    None: 0, "": 0,
    "starter": 1,
    "pro": 3,
}
# Weekly manual opp-scan limits per brand.
# Free users only get the weekly auto-scan; manual re-scans require a paid plan.
WEEKLY_SCAN_LIMITS: dict = {
    None: 0, "": 0,
    "starter": 10,
    "pro": 25,
}

# Prompt limits per brand type
PROMPT_LIMITS: dict[str, int] = {
    "pitch": 10,
    "standard": 25,
    "pro": 100,
}

# Brand type limits per subscription tier: {tier: {brand_type: max_count}}
BRAND_TYPE_LIMITS: dict = {
    None: {"pitch": 1, "standard": 0, "pro": 0},
    "": {"pitch": 1, "standard": 0, "pro": 0},
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
    return _stripe


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def billing_status(user: Annotated[User, Depends(get_current_user)]):
    from datetime import datetime
    limit = 999999 if user.is_admin else TIER_LIMITS.get(user.subscription_tier or "", 10)
    brand_limits = BRAND_LIMITS.get(user.subscription_tier or "", BRAND_LIMITS[None])
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
    brand_limits = BRAND_LIMITS.get(tier, BRAND_LIMITS[None])

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
    tier: str  # 'starter' | 'pro'
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
        metadata={"user_id": str(user.id), "tier": request.tier},
        subscription_data={
            "metadata": {"user_id": str(user.id), "tier": request.tier},
        },
    )

    session = stripe.checkout.Session.create(**session_kwargs)
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
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=request.return_url,
    )
    return {"portal_url": session.url}


# ── Change plan ───────────────────────────────────────────────────────────────

class ChangePlanRequest(BaseModel):
    tier: str  # 'starter' | 'pro'


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

    return {"message": f"Plan switched to {request.tier}. Billing adjusts at your next renewal."}


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
            # Auto-upgrade brands when user upgrades their subscription
            if tier == "pro" and tier != old_tier:
                from sqlalchemy import update as sa_update

                from app.models import Brand
                # Upgrade standard AND pitch brands to pro
                upgrade_result = await db.execute(
                    sa_update(Brand)
                    .where(Brand.user_id == user.id, Brand.brand_type.in_(["standard", "pitch"]))
                    .values(brand_type="pro", prompt_limit=100)
                )
                if upgrade_result.rowcount > 0:
                    logger.info(
                        "Auto-upgraded %d brand(s) to pro for user %d",
                        upgrade_result.rowcount, user.id,
                    )
            elif tier == "starter" and old_tier in (None, ""):
                from sqlalchemy import update as sa_update

                from app.models import Brand
                # Upgrade pitch brands to standard on starter plan
                upgrade_result = await db.execute(
                    sa_update(Brand)
                    .where(Brand.user_id == user.id, Brand.brand_type == "pitch")
                    .values(brand_type="standard", prompt_limit=25)
                )
                if upgrade_result.rowcount > 0:
                    logger.info(
                        "Auto-upgraded %d pitch brand(s) to standard for user %d",
                        upgrade_result.rowcount, user.id,
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
            await db.flush()

            # Downgrade pro brands back to standard so they don't retain
            # elevated prompt limits (100 → 25) after subscription cancellation.
            if old_tier == "pro":
                from sqlalchemy import update as sa_update

                from app.models import Brand
                downgrade_result = await db.execute(
                    sa_update(Brand)
                    .where(Brand.user_id == user.id, Brand.brand_type == "pro")
                    .values(brand_type="standard", prompt_limit=25, tier="standard")
                )
                if downgrade_result.rowcount > 0:
                    logger.info(
                        "Downgraded %d pro brand(s) to standard for user %d after cancellation",
                        downgrade_result.rowcount, user.id,
                    )

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
