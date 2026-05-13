import pytest
from app.services.site_audit.artifact_generator import (
    ARTIFACT_TYPES, LLM_ARTIFACT_TYPES, ArtifactResult,
)


def test_artifact_types_enum_complete():
    expected = {
        "jsonld_org", "jsonld_faq", "jsonld_article", "jsonld_breadcrumb",
        "jsonld_product", "jsonld_howto", "meta_title", "meta_description",
        "h1_text", "og_tags", "faq_section", "section_rewrite",
        "new_page_draft", "alt_text_batch", "llms_txt", "robots_snippet",
        "agents_md", "internal_link_suggestions",
    }
    assert expected.issubset(ARTIFACT_TYPES)


def test_llm_artifact_types_subset_of_artifact_types():
    assert LLM_ARTIFACT_TYPES.issubset(ARTIFACT_TYPES)


def test_artifact_result_dataclass():
    r = ArtifactResult(artifact="x", artifact_type="meta_title")
    assert r.artifact == "x"
    assert r.artifact_type == "meta_title"
