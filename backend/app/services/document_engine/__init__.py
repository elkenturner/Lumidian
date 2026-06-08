"""Document engine — template registry + generator."""
from app.services.document_engine import (
    agency_weekly_report,
    audit_initial,
    kickoff_checklist,
    monthly_report,
    site_plan,
    sow,
    wikipedia_plan,
)
from app.services.document_engine.generator import generate_pdf
from app.services.document_engine.preflight import MissingDataError
from app.services.document_engine.registry import (
    TEMPLATES,
    Template,
    get_template,
    list_templates,
    register,
)
from app.services.document_engine.structured_output import LLMJSONError

__all__ = [
    "TEMPLATES",
    "Template",
    "generate_pdf",
    "get_template",
    "list_templates",
    "register",
    "MissingDataError",
    "LLMJSONError",
]
