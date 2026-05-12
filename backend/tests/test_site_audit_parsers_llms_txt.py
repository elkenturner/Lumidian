from app.services.site_audit.parsers.llms_txt import parse_llms_txt

VALID = """# Acme

> Acme makes widgets.

## Key resources

- [Homepage](https://acme.com/)
- [Pricing](https://acme.com/pricing)
"""


def test_valid_llms_txt():
    out = parse_llms_txt(VALID)
    assert out.measurements["present"] is True
    assert out.measurements["valid"] is True
    ids = {f.check_id for f in out.findings}
    assert "llms_txt_present_valid" in ids


def test_missing_returns_info_finding():
    out = parse_llms_txt(None)
    assert out.measurements["present"] is False
    assert out.measurements["valid"] is False
    ids = {f.check_id for f in out.findings}
    assert "llms_txt_missing" in ids


def test_malformed_no_h1():
    out = parse_llms_txt("Random text without an H1 first.")
    assert out.measurements["valid"] is False
    ids = {f.check_id for f in out.findings}
    assert "llms_txt_malformed" in ids
