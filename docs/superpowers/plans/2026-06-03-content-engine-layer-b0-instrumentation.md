# Layer B0 — Instrumentation Foundation — Implementation Plan

> Executes the B0 section of `docs/superpowers/specs/2026-06-03-content-engine-layer-b-design.md`. Measurement-only: fixes Claude + Gemini citation blindness. No drafting/scoring/UX change.

**Goal:** All four tracked models report citations correctly into `CitationSource`.

**Architecture:** Add structured-citation extraction for Claude; capture Gemini's real domain via `web.title`; guard the Gemini JSON-schema footgun. TDD with mocked SDK response shapes — no live API calls.

**Files:** `backend/app/services/llm_service.py`, `backend/app/services/site_audit/citations.py`, `backend/tests/test_llm_citations.py` (new).

---

## Task 1: Claude structured citation extraction (B0.1)

**Files:** `app/services/llm_service.py` (add `_extract_claude_citations`, wire into `_query_claude` return); `tests/test_llm_citations.py` (new).

- [ ] **Step 1: Failing tests** — mocked Claude response shapes:
```python
import types
from app.services.llm_service import _extract_claude_citations

def _block(**kw): return types.SimpleNamespace(**kw)

def test_claude_citations_from_text_blocks():
    # text block carries .citations[] of web_search_result_location objects
    cite = _block(type="web_search_result_location", url="https://a.com/x", title="A")
    text_block = _block(type="text", text="answer", citations=[cite])
    resp = _block(content=[text_block])
    out = _extract_claude_citations(resp)
    assert out == [{"url": "https://a.com/x", "title": "A"}]

def test_claude_dedupes_and_handles_no_citations_attr():
    t1 = _block(type="text", text="a", citations=[_block(url="https://a.com", title=None)])
    t2 = _block(type="text", text="b", citations=[_block(url="https://a.com", title=None)])  # dup
    t3 = _block(type="text", text="c")  # no citations attr
    resp = _block(content=[t1, t2, t3])
    assert _extract_claude_citations(resp) == [{"url": "https://a.com", "title": None}]

def test_claude_returns_none_when_no_search():
    resp = _block(content=[_block(type="text", text="plain answer")])
    assert _extract_claude_citations(resp) is None

def test_claude_handles_tool_error_dict_content():
    # web_search_tool_result.content can be a dict (error), not a list — must not crash
    bad = _block(type="web_search_tool_result", content={"type": "error"})
    resp = _block(content=[bad])
    assert _extract_claude_citations(resp) is None
```

- [ ] **Step 2: Run, verify fail** — `cd backend && python -m pytest tests/test_llm_citations.py -k claude -v` → FAIL (`_extract_claude_citations` undefined).

- [ ] **Step 3: Implement** in `llm_service.py` after `_extract_claude_text`:
```python
def _extract_claude_citations(response) -> list[dict] | None:
    """Extract the URLs Claude actually cited from web_search.

    Claude returns citations as STRUCTURED objects, not inline prose URLs:
    each `text` block may carry a `.citations[]` array of web_search_result_location
    objects (.url/.title) — the *actually cited* set. We prefer those. Returns
    None when no web search produced citations (clean prose / search disabled).
    """
    out: list[dict] = []
    seen: set[str] = set()
    for block in getattr(response, "content", None) or []:
        cites = getattr(block, "citations", None)
        if not isinstance(cites, list):
            continue
        for c in cites:
            url = getattr(c, "url", None)
            if not url or url in seen:
                continue
            seen.add(url)
            out.append({"url": url, "title": getattr(c, "title", None)})
    return out or None
```

- [ ] **Step 4: Wire into `_query_claude`** — replace the success-return dict (`:399-404`) so it includes citations:
```python
        cleaned = _strip_url_citations(text)
        mentioned = _mentioned(brand_name, cleaned)
        return {
            "response_text": text,
            "mentioned": mentioned,
            "latency_ms": latency_ms,
            "error": None,
            "citations": _extract_claude_citations(response),
        }
```

- [ ] **Step 5: Run, verify pass** — `pytest tests/test_llm_citations.py -k claude -v` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "fix(llm): extract Claude structured web_search citations (was 100% blind)"`

---

## Task 2: Gemini real-domain capture (B0.2)

**Files:** `app/services/llm_service.py` (`_extract_gemini_citations` adds `domain_hint`); `app/services/site_audit/citations.py` (`extract_for_run` prefers `domain_hint`); `tests/test_llm_citations.py`.

- [ ] **Step 1: Failing test** — Gemini chunk with redirect uri + bare-domain title:
```python
from app.services.llm_service import _extract_gemini_citations

