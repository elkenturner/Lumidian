"""One-shot: verify and tier-up the two test accounts. Remove after deploy."""

import logging

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import User, utcnow

logger = logging.getLogger(__name__)

_TEST_ACCOUNTS = {
    "test-starter@lumidian.com": {"tier": "starter", "status": "active"},
    "test-pro@lumidian.com": {"tier": "pro", "status": "active"},
}


async def activate_test_accounts() -> None:
    async with AsyncSessionLocal() as db:
        for email, cfg in _TEST_ACCOUNTS.items():
            result = await db.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
            if user is None:
                logger.info("seed_test: %s not found, skipping", email)
                continue
            changed = False
            if not user.email_verified:
                user.email_verified = True
                changed = True
            if user.subscription_tier != cfg["tier"]:
                user.subscription_tier = cfg["tier"]
                changed = True
            if user.subscription_status != cfg["status"]:
                user.subscription_status = cfg["status"]
                changed = True
            if changed:
                user.updated_at = utcnow()
                await db.commit()
                logger.info("seed_test: activated %s (tier=%s)", email, cfg["tier"])
            else:
                logger.info("seed_test: %s already configured", email)
