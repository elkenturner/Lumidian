"""Reddit thread-routing + Quora title tests for cluster post-target resolution.

Reddit pieces should prefer a real, high-relevance, un-actioned
``ContentOpportunity`` thread (generated via the ``reddit_comment`` spec) over
a standalone subreddit post. Quora targets should carry the resolved
question's title so it can be persisted on the draft.
"""
from unittest.mock import AsyncMock, patch


async def _seed_brand_prompt_cluster(db_session):
    from app.models import Brand, ContentCluster, Prompt, User
    user = User(email="route@example.com", password_hash="x", name="R")
    db_session.add(user); await db_session.flush()
    brand = Brand(name="RouteCo", slug="routeco", user_id=user.id)
    db_session.add(brand); await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="best widget tool?")
    db_session.add(prompt); await db_session.flush()
    cluster = ContentCluster(brand_id=brand.id, prompt_id=prompt.id, status="pending")
    db_session.add(cluster); await db_session.commit()
    return brand, prompt, cluster


async def test_reddit_routes_to_high_relevance_thread(db_session):
    from app.models import ContentOpportunity
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    opp = ContentOpportunity(
        brand_id=brand.id, prompt_id=prompt.id, platform="reddit",
        thread_url="https://reddit.com/r/widgets/comments/abc/best_widget",
        thread_title="Anyone compared widget tools?", subreddit="widgets",
        relevance_score=82.0, status="new",
    )
    db_session.add(opp); await db_session.commit()

    targets = await _resolve_post_targets(
        db_session, brand_id=brand.id, brand_name="RouteCo",
        prompt_id=prompt.id, prompt_text=prompt.text, enabled=["reddit"],
    )
    t = targets["reddit"]
    assert t["brief"] == opp.thread_url
    assert t["target_title"] == "Anyone compared widget tools?"
    assert t["platform_key_override"] == "reddit_comment"
    assert t["opportunity_id"] == opp.id
    assert "Anyone compared widget tools?" in t["opportunity"]
    assert t["subreddit"] == "widgets"


async def test_reddit_low_relevance_falls_back_to_post_mode(db_session):
    from app.models import ContentOpportunity
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    db_session.add(ContentOpportunity(
        brand_id=brand.id, prompt_id=prompt.id, platform="reddit",
        thread_url="https://reddit.com/x", thread_title="meh",
        relevance_score=45.0, status="new",
    ))
    await db_session.commit()
    with patch("app.services.reddit_scanner_service.get_relevant_subreddits", return_value=["widgets"]), \
         patch("app.services.reddit_scanner_service.find_first_valid_subreddit", new=AsyncMock(return_value="widgets")):
        targets = await _resolve_post_targets(
            db_session, brand_id=brand.id, brand_name="RouteCo",
            prompt_id=prompt.id, prompt_text=prompt.text, enabled=["reddit"],
        )
    assert targets["reddit"]["brief"] == "r/widgets"
    assert "platform_key_override" not in targets["reddit"]
    assert targets["reddit"]["subreddit"] == "widgets"


async def test_reddit_routes_preserve_r_initial_subreddit_name(db_session):
    # Regression for the .lstrip("r/") char-class bug: a bare r-initial
    # subreddit name like "rust" (as stored by the scanner) must survive
    # intact through routing and into the writer context as "r/rust", not
    # "r/ust".
    from app.models import ContentOpportunity
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    opp = ContentOpportunity(
        brand_id=brand.id, prompt_id=prompt.id, platform="reddit",
        thread_url="https://reddit.com/r/rust/comments/abc/best_widget",
        thread_title="Anyone compared widget tools?", subreddit="rust",
        relevance_score=82.0, status="new",
    )
    db_session.add(opp); await db_session.commit()

    targets = await _resolve_post_targets(
        db_session, brand_id=brand.id, brand_name="RouteCo",
        prompt_id=prompt.id, prompt_text=prompt.text, enabled=["reddit"],
    )
    t = targets["reddit"]
    assert t["subreddit"] == "rust"
    assert "r/rust" in t["opportunity"]


async def test_failed_reddit_piece_does_not_consume_opportunity(db_session):
    """Regression: routed_opp_ids used to be built from post_targets alone, so
    an opportunity got marked 'drafted' even when its piece failed to
    generate. It must stay 'new' so a future regen can retry it.
    """
    from app.database import AsyncSessionLocal
    from app.models import (
        Brand, ContentBrief, ContentCluster, ContentEvidencePack,
        ContentOpportunity, Prompt, User,
    )
    from app.services import clustering_service

    user = User(email="route-fail@example.com", password_hash="x", name="R")
    db_session.add(user); await db_session.flush()
    brand = Brand(name="RouteFailCo", slug="routefailco", user_id=user.id, tier="standard")
    db_session.add(brand); await db_session.flush()
    prompt = Prompt(brand_id=brand.id, text="best widget tool?")
    db_session.add(prompt); await db_session.flush()
    cluster = ContentCluster(
        brand_id=brand.id, prompt_id=prompt.id, status="ready", pillar_mode="none", version=1,
    )
    db_session.add(cluster); await db_session.flush()
    pack = ContentEvidencePack(cluster_id=cluster.id, version=1, sources=[])
    db_session.add(pack); await db_session.flush()
    brief = ContentBrief(
        cluster_id=cluster.id, version=1,
        positioning="p", key_claims=[], canonical_phrasings=[], stats=[],
        competitor_context={}, narrative_spine="spine", tone_notes="tone",
        created_by="system", evidence_pack_id=pack.id,
    )
    db_session.add(brief); await db_session.flush()
    cluster.last_brief_id = brief.id
    opp = ContentOpportunity(
        brand_id=brand.id, prompt_id=prompt.id, platform="reddit",
        thread_url="https://reddit.com/r/widgets/comments/abc/best_widget",
        thread_title="Anyone compared widget tools?", subreddit="widgets",
        relevance_score=82.0, status="new",
    )
    db_session.add(opp); await db_session.commit()
    cluster_id, opp_id, brand_id, prompt_id = cluster.id, opp.id, brand.id, prompt.id

    async def _no_platforms(db, brand_id):
        return ["reddit"]

    async def _fail_piece(db, **kwargs):
        raise RuntimeError("simulated generation failure")

    with patch.object(clustering_service, "_enabled_platforms", _no_platforms), \
         patch.object(clustering_service, "_generate_piece_text", _fail_piece):
        async with AsyncSessionLocal() as db:
            await clustering_service.regenerate_cluster(
                db, cluster_id=cluster_id, tier="pro", rebuild_brief=False,
            )

    async with AsyncSessionLocal() as db:
        opp_after = await db.get(ContentOpportunity, opp_id)
        assert opp_after.status == "new", (
            "opportunity was marked drafted despite its piece failing to generate"
        )


async def test_quora_target_includes_title(db_session):
    from app.services.clustering_service import _resolve_post_targets
    brand, prompt, _ = await _seed_brand_prompt_cluster(db_session)
    with patch("app.services.quora_search_service.search_quora_questions",
               new=AsyncMock(return_value=[{"title": "What is the best widget tool?",
                                            "url": "https://quora.com/q1", "snippet": "s"}])):
        targets = await _resolve_post_targets(
            db_session, brand_id=brand.id, brand_name="RouteCo",
            prompt_id=prompt.id, prompt_text=prompt.text, enabled=["quora"],
        )
    assert targets["quora"]["target_title"] == "What is the best widget tool?"
