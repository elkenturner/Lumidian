# Agency Video Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-client `Video` tab to the agency cockpit that turns a finished video upload into a paste-ready YouTube metadata package (title / description / chapters / tags / JSON-LD + `.srt` / `.vtt` captions) optimized for AI retrieval.

**Architecture:** Streaming multipart upload → ffmpeg audio extract → Whisper transcribe (chunked at silence boundaries if > 24 MB) → Claude Sonnet metadata generation using the client's `BrandProfile`. Job state persisted on a new `VideoMetadataJob` ORM table. Video + audio files discarded after processing. Frontend tab polls job status every 2 s.

**Tech Stack:** FastAPI (`UploadFile`, `BackgroundTask`), SQLAlchemy async, ffmpeg subprocess, OpenAI Whisper API, Anthropic Claude Sonnet, pytest. Next.js / React / Tailwind / Axios on the frontend.

**Spec:** `docs/superpowers/specs/2026-05-18-agency-video-tab-design.md`

---

## File Structure

### Backend — Create

| Path | Responsibility |
|---|---|
| `backend/app/services/video_pipeline/__init__.py` | Package marker |
| `backend/app/services/video_pipeline/captions.py` | Pure functions: segments → `.srt` / `.vtt` strings |
| `backend/app/services/video_pipeline/audio_extractor.py` | ffmpeg subprocess: extract audio, capture duration, chunk at silence if > 24 MB |
| `backend/app/services/video_pipeline/transcriber.py` | Whisper API client w/ `Semaphore(2)`, chunk reassembly with timestamp offsets |
| `backend/app/services/video_pipeline/metadata_generator.py` | Claude Sonnet structured-output call; Pydantic-validated artifacts |
| `backend/app/services/video_pipeline/pipeline.py` | Top-level orchestrator: walks a job through statuses, guarantees tmp cleanup |
| `backend/app/services/video_pipeline/orphan_sweep.py` | Startup hook: deletes orphan tmp files older than 1 hour |
| `backend/app/routers/agency_video.py` | 5 endpoints, all gated by `require_agency_staff` |
| `backend/tests/test_agency_video.py` | Backend test suite (11 tests) |

### Backend — Modify

| Path | Reason |
|---|---|
| `backend/app/models.py` | Add `VideoMetadataJob` model |
| `backend/app/schemas.py` | Add request/response schemas for the 5 endpoints |
| `backend/app/main.py` | Mount `agency_video` router; wire `orphan_sweep.run_orphan_sweep()` into the lifespan startup |

### Frontend — Create

| Path | Responsibility |
|---|---|
| `frontend/app/agency/clients/[id]/video/page.tsx` | Tab route — orchestrates UploadZone + JobsList + ResultPanel |
| `frontend/components/agency/video/UploadZone.tsx` | Drag-and-drop, progress bar |
| `frontend/components/agency/video/JobsList.tsx` | Recent jobs for the client + status pills |
| `frontend/components/agency/video/ResultPanel.tsx` | Composes the artifact cards + transcript + downloads |
| `frontend/components/agency/video/ArtifactCard.tsx` | Reusable card w/ copy button |
| `frontend/components/agency/video/TranscriptViewer.tsx` | Collapsible transcript with timestamps |
| `frontend/components/agency/video/CaptionDownloadButton.tsx` | `.srt` / `.vtt` download |
| `frontend/components/agency/video/RegenerateMetadataButton.tsx` | Confirmation + POST + poll |

### Frontend — Modify

| Path | Reason |
|---|---|
| `frontend/lib/api.ts` | Add 5 video methods + the `VideoMetadataJob` type |
| `frontend/app/agency/clients/[id]/page.tsx` (or wherever the client-detail tab nav lives) | Add `Video` tab entry pointing to `./video` |

---

## Task 1: Add `VideoMetadataJob` ORM model

**Files:** Modify `backend/app/models.py`

- [ ] **Step 1: Append the model below the existing agency models** (after `ClientReviewLink`, before the `# ── Website AIO module ──` header — approximately line 760)

```python
class VideoMetadataJob(Base):
    __tablename__ = "video_metadata_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded", index=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_segments: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    ai_title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ai_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_chapters: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_jsonld: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    srt_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    vtt_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    metadata_failed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

No `run_migrations()` entry needed — `create_tables()` (which runs on startup before migrations) creates new tables from the ORM models. Migrations are only required for `ALTER TABLE` operations on existing tables.

- [ ] **Step 2: Verify imports at top of `models.py` include `JSON`, `Float`, `Text`, `Boolean`, `ForeignKey`, `String`, `Integer`, `DateTime`, `Mapped`, `mapped_column`, `Base`, `utcnow`**

These are all imported already (used by `WebsiteAudit` etc.). No changes needed; just confirm.

- [ ] **Step 3: Commit**

```bash
git add backend/app/models.py
git commit -m "feat(video): add VideoMetadataJob ORM model"
```

---

## Task 2: Captions module (TDD)

**Files:**
- Create: `backend/app/services/video_pipeline/__init__.py` (empty)
- Create: `backend/app/services/video_pipeline/captions.py`
- Test: `backend/tests/test_agency_video.py` (will grow throughout the plan; create here)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_agency_video.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && source venv/bin/activate
pytest tests/test_agency_video.py -v
```

