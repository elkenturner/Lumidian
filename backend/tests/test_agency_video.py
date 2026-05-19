"""Tests for the agency video pipeline + endpoints."""

from app.services.video_pipeline import captions


def test_segments_to_srt_basic():
    segments = [
        {"start": 0.0, "end": 2.5, "text": "Hello world."},
        {"start": 2.5, "end": 5.0, "text": "Second line."},
    ]
    out = captions.segments_to_srt(segments)
    assert out == (
        "1\n00:00:00,000 --> 00:00:02,500\nHello world.\n\n"
        "2\n00:00:02,500 --> 00:00:05,000\nSecond line.\n\n"
    )


def test_segments_to_srt_handles_hours():
    segments = [{"start": 3661.123, "end": 3662.456, "text": "Late."}]
    out = captions.segments_to_srt(segments)
    assert out.startswith("1\n01:01:01,123 --> 01:01:02,456\nLate.\n\n")


def test_segments_to_vtt_basic():
    segments = [
        {"start": 0.0, "end": 2.5, "text": "Hello."},
    ]
    out = captions.segments_to_vtt(segments)
    assert out == "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello.\n\n"


def test_segments_to_srt_empty():
    assert captions.segments_to_srt([]) == ""


def test_segments_to_vtt_empty():
    assert captions.segments_to_vtt([]) == "WEBVTT\n\n"


from pathlib import Path
from unittest.mock import patch, MagicMock

from app.services.video_pipeline import audio_extractor


