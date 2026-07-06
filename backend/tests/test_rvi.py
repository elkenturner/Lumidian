"""
Tests for the RVI (Relative Visibility Index) service + endpoint.

RVI = brand visibility ÷ mean(peer-pool visibility), over contested prompts only.
Spec: docs/superpowers/specs/2026-07-05-rvi-design.md
"""
from datetime import datetime, timedelta

import httpx
import pytest

pytestmark = pytest.mark.asyncio

from app.database import AsyncSessionLocal
from app.models import Brand, Competitor, Prompt, QueryResult, TrackingRun, User


async def _seed(
    *,
    user_email: str,
    competitors: list[tuple[str, bool]] | None = None,  # (name, in_peer_pool)
    prompts: list[str] | None = None,
    runs: list[dict] | None = None,
    # runs: [{"completed_at": dt, "queries": [{"prompt": idx, "mentioned": bool, "response_text": str}]}]
) -> tuple[int, int, list[int]]:
    """Seed brand + prompts + competitors + completed runs. Returns (user_id, brand_id, prompt_ids)."""
    async with AsyncSessionLocal() as db:
        user = User(email=user_email, password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()

        brand = Brand(name="SpotItEarly", slug=f"spotitearly-{user.id}", user_id=user.id, tier="basic")
        db.add(brand)
        await db.flush()

        prompt_ids: list[int] = []
        for text_ in (prompts or ["default prompt"]):
            p = Prompt(brand_id=brand.id, text=text_)
            db.add(p)
            await db.flush()
            prompt_ids.append(p.id)

        for name, in_pool in (competitors or []):
            db.add(Competitor(brand_id=brand.id, name=name, in_peer_pool=in_pool))

        for spec in (runs or []):
            run = TrackingRun(
                brand_id=brand.id,
                status="completed",
                run_type="manual",
                completed_at=spec["completed_at"],
                started_at=spec["completed_at"],
            )
            db.add(run)
            await db.flush()
            for q in spec.get("queries", []):
                db.add(QueryResult(
                    tracking_run_id=run.id,
                    prompt_id=prompt_ids[q.get("prompt", 0)],
                    model=q.get("model", "chatgpt"),
                    run_number=1,
                    mentioned=q["mentioned"],
                    response_text=q["response_text"],
                    error=None,
                    created_at=spec["completed_at"],
                ))
        await db.commit()
        return user.id, brand.id, prompt_ids


def _now() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


# ── compute_rvi core ─────────────────────────────────────────────────────────

async def test_rvi_worked_example():
    """Contested prompt: brand 25%, peers 50%/50% → RVI 0.5. Owned prompt counted separately."""
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, prompt_ids = await _seed(
        user_email="rvi-worked@example.com",
        competitors=[("Freenome", True), ("Delfi", True)],
        prompts=["best MCED test", "breath-based cancer detection"],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                # P0 (contested): brand 1/4 mentioned; Freenome 2/4; Delfi 2/4
                {"prompt": 0, "mentioned": True,  "response_text": "SpotItEarly and Freenome lead."},
                {"prompt": 0, "mentioned": False, "response_text": "Freenome and Delfi are options."},
                {"prompt": 0, "mentioned": False, "response_text": "Delfi is notable."},
                {"prompt": 0, "mentioned": False, "response_text": "Many startups compete."},
                # P1 (owned): brand 2/2, no peer registers
                {"prompt": 1, "mentioned": True, "response_text": "SpotItEarly pioneered this."},
                {"prompt": 1, "mentioned": True, "response_text": "SpotItEarly's canine VOC method."},
            ],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)

    assert resp.has_peers is True
    assert resp.has_data is True
    assert resp.contested_prompt_count == 1
    assert resp.owned_prompt_count == 1
    assert resp.unclaimed_prompt_count == 0
    assert resp.brand_pct == pytest.approx(25.0)
    assert resp.peer_avg_pct == pytest.approx(50.0)
    assert resp.rvi == pytest.approx(0.5)
    assert resp.sample_count == 4  # contested rows only
    assert resp.confidence == "low"
    assert len(resp.contested_prompts) == 1
    assert resp.contested_prompts[0].prompt_id == prompt_ids[0]
    assert resp.contested_prompts[0].rvi == pytest.approx(0.5)
    assert len(resp.owned_prompts) == 1
    assert resp.owned_prompts[0].prompt_id == prompt_ids[1]
    assert resp.owned_prompts[0].brand_pct == pytest.approx(100.0)
    peer_names = {p.name for p in resp.peers}
    assert peer_names == {"Freenome", "Delfi"}