Expected: 5 failures with `ModuleNotFoundError: No module named 'app.services.video_pipeline'`.

- [ ] **Step 3: Create the package and the captions module**

Create `backend/app/services/video_pipeline/__init__.py` empty.

Create `backend/app/services/video_pipeline/captions.py`:

```python
"""Pure functions for converting transcript segments into SubRip/WebVTT formats."""

from __future__ import annotations


def _format_srt_timestamp(seconds: float) -> str:
    total_ms = int(round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _format_vtt_timestamp(seconds: float) -> str:
    return _format_srt_timestamp(seconds).replace(",", ".")


def segments_to_srt(segments: list[dict]) -> str:
    """Render Whisper segments as a SubRip (.srt) string."""
    lines = []
    for idx, seg in enumerate(segments, start=1):
        start = _format_srt_timestamp(float(seg["start"]))
        end = _format_srt_timestamp(float(seg["end"]))
        text = str(seg["text"]).strip()
        lines.append(f"{idx}\n{start} --> {end}\n{text}\n\n")
    return "".join(lines)


def segments_to_vtt(segments: list[dict]) -> str:
    """Render Whisper segments as a WebVTT (.vtt) string."""
    parts = ["WEBVTT\n\n"]
    for seg in segments:
        start = _format_vtt_timestamp(float(seg["start"]))
        end = _format_vtt_timestamp(float(seg["end"]))
        text = str(seg["text"]).strip()
        parts.append(f"{start} --> {end}\n{text}\n\n")
    return "".join(parts)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_agency_video.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_pipeline/__init__.py backend/app/services/video_pipeline/captions.py backend/tests/test_agency_video.py
git commit -m "feat(video): captions module — segments to SRT/VTT"
```

---

## Task 3: Audio extractor (TDD)

The audio extractor wraps two ffmpeg subprocess calls (`ffprobe` for duration, `ffmpeg` for audio extraction) and optionally chunks the result. Subprocesses are mocked in tests.

**Files:**
- Create: `backend/app/services/video_pipeline/audio_extractor.py`
- Test: append to `backend/tests/test_agency_video.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_agency_video.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pytest tests/test_agency_video.py -v
```

Expected: import errors for `audio_extractor`.

- [ ] **Step 3: Implement the module**

Create `backend/app/services/video_pipeline/audio_extractor.py`:

```python
"""ffmpeg-based audio extraction and chunking."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Whisper's hard cap is 25 MB. We chunk at 24 MB to leave headroom.
CHUNK_THRESHOLD_BYTES = 24 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 600  # 10 min ceiling per ffmpeg call


class AudioExtractionError(RuntimeError):
    """ffmpeg or ffprobe returned non-zero or the input has no audio."""


def probe_duration(video_path: Path) -> float | None:
    """Return the duration of `video_path` in seconds, or None if ffprobe fails."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("ffprobe failed for %s: %s", video_path, e)
        return None
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def extract_audio(src: Path, dst: Path) -> Path:
    """Extract mono 96 kbps AAC audio from `src` to `dst`. Raises on failure."""
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-vn", "-acodec", "aac",
        "-b:a", "96k", "-ac", "1",
        str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=DEFAULT_TIMEOUT_SECONDS)
    if result.returncode != 0:
        # Keep only the tail of stderr so we don't blow up error_message.
        tail = (result.stderr or "")[-500:]
        raise AudioExtractionError(f"ffmpeg failed: {tail}")
    if not dst.exists() or dst.stat().st_size == 0:
        raise AudioExtractionError("ffmpeg produced no audio output (no audio track?)")
    return dst


def should_chunk(audio_path: Path) -> bool:
    """Return True if the audio file is too large for a single Whisper call."""
    return audio_path.stat().st_size > CHUNK_THRESHOLD_BYTES


def chunk_audio(audio_path: Path, chunk_dir: Path) -> list[tuple[Path, float]]:
    """Split `audio_path` into ≤24 MB pieces at 10-minute time boundaries.

    Returns a list of (chunk_path, start_offset_seconds) tuples in order.

    Time-based splitting (not silence detection) is used for v1 — silence detect
    adds an extra ffmpeg pass and the typical agency video is short enough that
    chunking is the rare path anyway. Can swap to silence boundaries later if
    timestamp continuity becomes an issue.
    """
    chunk_dir.mkdir(parents=True, exist_ok=True)
    duration = probe_duration(audio_path) or 0.0
    if duration <= 0:
        raise AudioExtractionError("could not determine audio duration for chunking")

    chunk_seconds = 600  # 10 min — well under Whisper's size cap at 96 kbps mono
    chunks: list[tuple[Path, float]] = []
    start = 0.0
    idx = 0
    while start < duration:
        out = chunk_dir / f"chunk_{idx:03d}.m4a"
        cmd = [
            "ffmpeg", "-y", "-i", str(audio_path),
            "-ss", str(start), "-t", str(chunk_seconds),
            "-c", "copy", str(out),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=DEFAULT_TIMEOUT_SECONDS)
        if result.returncode != 0:
            raise AudioExtractionError(f"ffmpeg chunk failed: {result.stderr[-500:]}")
        chunks.append((out, start))
        start += chunk_seconds
        idx += 1
    return chunks
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_agency_video.py -v
```

