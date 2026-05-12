"""Match own-domain pages to losing prompts via slug + title token overlap."""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


@dataclass
class PageLinkInput:
    id: int
    url: str
    title: str | None
    page_type: str


@dataclass
class PromptLinkInput:
    id: int
    text: str
    cited_urls: list[str]  # competitor/third-party URLs cited for this prompt


def _tokens(s: str | None) -> set[str]:
    if not s:
        return set()
    return {t.lower() for t in _TOKEN_RE.findall(s) if len(t) > 2}


def _slug(url: str) -> set[str]:
    path = urlparse(url).path
    return _tokens(path.replace("/", " ").replace("-", " ").replace("_", " "))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _page_type_for_cited(url: str) -> str:
    p = urlparse(url).path.lower()
    if "pricing" in p:
        return "pricing"
    if "about" in p or "team" in p:
        return "about"
    if "docs" in p or "api" in p or "help" in p:
        return "docs"
    if "blog" in p or "article" in p:
        return "article"
    return "other"


def score_url_match(*, own_url: str, own_title: str | None, own_page_type: str,
                    cited_url: str, prompt_text: str) -> float:
    slug_overlap = _jaccard(_slug(own_url), _slug(cited_url))
    title_overlap = _jaccard(_tokens(own_title), _tokens(prompt_text))
    page_type_match = 1.0 if own_page_type == _page_type_for_cited(cited_url) else 0.0
    return 0.5 * slug_overlap + 0.3 * title_overlap + 0.2 * page_type_match


def link_pages_to_prompts(
    pages: list[PageLinkInput],
    prompts: list[PromptLinkInput],
    *,
    threshold: float = 0.3,
) -> dict[int, list[int]]:
    """Return {page_id: [prompt_id, ...]}."""
    result: dict[int, list[int]] = {}
    for prompt in prompts:
        best_page_id: int | None = None
        best_score = threshold
        for cited in prompt.cited_urls:
            for page in pages:
                s = score_url_match(
                    own_url=page.url, own_title=page.title, own_page_type=page.page_type,
                    cited_url=cited, prompt_text=prompt.text,
                )
                if s > best_score:
                    best_score = s
                    best_page_id = page.id
        if best_page_id is not None:
            result.setdefault(best_page_id, []).append(prompt.id)
        else:
            # Fallback: top-1 page by title-token overlap with the prompt
            ranked = sorted(
                pages,
                key=lambda p: _jaccard(_tokens(p.title), _tokens(prompt.text)),
                reverse=True,
            )
            if ranked and _jaccard(_tokens(ranked[0].title), _tokens(prompt.text)) > 0.1:
                result.setdefault(ranked[0].id, []).append(prompt.id)
    return result
