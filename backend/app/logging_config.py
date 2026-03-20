"""
Structured logging configuration for ClarityAI.

Sets up:
  - Console handler (INFO level)
  - Rotating file handler at backend/logs/app.log (max 10 MB, 5 backups)
  - Root logger captures all app.* loggers

Call configure_logging() once at application startup (in main.py lifespan).
"""
from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


def configure_logging() -> None:
    """Attach a rotating file handler to the root logger."""
    log_dir = Path(__file__).resolve().parent.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "app.log"

    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.WARNING)
    file_handler.setFormatter(fmt)

    # Also capture INFO+ to log file for scheduler and tracking events
    info_handler = RotatingFileHandler(
        log_dir / "app.info.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    info_handler.setLevel(logging.INFO)
    info_handler.setFormatter(fmt)

    root = logging.getLogger()
    # Avoid adding duplicate handlers if called multiple times
    existing_files = {h.baseFilename for h in root.handlers if isinstance(h, RotatingFileHandler)}
    if str(log_file) not in existing_files:
        root.addHandler(file_handler)
    if str(log_dir / "app.info.log") not in existing_files:
        root.addHandler(info_handler)