Expected: previous 5 tests still pass + 6 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_pipeline/audio_extractor.py backend/tests/test_agency_video.py
git commit -m "feat(video): ffmpeg audio extractor with chunking"
```

---

## Task 4: Whisper transcriber (TDD)

**Files:**
- Create: `backend/app/services/video_pipeline/transcriber.py`
- Test: append to `backend/tests/test_agency_video.py`

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pytest tests/test_agency_video.py -v
```

Expected: import errors for `transcriber`.

- [ ] **Step 3: Implement the module**

Create `backend/app/services/video_pipeline/transcriber.py`:

```python
"""OpenAI Whisper API wrapper with chunk reassembly + retry."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from openai import OpenAI, APIError, AuthenticationError, RateLimitError

logger = logging.getLogger(__name__)

WHISPER_SEM = asyncio.Semaphore(2)
MAX_RETRIES = 3
RETRY_BACKOFFS_SECONDS = [10, 30, 90]


class TranscriptionError(RuntimeError):
    """Whisper request failed permanently (after retries) or returned malformed data."""


class TranscriptionAuthError(TranscriptionError):
    """API key invalid — do not retry."""


def offset_segments(segments: list[dict], *, offset: float) -> list[dict]:
    """Return a new list of segments with start/end shifted by `offset` seconds."""
    return [
        {"start": float(s["start"]) + offset, "end": float(s["end"]) + offset, "text": s["text"]}
        for s in segments
    ]


def concatenate_text(parts: list[str]) -> str:
    return " ".join(p.strip() for p in parts if p and p.strip())


async def _call_whisper(audio_path: Path) -> dict:
    """One Whisper call with retry. Returns {'text': str, 'segments': [...]}."""
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            async with WHISPER_SEM:
                # The OpenAI SDK is sync; offload to a thread so the semaphore is meaningful.
                def _do_call():
                    with open(audio_path, "rb") as f:
                        return client.audio.transcriptions.create(
                            model="whisper-1",
                            file=f,
                            response_format="verbose_json",
                            timestamp_granularities=["segment"],
                        )
                resp = await asyncio.to_thread(_do_call)
            return {
                "text": getattr(resp, "text", "") or "",
                "segments": [
                    {"start": s["start"], "end": s["end"], "text": s["text"]}
                    for s in (getattr(resp, "segments", None) or [])
                ],
            }
        except AuthenticationError as e:
            raise TranscriptionAuthError(str(e)) from e
        except (RateLimitError, APIError) as e:
            last_exc = e
            if attempt < MAX_RETRIES:
                delay = RETRY_BACKOFFS_SECONDS[attempt]
                logger.warning("Whisper transient error (attempt %d): %s. Retrying in %ds.", attempt + 1, e, delay)
                await asyncio.sleep(delay)
                continue
        except Exception as e:
            raise TranscriptionError(str(e)) from e
    raise TranscriptionError(f"Whisper failed after {MAX_RETRIES + 1} attempts: {last_exc}")


async def transcribe_chunks(chunks: list[tuple[Path, float]]) -> dict:
    """Transcribe each chunk in order, reassemble. Each chunk is (path, start_offset_seconds).

    Returns {'text': str, 'segments': [{'start','end','text'}, ...]}.
    """
    texts: list[str] = []
    segments: list[dict] = []
    for path, offset in chunks:
        chunk_result = await _call_whisper(path)
        texts.append(chunk_result["text"])
        segments.extend(offset_segments(chunk_result["segments"], offset=offset))
    return {"text": concatenate_text(texts), "segments": segments}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_agency_video.py -v
```

Expected: all previous tests pass + 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_pipeline/transcriber.py backend/tests/test_agency_video.py
git commit -m "feat(video): Whisper transcriber with chunk reassembly"
```

---

## Task 5: Metadata generator (TDD)

**Files:**
- Create: `backend/app/services/video_pipeline/metadata_generator.py`
- Test: append to `backend/tests/test_agency_video.py`

- [ ] **Step 1: Write the failing tests**

```python
import json
from unittest.mock import AsyncMock, patch

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
    import asyncio

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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pytest tests/test_agency_video.py -v
```

Expected: import errors for `metadata_generator`.

- [ ] **Step 3: Implement the module**

Create `backend/app/services/video_pipeline/metadata_generator.py`:

```python
"""Claude Sonnet metadata generation from transcript + BrandProfile."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from anthropic import AsyncAnthropic
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

MODEL_ID = "claude-sonnet-4-6"  # per CLAUDE.md current model conventions
MAX_TOKENS = 3000
MAX_RETRIES = 3


class MetadataGenerationError(RuntimeError):
    """Claude call failed permanently or returned unparseable JSON."""


class ChapterOut(BaseModel):
    ts_seconds: int
    label: str


class MetadataOut(BaseModel):
    title: str
    description: str
    chapters: list[ChapterOut]
    tags: list[str]
    jsonld: dict[str, Any]


def _get_client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


def build_prompt(*, brand_name: str, brand_profile: dict, transcript: str) -> str:
    """Construct the Claude prompt anchored on AI-visibility patterns."""
    profile_lines = [f"Brand: {brand_name}"]
    for field in ("company_description", "tone_of_voice", "target_audience",
                   "approved_language", "what_not_to_say", "key_stats"):
        val = brand_profile.get(field)
        if val:
            profile_lines.append(f"- {field}: {val}")

    return f"""You are optimizing a YouTube upload for AI assistant retrieval — ChatGPT, Claude, Perplexity, Gemini — NOT for human social engagement.

