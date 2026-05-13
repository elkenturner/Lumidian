"""Document engine — template registry + generator."""
# Importing each template module triggers its register() call
from app.services.document_engine import (
    agency_weekly_report,  # noqa: F401
    audit_initial,  # noqa: F401
    kickoff_checklist,  # noqa: F401
    monthly_report,  # noqa: F401
    sow,  # noqa: F401
)
from app.services.document_engine.generator import generate_document
from app.services.document_engine.registry import (
    TEMPLATES,
    Template,
    get_template,
    list_templates,
    register,
)

__all__ = [
    "TEMPLATES",
    "Template",
    "generate_document",
    "get_template",
    "list_templates",
    "register",
]
