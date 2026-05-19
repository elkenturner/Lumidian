"""Agency video pipeline endpoints."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from fastapi import status as http_status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_agency_staff
from app.models import AgencyClient, Brand, User, VideoMetadataJob
from app.schemas import VideoMetadataJobOut, VideoUploadResponse
from app.services.video_pipeline import pipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agency", tags=["agency-video"])

MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB
ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
TMP_DIR = Path("/tmp/lumidian-video")


async def _resolve_client_brand(
    db: AsyncSession, client_id: int, user: User
) -> tuple[AgencyClient, Brand]:
    """Verify the agency client exists and the brand is linked.

    Lumidian's agency model: staff users (is_agency_staff) have access to all agency clients.
    """
    client = await db.get(AgencyClient, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="agency client not found")
    brand = (await db.execute(
        select(Brand).where(
            Brand.agency_client_id == client_id, Brand.brand_type == "agency"
        ).limit(1)
    )).scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="no agency brand linked to this client")
    return client, brand


@router.post(
    "/clients/{client_id}/video/upload",
    response_model=VideoUploadResponse,
)
async def upload_video(
    client_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_agency_staff),
):
    _client, brand = await _resolve_client_brand(db, client_id, user)

    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail=f"unsupported media type: {file.content_type}")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix or ".mp4"
    tmp_path = TMP_DIR / f"{uuid.uuid4()}{suffix}"

    total = 0
    try:
        with tmp_path.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="file too large")
                out.write(chunk)
    except HTTPException:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise
    except Exception as e:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        logger.exception("upload write failed")
        raise HTTPException(status_code=500, detail="upload failed") from e

    job = VideoMetadataJob(
        agency_client_id=client_id,
        brand_id=brand.id,
        created_by=user.id,
        status="uploaded",
        filename=file.filename or "unknown.mp4",
        file_size_bytes=total,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(pipeline.process_job, job.id, tmp_path)
    return VideoUploadResponse(job_id=job.id, status=job.status)


@router.get(
    "/clients/{client_id}/video/jobs",
    response_model=list[VideoMetadataJobOut],
)
async def list_video_jobs(
    client_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    rows = await db.execute(
        select(VideoMetadataJob)
        .where(VideoMetadataJob.agency_client_id == client_id)
        .order_by(VideoMetadataJob.created_at.desc())
    )
    return rows.scalars().all()


@router.get(
    "/clients/{client_id}/video/jobs/{job_id}",
    response_model=VideoMetadataJobOut,
)
async def get_video_job(
    client_id: int,
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    job = await db.get(VideoMetadataJob, job_id)
    if not job or job.agency_client_id != client_id:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.post(
    "/clients/{client_id}/video/jobs/{job_id}/regenerate-metadata",
    response_model=VideoMetadataJobOut,
)
async def regenerate_video_metadata(
    client_id: int,
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    job = await db.get(VideoMetadataJob, job_id)
    if not job or job.agency_client_id != client_id:
        raise HTTPException(status_code=404, detail="job not found")
    if not job.transcript_text:
        raise HTTPException(status_code=409, detail="job has no transcript to regenerate from")
    await pipeline.regenerate_metadata(job_id)
    await db.refresh(job)
    return job


@router.delete(
    "/clients/{client_id}/video/jobs/{job_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
)
async def delete_video_job(
    client_id: int,
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_agency_staff),
):
    job = await db.get(VideoMetadataJob, job_id)
    if not job or job.agency_client_id != client_id:
        raise HTTPException(status_code=404, detail="job not found")
    await db.execute(delete(VideoMetadataJob).where(VideoMetadataJob.id == job_id))
    await db.commit()