These assistants cite YouTube content based on the transcript + description + chapters. Thumbnails and view counts are irrelevant. Optimize for what gets retrieved.

{chr(10).join(profile_lines)}

TRANSCRIPT:
\"\"\"
{transcript[:30000]}
\"\"\"

Produce JSON with this exact schema:
{{
  "title": "Question-form title (≤90 chars) matching how people prompt LLMs. e.g. 'How does X work?' not 'X explained'.",
  "description": "≤4900 chars. Restate the factual claims, named entities, and stats verbatim from the transcript. AI assistants cite specifics, not summaries. Open with a 1-sentence pitch then a paragraph of substance.",
  "chapters": [{{"ts_seconds": int, "label": "Question the chapter answers"}}],
  "tags": ["~15 tags including brand name, named entities, topic terms"],
  "jsonld": {{
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": "<title>",
    "description": "<first 200 chars of description>",
    "uploadDate": "<today ISO date>",
    "transcript": "<first 5000 chars of transcript>"
  }}
}}

Output ONLY the JSON object. No prose, no markdown fences."""


def parse_response(raw: str) -> MetadataOut:
    """Parse a Claude response into a validated MetadataOut. Raises MetadataGenerationError on failure."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.rsplit("```", 1)[0].strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise MetadataGenerationError(f"Claude returned non-JSON: {e}") from e
    try:
        return MetadataOut.model_validate(data)
    except ValidationError as e:
        raise MetadataGenerationError(f"Claude output failed validation: {e}") from e


async def generate_metadata(*, brand_name: str, brand_profile: dict, transcript: str) -> MetadataOut:
    """Call Claude Sonnet to produce the artifact bundle. Retries transient errors."""
    client = _get_client()
    prompt = build_prompt(brand_name=brand_name, brand_profile=brand_profile, transcript=transcript)

    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.messages.create(
                model=MODEL_ID,
                max_tokens=MAX_TOKENS,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text if resp.content else ""
            return parse_response(raw)
        except MetadataGenerationError:
            # Parse/validation failure — retry (Claude may produce better JSON on a re-roll)
            last_exc = MetadataGenerationError("output validation failed")
        except Exception as e:
            logger.warning("Claude metadata call failed (attempt %d): %s", attempt + 1, e)
            last_exc = e
    raise MetadataGenerationError(f"Metadata generation failed after {MAX_RETRIES} attempts: {last_exc}")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_agency_video.py -v
```

Expected: all previous tests pass + 5 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_pipeline/metadata_generator.py backend/tests/test_agency_video.py
git commit -m "feat(video): Claude metadata generator"
```

---

## Task 6: Pipeline orchestrator (TDD)

**Files:**
- Create: `backend/app/services/video_pipeline/pipeline.py`
- Test: append to `backend/tests/test_agency_video.py`

The pipeline takes a job ID, walks it through `transcribing → generating → completed`, and guarantees tmp-file cleanup. Tests mock all four stages.

**Test convention:** the agency test suites do not use a "logged-in staff" pytest fixture. They use module-level helpers — see `tests/test_agency_tracking.py` for the canonical pattern. Replicate that here.

- [ ] **Step 1: Add module-level helpers + first three pipeline tests**

```python
"""...existing module docstring..."""

# Append to backend/tests/test_agency_video.py

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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pytest tests/test_agency_video.py -v
```

Expected: import errors for `pipeline`.

- [ ] **Step 3: Implement the orchestrator**

Create `backend/app/services/video_pipeline/pipeline.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_agency_video.py -v
```

Expected: previous tests pass + 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/video_pipeline/pipeline.py backend/tests/test_agency_video.py
git commit -m "feat(video): pipeline orchestrator with cleanup invariants"
```

---

## Task 7: Pydantic schemas

**Files:** Modify `backend/app/schemas.py`

- [ ] **Step 1: Append the schemas at the end of `schemas.py`**

```python
# ── Agency video pipeline ──────────────────────────────────────────────

class VideoChapterOut(BaseModel):
    ts_seconds: int
    label: str


class VideoMetadataJobOut(BaseModel):
    id: int
    agency_client_id: int
    brand_id: int
    status: str
    filename: str
    file_size_bytes: int
    duration_seconds: float | None
    transcript_text: str | None
    transcript_segments: list[dict] | None
    ai_title: str | None
    ai_description: str | None
    ai_chapters: list[VideoChapterOut] | None
    ai_tags: list[str] | None
    ai_jsonld: dict | None
    srt_content: str | None
    vtt_content: str | None
    metadata_failed: bool
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True


class VideoUploadResponse(BaseModel):
    job_id: int
    status: str
```

