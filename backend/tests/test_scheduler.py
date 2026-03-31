"""Tests for scheduler backup integrity check."""
from pathlib import Path
import shutil
import sqlite3


def test_backup_integrity_check_passes_on_valid_db(tmp_path: Path):
    """A valid copied SQLite file passes PRAGMA integrity_check."""
    # Create a minimal SQLite DB
    src = tmp_path / "test.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    # Copy it (simulating the backup)
    backup = tmp_path / "test_backup.db"
    shutil.copy2(str(src), str(backup))

    # Run integrity check
    conn = sqlite3.connect(str(backup))
    result = conn.execute("PRAGMA integrity_check").fetchone()
    conn.close()
    assert result[0] == "ok"


def test_backup_integrity_check_detects_corruption(tmp_path: Path):
    """A corrupted file fails PRAGMA integrity_check."""
    # Create a valid DB
    src = tmp_path / "test.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    # Copy it, then corrupt it
    backup = tmp_path / "corrupt_backup.db"
    shutil.copy2(str(src), str(backup))
    # Overwrite middle of the file with garbage
    with open(str(backup), "r+b") as f:
        f.seek(100)
        f.write(b"\x00" * 200)

    # A corrupted DB either raises an exception or returns a non-"ok" result —
    # both are valid failure modes that the integrity check detects.
    try:
        conn = sqlite3.connect(str(backup))
        result = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()
        assert result is not None and result[0] != "ok"
    except sqlite3.DatabaseError:
        pass  # Exception is also an acceptable signal of corruption
