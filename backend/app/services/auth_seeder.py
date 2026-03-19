"""Seed the default admin user on startup."""
from __future__ import annotations

import logging
import os
import bcrypt
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import User, utcnow

logger = logging.getLogger(__name__)

_raw_admin_emails = os.getenv("ADMIN_EMAILS", "ken@clarityai.com")
ADMIN_EMAIL = _raw_admin_emails.split(",")[0].strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_NAME = os.getenv("ADMIN_NAME", "Admin")


async def seed_admin_user() -> None:
    if not ADMIN_PASSWORD:
        logger.warning(
            "ADMIN_PASSWORD env var is not set — skipping admin user seed. "
            "Set ADMIN_PASSWORD in .env to create the admin account on startup."
        )
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        user = result.scalar_one_or_none()
        if user is None:
            user = User(
                email=ADMIN_EMAIL,
                password_hash=bcrypt.hashpw(ADMIN_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
                name=ADMIN_NAME,
                is_admin=True,
            )
            db.add(user)
            await db.commit()
            logger.info("Admin user seeded: %s", ADMIN_EMAIL)
        elif not user.is_admin:
            user.is_admin = True
            user.updated_at = utcnow()
            await db.commit()
            logger.info("Admin flag set for: %s", ADMIN_EMAIL)