def test_probe_duration_parses_ffprobe_output(tmp_path):
    fake_video = tmp_path / "vid.mp4"
    fake_video.write_bytes(b"fake")
    with patch("app.services.video_pipeline.audio_extractor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="42.5\n", stderr="")
        assert audio_extractor.probe_duration(fake_video) == 42.5


def test_probe_duration_returns_none_on_failure(tmp_path):
    fake_video = tmp_path / "vid.mp4"
    fake_video.write_bytes(b"fake")
    with patch("app.services.video_pipeline.audio_extractor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="bad")
        assert audio_extractor.probe_duration(fake_video) is None


def test_extract_audio_returns_dst_path_on_success(tmp_path):
    src = tmp_path / "vid.mp4"
    src.write_bytes(b"fake")
    dst = tmp_path / "vid.m4a"

    def fake_run(cmd, *args, **kwargs):
        # Simulate ffmpeg writing the output file
        dst.write_bytes(b"audio")
        return MagicMock(returncode=0, stderr="")

    with patch("app.services.video_pipeline.audio_extractor.subprocess.run", side_effect=fake_run):
        out = audio_extractor.extract_audio(src, dst)
    assert out == dst
    assert dst.exists()


def test_extract_audio_raises_on_ffmpeg_failure(tmp_path):
    src = tmp_path / "vid.mp4"
    src.write_bytes(b"fake")
    dst = tmp_path / "vid.m4a"
    with patch("app.services.video_pipeline.audio_extractor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stderr="bad codec")
        try:
            audio_extractor.extract_audio(src, dst)
        except audio_extractor.AudioExtractionError as e:
            assert "bad codec" in str(e)
        else:
            raise AssertionError("expected AudioExtractionError")


def test_should_chunk_returns_false_for_small_file(tmp_path):
    small = tmp_path / "small.m4a"
    small.write_bytes(b"x" * 1000)
    assert audio_extractor.should_chunk(small) is False


def test_should_chunk_returns_true_for_large_file(tmp_path):
    big = tmp_path / "big.m4a"
    big.write_bytes(b"x" * (25 * 1024 * 1024))  # 25 MB > 24 MB threshold
    assert audio_extractor.should_chunk(big) is True


import asyncio
from unittest.mock import AsyncMock, patch

from app.services.video_pipeline import transcriber


def test_offset_segments_shifts_timestamps():
    segs = [
        {"start": 0.0, "end": 2.0, "text": "a"},
        {"start": 2.0, "end": 4.0, "text": "b"},
    ]
    out = transcriber.offset_segments(segs, offset=10.0)
    assert out == [
        {"start": 10.0, "end": 12.0, "text": "a"},
        {"start": 12.0, "end": 14.0, "text": "b"},
    ]


def test_concatenate_text():
    assert transcriber.concatenate_text(["Hello.", " World."]) == "Hello. World."
    assert transcriber.concatenate_text(["  Hi  ", "there"]) == "Hi there"


def test_transcribe_chunks_reassembles(tmp_path):
    chunk_a = tmp_path / "a.m4a"; chunk_a.write_bytes(b"a")
    chunk_b = tmp_path / "b.m4a"; chunk_b.write_bytes(b"b")

    async def fake_call_whisper(path):
        if path.name == "a.m4a":
            return {"text": "Hello.", "segments": [{"start": 0.0, "end": 2.0, "text": "Hello."}]}
        return {"text": "World.", "segments": [{"start": 0.0, "end": 1.5, "text": "World."}]}

    with patch.object(transcriber, "_call_whisper", side_effect=fake_call_whisper):
        result = asyncio.run(transcriber.transcribe_chunks([(chunk_a, 0.0), (chunk_b, 2.0)]))
    assert result["text"] == "Hello. World."
    assert result["segments"] == [
        {"start": 0.0, "end": 2.0, "text": "Hello."},
        {"start": 2.0, "end": 3.5, "text": "World."},
    ]


def test_transcribe_chunks_raises_on_provider_error(tmp_path):
    chunk = tmp_path / "a.m4a"; chunk.write_bytes(b"a")

    async def fake_call_whisper(path):
        raise transcriber.TranscriptionError("rate limited")

    with patch.object(transcriber, "_call_whisper", side_effect=fake_call_whisper):
        try:
            asyncio.run(transcriber.transcribe_chunks([(chunk, 0.0)]))
        except transcriber.TranscriptionError as e:
            assert "rate limited" in str(e)
        else:
            raise AssertionError("expected TranscriptionError")


import json
from app.services.video_pipeline import metadata_generator


def test_build_prompt_includes_brand_profile_fields():
    profile = {
        "company_description": "Acme makes widgets.",
        "tone_of_voice": "direct, technical",
        "target_audience": "engineering managers",
        "approved_language": "ship, retention",
        "what_not_to_say": "synergy, leverage",
        "key_stats": "60% retention",
    }
    out = metadata_generator.build_prompt(brand_name="Acme", brand_profile=profile, transcript="Hello world.")
    assert "Acme" in out
    assert "direct, technical" in out
    assert "Hello world." in out
    assert "synergy" in out  # what_not_to_say included


def test_parse_response_success():
    raw = json.dumps({
        "title": "How does X work?",
        "description": "X is...",
        "chapters": [{"ts_seconds": 0, "label": "Intro"}],
        "tags": ["a", "b"],
        "jsonld": {"@type": "VideoObject"},
    })
    out = metadata_generator.parse_response(raw)
    assert out.title == "How does X work?"
    assert out.chapters[0].label == "Intro"
    assert out.jsonld == {"@type": "VideoObject"}


def test_parse_response_invalid_json_raises():
    try:
        metadata_generator.parse_response("not json")
    except metadata_generator.MetadataGenerationError:
        pass
    else:
        raise AssertionError("expected MetadataGenerationError")


def test_parse_response_missing_field_raises():
    raw = json.dumps({"title": "x"})  # missing description, chapters, tags, jsonld
    try:
        metadata_generator.parse_response(raw)
    except metadata_generator.MetadataGenerationError:
        pass
    else:
        raise AssertionError("expected MetadataGenerationError")


def test_generate_metadata_calls_claude(monkeypatch):
    fake_response = AsyncMock()
    fake_response.content = [type("Block", (), {"text": json.dumps({
        "title": "T", "description": "D",
        "chapters": [{"ts_seconds": 0, "label": "L"}],
        "tags": ["t"], "jsonld": {"@type": "VideoObject"},
    })})]

    async def fake_create(**_kwargs):
        return fake_response

    fake_client = type("C", (), {"messages": type("M", (), {"create": staticmethod(fake_create)})()})()

    with patch.object(metadata_generator, "_get_client", return_value=fake_client):
        result = asyncio.run(metadata_generator.generate_metadata(
            brand_name="X", brand_profile={}, transcript="hello"
        ))
    assert result.title == "T"


# ── Pipeline orchestrator tests ──────────────────────────────────────────────

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import AgencyClient, AgencyStaff, Brand, User, VideoMetadataJob
from tests.conftest import register_and_login


async def _make_agency_user(client, email: str = "video-staff@example.com") -> int:
    """Register, log in, and elevate to is_agency_staff. Returns the user's id."""
    await register_and_login(client, email=email)
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.email == email).values(is_agency_staff=True))
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        if not (
            await db.execute(select(AgencyStaff).where(AgencyStaff.user_id == user.id))
        ).scalar_one_or_none():
            db.add(AgencyStaff(user_id=user.id, role="owner", active=True))
        await db.commit()
    return user.id


async def _create_agency_client(client, name: str = "VidCo") -> tuple[int, int]:
    """POST /api/agency/clients and return (client_id, brand_id)."""
    resp = await client.post("/api/agency/clients", json={"name": name})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["brand_id"]


async def _insert_job(*, agency_client_id: int, brand_id: int, created_by: int | None,
                     status: str = "uploaded", **fields) -> VideoMetadataJob:
    async with AsyncSessionLocal() as db:
        job = VideoMetadataJob(
            agency_client_id=agency_client_id, brand_id=brand_id,
            created_by=created_by, status=status,
            filename=fields.pop("filename", "test.mp4"),
            file_size_bytes=fields.pop("file_size_bytes", 1024),
            **fields,
        )
        db.add(job); await db.commit(); await db.refresh(job)
    return job


@pytest.mark.asyncio
async def test_pipeline_happy_path(client, tmp_path):
    user_id = await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    job = await _insert_job(agency_client_id=cid, brand_id=brand_id, created_by=user_id)

    fake_video = tmp_path / "v.mp4"; fake_video.write_bytes(b"fake")
    fake_audio = tmp_path / "v.m4a"

    fake_transcript = {
        "text": "Hello world.",
        "segments": [{"start": 0.0, "end": 1.5, "text": "Hello world."}],
    }
    from app.services.video_pipeline.metadata_generator import MetadataOut, ChapterOut
    fake_meta = MetadataOut(
        title="How does X work?",
        description="X is...",
        chapters=[ChapterOut(ts_seconds=0, label="Intro")],
        tags=["a", "b"],
        jsonld={"@type": "VideoObject"},
    )

    def fake_extract(_src, dst):
        dst.write_bytes(b"audio")
        return dst

    with patch("app.services.video_pipeline.pipeline.audio_extractor.probe_duration", return_value=12.5), \
         patch("app.services.video_pipeline.pipeline.audio_extractor.extract_audio", side_effect=fake_extract), \
         patch("app.services.video_pipeline.pipeline.audio_extractor.should_chunk", return_value=False), \
         patch("app.services.video_pipeline.pipeline.transcriber.transcribe_chunks", new=AsyncMock(return_value=fake_transcript)), \
         patch("app.services.video_pipeline.pipeline.metadata_generator.generate_metadata", new=AsyncMock(return_value=fake_meta)):
        from app.services.video_pipeline import pipeline
        await pipeline.process_job(job.id, fake_video)

    async with AsyncSessionLocal() as db:
        result = await db.get(VideoMetadataJob, job.id)
    assert result.status == "completed"
    assert result.transcript_text == "Hello world."
    assert result.ai_title == "How does X work?"
    assert result.srt_content.startswith("1\n")
    assert not fake_video.exists()
    assert not fake_audio.exists()


@pytest.mark.asyncio
async def test_pipeline_transcription_failure_marks_failed(client, tmp_path):
    user_id = await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    job = await _insert_job(agency_client_id=cid, brand_id=brand_id, created_by=user_id)

    fake_video = tmp_path / "v.mp4"; fake_video.write_bytes(b"fake")

    def fake_extract(_src, dst):
        dst.write_bytes(b"audio")
        return dst

    from app.services.video_pipeline.transcriber import TranscriptionError
    with patch("app.services.video_pipeline.pipeline.audio_extractor.probe_duration", return_value=10.0), \
         patch("app.services.video_pipeline.pipeline.audio_extractor.extract_audio", side_effect=fake_extract), \
         patch("app.services.video_pipeline.pipeline.audio_extractor.should_chunk", return_value=False), \
         patch("app.services.video_pipeline.pipeline.transcriber.transcribe_chunks",
               new=AsyncMock(side_effect=TranscriptionError("rate limited"))):
        from app.services.video_pipeline import pipeline
        await pipeline.process_job(job.id, fake_video)

    async with AsyncSessionLocal() as db:
        result = await db.get(VideoMetadataJob, job.id)
    assert result.status == "failed"
    assert "rate limited" in (result.error_message or "")
    assert not fake_video.exists()


@pytest.mark.asyncio
async def test_pipeline_metadata_failure_keeps_transcript(client, tmp_path):
    user_id = await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    job = await _insert_job(agency_client_id=cid, brand_id=brand_id, created_by=user_id)

    fake_video = tmp_path / "v.mp4"; fake_video.write_bytes(b"fake")
    fake_transcript = {
        "text": "Hello.", "segments": [{"start": 0.0, "end": 1.0, "text": "Hello."}],
    }

    def fake_extract(_src, dst):
        dst.write_bytes(b"audio")
        return dst

    from app.services.video_pipeline.metadata_generator import MetadataGenerationError
    with patch("app.services.video_pipeline.pipeline.audio_extractor.probe_duration", return_value=5.0), \
         patch("app.services.video_pipeline.pipeline.audio_extractor.extract_audio", side_effect=fake_extract), \
         patch("app.services.video_pipeline.pipeline.audio_extractor.should_chunk", return_value=False), \
         patch("app.services.video_pipeline.pipeline.transcriber.transcribe_chunks", new=AsyncMock(return_value=fake_transcript)), \
         patch("app.services.video_pipeline.pipeline.metadata_generator.generate_metadata",
               new=AsyncMock(side_effect=MetadataGenerationError("validation"))):
        from app.services.video_pipeline import pipeline
        await pipeline.process_job(job.id, fake_video)

    async with AsyncSessionLocal() as db:
        result = await db.get(VideoMetadataJob, job.id)
    assert result.status == "completed"
    assert result.metadata_failed is True
    assert result.transcript_text == "Hello."
    assert result.srt_content.startswith("1\n")
    assert result.ai_title is None


# ── Endpoint tests ────────────────────────────────────────────────────────────

import io


@pytest.mark.asyncio
async def test_upload_creates_job(client):
    await _make_agency_user(client)
    cid, _brand = await _create_agency_client(client)
    files = {"file": ("test.mp4", io.BytesIO(b"x" * 2048), "video/mp4")}
    resp = await client.post(f"/api/agency/clients/{cid}/video/upload", files=files)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "job_id" in body
    assert body["status"] == "uploaded"


@pytest.mark.asyncio
async def test_upload_rejects_non_video_mime(client):
    await _make_agency_user(client)
    cid, _brand = await _create_agency_client(client)
    files = {"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")}
    resp = await client.post(f"/api/agency/clients/{cid}/video/upload", files=files)
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_upload_rejects_over_size_limit(client, monkeypatch):
    await _make_agency_user(client)
    cid, _brand = await _create_agency_client(client)
    from app.routers import agency_video
    monkeypatch.setattr(agency_video, "MAX_UPLOAD_BYTES", 1024)
    files = {"file": ("big.mp4", io.BytesIO(b"x" * 2048), "video/mp4")}
    resp = await client.post(f"/api/agency/clients/{cid}/video/upload", files=files)
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_upload_requires_staff(client):
    """Logged-in but non-staff user should get 403 from require_agency_staff."""
    await register_and_login(client, email="not-staff@example.com")
    # No is_agency_staff elevation. Create a client row directly so the endpoint
    # doesn't 404 before the staff check.
    async with AsyncSessionLocal() as db:
        ac = AgencyClient(name="X", slug="x-client", status="active")
        db.add(ac); await db.commit(); await db.refresh(ac)
        brand = Brand(
            name="X Brand", slug="x-brand", user_id=1,
            agency_client_id=ac.id, brand_type="agency",
        )
        db.add(brand); await db.commit()
        cid = ac.id

    files = {"file": ("t.mp4", io.BytesIO(b"x"), "video/mp4")}
    resp = await client.post(f"/api/agency/clients/{cid}/video/upload", files=files)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_upload_unknown_client_returns_404(client):
    await _make_agency_user(client)
    files = {"file": ("t.mp4", io.BytesIO(b"x"), "video/mp4")}
    resp = await client.post("/api/agency/clients/999999/video/upload", files=files)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_jobs_scoped_to_client(client):
    user_id = await _make_agency_user(client)
    cid_a, brand_a = await _create_agency_client(client, name="ClientA")
    cid_b, brand_b = await _create_agency_client(client, name="ClientB")
    await _insert_job(agency_client_id=cid_a, brand_id=brand_a, created_by=user_id,
                      status="completed", filename="a1.mp4")
    await _insert_job(agency_client_id=cid_a, brand_id=brand_a, created_by=user_id,
                      status="completed", filename="a2.mp4")
    await _insert_job(agency_client_id=cid_b, brand_id=brand_b, created_by=user_id,
                      status="completed", filename="b1.mp4")

    resp = await client.get(f"/api/agency/clients/{cid_a}/video/jobs")
    assert resp.status_code == 200
    fnames = {j["filename"] for j in resp.json()}
    assert fnames == {"a1.mp4", "a2.mp4"}


