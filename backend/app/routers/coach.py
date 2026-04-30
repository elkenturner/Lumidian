"""Coach router: SSE message endpoint + usage endpoint."""
from fastapi import APIRouter
router = APIRouter(prefix="/api/coach", tags=["coach"])
