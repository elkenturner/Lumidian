"""Parsers — pure functions returning (measurements, findings)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Finding:
    check_id: str
    severity: str       # 'critical' | 'high' | 'medium' | 'low' | 'info'
    category: str       # 'bot_access' | 'content' | 'schema' | 'technical' | 'authority'
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParseOutput:
    measurements: dict[str, Any]
    findings: list[Finding]
