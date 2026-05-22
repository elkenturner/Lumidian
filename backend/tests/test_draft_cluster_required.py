import pytest

from app.services.drafting_service import make_cluster_draft


def test_make_cluster_draft_requires_cluster_id():
    with pytest.raises(ValueError, match="cluster"):
        make_cluster_draft(
            brand_id=1,
            prompt_id=1,
            cluster_id=None,  # type: ignore[arg-type]
            platform="medium",
            content_text="x",
        )


def test_make_cluster_draft_builds_with_cluster_id():
    draft = make_cluster_draft(
        brand_id=1,
        prompt_id=2,
        cluster_id=3,
        platform="medium",
        content_text="body",
    )
    assert draft.cluster_id == 3
    assert draft.brand_id == 1
    assert draft.platform == "medium"
    assert draft.content_text == "body"
    assert draft.source == "cluster"
