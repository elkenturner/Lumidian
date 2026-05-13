"""
Tests for the Competitive Gap metric (service + endpoint).
"""
from datetime import UTC, datetime, timedelta

import httpx
import pytest

pytestmark = pytest.mark.asyncio

from app.database import AsyncSessionLocal
from app.models import Brand, Competitor, Prompt, QueryResult, TrackingRun, User


async def _seed_brand_with_runs(
    *,
    user_email: str,
    competitors: list[tuple[str, datetime]] | None = None,  # (name, created_at)
    runs: list[dict] | None = None,
    # runs: [{"completed_at": dt, "queries": [{"model": str, "mentioned": bool, "response_text": str}]}, ...]
) -> tuple[int, int]:
    """Seed a brand + competitors + completed tracking runs with query results.
    Returns (user_id, brand_id)."""
    async with AsyncSessionLocal() as db:
        user = User(email=user_email, password_hash="x", email_verified=1)
        db.add(user)
        await db.flush()

        brand = Brand(name="Acme", slug=f"acme-{user.id}", user_id=user.id, tier="basic")
        db.add(brand)
        await db.flush()

        prompt = Prompt(brand_id=brand.id, text="best CRM?")
        db.add(prompt)
        await db.flush()

        for name, created_at in competitors or []:
            db.add(Competitor(
                brand_id=brand.id,
                name=name,
                website_url=f"https://{name.lower()}.com",
                created_at=created_at,
            ))

        for run_spec in runs or []:
            run = TrackingRun(
                brand_id=brand.id,
                status="completed",
                run_type="manual",
                completed_at=run_spec["completed_at"],
                started_at=run_spec["completed_at"],
            )
            db.add(run)
            await db.flush()
            for q in run_spec.get("queries", []):
                db.add(QueryResult(
                    tracking_run_id=run.id,
                    prompt_id=prompt.id,
                    model=q["model"],
                    run_number=1,
                    mentioned=q["mentioned"],
                    response_text=q["response_text"],
                    error=None,
                    created_at=run_spec["completed_at"],
                ))

        await db.commit()
        return user.id, brand.id


# ── _resolve_window ──────────────────────────────────────────────────────────

def test_resolve_window_7d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("7d", now=now)

    # Naive UTC datetimes (matches TrackingRun.completed_at storage)
    assert start.tzinfo is None
    assert end.tzinfo is None
    assert end == datetime(2026, 5, 12, 14, 0, 0)
    assert start == end - timedelta(days=7)
    assert prior_end == start
    assert prior_start == start - timedelta(days=7)


def test_resolve_window_30d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("30d", now=now)

    assert (end - start) == timedelta(days=30)
    assert (prior_end - prior_start) == timedelta(days=30)
    assert prior_end == start


def test_resolve_window_90d():
    from app.services.competitive_gap import _resolve_window

    now = datetime(2026, 5, 12, 14, 0, 0, tzinfo=UTC)
    start, end, prior_start, prior_end = _resolve_window("90d", now=now)

    assert (end - start) == timedelta(days=90)


def test_resolve_window_invalid_raises():
    from app.services.competitive_gap import _resolve_window

    with pytest.raises(ValueError):
        _resolve_window("5d")


# ── _mention_matches ─────────────────────────────────────────────────────────

def test_mention_matches_exact():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("I love Notion for notes.", "Notion") is True


def test_mention_matches_case_insensitive():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("notion is great", "Notion") is True


def test_mention_matches_word_boundary_no_substring_false_positive():
    """Asana must NOT match inside Casana."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("Casana raised a Series A.", "Asana") is False


def test_mention_matches_punctuation_boundary():
    """Trailing punctuation should still count as a match."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("Try Asana. It's great.", "Asana") is True


def test_mention_matches_regex_metachars_escaped():
    """Names with regex metacharacters must not blow up."""
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("We use C++ heavily.", "C++") is True
    assert _mention_matches("See notion.so for docs.", "Notion.so") is True