async def test_rvi_excluded_competitor_does_not_affect_classification_or_denominator():
    """A tracked-but-excluded incumbent (GRAIL) is ignored everywhere: a prompt
    where only GRAIL registers stays owned, and the peer average excludes it."""
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-grail@example.com",
        competitors=[("Freenome", True), ("GRAIL", False)],
        prompts=["MCED comparison", "canine VOC detection"],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                # P0: Freenome registers → contested. GRAIL everywhere but excluded.
                {"prompt": 0, "mentioned": True,  "response_text": "GRAIL, Freenome, SpotItEarly."},
                {"prompt": 0, "mentioned": False, "response_text": "GRAIL dominates. Freenome too."},
                # P1: ONLY GRAIL registers → still owned (GRAIL not in pool)
                {"prompt": 1, "mentioned": True, "response_text": "SpotItEarly and GRAIL."},
            ],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)

    assert resp.contested_prompt_count == 1
    assert resp.owned_prompt_count == 1
    # Denominator is Freenome alone: 2/2 = 100%; brand 1/2 = 50% → RVI 0.5
    assert resp.peer_avg_pct == pytest.approx(100.0)
    assert resp.rvi == pytest.approx(0.5)
    assert [e.name for e in resp.excluded] == ["GRAIL"]
    assert all(p.name != "GRAIL" for p in resp.peers)


