"""Polls: one question per overlay, with votes.

Kept out of `store.py` on purpose. Overlay config is a document that the editor
rewrites wholesale, and a poll is a counter that changes on every vote — folding
the two together would mean a read-modify-write on the whole config file per
vote, which is the exact pattern that file was rewritten to avoid.

The vote path is a GET on purpose. OBS loads the overlay and cannot present a
session, so a vote that needed one could not be cast from a browser source at
all. The cost is that anyone who can load the overlay can vote, including a bot;
one voter per overlay per viewer is enforced by the widget, not here, because
enforcing it properly means the thing OBS cannot do.

Creating and closing a poll are writes, and go through the same token guard as
the rest of the API.
"""

import threading
import time
from typing import Any

#: overlay_id -> poll. In memory on purpose: a poll is a thing for right now, and
#: surviving a restart would mean a stream that comes back showing yesterday's
#: question with today's voters already counted.
_polls: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()

#: A poll with no activity in this long is over whether anyone closed it or not.
TTL_SECONDS = 6 * 60 * 60

MAX_OPTIONS = 8
MAX_QUESTION = 200
MAX_OPTION = 80


def _shape(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id", ""),
        "question": raw.get("question", ""),
        "options": raw["options"],
        "closed": bool(raw.get("closed")),
        "updatedAt": raw.get("updatedAt", 0),
    }


def _prune(now: float) -> None:
    for key in [k for k, v in _polls.items() if now - v.get("updatedAt", 0) > TTL_SECONDS]:
        _polls.pop(key, None)


def get_poll(overlay_id: str) -> dict[str, Any] | None:
    with _lock:
        _prune(time.time())
        raw = _polls.get(overlay_id)
        return _shape(raw) if raw else None


def set_poll(overlay_id: str, question: str, options: list[str], closed: bool = False) -> dict[str, Any]:
    question = (question or "").strip()[:MAX_QUESTION]
    clean = [o.strip()[:MAX_OPTION] for o in options if o and o.strip()][:MAX_OPTIONS]
    if not question or not clean:
        raise ValueError("a poll needs a question and at least one option")
    with _lock:
        _prune(time.time())
        record = {
            "id": overlay_id,
            "question": question,
            "options": [{"label": label, "votes": 0} for label in clean],
            "closed": closed,
            "updatedAt": time.time(),
        }
        _polls[overlay_id] = record
        return _shape(record)


def clear_poll(overlay_id: str) -> bool:
    with _lock:
        return _polls.pop(overlay_id, None) is not None


def vote(overlay_id: str, choice: int) -> dict[str, Any]:
    """Record one vote. Rejects a closed poll and an out-of-range choice.

    Not idempotent: a repeated call is a second vote, because the widget is the
    only thing stopping an accidental double-tap and it already does. Making
    this de-duplicated would need a voter identity, which is the session OBS
    cannot hold.
    """
    with _lock:
        _prune(time.time())
        record = _polls.get(overlay_id)
        if record is None:
            raise LookupError("no poll")
        if record["closed"]:
            raise PermissionError("poll is closed")
        if not isinstance(choice, int) or choice < 0 or choice >= len(record["options"]):
            raise IndexError("choice out of range")
        record["options"][choice]["votes"] += 1
        record["updatedAt"] = time.time()
        return _shape(record)
