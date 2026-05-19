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
                    try:
                        sub.unlink()
                    except OSError:
                        pass
                try:
                    entry.rmdir()
                except OSError:
                    pass
                deleted += 1
        except OSError as e:
            logger.warning("Orphan sweep failed for %s: %s", entry, e)
    if deleted:
        logger.info("Orphan sweep removed %d entries from %s", deleted, directory)
    return deleted
