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
