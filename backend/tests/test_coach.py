"""Tests for the AI visibility coach."""
import json
import secrets

import pytest
from app.database import AsyncSessionLocal
from app.models import Brand, User
from app.services.coach_tools import (
    BrandNotOwnedError,
    ToolNotFoundError,
    dispatch_tool,
    register_tool,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create_user(email: str) -> int:
    """Insert a bare User row and return its id."""
    async with AsyncSessionLocal() as db:
        user = User(
            email=email,
            password_hash="x",
            email_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user.id


async def _create_brand(user_id: int, name: str) -> dict:
    """Insert a bare Brand row and return a dict with id + name."""
    slug = f"{name.lower().replace(' ', '-')}-{secrets.token_hex(4)}"
    async with AsyncSessionLocal() as db:
        brand = Brand(name=name, slug=slug, user_id=user_id)
        db.add(brand)
        await db.commit()
        await db.refresh(brand)
        return {"id": brand.id, "name": brand.name}


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dispatch_tool_unknown_tool_raises():
    async with AsyncSessionLocal() as db:
        with pytest.raises(ToolNotFoundError):
            await dispatch_tool(db, user_id=1, brand_id=1, tool_name="nonexistent", tool_args={})


@pytest.mark.asyncio
async def test_dispatch_tool_enforces_ownership():
    user_a_id = await _create_user("a@example.com")
    user_b_id = await _create_user("b@example.com")
    brand_a = await _create_brand(user_a_id, "Brand A")

    @register_tool(
        name="echo_brand",
        schema={
            "name": "echo_brand",
            "description": "test",
            "input_schema": {"type": "object", "properties": {}},
        },
        token_budget=200,
    )
    async def echo_brand(db, user_id, brand_id, **kwargs):
        return {"brand_id": brand_id}

    async with AsyncSessionLocal() as db:
        with pytest.raises(BrandNotOwnedError):
            await dispatch_tool(
                db,
                user_id=user_b_id,
                brand_id=brand_a["id"],
                tool_name="echo_brand",
                tool_args={},
            )


@pytest.mark.asyncio
async def test_dispatch_tool_truncates_oversize_results():
    user_id = await _create_user("c@example.com")
    brand = await _create_brand(user_id, "Brand C")

    @register_tool(
        name="big_payload",
        schema={
            "name": "big_payload",
            "description": "test",
            "input_schema": {"type": "object", "properties": {}},
        },
        token_budget=50,
    )
    async def big_payload(db, user_id, brand_id, **kwargs):
        return {"items": ["x" * 20 for _ in range(100)]}

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(
            db,
            user_id=user_id,
            brand_id=brand["id"],
            tool_name="big_payload",
            tool_args={},
        )

    serialized = json.dumps(result)
    assert len(serialized) <= 50 * 4 + 200, f"Expected truncation, got {len(serialized)} chars"
    assert result.get("_truncated") is True


@pytest.mark.asyncio
async def test_get_brand_overview_returns_expected_shape():
    user_id = await _create_user("o@example.com")
    brand = await _create_brand(user_id, "Brand O")

    async with AsyncSessionLocal() as db:
        # Add a couple of prompts so the list isn't empty
        from app.models import Prompt
        for text in ("best CRMs", "top sales tools"):
            db.add(Prompt(brand_id=brand["id"], text=text, prompt_type="standard"))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_brand_overview", tool_args={})

    assert result["brand_name"] == "Brand O"
    assert result["brand_type"] in ("standard", "pitch")
    assert "tier" in result and "tier_display" in result
    assert result["prompt_count"] == 2
    assert isinstance(result["prompts"], list) and len(result["prompts"]) == 2
    assert all(set(p.keys()) == {"id", "text"} for p in result["prompts"])
    assert result["latest_score"] is None  # no runs yet
    assert result["total_runs"] == 0


@pytest.mark.asyncio
async def test_get_score_breakdown_returns_per_model_and_per_prompt():
    user_id = await _create_user("sb@example.com")
    brand = await _create_brand(user_id, "Brand SB")

    async with AsyncSessionLocal() as db:
        from app.models import Prompt, TrackingRun, RunModelScore, QueryResult
        prompt = Prompt(brand_id=brand["id"], text="best CRMs", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        run = TrackingRun(brand_id=brand["id"], status="completed", overall_score=50.0, total_queries=4, total_mentions=2)
        db.add(run)
        await db.flush()
        db.add(RunModelScore(tracking_run_id=run.id, model="perplexity", total_queries=2, total_mentions=2, score=100.0))
        db.add(RunModelScore(tracking_run_id=run.id, model="gemini", total_queries=2, total_mentions=0, score=0.0))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity", run_number=1, response_text="...", mentioned=True))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity", run_number=2, response_text="...", mentioned=True))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="gemini", run_number=1, response_text="...", mentioned=False))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="gemini", run_number=2, response_text="...", mentioned=False))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_score_breakdown", tool_args={})

    assert result["overall_score"] == 50.0
    by_model = {m["model"]: m for m in result["per_model"]}
    assert by_model["perplexity"]["score"] == 100.0
    assert by_model["gemini"]["score"] == 0.0
    assert len(result["per_prompt"]) == 1
    assert result["per_prompt"][0]["prompt_text"] == "best CRMs"
    assert result["per_prompt"][0]["score"] == 50.0


