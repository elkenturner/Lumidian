"""Template registry for the document engine."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgencyClient


@dataclass(frozen=True)
class Template:
    kind: str
    name: str
    description: str
    title_factory: Callable[[AgencyClient], str]
    fetch_data: Callable[[AsyncSession, AgencyClient], Awaitable[dict]]
    system_prompt: str
    user_prompt_template: str  # python-format string with `{data_json}` slot
    max_tokens: int


TEMPLATES: dict[str, Template] = {}


def register(t: Template) -> Template:
    TEMPLATES[t.kind] = t
    return t


def get_template(kind: str) -> Template | None:
    return TEMPLATES.get(kind)


def list_templates() -> list[Template]:
    return list(TEMPLATES.values())
