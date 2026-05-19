"""Top-level orchestrator: walks a VideoMetadataJob through statuses."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import VideoMetadataJob, Brand, BrandProfile
from app.services.video_pipeline import audio_extractor, transcriber, metadata_generator, captions

logger = logging.getLogger(__name__)


async def _set_status(job_id: int, **fields) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(VideoMetadataJob, job_id)
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        await db.commit()


async def _fail(job_id: int, message: str, video_path: Path | None = None) -> None:
    logger.warning("Video job %d failed: %s", job_id, message)
    await _set_status(job_id, status="failed", error_message=message[-1000:],
                      completed_at=datetime.now(timezone.utc))
    _cleanup(video_path)


def _cleanup(*paths: Path | None) -> None:
    for p in paths:
        if p is None:
            continue
        try:
            if p.exists():
                p.unlink()
        except OSError as e:
            logger.warning("Failed to delete %s: %s", p, e)


async def _load_brand_profile(brand_id: int) -> tuple[str, dict]:
    """Return (brand_name, brand_profile_dict). Profile may be empty if none exists."""
    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        brand_name = brand.name if brand else ""
        result = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))
        profile = result.scalar_one_or_none()
    if not profile:
        return brand_name, {}
    return brand_name, {
        "company_description": profile.company_description,
        "tone_of_voice": profile.tone_of_voice,
        "target_audience": profile.target_audience,
        "approved_language": profile.approved_language,
        "what_not_to_say": profile.what_not_to_say,
        "key_stats": profile.key_stats,
    }


async def process_job(job_id: int, video_path: Path) -> None:
    """Run the full pipeline. video_path is the /tmp file produced by the upload endpoint."""
    audio_path: Path | None = None
    try:
        # ── transcribe ─────────────────────────────────────────────────────────
        await _set_status(job_id, status="transcribing")
        duration = audio_extractor.probe_duration(video_path)
        audio_path = video_path.with_suffix(".m4a")
        try:
            audio_extractor.extract_audio(video_path, audio_path)
        except audio_extractor.AudioExtractionError as e:
            return await _fail(job_id, str(e), video_path)

        if audio_extractor.should_chunk(audio_path):
            chunk_dir = audio_path.parent / f"{audio_path.stem}_chunks"
            try:
                chunks = audio_extractor.chunk_audio(audio_path, chunk_dir)
            except audio_extractor.AudioExtractionError as e:
                _cleanup(audio_path)
                return await _fail(job_id, str(e), video_path)
        else:
            chunks = [(audio_path, 0.0)]

        try:
            t_result = await transcriber.transcribe_chunks(chunks)
        except transcriber.TranscriptionError as e:
            for path, _ in chunks:
                _cleanup(path)
            _cleanup(audio_path)
            return await _fail(job_id, str(e), video_path)
        finally:
            for path, _ in chunks:
                if path != audio_path:
                    _cleanup(path)

        # Persist transcript + captions BEFORE the metadata pass so a Claude failure
        # still leaves us with usable output.
        transcript_text = t_result["text"]
        transcript_segments = t_result["segments"]
        srt = captions.segments_to_srt(transcript_segments)
        vtt = captions.segments_to_vtt(transcript_segments)
        await _set_status(
            job_id,
            status="generating",
            duration_seconds=duration,
            transcript_text=transcript_text,
            transcript_segments=transcript_segments,
            srt_content=srt,
            vtt_content=vtt,
        )
        _cleanup(audio_path)
        _cleanup(video_path)
        audio_path = None
        video_path = None  # type: ignore[assignment]

        # ── generate metadata ──────────────────────────────────────────────────
        async with AsyncSessionLocal() as db:
            job = await db.get(VideoMetadataJob, job_id)
            brand_id = job.brand_id if job else None
        if brand_id is None:
            return
        brand_name, brand_profile = await _load_brand_profile(brand_id)

        try:
            meta = await metadata_generator.generate_metadata(
                brand_name=brand_name, brand_profile=brand_profile, transcript=transcript_text,
            )
        except metadata_generator.MetadataGenerationError as e:
            logger.warning("Video job %d metadata generation failed: %s", job_id, e)
            await _set_status(
                job_id, status="completed", metadata_failed=True,
                error_message=str(e)[-1000:],
                completed_at=datetime.now(timezone.utc),
            )
            return

        await _set_status(
            job_id,
            status="completed",
            metadata_failed=False,
            ai_title=meta.title,
            ai_description=meta.description,
            ai_chapters=[c.model_dump() for c in meta.chapters],
            ai_tags=meta.tags,
            ai_jsonld=meta.jsonld,
            completed_at=datetime.now(timezone.utc),
        )
    except Exception as e:
        logger.exception("Video job %d unexpected error", job_id)
        await _fail(job_id, f"unexpected error: {e}", video_path)
    finally:
        _cleanup(audio_path, video_path)


async def regenerate_metadata(job_id: int) -> None:
    """Re-run only the Claude metadata pass against the cached transcript."""
    async with AsyncSessionLocal() as db:
        job = await db.get(VideoMetadataJob, job_id)
        if not job or not job.transcript_text:
            return
        brand_id = job.brand_id

    brand_name, brand_profile = await _load_brand_profile(brand_id)
    try:
        meta = await metadata_generator.generate_metadata(
            brand_name=brand_name, brand_profile=brand_profile, transcript=job.transcript_text,
        )
    except metadata_generator.MetadataGenerationError as e:
        await _set_status(job_id, metadata_failed=True, error_message=str(e)[-1000:])
        return

    await _set_status(
        job_id,
        metadata_failed=False,
        error_message=None,
        ai_title=meta.title,
        ai_description=meta.description,
        ai_chapters=[c.model_dump() for c in meta.chapters],
        ai_tags=meta.tags,
        ai_jsonld=meta.jsonld,
    )
