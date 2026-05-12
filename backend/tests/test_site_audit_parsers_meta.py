from app.services.site_audit.parsers.meta import parse_meta


def test_well_formed_meta():
    html = """<html><head>
    <title>How much does Acme cost?</title>
    <meta name="description" content="Acme costs $99/month for the Pro plan, billed annually. Volume discounts available.">
    </head><body>
    <article><div class="byline">By Jane Doe, published 2025-09-12</div></article>
    <img src="/x.png" alt="A diagram of widget assembly steps">
    </body></html>"""
    out = parse_meta(html, "https://acme.com/pricing", page_type="pricing")
    assert out.measurements["title"]
    assert out.measurements["meta_description"]
    ids = {f.check_id for f in out.findings}
    assert "missing_title" not in ids
    assert "missing_meta_description" not in ids


def test_missing_title_and_description():
    out = parse_meta("<html><head></head><body></body></html>",
                     "https://acme.com/foo", page_type="other")
    ids = {f.check_id for f in out.findings}
    assert "missing_title" in ids
    assert "missing_meta_description" in ids


def test_article_missing_byline_and_date():
    out = parse_meta("<html><body><h1>Article</h1></body></html>",
                     "https://acme.com/blog/x", page_type="article")
    ids = {f.check_id for f in out.findings}
    assert "missing_byline" in ids
    assert "missing_update_date" in ids


def test_image_alt_coverage():
    html = """<html><body>
    <img src="a.png">
    <img src="b.png" alt="">
    <img src="c.png" alt="image">
    <img src="d.png" alt="A diagram of the architecture">
    </body></html>"""
    out = parse_meta(html, "https://acme.com/x", page_type="other")
    ids = {f.check_id for f in out.findings}
    assert "low_alt_text_coverage" in ids
    assert out.measurements["image_count"] == 4
    assert out.measurements["image_alt_pct"] == 25.0
