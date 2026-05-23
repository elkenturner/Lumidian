"""Public, no-auth client portal router. Token-gated via ClientReviewLink.

All endpoints are read-only mirrors of SaaS surfaces, scoped to the brand
attached to the AgencyClient that owns the token.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import ClientViewContext, get_client_view_context
from app.schemas import (
    ClientPortalBrandOut,
    ClientPortalProposalOut,
)

router = APIRouter(prefix="/api/public/client", tags=["client-portal"])


@router.get("/{token}/brand", response_model=ClientPortalBrandOut)
async def get_brand(ctx: ClientViewContext = Depends(get_client_view_context)):
    """Brand summary for the portal home."""
    return ClientPortalBrandOut(
        id=ctx.brand.id,
        name=ctx.brand.name,
        slug=ctx.brand.slug,
        brand_type=ctx.brand.brand_type,
        website_url=ctx.brand.website_url,
    )


@router.get("/{token}/proposal", response_model=ClientPortalProposalOut)
async def get_proposal(ctx: ClientViewContext = Depends(get_client_view_context)):
    """Current 'this week's proposal' pointer (Google Doc URL + label).

    Returns nulls if not set — the frontend hides the card in that case.
    """
    return ClientPortalProposalOut(
        doc_url=ctx.agency_client.current_proposal_doc_url,
        label=ctx.agency_client.current_proposal_label,
    )
