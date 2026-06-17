"""Template registry for the document engine."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Type

from pydantic import BaseModel
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
    # New (all optional during migration; Phase 4 makes them required and drops the old ones)
    required_fields: tuple[str, ...] = ()
    output_schema: Type[BaseModel] | None = None
    typst_template: str | None = None  # filename inside templates/ dir, e.g., "audit_initial.typ"
    chart_calls: tuple[Callable[[AsyncSession, AgencyClient, dict], Awaitable[bytes]], ...] = ()
    # Optional hook to mutate the typst_input dict AFTER the LLM call but BEFORE typst compile.
    # Used to inject deterministically-computed fields (e.g. kickoff pre_kickoff items) that
    # we don't want the LLM to hallucinate.
    post_process: Callable[[dict], dict] | None = None


TEMPLATES: dict[str, Template] = {}


def register(t: Template) -> Template:
    TEMPLATES[t.kind] = t
    return t


def get_template(kind: str) -> Template | None:
    return TEMPLATES.get(kind)


def list_templates() -> list[Template]:
    return list(TEMPLATES.values())
