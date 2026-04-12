#!/bin/sh

# Tighten DB file permissions (owner-only read/write)
if [ -f /data/lumidian.db ]; then
  chmod 600 /data/lumidian.db
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