def test_gemini_captures_domain_hint_from_title():
    web = _block(uri="https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC", title="reddit.com")
    chunk = _block(web=web)
    meta = _block(grounding_chunks=[chunk])
    cand = _block(grounding_metadata=meta)
    resp = _block(candidates=[cand])
    out = _extract_gemini_citations(resp)
    assert out == [{"url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC",
                    "title": "reddit.com", "domain_hint": "reddit.com"}]
```

- [ ] **Step 2: Run, verify fail** — `pytest tests/test_llm_citations.py -k gemini -v` → FAIL (no `domain_hint` key).

- [ ] **Step 3: Implement** — in `_extract_gemini_citations`, when the uri is a grounding redirect, set `domain_hint` from `web.title`:
```python
        url = getattr(web, "uri", None)
        if not url or url in seen:
            continue
        seen.add(url)
        title = getattr(web, "title", None)
        item = {"url": url, "title": title}
        # The uri is an opaque grounding-redirect proxy; web.title carries the
        # bare domain (e.g. "reddit.com"). Capture it so citation classification
        # sees the real domain instead of resolving the proxy to google.com.
        if title and "grounding-api-redirect" in url:
            item["domain_hint"] = title
        out.append(item)
```

- [ ] **Step 4: Consume the hint in `citations.py:extract_for_run`** — in the `structured` loop, prefer `domain_hint` for domain classification. Change the structured-item handling (around `:123-135`) so a `domain_hint` overrides the domain derived from the proxy URL. Add a failing test first in `tests/test_llm_citations.py` exercising a small helper, OR (simpler, no DB) factor the domain choice into a pure helper `_domain_for_citation(item)` in `citations.py` and unit-test it:
```python
# in citations.py
def _domain_for_citation(item: dict, fallback_url: str) -> str | None:
    hint = item.get("domain_hint")
    if hint:
        return hint.lower().lstrip("www.")
    from app.services.site_audit.url_utils import registered_domain  # existing helper
    return registered_domain(fallback_url)
```
Test:
```python
from app.services.site_audit.citations import _domain_for_citation
def test_domain_hint_overrides_proxy():
    item = {"url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x", "domain_hint": "reddit.com"}
    assert _domain_for_citation(item, item["url"]) == "reddit.com"
```
Then use `_domain_for_citation` when building the `CitationSource.domain` for structured items (keep `classify_url` for kind/own/competitor, but override `.domain` with the hint when present). Keep this change minimal and behind the hint's presence so non-Gemini items are unaffected.

- [ ] **Step 5: Run, verify pass** — `pytest tests/test_llm_citations.py -k "gemini or domain" -v` → PASS.

- [ ] **Step 6: Commit** — `git commit -am "fix(llm): capture Gemini real domain via web.title (was all google.com)"`

---

## Task 3: Gemini JSON-schema guardrail (B0.3)

**Files:** `app/services/llm_service.py` (`_query_gemini` grounded-config site, `:505-508`).

- [ ] **Step 1: Add a guard comment + assertion** at the grounded-config construction so a future schema addition fails loudly:
```python
        # GUARDRAIL (Layer B0): a forced response_schema/response_mime_type on a
        # GROUNDED Gemini call silently nulls grounding_metadata → citation loss.
        # Never set a JSON schema on this config. If you need structured output,
        # use a SEPARATE ungrounded call.
        assert "response_schema" not in (grounded_config_kwargs or {}), \
            "grounded Gemini call must not set response_schema (nulls grounding)"
```
(adapt variable name to the actual config kwargs at that site).

- [ ] **Step 2: Run full suite** — `cd backend && python -m pytest -q` → all green.

- [ ] **Step 3: Commit** — `git commit -am "chore(llm): guardrail against schema-on-grounded-Gemini citation loss"`

---

## Self-review
- Spec coverage: B0.1→T1, B0.2→T2, B0.3→T3. B0.4 (stale duplicate) intentionally deferred to B2 per spec.
- Each task: failing test → impl → pass → commit.
- Defensive parsing mirrors existing extractors (getattr + type guards); worst case returns None, never crashes tracking.
- No drafting/scoring/mention changes — measurement only.
