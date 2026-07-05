from sqlalchemy import text as sqltext


async def test_new_columns_exist(db_session):
    cols_drafts = {r[1] for r in (await db_session.execute(
        sqltext("PRAGMA table_info(content_drafts)"))).all()}
    assert "target_title" in cols_drafts
    cols_clusters = {r[1] for r in (await db_session.execute(
        sqltext("PRAGMA table_info(content_clusters)"))).all()}
    assert "angle" in cols_clusters


def test_cluster_draft_schema_exposes_routing_fields():
    from app.schemas import ContentClusterDraft, ContentClusterDetail
    fields = ContentClusterDraft.model_fields
    assert "content_brief" in fields and "target_title" in fields
    assert "angle" in ContentClusterDetail.model_fields
