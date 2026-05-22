"""Tests for the client portal (read-only token-gated mirror of SaaS surfaces)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.models import AgencyClient
from tests.conftest import register_user, login_user


@pytest.mark.asyncio
async def test_agency_client_has_proposal_columns(client: AsyncClient, db_session):
    """AgencyClient table has current_proposal_doc_url and current_proposal_label columns."""
    ac = AgencyClient(
        name="Acme Inc",
        slug="acme-inc",
        status="active",
        current_proposal_doc_url="https://docs.google.com/document/d/abc",
        current_proposal_label="Week of May 22 — 5 pieces",
    )
    db_session.add(ac)
    await db_session.commit()
    await db_session.refresh(ac)
    assert ac.current_proposal_doc_url == "https://docs.google.com/document/d/abc"
    assert ac.current_proposal_label == "Week of May 22 — 5 pieces"