def test_mention_matches_fuzzy_normalized():
    """When word-boundary fails, fall back to alphanumeric-normalized substring
    (mirrors brand detection in tracking_service)."""
    from app.services.competitive_gap import _mention_matches
    # "SpotItEarly" should match "Spot it Early" via the fuzzy path
    assert _mention_matches("Check out SpotItEarly today.", "Spot it Early") is True


def test_mention_matches_empty_text_returns_false():
    from app.services.competitive_gap import _mention_matches
    assert _mention_matches("", "Notion") is False
    assert _mention_matches(None, "Notion") is False


# ── _per_day_buckets ─────────────────────────────────────────────────────────

def test_per_day_buckets_groups_by_utc_date():
    from datetime import date, datetime
    from app.services.competitive_gap import _per_day_buckets

    rows = [
        ("rowA", datetime(2026, 5, 10, 9, 0)),
        ("rowB", datetime(2026, 5, 10, 23, 30)),
        ("rowC", datetime(2026, 5, 11, 8, 0)),
    ]
    out = _per_day_buckets(rows)

    assert set(out.keys()) == {date(2026, 5, 10), date(2026, 5, 11)}
    assert len(out[date(2026, 5, 10)]) == 2
    assert len(out[date(2026, 5, 11)]) == 1


def test_per_day_buckets_empty_input_returns_empty_dict():
    from app.services.competitive_gap import _per_day_buckets
    assert _per_day_buckets([]) == {}


# ── compute_competitive_gap (happy path) ─────────────────────────────────────

async def test_compute_happy_path_window_aggregate():
    """Brand at 2/3 (66.7%), one competitor mentioned 1/3 (33.3%) → gap +33.3pp."""
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    user_id, brand_id = await _seed_brand_with_runs(
        user_email="happy@example.com",
        competitors=[("Notion", today - timedelta(days=30))],
        runs=[{
            "completed_at": today - timedelta(hours=2),
            "queries": [
                {"model": "chatgpt", "mentioned": True, "response_text": "Acme is great."},
                {"model": "claude",  "mentioned": True, "response_text": "I'd suggest Acme."},
                {"model": "gemini",  "mentioned": False, "response_text": "Try Notion instead."},
            ],
        }],
    )

    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)

    assert resp.brand_id == brand_id
    assert resp.window == "7d"
    assert resp.has_competitors is True
    assert resp.has_data is True
    assert resp.brand_visibility_pct == pytest.approx(200 / 3, rel=1e-3)
    assert resp.competitor_avg_pct == pytest.approx(100 / 3, rel=1e-3)
    assert resp.headline_gap_pp == pytest.approx(100 / 3, rel=1e-3)  # 66.7 − 33.3
    assert resp.sample_count == 3
    assert resp.confidence == "low"  # <20 → low
    assert len(resp.competitors) == 1
    assert resp.competitors[0].name == "Notion"
    assert resp.competitors[0].competitor_pct == pytest.approx(100 / 3, rel=1e-3)


# ── compute_competitive_gap (edges) ──────────────────────────────────────────