Confirm `BaseModel`, `datetime`, etc. are already imported at the top of `schemas.py` — they are throughout the file.

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas.py
git commit -m "feat(video): Pydantic schemas for video job endpoints"
```

---

## Task 8: Router endpoints (TDD)

**Files:**
- Create: `backend/app/routers/agency_video.py`
- Modify: `backend/app/main.py` (mount the router)
- Test: append to `backend/tests/test_agency_video.py`

- [ ] **Step 1: Write the failing endpoint tests**

Append to `backend/tests/test_agency_video.py` (reusing the `_make_agency_user`, `_create_agency_client`, and `_insert_job` helpers added in Task 6):

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pytest tests/test_agency_video.py -v
```

Expected: 404s / module-not-found errors for the router.

- [ ] **Step 3: Implement the router**

Create `backend/app/routers/agency_video.py`:

```python
"""Agency video pipeline endpoints."""

from __future__ import annotations

import logging
import os
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
    """Verify the agency client exists, the staff user can access it, and the brand is linked.

    Lumidian's agency model: staff users (`is_agency_staff`) have access to all agency clients.
    """
    client = await db.get(AgencyClient, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="agency client not found")
    brand = (await db.execute(
        select(Brand).where(Brand.agency_client_id == client_id, Brand.brand_type == "agency").limit(1)
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
        try: tmp_path.unlink()
        except OSError: pass
        raise
    except Exception as e:
        try: tmp_path.unlink()
        except OSError: pass
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
```

- [ ] **Step 4: Mount the router**

Modify `backend/app/main.py`. Find the block where the other agency routers are included (search for `agency`). Add:

```python
from app.routers import agency_video
app.include_router(agency_video.router)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pytest tests/test_agency_video.py -v
```

Expected: all backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/agency_video.py backend/app/main.py backend/tests/test_agency_video.py
git commit -m "feat(video): /api/agency/clients/{id}/video/* endpoints"
```

---

## Task 9: Orphan tmp-file sweeper (TDD)

**Files:**
- Create: `backend/app/services/video_pipeline/orphan_sweep.py`
- Modify: `backend/app/main.py` (call from lifespan startup)
- Test: append to `backend/tests/test_agency_video.py`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pytest tests/test_agency_video.py -v
```

Expected: import error for `orphan_sweep`.

- [ ] **Step 3: Implement the sweeper**

Create `backend/app/services/video_pipeline/orphan_sweep.py`:

```python
"""Startup sweep for orphan video tmp files (left over from crashes / hot-reloads)."""

from __future__ import annotations

import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)


def sweep_orphan_files(directory: Path, *, max_age_seconds: int = 3600) -> int:
    """Delete every file in `directory` older than `max_age_seconds`. Returns count deleted."""
    if not directory.exists() or not directory.is_dir():
        return 0
    cutoff = time.time() - max_age_seconds
    deleted = 0
    for entry in directory.iterdir():
        try:
            if entry.is_file() and entry.stat().st_mtime < cutoff:
                entry.unlink()
                deleted += 1
            elif entry.is_dir() and entry.stat().st_mtime < cutoff:
                # Recursive cleanup for chunk subdirs.
                for sub in entry.iterdir():
                    try: sub.unlink()
                    except OSError: pass
                try: entry.rmdir()
                except OSError: pass
                deleted += 1
        except OSError as e:
            logger.warning("Orphan sweep failed for %s: %s", entry, e)
    if deleted:
        logger.info("Orphan sweep removed %d entries from %s", deleted, directory)
    return deleted
```

- [ ] **Step 4: Wire into lifespan startup**

Modify `backend/app/main.py`. Find the existing `lifespan` async context manager (search for `@asynccontextmanager` or `async def lifespan`). Inside the startup phase (before `yield`), append:

```python
from app.services.video_pipeline.orphan_sweep import sweep_orphan_files
from app.routers.agency_video import TMP_DIR as VIDEO_TMP_DIR
try:
    sweep_orphan_files(VIDEO_TMP_DIR)
except Exception as e:
    logger.warning("Video orphan sweep failed: %s", e)
```

(Use whatever `logger` is in scope. If none, import from `logging`.)

- [ ] **Step 5: Add `os` import to the test file** if not already present (the test uses `os.utime`)

```python
import os
```

- [ ] **Step 6: Run tests + commit**

```bash
pytest tests/test_agency_video.py -v
git add backend/app/services/video_pipeline/orphan_sweep.py backend/app/main.py backend/tests/test_agency_video.py
git commit -m "feat(video): orphan tmp-file sweep on startup"
```

---

## Task 10: Frontend API client

**Files:** Modify `frontend/lib/api.ts`

- [ ] **Step 1: Add the type + methods**

Find an appropriate spot near other agency methods. Add:

```typescript
export interface VideoChapter {
  ts_seconds: number;
  label: string;
}

export interface VideoMetadataJobOut {
  id: number;
  agency_client_id: number;
  brand_id: number;
  status: "uploaded" | "transcribing" | "generating" | "completed" | "failed";
  filename: string;
  file_size_bytes: number;
  duration_seconds: number | null;
  transcript_text: string | null;
  transcript_segments: { start: number; end: number; text: string }[] | null;
  ai_title: string | null;
  ai_description: string | null;
  ai_chapters: VideoChapter[] | null;
  ai_tags: string[] | null;
  ai_jsonld: Record<string, unknown> | null;
  srt_content: string | null;
  vtt_content: string | null;
  metadata_failed: boolean;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}
```