async def test_rvi_no_pool_members_reports_has_peers_false():
    """All competitors excluded → has_peers False; excluded list still populated."""
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-nopool@example.com",
        competitors=[("GRAIL", False)],
        runs=[{
            "completed_at": today - timedelta(hours=1),
            "queries": [{"mentioned": True, "response_text": "SpotItEarly!"}],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.has_peers is False
    assert resp.rvi is None
    assert [e.name for e in resp.excluded] == ["GRAIL"]


async def test_rvi_no_competitors_at_all():
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-nocomp@example.com",
        competitors=[],
        runs=[{
            "completed_at": today - timedelta(hours=1),
            "queries": [{"mentioned": True, "response_text": "SpotItEarly!"}],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.has_peers is False
    assert resp.rvi is None
    assert resp.excluded == []


async def test_rvi_all_owned_returns_null_rvi_with_owned_counts():
    """No peer registers anywhere → rvi None, owned territory populated, has_data True."""
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-allowned@example.com",
        competitors=[("Freenome", True)],
        prompts=["breath detection", "canine VOC"],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                {"prompt": 0, "mentioned": True, "response_text": "SpotItEarly leads."},
                {"prompt": 1, "mentioned": True, "response_text": "SpotItEarly again."},
            ],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.has_peers is True
    assert resp.has_data is True
    assert resp.rvi is None
    assert resp.contested_prompt_count == 0
    assert resp.owned_prompt_count == 2
    assert resp.sample_count == 0


async def test_rvi_unclaimed_prompts_counted_but_excluded():
    """Prompt where neither brand nor any peer registers → unclaimed, in neither segment."""
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-unclaimed@example.com",
        competitors=[("Freenome", True)],
        prompts=["contested one", "nobody registers"],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                {"prompt": 0, "mentioned": True, "response_text": "SpotItEarly vs Freenome."},
                {"prompt": 1, "mentioned": False, "response_text": "Generic screening advice."},
            ],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.contested_prompt_count == 1
    assert resp.owned_prompt_count == 0
    assert resp.unclaimed_prompt_count == 1


async def test_rvi_delta_vs_prior_window():
    """Prior window RVI 1.0 → current 0.5 → delta −0.5. Windows classified independently."""
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-delta@example.com",
        competitors=[("Freenome", True)],
        prompts=["contested"],
        runs=[
            {   # prior window (8 days ago for a 7d window): brand 1/2, peer 1/2 → RVI 1.0
                "completed_at": today - timedelta(days=8),
                "queries": [
                    {"mentioned": True,  "response_text": "SpotItEarly here."},
                    {"mentioned": False, "response_text": "Freenome is solid."},
                ],
            },
            {   # current window: brand 1/2, peer 2/2 → RVI 0.5
                "completed_at": today - timedelta(hours=3),
                "queries": [
                    {"mentioned": True,  "response_text": "SpotItEarly and Freenome."},
                    {"mentioned": False, "response_text": "Freenome again."},
                ],
            },
        ],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.rvi == pytest.approx(0.5)
    assert resp.rvi_delta == pytest.approx(-0.5)


async def test_rvi_trend_uses_fixed_contested_set_and_skips_zero_peer_days():
    """Daily trend reuses the window-level contested set; a day where no peer
    registers on those prompts yields no point (no divide-by-zero, no flicker)."""
    from app.services.rvi import compute_rvi

    today = _now()
    day1 = today - timedelta(days=2)
    day2 = today - timedelta(days=1)
    _, brand_id, _ = await _seed(
        user_email="rvi-trend@example.com",
        competitors=[("Freenome", True)],
        prompts=["contested"],
        runs=[
            {   # day1: brand 1/2, peer 2/2 → daily RVI 0.5
                "completed_at": day1,
                "queries": [
                    {"mentioned": True,  "response_text": "SpotItEarly, Freenome."},
                    {"mentioned": False, "response_text": "Freenome."},
                ],
            },
            {   # day2: peer absent that day → no trend point
                "completed_at": day2,
                "queries": [
                    {"mentioned": True, "response_text": "SpotItEarly only."},
                ],
            },
        ],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert len(resp.trend) == 1
    assert resp.trend[0].date == day1.date().isoformat()
    assert resp.trend[0].rvi == pytest.approx(0.5)


async def test_rvi_no_runs_returns_has_data_false():
    from app.services.rvi import compute_rvi

    _, brand_id, _ = await _seed(
        user_email="rvi-noruns@example.com",
        competitors=[("Freenome", True)],
        runs=[],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.has_peers is True
    assert resp.has_data is False
    assert resp.rvi is None


async def test_rvi_tolerates_timezone_aware_timestamps():
    """Offset-suffixed timestamp strings (external seeding) must not crash the
    service — regression carried over from the competitive-gap tz-aware 500."""
    from sqlalchemy import text
    from app.services.rvi import compute_rvi

    today = _now()
    _, brand_id, _ = await _seed(
        user_email="rvi-tzaware@example.com",
        competitors=[("Freenome", True)],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                {"mentioned": True,  "response_text": "SpotItEarly and Freenome."},
                {"mentioned": False, "response_text": "Freenome."},
            ],
        }],
    )
    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "UPDATE competitors SET created_at = :ts WHERE brand_id = :b"),
            {"ts": f"{today - timedelta(days=30)}+00:00", "b": brand_id})
        await db.execute(text(
            "UPDATE tracking_runs SET completed_at = :ts WHERE brand_id = :b"),
            {"ts": f"{today - timedelta(hours=2)}+00:00", "b": brand_id})
        await db.commit()
    async with AsyncSessionLocal() as db:
        resp = await compute_rvi(brand_id=brand_id, window="7d", db=db)
    assert resp.has_data is True
    assert resp.rvi == pytest.approx(0.5)


# ── Endpoint ─────────────────────────────────────────────────────────────────

from tests.conftest import create_brand, register_and_login as _register_and_login  # noqa: E402


async def test_rvi_endpoint_unauthenticated_401(client: httpx.AsyncClient):
    resp = await client.get("/api/dashboard/1/rvi")
    assert resp.status_code == 401


async def test_rvi_endpoint_wrong_owner_403(client: httpx.AsyncClient):
    _, brand_id, _ = await _seed(user_email="rvi-owner@example.com")
    await _register_and_login(client, "rvi-intruder@example.com")
    resp = await client.get(f"/api/dashboard/{brand_id}/rvi")
    assert resp.status_code == 403