@pytest.mark.asyncio
async def test_get_job_returns_artifacts(client):
    user_id = await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    job = await _insert_job(
        agency_client_id=cid, brand_id=brand_id, created_by=user_id,
        status="completed", ai_title="Hello?", transcript_text="hi",
    )
    resp = await client.get(f"/api/agency/clients/{cid}/video/jobs/{job.id}")
    assert resp.status_code == 200
    assert resp.json()["ai_title"] == "Hello?"


@pytest.mark.asyncio
async def test_delete_job(client):
    user_id = await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    job = await _insert_job(
        agency_client_id=cid, brand_id=brand_id, created_by=user_id, status="completed",
    )
    resp = await client.delete(f"/api/agency/clients/{cid}/video/jobs/{job.id}")
    assert resp.status_code == 204
    async with AsyncSessionLocal() as db:
        rows = await db.execute(select(VideoMetadataJob).where(VideoMetadataJob.id == job.id))
        assert rows.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_regenerate_metadata_reruns_claude(client):
    user_id = await _make_agency_user(client)
    cid, brand_id = await _create_agency_client(client)
    job = await _insert_job(
        agency_client_id=cid, brand_id=brand_id, created_by=user_id,
        status="completed", transcript_text="hello world", ai_title="OLD",
    )

    from app.services.video_pipeline.metadata_generator import MetadataOut, ChapterOut
    fake_meta = MetadataOut(
        title="NEW", description="d", chapters=[ChapterOut(ts_seconds=0, label="L")],
        tags=["t"], jsonld={"@type": "VideoObject"},
    )
    with patch("app.services.video_pipeline.pipeline.metadata_generator.generate_metadata",
               new=AsyncMock(return_value=fake_meta)):
        resp = await client.post(
            f"/api/agency/clients/{cid}/video/jobs/{job.id}/regenerate-metadata"
        )
    assert resp.status_code == 200, resp.text
    async with AsyncSessionLocal() as db:
        refreshed = await db.get(VideoMetadataJob, job.id)
    assert refreshed.ai_title == "NEW"
    assert refreshed.transcript_text == "hello world"  # unchanged


# ── Orphan sweep tests ────────────────────────────────────────────────────────

import os
import time

from app.services.video_pipeline.orphan_sweep import sweep_orphan_files


def test_sweep_deletes_files_older_than_max_age(tmp_path):
    old = tmp_path / "old.mp4"
    new = tmp_path / "new.mp4"
    old.write_bytes(b"x")
    new.write_bytes(b"x")
    # Set mtime of old to 2 hours ago.
    two_hours_ago = time.time() - 7200
    os.utime(old, (two_hours_ago, two_hours_ago))

    sweep_orphan_files(tmp_path, max_age_seconds=3600)
    assert not old.exists()
    assert new.exists()


def test_sweep_handles_missing_dir(tmp_path):
    sweep_orphan_files(tmp_path / "does-not-exist", max_age_seconds=3600)  # no exception
