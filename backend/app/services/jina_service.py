"""
Jina Reader service — fetches website content via https://r.jina.ai/{url}.

Error handling:
  - Invalid/malformed URLs: caught and logged before the HTTP request
  - Site blocks Jina (4xx): caught via raise_for_status(), logged as warning
  - Empty response: detected after fetch, stored as empty context (still marks fetched)
  - Network timeout (30s): caught by httpx.TimeoutException, logged as warning
  - Any other exception: caught generically, logged, returns False
In all cases refresh_brand_website_context() returns False on failure, True on success.
"""

import ipaddress
import logging
import socket
from datetime import UTC
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

JINA_BASE = "https://r.jina.ai/"
MAX_CHARS = 12_000  # truncate to avoid storing huge blobs


def _is_private_host(hostname: str) -> bool:
    """Check if a hostname resolves to a private/reserved IP address."""
    try:
        addr_info = socket.getaddrinfo(hostname, None)
        for _, _, _, _, sockaddr in addr_info:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return True
    except (socket.gaierror, ValueError):
        pass
    return False


def _validate_url(url: str) -> str:
    """
    Normalise and basic-validate a URL.
    Returns the (possibly normalised) URL, or raises ValueError.
    Blocks private/internal IPs to prevent SSRF.
    """
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    if not parsed.netloc:
        raise ValueError(f"Invalid URL — no host: {url!r}")
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Invalid URL scheme: {parsed.scheme!r}")
    hostname = parsed.hostname or ""
    if _is_private_host(hostname):
        raise ValueError(f"URLs pointing to private/internal addresses are not allowed")
    return url


async def fetch_website_context(url: str) -> str:
    """
    Fetch readable text content from a URL using the Jina Reader API.
    Returns the extracted text (truncated to MAX_CHARS), possibly empty string.

    Raises:
      ValueError              — malformed URL
      httpx.TimeoutException  — request timed out
      httpx.HTTPStatusError   — non-2xx response (e.g. site blocked Jina)
      httpx.HTTPError         — other network-level error
    """
    url = _validate_url(url)
    jina_url = JINA_BASE + url

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(
            jina_url,
            headers={"Accept": "text/plain", "X-No-Cache": "true"},
        )
        resp.raise_for_status()
        text = resp.text.strip()

    if not text:
        logger.warning("Jina returned an empty response for %s", url)

    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n[content truncated]"

    logger.info("Jina fetch for %s: %d chars", url, len(text))
    return text


async def refresh_brand_website_context(brand_id: int) -> bool:
    """
    Fetch website content for a brand and store it in the brand's profile.
    Returns True on success, False if the brand has no website_url or on error.
    Logs all failures — never raises.
    """
    from datetime import datetime

    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models import Brand, BrandProfile

    async with AsyncSessionLocal() as db:
        brand = await db.get(Brand, brand_id)
        if not brand or not brand.website_url:
            logger.debug("Jina refresh skipped for brand %d — no website_url", brand_id)
            return False

        url = brand.website_url
        try:
            context = await fetch_website_context(url)
        except ValueError as exc:
            logger.warning("Jina fetch skipped for brand %d — invalid URL %r: %s", brand_id, url, exc)
            return False
        except httpx.TimeoutException:
            logger.warning("Jina fetch timed out for brand %d (%s)", brand_id, url)
            return False
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Jina fetch blocked/error for brand %d (%s): HTTP %s",
                brand_id, url, exc.response.status_code,
            )
            return False
        except httpx.HTTPError as exc:
            logger.warning("Jina fetch network error for brand %d (%s): %s", brand_id, url, exc)
            return False
        except Exception as exc:
            logger.exception("Jina fetch unexpected error for brand %d (%s): %s", brand_id, url, exc)
            return False

        # Upsert BrandProfile
        result = await db.execute(select(BrandProfile).where(BrandProfile.brand_id == brand_id))
        profile = result.scalar_one_or_none()
        if profile is None:
            profile = BrandProfile(brand_id=brand_id)
            db.add(profile)

        profile.internal_brand_context = context
        profile.website_context_last_fetched = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()

    logger.info("Website context refreshed for brand %d (%s): %d chars", brand_id, url, len(context))
    return True
