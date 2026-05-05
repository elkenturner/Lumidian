"""One-off: flip is_agency_staff=True on a user by email and create AgencyStaff row.

Usage:
    python seed_agency_staff.py user@example.com [owner|contractor]
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.database import AsyncSessionLocal, create_tables, run_migrations
from app.models import AgencyStaff, User


async def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python seed_agency_staff.py <email> [owner|contractor]")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    role = sys.argv[2] if len(sys.argv) > 2 else "owner"
    if role not in ("owner", "contractor"):
        print(f"Invalid role '{role}'. Must be 'owner' or 'contractor'.")
        sys.exit(1)

    await create_tables()
    await run_migrations()

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if user is None:
            print(
                f"No user found with email {email}. "
                "Register the user first via the normal signup flow."
            )
            sys.exit(1)

        user.is_agency_staff = True

        existing = (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none()
        if existing is None:
            db.add(AgencyStaff(user_id=user.id, role=role, active=True))
        else:
            existing.role = role
            existing.active = True

        await db.commit()
        print(f"OK — {email} is now agency staff ({role}).")


if __name__ == "__main__":
    asyncio.run(main())