Then in the API object (matching the existing pattern):

```typescript
  uploadVideo: async (
    clientId: number,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ job_id: number; status: string }> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await client.post(
      `/api/agency/clients/${clientId}/video/upload`,
      form,
      {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
        },
      },
    );
    return resp.data;
  },

  getVideoJobs: async (clientId: number): Promise<VideoMetadataJobOut[]> => {
    const resp = await client.get(`/api/agency/clients/${clientId}/video/jobs`);
    return resp.data;
  },

  getVideoJob: async (clientId: number, jobId: number): Promise<VideoMetadataJobOut> => {
    const resp = await client.get(`/api/agency/clients/${clientId}/video/jobs/${jobId}`);
    return resp.data;
  },

  regenerateVideoMetadata: async (clientId: number, jobId: number): Promise<VideoMetadataJobOut> => {
    const resp = await client.post(
      `/api/agency/clients/${clientId}/video/jobs/${jobId}/regenerate-metadata`,
    );
    return resp.data;
  },

  deleteVideoJob: async (clientId: number, jobId: number): Promise<void> => {
    await client.delete(`/api/agency/clients/${clientId}/video/jobs/${jobId}`);
  },
```

- [ ] **Step 2: Type-check + commit**

```bash
cd frontend && npm run lint
git add frontend/lib/api.ts
git commit -m "feat(video): API client methods for video jobs"
```

---

## Task 11: UploadZone component

**Files:** Create `frontend/components/agency/video/UploadZone.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";

interface Props {
  clientId: number;
  onUploaded: (jobId: number) => void;
}

const ACCEPTED = "video/mp4,video/quicktime,video/webm";

export function UploadZone({ clientId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) {
      setError("Unsupported file type. Use .mp4, .mov, or .webm.");
      return;
    }
    setUploading(true); setPct(0);
    try {
      const { job_id } = await api.uploadVideo(clientId, file, setPct);
      onUploaded(job_id);
    } catch (e) {
      const msg = (e as { response?: { status?: number } })?.response?.status === 413
        ? "File exceeds 500 MB limit."
        : "Upload failed. Please retry.";
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false);
        const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
      }}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
        dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      {uploading ? (
        <div>
          <div className="mb-2 text-sm text-gray-600">Uploading… {pct}%</div>
          <div className="h-2 w-full rounded bg-gray-200">
            <div className="h-2 rounded bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-700">Drag a finished video here, or</p>
          <button
            type="button"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </button>
          <p className="mt-3 text-xs text-gray-500">.mp4, .mov, .webm — up to 500 MB</p>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint + commit**

```bash
cd frontend && npm run lint
git add frontend/components/agency/video/UploadZone.tsx
git commit -m "feat(video): UploadZone component"
```

---

## Task 12: JobsList component

**Files:** Create `frontend/components/agency/video/JobsList.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { VideoMetadataJobOut } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  transcribing: "bg-blue-100 text-blue-700",
  generating: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

interface Props {
  jobs: VideoMetadataJobOut[];
  selectedId: number | null;
  onSelect: (jobId: number) => void;
}

