"""Normalised event layer.

Every source — TikTok, the manual trigger button, a donation webhook — emits
the same `Event` shape, and this module owns the single place where that shape
becomes a wire message. Sources therefore never learn the wire format, and
adding a new kind of alert is a one-file change instead of a new branch in
whichever source happened to produce it.

The wire format for the pre-existing kinds is unchanged from the original
single-file server, so a frontend on the old build keeps working against a
server on this one.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable

from hub import hub

COMMENT = "comment"
LIKE = "like"
GIFT = "gift"
JOIN = "join"
VIEWERS = "viewers"
FOLLOW = "follow"
SHARE = "share"
ALERT = "alert"

#: Kinds a widget can subscribe to. The frontend mirrors this list in
#: lib/widgets/registry.ts; a mismatch means a widget never fires.
STREAM_KINDS = (COMMENT, LIKE, GIFT, JOIN)
STATE_KINDS = (VIEWERS,)
MANUAL_KINDS = (FOLLOW, SHARE, ALERT)


@dataclass
class Event:
    kind: str
    user: str = ""
    #: Bare payload, no verb attached. "sent Rose x1", not "kei sent Rose x1" —
    #: the verb is a presentation concern and belongs in the renderer.
    value: str = ""
    meta: dict[str, Any] = field(default_factory=dict)


def _comment(e: Event) -> dict[str, Any]:
    return {"type": COMMENT, "user": e.user, "text": e.value}


def _like(e: Event) -> dict[str, Any]:
    return {
        "type": LIKE,
        "user": e.user,
        "count": e.meta.get("count", 1),
        "totalLikes": e.meta.get("totalLikes", 0),
    }


def _gift(e: Event) -> dict[str, Any]:
    return {
        "type": GIFT,
        "user": e.user,
        "giftName": e.meta.get("giftName", "Gift"),
        "count": e.meta.get("count", 1),
        "value": e.meta.get("value", 0),
    }


def _join(e: Event) -> dict[str, Any]:
    return {"type": JOIN, "user": e.user, "viewers": e.meta.get("viewers", 0)}


def _viewers(e: Event) -> dict[str, Any]:
    return {"type": VIEWERS, "count": e.meta.get("count", 0)}


def _follow(e: Event) -> dict[str, Any]:
    return {"type": FOLLOW, "user": e.user}


def _share(e: Event) -> dict[str, Any]:
    return {"type": SHARE, "user": e.user, "count": e.meta.get("count", 1)}


def _alert(e: Event) -> dict[str, Any]:
    return {
        "type": ALERT,
        "title": e.meta.get("title", ""),
        "text": e.value,
        "icon": e.meta.get("icon", "★"),
    }


SERIALISERS: dict[str, Callable[[Event], dict[str, Any]]] = {
    COMMENT: _comment,
    LIKE: _like,
    GIFT: _gift,
    JOIN: _join,
    VIEWERS: _viewers,
    FOLLOW: _follow,
    SHARE: _share,
    ALERT: _alert,
}


def to_wire(event: Event) -> dict[str, Any]:
    serialise = SERIALISERS.get(event.kind)
    if serialise is None:
        # An unknown kind is a bug in the caller, not a reason to silence the
        # overlay: surface it as an alert so it is visible while developing
        # rather than dropped on the floor.
        return _alert(
            Event(kind=ALERT, value=event.kind, meta={"title": "unhandled kind", "icon": "⚠"})
        )
    return serialise(event)


async def emit(overlay_id: str, event: Event) -> None:
    await hub.broadcast(to_wire(event), overlay_id=overlay_id)


async def emit_status(overlay_id: str, *, connected: bool, message: str, connecting: bool = False) -> None:
    payload: dict[str, Any] = {"type": "status", "connected": connected, "message": message}
    if connecting:
        payload["connecting"] = True
    await hub.broadcast(payload, overlay_id=overlay_id)


async def emit_error(overlay_id: str, message: str) -> None:
    await hub.broadcast({"type": "error", "message": message}, overlay_id=overlay_id)


async def emit_config(overlay_id: str, config: dict[str, Any]) -> None:
    await hub.broadcast({"type": "config", "config": config}, overlay_id=overlay_id)


def dispatch(overlay_id: str, event: Event) -> asyncio.Task:
    """Fire an event without making the caller await the fan-out.

    WebSocket sends can block on a stalled client, and a source's handler runs
    inside TikTokLive's event loop; awaiting here would let one wedged browser
    source back-pressure the whole live stream.
    """
    return asyncio.create_task(emit(overlay_id, event))
