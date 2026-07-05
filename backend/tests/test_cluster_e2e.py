"""End-to-end smoke test for content clusters."""
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Brand, Prompt, User

BRIEF_JSON = (
    '{"positioning":"P","key_claims":["c"],"canonical_phrasings":["acme tracks x"],'
    '"stats":[],"narrative_spine":"n","tone_notes":"t"}'
)


@pytest_asyncio.fixture
async def e2e_user(db_session: AsyncSession) -> User:
    user = User(email="cluster_e2e@example.com", password_hash="x", name="E2E", email_verified=True)
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_full_cluster_lifecycle(
    client: AsyncClient,
    db_session: AsyncSession,
    e2e_user: User,
) -> None:
    # Auth: log in directly by minting a JWT cookie via existing auth flow.
    # The existing test pattern uses /api/auth/login with email/password; we'll
    # use a simpler path: directly seed an authenticated request by attaching
    # a JWT cookie generated like the auth router does.
    from datetime import UTC, datetime, timedelta
    import os
    import jwt as pyjwt

    secret = os.getenv("JWT_SECRET", "test-secret-key-for-clusters-32+chars")
    token = pyjwt.encode(
        {"sub": str(e2e_user.id), "exp": datetime.now(UTC) + timedelta(hours=1)},
        secret,
        algorithm="HS256",
    )
    client.cookies.set("clarity_token", token)

    brand = Brand(name="Acme", slug="cluster-e2e-acme", user_id=e2e_user.id)
    db_session.add(brand)
    await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="What is Acme?", prompt_type="standard")
    db_session.add(prompt)
    await db_session.commit()

    _FAKE_PACK = [
        {"url": "https://reuters.com/a", "title": "A", "snippet": "..."},
        {"url": "https://nytimes.com/b", "title": "B", "snippet": "..."},
        {"url": "https://techcrunch.com/c", "title": "C", "snippet": "..."},
        {"url": "https://forbes.com/d", "title": "D", "snippet": "..."},
    ]

    with patch("app.services.cluster_brief._call_llm", new=AsyncMock(return_value=BRIEF_JSON)), patch(
        "app.services.clustering_service._generate_piece_text",
        new=AsyncMock(return_value=("Title", "Body.", None, [], False)),
    ), patch(
        "app.services.cluster_evidence.fetch_and_dedupe",
        new=AsyncMock(return_value=_FAKE_PACK),
    ), patch(
        "app.services.clustering_service._gen_owned_site_piece",
        new=AsyncMock(return_value=("ok", "owned_site", "Title", "Body.", None, [], False)),
    ):
        from app.services.clustering_service import CLUSTER_PLATFORMS

        # 1. Trigger cluster regeneration
        r1 = await client.post(f"/api/clusters/{brand.id}/by-prompt/{prompt.id}/regenerate")
        assert r1.status_code == 200, r1.text
        cluster_id = r1.json()["id"]

        # 2. List shows the cluster
        r2 = await client.get(f"/api/clusters/{brand.id}")
        assert r2.status_code == 200
        body = r2.json()
        assert len(body) == 1
        assert body[0]["status"] == "ready"
        assert len(body[0]["pieces"]) == len(CLUSTER_PLATFORMS)

        # 3. Detail returns brief + drafts
        r3 = await client.get(f"/api/clusters/{brand.id}/{cluster_id}")
        assert r3.status_code == 200
        detail = r3.json()
        assert detail["brief"] is not None
        assert detail["brief"]["positioning"] == "P"
        assert len(detail["drafts"]) == len(CLUSTER_PLATFORMS)

        # 4. Edit brief
        r4 = await client.patch(
            f"/api/clusters/{brand.id}/{cluster_id}/brief",
            json={"positioning": "Updated positioning"},
        )
        assert r4.status_code == 200
        assert r4.json()["positioning"] == "Updated positioning"

        # 5. Regenerate one piece
        with patch(
            "app.services.clustering_service._generate_piece_text",
            new=AsyncMock(return_value=("Updated", "Updated body.", None, [], False)),
        ):
            r5 = await client.post(
                f"/api/clusters/{brand.id}/{cluster_id}/regenerate-piece",
                json={"platform": "linkedin"},
            )
            assert r5.status_code == 200
            assert r5.json()["title"] == "Updated"
