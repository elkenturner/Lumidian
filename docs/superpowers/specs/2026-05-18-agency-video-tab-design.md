# Agency Video Tab — Transcript-to-AI-Package Pipeline

**Date:** 2026-05-18
**Status:** Approved, ready for implementation plan
**Surface:** Agency cockpit (`/agency/clients/[id]`)

## Goal

Add a per-client `Video` tab to the agency cockpit that turns a finished video upload into a paste-ready YouTube metadata package optimized for AI retrieval (ChatGPT, Claude, Perplexity, Gemini citations from YouTube).

YouTube is a Tier 1 deliverable per the 2026-05-04 channel-mix decision. AI assistants don't watch videos — they cite YouTube content based on the **transcript + description + chapters**. This pipeline produces all of those, anchored on the client's `BrandProfile`.

## Non-Goals (v1)

- YouTube OAuth / auto-publish (contradicts the `posting is manual-only` constraint)
- Cluster integration (treating the video as a pillar that feeds LinkedIn/Medium/Reddit drafts) — possible follow-up
- Video file storage or in-app replay
- Multi-language transcription surfacing (Whisper auto-detects; we don't surface a picker)
- Speaker diarization
- Per-call staff knobs for the LLM pass

## User Flow

1. Agency staff opens `/agency/clients/42/video`.
2. Drags a finished video (`.mp4` / `.mov` / `.webm`, ≤ 500 MB) into the UploadZone.
3. Upload progress bar shows multipart progress. On completion: a new job appears in the JobsList with status `transcribing`.
4. Background pipeline runs: ffmpeg → Whisper → Claude. Frontend polls every 2s. Status pill advances `transcribing` → `generating` → `completed`.
5. Result panel renders one `ArtifactCard` per artifact: title, description, chapters (timestamped list), tags, JSON-LD. Each card has a copy button. Below: a collapsible transcript viewer and download buttons for `.srt` and `.vtt`.
6. Staff copy-pastes title/description/chapters/tags into YouTube Studio and uploads the captions file alongside the video. Manual upload — no auto-publish.
7. If the LLM pass produces something off-tone, staff hits `Regenerate metadata` — Claude runs again against the cached transcript (no re-transcription cost).

## Architecture

### Backend

**New service module — `app/services/video_pipeline/`**

| File | Responsibility |
|---|---|
| `audio_extractor.py` | ffmpeg subprocess: extract audio track to m4a (96 kbps mono AAC). Chunk into ≤ 24 MB pieces at silence boundaries if needed (Whisper's 25 MB hard cap). Capture `duration_seconds` via ffprobe. |
| `transcriber.py` | OpenAI Whisper API call(s). `Semaphore(2)` matching existing per-provider concurrency pattern. Reassemble word/segment timestamps across chunks with offsets. Produce canonical `transcript_text` and segment list. |
| `metadata_generator.py` | Claude Sonnet structured-output call. Input: transcript + `BrandProfile` (tone, target audience, approved language, key stats, what_not_to_say). Output JSON: `{title, description, chapters[], tags[], jsonld}`. Pydantic-validated. |
| `captions.py` | Pure function: segments → `.srt` and `.vtt` strings. |
| `pipeline.py` | Top-level orchestrator. Walks a `VideoMetadataJob` through statuses; persists artifacts; guarantees tmp-file cleanup via `try/finally`. |

**New ORM model — `VideoMetadataJob`**

```
id                       PK
agency_client_id         FK → AgencyClient
brand_id                 FK → Brand
created_by               FK → User
status                   uploaded | transcribing | generating | completed | failed
filename                 str
file_size_bytes          int
duration_seconds         float (nullable until ffprobe runs)
transcript_text          text (nullable)
transcript_segments      JSON  (nullable)  — [{start, end, text}]
ai_title                 str   (nullable)
ai_description           text  (nullable)
ai_chapters              JSON  (nullable)  — [{ts_seconds, label}]
ai_tags                  JSON  (nullable)  — [tag]
ai_jsonld                JSON  (nullable)  — VideoObject schema
srt_content              text  (nullable)
vtt_content              text  (nullable)
metadata_failed          bool default False  — true when transcript saved but Claude pass errored
error_message            text (nullable)
created_at               datetime
completed_at             datetime (nullable)
```

Migration appended to `database.py:run_migrations()` per project convention. New table created via `create_tables()` on first deploy.

**API endpoints — extend `routers/agency.py`** (or split into `routers/agency_video.py` if `agency.py` grows past comfort). All gated by `require_agency_staff` and an ownership check that the `agency_client_id` belongs to a brand the staff user can access.

```
POST   /api/agency/clients/{client_id}/video/upload
GET    /api/agency/clients/{client_id}/video/jobs
GET    /api/agency/clients/{client_id}/video/jobs/{job_id}
POST   /api/agency/clients/{client_id}/video/jobs/{job_id}/regenerate-metadata
DELETE /api/agency/clients/{client_id}/video/jobs/{job_id}
```

`regenerate-metadata` re-runs only the Claude pass against the cached transcript — useful when the first LLM output is off-tone. Transcription is the expensive step and is preserved.

### Frontend

**New route — `app/agency/clients/[id]/video/page.tsx`** plus a new `Video` entry in the client-detail tab nav.

**New components — `components/agency/video/`**

| Component | Responsibility |
|---|---|
| `UploadZone.tsx` | Drag-and-drop + click-to-pick. Filename/size preview. Upload progress bar driven by Axios `onUploadProgress`. |
| `JobsList.tsx` | Recent jobs for this client. Status pills (`uploaded` / `transcribing` / `generating` / `completed` / `failed`). Click → open ResultPanel. |
| `ResultPanel.tsx` | Orchestrator for a completed job. Lays out artifact cards + transcript viewer + caption downloads. |
| `ArtifactCard.tsx` | Reusable card for one artifact (title / description / chapters / tags / JSON-LD). Copy button. Mirrors `FixCard` styling from Site Audit Fix-Factory. |
| `TranscriptViewer.tsx` | Collapsible. Shows segments with `mm:ss` timestamps. Clicking a timestamp copies the `?t=` URL form. |
| `CaptionDownloadButton.tsx` | Triggers download of `.srt` or `.vtt` blob. |
| `RegenerateMetadataButton.tsx` | Confirmation modal + POST → backend → poll until completed. |

`lib/api.ts` additions: `uploadVideo(clientId, file, onProgress)`, `getVideoJobs(clientId)`, `getVideoJob(clientId, jobId)`, `regenerateVideoMetadata(clientId, jobId)`, `deleteVideoJob(clientId, jobId)`.

## Data Flow

**Upload phase**

1. Frontend multipart POST to `/api/agency/clients/{id}/video/upload`.
2. Backend streams `UploadFile` to `/tmp/lumidian-video/{uuid}.{ext}` in 1 MB chunks. Aborts with 413 if the running byte total exceeds 500 MB. MIME types outside `{video/mp4, video/quicktime, video/webm}` rejected with 415 before persisting.
3. Insert `VideoMetadataJob(status='uploaded', file_size_bytes=…, filename=…)`.
4. Schedule `pipeline.process_job(job_id)` as a FastAPI `BackgroundTask`. Return `{ job_id }`.

**Processing phase (background)**

```
uploaded → transcribing → generating → completed
                  ↓             ↓
               failed       completed (metadata_failed=True)
```

`transcribing`:
- ffmpeg: `ffmpeg -i {src} -vn -acodec aac -b:a 96k -ac 1 {dst}.m4a`. ffprobe captures `duration_seconds`.
- If audio > 24 MB: split at silence boundaries via `ffmpeg -af silencedetect`. Otherwise single chunk.
- For each chunk: `openai.audio.transcriptions.create(model="whisper-1", response_format="verbose_json", timestamp_granularities=["segment"])` under `Semaphore(2)`.
- Reassemble: segment timestamps offset by their source chunk's start time. Build a single canonical transcript.
- Persist `transcript_text`, `transcript_segments`, `srt_content`, `vtt_content`. Delete `/tmp` audio + video files.
- Status → `generating`.

`generating`:
- Load `BrandProfile` for the client's brand.
- Single Claude Sonnet call. Prompt explicitly anchors on AI-visibility patterns:
  - Title: question-form, matches how people prompt LLMs.
  - Description: restates the factual claims, stats, and named entities from the transcript (≤ 4900 chars). This is what AI assistants cite — summaries get ignored.
  - Chapters: 5–10 entries. Labels phrased as the question the chapter answers, not generic ("Intro").
  - Tags: ~15 entries, including brand name + named entities + topic terms.
  - JSON-LD: `VideoObject` schema with name/description/uploadDate/duration/transcript.
- Pydantic-validated output schema. On validation failure → treated as a Claude error (see failure modes).
- Persist all five artifacts. Status → `completed`.

**Result phase**

Frontend polls `GET /jobs/{job_id}` every 2 s while status ∈ {uploaded, transcribing, generating}. Stops on `completed` / `failed`. `ResultPanel` renders artifact cards + transcript viewer + caption downloads.

**Persistence policy**

- Video file: deleted as soon as transcription completes, or on any failure path.
- Audio file: deleted as soon as Whisper response is captured.
- Transcript + all artifacts: persisted indefinitely on `VideoMetadataJob`. No automatic cleanup.

**Concurrency**

- Whisper API: `Semaphore(2)` (same pattern as Perplexity/Gemini).
- One in-flight `BackgroundTask` per job. No global limit — agency volume is low.

## Error Handling

| Stage | Failure | Behavior |
|---|---|---|
| Upload | File > 500 MB | Stream aborts mid-upload, 413, partial `/tmp` file deleted via `try/finally` |
| Upload | MIME type not in `{video/mp4, video/quicktime, video/webm}` | 415 before persisting |
| Upload | Disk write fails | 500, partial file deleted |
| ffmpeg | Subprocess returns non-zero | Job → `failed`, `error_message` = stderr tail (last 500 chars), video deleted, no retry |
| ffmpeg | No audio track detected | Job → `failed`, `error_message="video has no audio track"` |
| Whisper | 429 / 5xx | Exponential backoff, 3 retries (10s / 30s / 90s). Persistent → job `failed` |
| Whisper | 401 auth error | Job → `failed` immediately, no retry. Message directs staff to API key settings |
| Whisper | Chunk N fails after retries | Whole job → `failed` (partial transcripts aren't useful) |
| Claude metadata | Any error after 3 retries | Status → `completed`, artifact fields null, `metadata_failed=True`, `error_message` set. Transcript + SRT/VTT still delivered. Staff can hit `regenerate-metadata`. |
| Claude | Pydantic validation fails on output | Counted as a Claude error, same path |

**Cleanup invariants**

- `try/finally` around the whole pipeline guarantees `/tmp/lumidian-video/{uuid}.*` files are deleted on every exit path.
- On startup, sweep `/tmp/lumidian-video/` for orphan files older than 1 hour. Handles dev hot-reloads and prod crashes mid-job. Added to the existing startup lifespan in `main.py`.

## Auth & Tier Gating

- `require_agency_staff` on every endpoint.
- Ownership check: `agency_client_id` must belong to a brand the staff user can access — reuse the same predicate `agency.py` uses for other client-scoped endpoints.
- No SaaS tier gating. This is agency-internal — never exposed to SaaS customers.

## Testing

Backend tests in `tests/test_agency_video.py`:

1. `test_upload_creates_job` — POST a 3-second fixture (`tests/fixtures/3s_silent.mp4`), assert 200 + row created with `status='uploaded'`.
2. `test_upload_too_large_rejected` — 600 MB stream → 413.
3. `test_upload_non_video_rejected` — `.txt` → 415.
4. `test_upload_unauthenticated` — non-staff user → 403.
5. `test_upload_wrong_client_rejected` — staff user attempting upload to a client they don't own → 403.
6. `test_pipeline_happy_path` — mock ffmpeg + Whisper + Claude, run `pipeline.process_job` synchronously, assert all artifacts populated, status `completed`.
7. `test_pipeline_whisper_failure` — mock Whisper to raise, assert status `failed`, video file deleted.
8. `test_pipeline_metadata_failure_keeps_transcript` — mock Claude to raise, assert status `completed`, `metadata_failed=True`, transcript intact, captions intact.
9. `test_regenerate_metadata` — completed job, re-run Claude pass, transcript untouched, new title/description saved.
10. `test_delete_job` — cleanup, including any stray tmp files.
11. `test_get_jobs_scoped_to_client` — list endpoint returns only the requested client's jobs.

No frontend tests (matches repo convention — no frontend tests exist).

**Smoke verification before merge:** end-to-end run with a real 30-second video. Validate every artifact renders, every copy button works, `.srt` downloads as valid SubRip, `regenerate-metadata` produces a different LLM output without re-transcribing.

## Dependencies

- `ffmpeg` binary on the deployment host. Already present in Lumidian's Railway image (used by Playwright). Verify in `Dockerfile`; install if missing.
- `OPENAI_API_KEY` — already in env.
- `ANTHROPIC_API_KEY` — already in env.
- No new Python deps required: `openai` and `anthropic` SDK clients are already in `requirements.txt`.

## Open Items for the Plan

- Decide whether to extend `routers/agency.py` or split into `routers/agency_video.py` based on the current file size when planning.
- Whisper chunking: default to silence-boundary chunking (`ffmpeg -af silencedetect`). If implementation reveals it's brittle, fall back to time-based chunks at 10-minute boundaries. Either way, files under 24 MB after audio extraction skip chunking entirely (the typical case for 5–20 min videos at 96 kbps mono).