@pytest.mark.asyncio
async def test_get_score_trend_returns_runs_in_descending_order():
    user_id = await _create_user("st@example.com")
    brand = await _create_brand(user_id, "Brand ST")

    async with AsyncSessionLocal() as db:
        from app.models import TrackingRun, RunModelScore
        from datetime import datetime, timedelta, timezone
        base = datetime.now(timezone.utc)
        for i in range(3):
            run = TrackingRun(
                brand_id=brand["id"],
                status="completed",
                overall_score=20.0 + i * 10,
                completed_at=base - timedelta(days=2 - i),
            )
            db.add(run)
            await db.flush()
            db.add(RunModelScore(tracking_run_id=run.id, model="perplexity", total_queries=4, total_mentions=int(i + 1), score=25.0 * (i + 1)))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_score_trend", tool_args={})

    assert len(result["runs"]) == 3
    # Most recent first
    assert result["runs"][0]["overall_score"] >= result["runs"][1]["overall_score"]
    assert "per_model" in result["runs"][0]
    assert "perplexity" in result["runs"][0]["per_model"]


@pytest.mark.asyncio
async def test_get_competitor_comparison_returns_head_to_head():
    user_id = await _create_user("cc@example.com")
    brand = await _create_brand(user_id, "Brand CC")

    async with AsyncSessionLocal() as db:
        from app.models import Prompt, TrackingRun, QueryResult, Competitor, CompetitorMention
        prompt = Prompt(brand_id=brand["id"], text="best CRMs", prompt_type="standard")
        db.add(prompt)
        comp = Competitor(brand_id=brand["id"], name="Acme")
        db.add(comp)
        await db.flush()
        run = TrackingRun(brand_id=brand["id"], status="completed", overall_score=50.0)
        db.add(run)
        await db.flush()
        # Brand mentioned in 1 of 2 queries
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity", run_number=1, response_text="...", mentioned=True))
        db.add(QueryResult(tracking_run_id=run.id, prompt_id=prompt.id, model="perplexity", run_number=2, response_text="...", mentioned=False))
        # Acme mentioned in 2 of 2 queries
        db.add(CompetitorMention(tracking_run_id=run.id, competitor_id=comp.id, prompt_id=prompt.id, model="perplexity", run_number=1, mentioned=True))
        db.add(CompetitorMention(tracking_run_id=run.id, competitor_id=comp.id, prompt_id=prompt.id, model="perplexity", run_number=2, mentioned=True))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_competitor_comparison", tool_args={})

    competitors = result["competitors"]
    assert len(competitors) == 1
    assert competitors[0]["name"] == "Acme"
    assert competitors[0]["mention_rate"] == 100.0  # 2/2
    assert result["brand_mention_rate"] == 50.0     # 1/2
    # Head-to-head: competitor wins on this prompt
    assert competitors[0]["wins_on_prompts"] >= 1