export function JobsList({ jobs, selectedId, onSelect }: Props) {
  if (jobs.length === 0) {
    return <p className="text-sm text-gray-500">No videos yet. Upload one above to get started.</p>;
  }
  return (
    <ul className="divide-y divide-gray-200 rounded border border-gray-200">
      {jobs.map((j) => (
        <li key={j.id}>
          <button
            type="button"
            onClick={() => onSelect(j.id)}
            className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 ${
              selectedId === j.id ? "bg-blue-50" : ""
            }`}
          >
            <div>
              <div className="font-medium text-gray-900">{j.filename}</div>
              <div className="text-xs text-gray-500">
                {new Date(j.created_at).toLocaleString()}
                {j.duration_seconds ? ` · ${Math.round(j.duration_seconds)}s` : ""}
              </div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[j.status] || ""}`}>
              {j.status}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Lint + commit**

```bash
cd frontend && npm run lint
git add frontend/components/agency/video/JobsList.tsx
git commit -m "feat(video): JobsList component"
```

---

## Task 13: ArtifactCard, TranscriptViewer, CaptionDownloadButton

**Files:** Create three components in `frontend/components/agency/video/`

- [ ] **Step 1: ArtifactCard**

Create `frontend/components/agency/video/ArtifactCard.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  title: string;
  value: string;
  multiline?: boolean;
}

export function ArtifactCard({ title, value, multiline }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <button
          type="button"
          onClick={copy}
          className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-800">
          {value}
        </pre>
      ) : (
        <p className="text-sm text-gray-800">{value}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TranscriptViewer**

Create `frontend/components/agency/video/TranscriptViewer.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Segment { start: number; end: number; text: string; }

interface Props {
  segments: Segment[];
}

function formatTs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TranscriptViewer({ segments }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-gray-700"
      >
        {open ? "Hide" : "Show"} full transcript ({segments.length} segments)
      </button>
      {open && (
        <ul className="mt-3 max-h-96 space-y-2 overflow-auto text-sm text-gray-800">
          {segments.map((s, i) => (
            <li key={i}>
              <span className="mr-2 font-mono text-xs text-gray-500">{formatTs(s.start)}</span>
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: CaptionDownloadButton**

Create `frontend/components/agency/video/CaptionDownloadButton.tsx`:

```tsx
"use client";

interface Props {
  filename: string;
  content: string;
  label: string;
}

export function CaptionDownloadButton({ filename, content, label }: Props) {
  function download() {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      Download {label}
    </button>
  );
}
```

- [ ] **Step 4: Lint + commit**

```bash
cd frontend && npm run lint
git add frontend/components/agency/video/ArtifactCard.tsx frontend/components/agency/video/TranscriptViewer.tsx frontend/components/agency/video/CaptionDownloadButton.tsx
git commit -m "feat(video): ArtifactCard, TranscriptViewer, CaptionDownloadButton"
```

---

## Task 14: RegenerateMetadataButton

**Files:** Create `frontend/components/agency/video/RegenerateMetadataButton.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  clientId: number;
  jobId: number;
  onComplete: () => void;
}

export function RegenerateMetadataButton({ clientId, jobId, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm("Re-run Claude metadata pass against the cached transcript?")) return;
    setRunning(true); setError(null);
    try {
      await api.regenerateVideoMetadata(clientId, jobId);
      onComplete();
    } catch {
      setError("Regeneration failed. Try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {running ? "Regenerating…" : "Regenerate metadata"}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Lint + commit**

```bash
cd frontend && npm run lint
git add frontend/components/agency/video/RegenerateMetadataButton.tsx
git commit -m "feat(video): RegenerateMetadataButton"
```

---

## Task 15: ResultPanel

**Files:** Create `frontend/components/agency/video/ResultPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { VideoMetadataJobOut } from "@/lib/api";
import { ArtifactCard } from "./ArtifactCard";
import { TranscriptViewer } from "./TranscriptViewer";
import { CaptionDownloadButton } from "./CaptionDownloadButton";
import { RegenerateMetadataButton } from "./RegenerateMetadataButton";

interface Props {
  clientId: number;
  job: VideoMetadataJobOut;
  onRegenerated: () => void;
}

function chaptersToText(chapters: { ts_seconds: number; label: string }[]): string {
  return chapters.map((c) => {
    const h = Math.floor(c.ts_seconds / 3600);
    const m = Math.floor((c.ts_seconds % 3600) / 60);
    const s = c.ts_seconds % 60;
    const ts = h > 0
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${ts} ${c.label}`;
  }).join("\n");
}

export function ResultPanel({ clientId, job, onRegenerated }: Props) {
  if (job.status === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <strong>Failed.</strong> {job.error_message || "Unknown error."}
      </div>
    );
  }
  if (job.status !== "completed") {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        Status: {job.status}. This page will refresh automatically.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {job.metadata_failed && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Transcript saved, but the Claude metadata pass failed: {job.error_message}.
          Use the regenerate button below to retry without re-transcribing.
        </div>
      )}

      {job.ai_title && <ArtifactCard title="Title" value={job.ai_title} />}
      {job.ai_description && <ArtifactCard title="Description" value={job.ai_description} multiline />}
      {job.ai_chapters && job.ai_chapters.length > 0 && (
        <ArtifactCard title="Chapters" value={chaptersToText(job.ai_chapters)} multiline />
      )}
      {job.ai_tags && job.ai_tags.length > 0 && (
        <ArtifactCard title="Tags" value={job.ai_tags.join(", ")} />
      )}
      {job.ai_jsonld && (
        <ArtifactCard title="JSON-LD (VideoObject)" value={JSON.stringify(job.ai_jsonld, null, 2)} multiline />
      )}

      {job.transcript_segments && <TranscriptViewer segments={job.transcript_segments} />}

      <div className="flex flex-wrap items-center gap-2">
        {job.srt_content && (
          <CaptionDownloadButton filename={`${job.filename}.srt`} content={job.srt_content} label=".srt" />
        )}
        {job.vtt_content && (
          <CaptionDownloadButton filename={`${job.filename}.vtt`} content={job.vtt_content} label=".vtt" />
        )}
        <RegenerateMetadataButton clientId={clientId} jobId={job.id} onComplete={onRegenerated} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint + commit**

```bash
cd frontend && npm run lint
git add frontend/components/agency/video/ResultPanel.tsx
git commit -m "feat(video): ResultPanel"
```

---

## Task 16: Tab page + nav entry

**Files:**
- Create: `frontend/app/agency/clients/[id]/video/page.tsx`
- Modify: the file that defines the client-detail tab nav (likely `frontend/app/agency/clients/[id]/page.tsx` or a layout — search for the existing "Pipeline" / "Tracking" / "Documents" / "Site Audit" nav entries)

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, VideoMetadataJobOut } from "@/lib/api";
import { UploadZone } from "@/components/agency/video/UploadZone";
import { JobsList } from "@/components/agency/video/JobsList";
import { ResultPanel } from "@/components/agency/video/ResultPanel";

export default function VideoTabPage() {
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);
  const [jobs, setJobs] = useState<VideoMetadataJobOut[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = jobs.find((j) => j.id === selectedId) || null;

  async function refresh() {
    const data = await api.getVideoJobs(clientId);
    setJobs(data);
    if (selectedId === null && data.length > 0) setSelectedId(data[0].id);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  // Poll every 2s while any active job exists or the selected job is in-flight.
  useEffect(() => {
    const active = jobs.some((j) => ["uploaded", "transcribing", "generating"].includes(j.status));
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [jobs.map((j) => `${j.id}:${j.status}`).join(",")]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Video</h1>
      <p className="text-sm text-gray-600">
        Upload a finished video. Lumidian transcribes it and generates a paste-ready YouTube package
        optimized for AI retrieval — title, description, chapters, tags, JSON-LD, plus .srt/.vtt captions.
      </p>

      <UploadZone clientId={clientId} onUploaded={(jobId) => { setSelectedId(jobId); refresh(); }} />

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <JobsList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
        <div>
          {selected ? (
            <ResultPanel clientId={clientId} job={selected} onRegenerated={refresh} />
          ) : (
            <p className="text-sm text-gray-500">Select a job to see its artifacts.</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the Video nav entry**

Open the client-detail nav file. Find the existing tab definitions (look for entries like `"Pipeline"`, `"Tracking"`, `"Documents"`, `"Site Audit"`). Add a new entry directly after "Site Audit":

```tsx
{ label: "Video", href: `/agency/clients/${clientId}/video` },
```

(Adapt to whatever shape the existing array uses.)

- [ ] **Step 3: Manually verify**

```bash
cd backend && uvicorn app.main:app --reload --port 3001  # in one terminal
cd frontend && npm run dev                               # in another (port 3002)
```

Open `http://localhost:3002/agency/clients/<some-client-id>/video`. Confirm:
- The Video tab appears in the nav
- The UploadZone renders
- Empty JobsList shows the "No videos yet" message

- [ ] **Step 4: Commit**

```bash
git add frontend/app/agency/clients/[id]/video/page.tsx frontend/app/agency/clients/[id]/page.tsx
git commit -m "feat(video): tab page + nav entry"
```

---

## Task 17: End-to-end smoke verification (manual)

This is the verification gate before merge. No code, no commit.

- [ ] **Step 1: Confirm ffmpeg is on the path**

```bash
which ffmpeg && which ffprobe
ffmpeg -version | head -1
```

If missing locally, install: `brew install ffmpeg` on macOS. On Railway, verify ffmpeg is in the Docker image (used by Playwright deps); add to Dockerfile if not.

- [ ] **Step 2: Upload a real 30–60 second video**

- Drag a finished `.mp4` into the UploadZone.
- Watch progress bar reach 100%.
- Watch the JobsList entry advance: `uploaded → transcribing → generating → completed`.
- Total time: typically 30–90 seconds.

- [ ] **Step 3: Verify every artifact renders**

In ResultPanel:
- [ ] Title shows. Click Copy. Paste into a notepad — verify it's a question-form title.
- [ ] Description shows. Click Copy. Verify it restates factual claims, not just a summary.
- [ ] Chapters show. Each line in `HH:MM:SS Label` form. Copy and paste — should be valid YouTube description chapter format.
- [ ] Tags show, ~15 entries, brand name included.
- [ ] JSON-LD shows. Paste into a JSON validator — verify it parses, `@type` is `VideoObject`.
- [ ] Transcript viewer opens with all segments + timestamps.
- [ ] Download `.srt` — open in a text editor. Verify the SubRip format (`1\n00:00:00,000 --> 00:00:02,500\nText\n\n`).
- [ ] Download `.vtt` — open. Starts with `WEBVTT`.

- [ ] **Step 4: Verify Regenerate works**

- Click Regenerate metadata.
- Confirm the dialog.
- Watch for a brief loading state, then the Title/Description should refresh (Claude produces a different output on each roll).
- Transcript and SRT/VTT should be unchanged.

- [ ] **Step 5: Verify tmp files are cleaned up**

```bash
ls /tmp/lumidian-video/
```

Should be empty (or only contain very recent in-flight files if other jobs are running).

- [ ] **Step 6: Verify failure paths**

- Upload a `.txt` file with content-type `text/plain`. Should get 415.
- Upload a 600 MB file (or temporarily set `MAX_UPLOAD_BYTES = 1024`). Should get 413 mid-stream.
- (Optional) Set `OPENAI_API_KEY` to an invalid value and upload a video. Job should land in `failed` with the auth error message; tmp files deleted.

- [ ] **Step 7: Run the full backend suite**

```bash
cd backend && pytest tests/ -v
```

Expected: full pass.

- [ ] **Step 8: Update CURRENT_STATE.md**

Append a one-liner to the Recent Decisions section and update the "Most recent work" + "Next concrete step" entries in Current Task / WIP.

- [ ] **Step 9: Final commit if anything was changed during smoke verification**

```bash
git add -A
git commit -m "chore(video): smoke verification + CURRENT_STATE update"
```

The branch is now ready to merge.
