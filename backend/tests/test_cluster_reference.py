from app.services.clustering_service import append_pillar_reference


def test_linkedin_post_appends_further_reading():
    out = append_pillar_reference(
        text="Post body.", platform="linkedin_post",
        pillar_url="https://example.com/medium-post",
    )
    assert "More detail here" in out
    assert "https://example.com/medium-post" in out
    # Pillar is the brand's own-site page now, not Medium — the label must
    # stay source-neutral.
    assert "Medium" not in out


def test_reddit_appends_nothing():
    # Updated July 2026: reddit is excluded from pillar references — outbound
    # links to own content are the classic spam fingerprint there.
    for platform in ("reddit", "reddit_reply", "reddit_comment"):
        out = append_pillar_reference(
            text="Post body.", platform=platform,
            pillar_url="https://example.com/medium-post",
        )
        assert out == "Post body."


def test_x_inserts_url_only_no_label():
    out = append_pillar_reference(
        text="A tweet.", platform="x_post",
        pillar_url="https://example.com/m",
    )
    assert "https://example.com/m" in out
    # X is space-constrained — no leading marketing label
    assert "More detail here" not in out


def test_medium_appends_nothing():
    out = append_pillar_reference(
        text="Long article.", platform="medium",
        pillar_url="https://example.com/m",
    )
    assert out == "Long article."


def test_wikipedia_appends_nothing():
    out = append_pillar_reference(
        text="Article.", platform="wikipedia",
        pillar_url="https://example.com/m",
    )
    assert out == "Article."


def test_quora_appends_further_reading():
    out = append_pillar_reference(
        text="Answer.", platform="quora",
        pillar_url="https://example.com/m",
    )
    assert "More detail here" in out
    assert "Medium" not in out


def test_no_url_returns_unchanged():
    out = append_pillar_reference(text="x", platform="linkedin_post", pillar_url=None)
    assert out == "x"


# ── Base-platform-name wiring (I1 regression) ────────────────────────────────
# regenerate_cluster's `_gen` calls append_pillar_reference with the BASE
# platform name it loops over ("linkedin", "x"), but `_APPENDS_PILLAR_REF`
# keys on the resolved variant vocabulary (linkedin_article, x_thread, ...).
# Without resolving first, base names never match and linkedin/x pieces
# silently never receive the pillar reference.

def test_base_linkedin_name_does_not_match_directly():
    """Documents the bug: the bare base name 'linkedin' is not a recognized key."""
    out = append_pillar_reference(
        text="Post body.", platform="linkedin",
        pillar_url="https://example.com/pillar",
    )
    assert out == "Post body."


def test_resolved_linkedin_key_gets_the_reference():
    from app.services.drafting.platforms import resolve_platform_key
    out = append_pillar_reference(
        text="Post body.", platform=resolve_platform_key("linkedin"),
        pillar_url="https://example.com/pillar",
    )
    assert "https://example.com/pillar" in out
    assert "More detail here" in out


def test_resolved_x_key_gets_the_reference():
    from app.services.drafting.platforms import resolve_platform_key
    out = append_pillar_reference(
        text="A tweet.", platform=resolve_platform_key("x"),
        pillar_url="https://example.com/pillar",
    )
    assert "https://example.com/pillar" in out