@pytest.mark.asyncio
async def test_get_content_gaps_returns_top_by_severity():
    user_id = await _create_user("cg@example.com")
    brand = await _create_brand(user_id, "Brand CG")

    async with AsyncSessionLocal() as db:
        from app.models import Prompt, TrackingRun, ContentGap
        prompt = Prompt(brand_id=brand["id"], text="best CRMs", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        run = TrackingRun(brand_id=brand["id"], status="completed")
        db.add(run)
        await db.flush()
        for sev, model in [(0.9, "perplexity"), (0.4, "gemini"), (0.6, "perplexity")]:
            db.add(ContentGap(
                brand_id=brand["id"],
                prompt_id=prompt.id,
                tracking_run_id=run.id,
                model=model,
                severity_score=sev,
                opportunity_score=0.5,
                gap_score=sev,
                competitor_mentions=json.dumps([]),
                platforms_lacking=json.dumps(["reddit"]),
                quora_questions=json.dumps([]),
            ))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_content_gaps", tool_args={"n": 2})

    assert len(result["gaps"]) == 2
    # Sorted by severity descending
    assert result["gaps"][0]["severity_score"] >= result["gaps"][1]["severity_score"]
    assert result["gaps"][0]["prompt_text"] == "best CRMs"


@pytest.mark.asyncio
async def test_get_drafts_summary_returns_counts_and_recent():
    user_id = await _create_user("ds@example.com")
    brand = await _create_brand(user_id, "Brand DS")

    async with AsyncSessionLocal() as db:
        from app.models import Prompt, ContentDraft
        prompt = Prompt(brand_id=brand["id"], text="best CRMs", prompt_type="standard")
        db.add(prompt)
        await db.flush()
        for status in ("draft", "draft", "approved", "posted"):
            db.add(ContentDraft(brand_id=brand["id"], prompt_id=prompt.id, platform="reddit", status=status, title=f"t-{status}", content_text="..."))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_drafts_summary", tool_args={})

    assert result["counts"]["draft"] == 2
    assert result["counts"]["approved"] == 1
    assert result["counts"]["posted"] == 1
    assert len(result["recent"]) <= 5
    assert result["link"] == f"/content/{brand['id']}"


@pytest.mark.asyncio
async def test_get_brand_profile_returns_nulls_when_missing():
    user_id = await _create_user("bp@example.com")
    brand = await _create_brand(user_id, "Brand BP")

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_brand_profile", tool_args={})

    assert "company_description" in result
    assert result["has_profile"] is False


@pytest.mark.asyncio
async def test_get_brand_profile_returns_filled_fields():
    user_id = await _create_user("bp2@example.com")
    brand = await _create_brand(user_id, "Brand BP2")

    async with AsyncSessionLocal() as db:
        from app.models import BrandProfile
        db.add(BrandProfile(
            brand_id=brand["id"],
            company_description="We make CRMs.",
            target_audience="SMB sales teams",
            tone_of_voice="friendly",
        ))
        await db.commit()

    async with AsyncSessionLocal() as db:
        result = await dispatch_tool(db, user_id=user_id, brand_id=brand["id"], tool_name="get_brand_profile", tool_args={})

    assert result["has_profile"] is True
    assert result["company_description"] == "We make CRMs."
    assert result["target_audience"] == "SMB sales teams"


def test_build_system_prompt_includes_all_blocks():
    from app.services.coach_prompt import build_system_prompt
    prompt = build_system_prompt(brand_name="Acme", tier_display="Free", brand_type="standard")
    for marker in (
        "ROLE & MISSION",
        "WHAT LUMIDIAN DOES",
        "INTERPRETATION RULES",
        "COACHING STYLE",
        "ANTI-PATTERNS",
        "FEW-SHOT EXAMPLES",
        "DOMAIN HEURISTICS",
    ):
        assert marker in prompt, f"Missing block: {marker}"
    assert "Acme" in prompt
    assert "Free" in prompt


def test_build_system_prompt_pro_tier_mentions_claude():
    from app.services.coach_prompt import build_system_prompt
    prompt = build_system_prompt(brand_name="Acme", tier_display="Pro", brand_type="standard")
    assert "Claude" in prompt


@pytest.mark.asyncio
async def test_rate_limit_enforces_tier_caps():
    from app.services.coach_rate_limit import check_and_increment, get_usage, DAILY_CAPS

    user_id = await _create_user("rl@example.com")
    # Default tier is None → "Free" → 5/day
    async with AsyncSessionLocal() as db:
        for i in range(5):
            ok, used, limit = await check_and_increment(db, user_id=user_id, tier=None)
            assert ok is True, f"Should be allowed at {i + 1}/{limit}"
            assert used == i + 1
            assert limit == DAILY_CAPS[None]

        # 6th must be blocked
        ok, used, limit = await check_and_increment(db, user_id=user_id, tier=None)
        assert ok is False
        assert used == 5
        assert limit == 5

    async with AsyncSessionLocal() as db:
        usage = await get_usage(db, user_id=user_id, tier=None)
    assert usage["used"] == 5
    assert usage["limit"] == 5


def test_daily_caps_match_spec():
    from app.services.coach_rate_limit import DAILY_CAPS
    assert DAILY_CAPS[None] == 5
    assert DAILY_CAPS["basic"] == 25
    assert DAILY_CAPS["starter"] == 75
    assert DAILY_CAPS["pro"] == 250
