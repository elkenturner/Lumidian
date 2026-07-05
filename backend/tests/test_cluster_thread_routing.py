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
