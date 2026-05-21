from app.services.source_authority import classify_domain, T1_DOMAINS, T2_DOMAINS


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


def test_t1_registry_minimum_size():
    assert len(T1_DOMAINS) >= 40, "T1 seed too small; add more entries"


def test_t2_registry_minimum_size():
    assert len(T2_DOMAINS) >= 60, "T2 seed too small; add more entries"


def test_t1_covers_major_categories():
    # Must include at least one entry from each major category bucket
    wire = {"reuters.com", "ap.org", "afp.com"}
    science = {"nature.com", "science.org", "thelancet.com", "nejm.org", "pnas.org"}
    policy = {"brookings.edu", "rand.org", "cfr.org", "imf.org", "worldbank.org", "oecd.org"}
    assert wire & T1_DOMAINS
    assert science & T1_DOMAINS
    assert policy & T1_DOMAINS
