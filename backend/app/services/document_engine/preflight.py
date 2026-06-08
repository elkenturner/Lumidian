"""Preflight data validation for PDF generation.

Each Template declares REQUIRED_FIELDS as dotted-path strings; check_required()
raises MissingDataError listing any unset ones BEFORE the LLM is called.
"""
from __future__ import annotations

from typing import Any


class MissingDataError(Exception):
    """Required brand-data fields are missing."""

    def __init__(self, missing: list[str]):
        super().__init__(f"Missing required fields: {', '.join(missing)}")
        self.missing = missing


def _get(data: Any, path: str) -> Any:
    cur = data
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
        if cur is None:
            return None
    return cur


def _is_empty(v: Any) -> bool:
    return v is None or v == "" or v == [] or v == {}


def check_required(required: list[str], data: dict[str, Any]) -> None:
    """Raise MissingDataError listing any of the dotted paths that resolve to None/empty."""
    missing = [p for p in required if _is_empty(_get(data, p))]
    if missing:
        raise MissingDataError(missing)
