from app.services.clustering_service import append_pillar_reference


def test_linkedin_post_appends_further_reading():
    out = append_pillar_reference(
        text="Post body.", platform="linkedin_post",
        pillar_url="https://example.com/medium-post",
    )
    assert "Further reading on Medium" in out
    assert "https://example.com/medium-post" in out


def test_reddit_appends_softly():
    out = append_pillar_reference(
        text="Post body.", platform="reddit",
        pillar_url="https://example.com/medium-post",
    )
    assert "Medium" in out and "https://example.com/medium-post" in out


def test_x_inserts_url_only_no_label():
    out = append_pillar_reference(
        text="A tweet.", platform="x_post",
        pillar_url="https://example.com/m",
    )
    assert "https://example.com/m" in out
    # X is space-constrained — no leading marketing label
    assert "Further reading" not in out


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
    assert "Further reading on Medium" in out


def test_no_url_returns_unchanged():
    out = append_pillar_reference(text="x", platform="linkedin_post", pillar_url=None)
    assert out == "x"
