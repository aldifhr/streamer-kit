"""Overlay persistence.

The original loader re-read and re-wrote the entire overlays file on every
request. That is harmless for one overlay and wrong for twenty: each request
re-parses the JSON, and two saves issued in the same tick each hold their own
copy of the file, so whichever flushed last silently discarded the other. The
file is now read once and mutated in place behind a lock, and each write is
atomic so a crash mid-save cannot leave a truncated file behind.
"""

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OVERLAYS_FILE = CONFIG_DIR / "overlays.json"

# A plain lock, not asyncio.Lock: every critical section below is synchronous
# and contains no await, so the only thing the lock is protecting against is a
# re-entrant or cross-thread caller. asyncio.Lock would also demand `async with`.
_lock = threading.Lock()
_cache: dict[str, Any] | None = None


def _data() -> dict[str, Any]:
    global _cache
    if _cache is None:
        if OVERLAYS_FILE.exists():
            try:
                _cache = json.loads(OVERLAYS_FILE.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                # A corrupt file must not brick the API. The bad copy is set
                # aside so it can be inspected instead of silently overwritten.
                broken = OVERLAYS_FILE.with_suffix(".json.corrupt")
                os.replace(OVERLAYS_FILE, broken)
                _cache = {}
        else:
            _cache = {}
    return _cache


def _flush() -> None:
    data = _data()
    CONFIG_DIR.mkdir(exist_ok=True)
    tmp = OVERLAYS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, OVERLAYS_FILE)


def _record(overlay_id: str) -> dict[str, Any] | None:
    return _data().get(overlay_id)


def all_overlays() -> dict[str, Any]:
    """A detached copy, so a caller cannot mutate the cache by accident."""
    with _lock:
        return copy.deepcopy(_data())


def get_overlay(overlay_id: str) -> dict[str, Any] | None:
    with _lock:
        record = _record(overlay_id)
        return copy.deepcopy(record) if record else None


# Which platform a channel lives on.
#
# Every overlay had a bare `username`, which is fine until it is not: a TikTok
# handle and a YouTube channel name are both strings, so picking the wrong
# platform looks exactly like picking a channel that does not exist. The source
# is stored beside the name rather than inferred from it, because there is
# nothing in "nila" to infer from.
SOURCES = ("tiktok", "youtube")


def normalise_source(raw: Any) -> str:
    """Folds a source name to one this build knows, defaulting to TikTok.

    An unrecognised value becomes TikTok rather than an error. That is the
    safer of the two failures for a stored config written by an older build,
    and the wrong guess is visible on the overlay rather than silent in a log.
    """
    v = str(raw or "").strip().lower()
    return v if v in SOURCES else "tiktok"


def create_overlay(name: str, config: dict[str, Any]) -> dict[str, Any]:
    overlay_id = str(uuid.uuid4())
    record = {
        "name": name,
        "username": "",
        "source": "tiktok",
        "config": config,
        "createdAt": time.time(),
    }
    with _lock:
        _data()[overlay_id] = record
        _flush()
    return {"id": overlay_id, **record}


def update_overlay(
    overlay_id: str,
    *,
    name: str | None = None,
    username: str | None = None,
    source: str | None = None,
) -> dict[str, Any] | None:
    with _lock:
        record = _record(overlay_id)
        if record is None:
            return None
        if name is not None:
            record["name"] = name
        if username is not None:
            record["username"] = username
        if source is not None:
            record["source"] = normalise_source(source)
        _flush()
        return copy.deepcopy(record)


def delete_overlay(overlay_id: str) -> bool:
    with _lock:
        if overlay_id not in _data():
            return False
        del _data()[overlay_id]
        _flush()
        return True


def set_config(overlay_id: str, config: dict[str, Any]) -> bool:
    with _lock:
        record = _record(overlay_id)
        if record is None:
            return False
        record["config"] = config
        _flush()
        return True


def username_of(overlay_id: str) -> str:
    with _lock:
        record = _record(overlay_id)
        return str(record.get("username", "")) if record else ""


def source_of(overlay_id: str) -> str:
    """The stored platform for an overlay, or TikTok when there is no record."""
    with _lock:
        record = _record(overlay_id)
        return normalise_source(record.get("source")) if record else "tiktok"