async def test_rvi_endpoint_shape_and_windows(client: httpx.AsyncClient):
    today = _now()
    await _register_and_login(client, "rvi-shape@example.com")
    brand = await create_brand(client, name="SpotItEarly", prompts=["contested prompt"])
    brand_id = brand["id"]
    for name, in_pool in [("Freenome", True), ("GRAIL", False)]:
        comp = await client.post(f"/api/brands/{brand_id}/competitors", json={"name": name})
        assert comp.status_code == 201, comp.text
        if not in_pool:
            await client.patch(
                f"/api/brands/{brand_id}/competitors/{comp.json()['id']}",
                json={"in_peer_pool": False})

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select as sa_select
        prompt = (await db.execute(sa_select(Prompt).where(Prompt.brand_id == brand_id))).scalars().first()
        run = TrackingRun(brand_id=brand_id, status="completed", run_type="manual",
                          completed_at=today - timedelta(hours=1), started_at=today - timedelta(hours=1))
        db.add(run)
        await db.flush()
        for mentioned, text_ in [(True, "SpotItEarly, Freenome."), (False, "Freenome.")]:
            db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="chatgpt",
                               run_number=1, mentioned=mentioned, response_text=text_, error=None,
                               created_at=today - timedelta(hours=1)))
        await db.commit()

    resp = await client.get(f"/api/dashboard/{brand_id}/rvi?window=7d")
    assert resp.status_code == 200
    body = resp.json()
    assert body["rvi"] == pytest.approx(0.5)
    assert body["has_peers"] is True
    assert [e["name"] for e in body["excluded"]] == ["GRAIL"]

    bad = await client.get(f"/api/dashboard/{brand_id}/rvi?window=5d")
    assert bad.status_code == 422


async def test_peer_pool_patch_toggles_and_changes_rvi(client: httpx.AsyncClient):
    """PATCH flips in_peer_pool; RVI recomputes with the new denominator."""
    today = _now()
    await _register_and_login(client, "rvi-toggle@example.com")
    # create brand + competitor through the API as this user
    brand = await create_brand(client, name="SpotItEarly", prompts=["contested prompt"])
    brand_id = brand["id"]
    comp = await client.post(f"/api/brands/{brand_id}/competitors", json={"name": "Freenome"})
    assert comp.status_code == 201, comp.text
    comp_id = comp.json()["id"]
    assert comp.json()["in_peer_pool"] is True

    # seed a completed run with results
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select as sa_select
        prompt = (await db.execute(sa_select(Prompt).where(Prompt.brand_id == brand_id))).scalars().first()
        run = TrackingRun(brand_id=brand_id, status="completed", run_type="manual",
                          completed_at=today - timedelta(hours=1), started_at=today - timedelta(hours=1))
        db.add(run)
        await db.flush()
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="chatgpt",
                           run_number=1, mentioned=True, response_text="SpotItEarly, Freenome.", error=None,
                           created_at=today - timedelta(hours=1)))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="gemini",
                           run_number=1, mentioned=False, response_text="Freenome.", error=None,
                           created_at=today - timedelta(hours=1)))
        await db.commit()

    before = await client.get(f"/api/dashboard/{brand_id}/rvi")
    assert before.json()["rvi"] == pytest.approx(0.5)

    patched = await client.patch(
        f"/api/brands/{brand_id}/competitors/{comp_id}", json={"in_peer_pool": False})
    assert patched.status_code == 200
    assert patched.json()["in_peer_pool"] is False

    after = await client.get(f"/api/dashboard/{brand_id}/rvi")
    assert after.json()["has_peers"] is False
    assert after.json()["rvi"] is None


async def test_peer_pool_patch_wrong_owner_403(client: httpx.AsyncClient):
    _, brand_id, _ = await _seed(
        user_email="rvi-patch-owner@example.com",
        competitors=[("Freenome", True)],
    )
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select as sa_select
        comp = (await db.execute(sa_select(Competitor).where(Competitor.brand_id == brand_id))).scalars().first()
        comp_id = comp.id
    await _register_and_login(client, "rvi-patch-intruder@example.com")
    resp = await client.patch(
        f"/api/brands/{brand_id}/competitors/{comp_id}", json={"in_peer_pool": False})
    assert resp.status_code == 403