async def test_compute_no_competitors_returns_has_competitors_false():
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    _, brand_id = await _seed_brand_with_runs(
        user_email="nocomp@example.com",
        competitors=[],
        runs=[{
            "completed_at": today - timedelta(hours=1),
            "queries": [{"model": "chatgpt", "mentioned": True, "response_text": "Acme!"}],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    assert resp.has_competitors is False
    assert resp.headline_gap_pp is None
    assert resp.competitor_avg_pct is None
    assert resp.competitors == []


async def test_compute_no_runs_returns_has_data_false():
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    _, brand_id = await _seed_brand_with_runs(
        user_email="noruns@example.com",
        competitors=[("Notion", today - timedelta(days=30))],
        runs=[],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    assert resp.has_competitors is True
    assert resp.has_data is False
    assert resp.headline_gap_pp is None


async def test_compute_recently_added_competitor_marked_no_data():
    """Competitor created today is excluded from prior-window aggregate;
    appears in the response with has_data=False if also after window_end."""
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    today = datetime.utcnow().replace(microsecond=0)
    # Competitor created in the FUTURE relative to window end → has_data False
    _, brand_id = await _seed_brand_with_runs(
        user_email="recentcomp@example.com",
        competitors=[("FutureCo", today + timedelta(days=1))],
        runs=[{
            "completed_at": today - timedelta(hours=1),
            "queries": [{"model": "chatgpt", "mentioned": True, "response_text": "Acme is great."}],
        }],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    assert len(resp.competitors) == 1
    assert resp.competitors[0].has_data is False
    # Headline gap is None — no eligible competitors in the window
    assert resp.headline_gap_pp is None


async def test_compute_per_day_trend_groups_multiple_runs_same_day():
    from datetime import datetime, timedelta
    from app.database import AsyncSessionLocal
    from app.services.competitive_gap import compute_competitive_gap

    # Pick a day strictly in the past so both runs are within the 7d window
    # regardless of the wall-clock hour at test runtime.
    base = (datetime.utcnow() - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    today_morning = base + timedelta(hours=8)
    today_evening = base + timedelta(hours=20)
    _, brand_id = await _seed_brand_with_runs(
        user_email="multiday@example.com",
        competitors=[("Notion", today_morning - timedelta(days=30))],
        runs=[
            {"completed_at": today_morning, "queries": [
                {"model": "chatgpt", "mentioned": True, "response_text": "Acme."},
            ]},
            {"completed_at": today_evening, "queries": [
                {"model": "chatgpt", "mentioned": False, "response_text": "Notion."},
            ]},
        ],
    )
    async with AsyncSessionLocal() as db:
        resp = await compute_competitive_gap(brand_id=brand_id, window="7d", db=db)
    # Both runs same UTC day → 1 trend point
    assert len(resp.trend) == 1


def test_confidence_thresholds():
    from app.services.competitive_gap import _confidence
    assert _confidence(0) == "low"
    assert _confidence(19) == "low"
    assert _confidence(20) == "medium"
    assert _confidence(99) == "medium"
    assert _confidence(100) == "high"
    assert _confidence(500) == "high"


# ── Endpoint: GET /api/dashboard/{brand_id}/competitive-gap ─────────────────

from tests.conftest import register_and_login, create_brand


async def test_endpoint_unauthenticated_returns_401(client: httpx.AsyncClient):
    resp = await client.get("/api/dashboard/1/competitive-gap")
    assert resp.status_code == 401


async def test_endpoint_wrong_owner_returns_403(client: httpx.AsyncClient):
    await register_and_login(client, email="owner@example.com")
    a_brand = await create_brand(client, name="A Brand")
    a_brand_id = a_brand["id"]
    await register_and_login(client, email="other@example.com")
    resp = await client.get(f"/api/dashboard/{a_brand_id}/competitive-gap")
    assert resp.status_code == 403


async def test_endpoint_default_window_is_7d(client: httpx.AsyncClient):
    await register_and_login(client, email="defwin@example.com")
    brand = await create_brand(client, name="Defwin Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap")
    assert resp.status_code == 200
    assert resp.json()["window"] == "7d"


async def test_endpoint_invalid_window_returns_422(client: httpx.AsyncClient):
    await register_and_login(client, email="badwin@example.com")
    brand = await create_brand(client, name="Badwin Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap?window=5d")
    assert resp.status_code == 422


async def test_endpoint_each_window_value(client: httpx.AsyncClient):
    await register_and_login(client, email="allwin@example.com")
    brand = await create_brand(client, name="Allwin Brand")
    for w in ("7d", "30d", "90d"):
        resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap?window={w}")
        assert resp.status_code == 200
        assert resp.json()["window"] == w


async def test_endpoint_no_competitors_returns_empty_shape(client: httpx.AsyncClient):
    await register_and_login(client, email="empty@example.com")
    brand = await create_brand(client, name="Empty Brand")
    resp = await client.get(f"/api/dashboard/{brand['id']}/competitive-gap")
    body = resp.json()
    assert resp.status_code == 200
    assert body["has_competitors"] is False
    assert body["has_data"] is False
    assert body["headline_gap_pp"] is None
    assert body["competitors"] == []
