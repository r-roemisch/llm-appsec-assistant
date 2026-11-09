"""Trace retention: delete local JSONL trace files older than a number of days.

Only files named ``YYYY-MM-DD.jsonl`` in the traces folder are considered; anything else there is
left alone. Langfuse keeps its own copy under its own retention setting."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path


def trace_file_date(path: Path) -> date | None:
    if path.suffix != ".jsonl":
        return None
    try:
        return date.fromisoformat(path.stem)
    except ValueError:
        return None


def prune_traces(
    directory: Path, older_than_days: int, *, today: date | None = None, dry_run: bool = False
) -> list[Path]:
    """Delete trace files whose day is more than ``older_than_days`` days before today (UTC).
    Today's file is always kept. Returns the files deleted (or that would be, with dry_run)."""
    if older_than_days < 1:
        raise ValueError("older_than_days must be at least 1")
    if not directory.is_dir():
        return []
    cutoff = (today or datetime.now(UTC).date()) - timedelta(days=older_than_days)
    doomed = sorted(
        path
        for path in directory.iterdir()
        if path.is_file() and (day := trace_file_date(path)) is not None and day < cutoff
    )
    if not dry_run:
        for path in doomed:
            path.unlink(missing_ok=True)
    return doomed
