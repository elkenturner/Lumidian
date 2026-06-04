from scripts.layer_a_citation_analysis import classify_domain


def test_classifies_core_platforms():
    assert classify_domain("reddit.com") == "reddit"
    assert classify_domain("old.reddit.com") == "reddit"
    assert classify_domain("www.reddit.com") == "reddit"
    assert classify_domain("quora.com") == "quora"
    assert classify_domain("medium.com") == "medium"
    assert classify_domain("some-pub.medium.com") == "medium"
    assert classify_domain("linkedin.com") == "linkedin"
    assert classify_domain("twitter.com") == "x"
    assert classify_domain("x.com") == "x"


def test_classifies_known_noise():
    assert classify_domain("google.com") == "search_redirect"
    assert classify_domain("vertexaisearch.cloud.google.com") == "search_redirect"
    assert classify_domain("youtube.com") == "youtube"
    assert classify_domain("en.wikipedia.org") == "wikipedia"


def test_unknown_is_other():
    assert classify_domain("manhattanstreetcapital.com") == "other"


def test_empty_domain_is_other():
    assert classify_domain("") == "other"
    assert classify_domain(None) == "other"
