from app.services.source_authority import classify_domain


def test_t1_includes_nytimes():
    assert classify_domain("nytimes.com") == "T1"


def test_t1_strips_www():
    assert classify_domain("www.nytimes.com") == "T1"


def test_gov_heuristic_to_t1():
    assert classify_domain("cdc.gov") == "T1"


def test_edu_heuristic_to_t1():
    assert classify_domain("stanford.edu") == "T1"


def test_t2_known_trade_press():
    assert classify_domain("techcrunch.com") == "T2"


def test_t3_default_for_unknown():
    assert classify_domain("randomblog.example.com") == "T3"


def test_t3_for_empty():
    assert classify_domain("") == "T3"
