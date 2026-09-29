"""StreamKit API — routes only.

Persistence lives in `store`, WebSocket bookkeeping in `hub`, and the shape of
everything that reaches a browser in `events`. This module is the HTTP surface
and nothing else; the split exists so that adding a widget or an event source
does not mean editing the file that owns routing.
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import APIRouter, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import events
import store
from events import ALERT, Event
from hub import OVERLAY, hub
from sources import TikTokSource

# Only the theme id lives here. Every other style default is owned by the
# frontend (apps/web/lib/widgets) so the two can't drift apart — an earlier
# version mirrored the full schema here and silently overrode the frontend
# defaults with stale values.
DEFAULT_OVERLAY_CONFIG: dict[str, Any] = {"theme": "streamline"}


# --------------------------------------------------------------------------
# live connections
# --------------------------------------------------------------------------

#: overlay_id -> source. One live room per overlay, whatever asked for it.
sources: dict[str, TikTokSource] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for source in list(sources.values()):
        await source.stop()
    sources.clear()


app = FastAPI(title="StreamKit", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # The frontend is served from a different origin than this API, so it has to
    # be reachable cross-origin. Credentials are never used, which is what makes
    # "*" acceptable here.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter()


# --------------------------------------------------------------------------
# authorisation
#
# A deployed API is public. Without a token anyone could delete a stream's
# overlays, rewrite its config, or post a fake 999-diamond gift that permanently
# advances the astronaut roster. Read and stream access stays open on purpose:
# the overlay page is loaded by OBS, which cannot send a header, and it needs the
# event stream to render at all.
# --------------------------------------------------------------------------

#: Read from the API's environment. Unset means open, so local development and a
#: fresh clone keep working with no setup. Read per call rather than cached at
#: import so a test — and a future config reload — can change it without
#: reimporting the module.
def api_token() -> str:
    return os.environ.get("STREAMKIT_TOKEN", "").strip()


def _presented_token(request: Request) -> str:
    header = request.headers.get("x-streamkit-token", "")
    if header:
        return header
    # Query form, for the one caller that cannot set headers: the browser source
    # URL in OBS. It is a real trade-off — the token then lands in OBS logs and
    # screenshots — so it is only a fallback, never the preferred path.
    return request.query_params.get("token", "")


def token_is_valid(request: Request) -> bool:
    expected = api_token()
    if not expected:
        return True
    header = request.headers.get("x-streamkit-token", "")
    if header == expected:
        return True
    # Query form, for the one caller that cannot set headers: the browser source
    # URL in OBS. It is a real trade-off — the token then lands in OBS logs and
    # screenshots — so it is only a fallback, never the preferred path.
    return request.query_params.get("token", "") == expected


@app.middleware("http")
async def guard_mutations(request: Request, call_next):
    """Reject unauthenticated writes.

    A method check rather than a path list, so a new mutating route is protected
    the moment it is added instead of the day someone remembers to add it. The
    WebSocket path is exempt because it is not an HTTP request in the first
    place, and because OBS cannot authenticate at all.

    The rejection is returned rather than raised: an HTTPException thrown from
    middleware is not routed through the exception handlers, so it would surface
    as an unhandled error instead of a 401.
    """
    if request.method in ("POST", "PATCH", "PUT", "DELETE") and not token_is_valid(request):
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid or missing STREAMKIT_TOKEN"},
        )
    return await call_next(request)


# --------------------------------------------------------------------------
# request bodies
# --------------------------------------------------------------------------


class ConnectRequest(BaseModel):
    # Optional because /api/disconnect is posted with only an overlay id, and
    # this used to be required — which made disconnect answer 422 and left the
    # editor's Stop button silently doing nothing. /api/connect validates it.
    username: str = ""
    overlay_id: str | None = None


class CreateOverlayRequest(BaseModel):
    name: str
    #: Starting scene, resolved by the caller.
    #:
    #: The frontend owns the config schema deliberately — main.py mirrors only
    #: the theme id, because a second copy of the schema here is how the two
    # drift. Accepting the whole config keeps that ownership one-directional:
    # the backend stores what it is given and never interprets it.
    config: dict[str, Any] | None = None


class UpdateOverlayRequest(BaseModel):
    name: str | None = None
    username: str | None = None


class ConfigUpdateRequest(BaseModel):
    config: dict[str, Any]
    overlay_id: str | None = None


class TriggerRequest(BaseModel):
    """Fire an event by hand — the "alert now" path with no live room involved.

    Deliberately permissive on `kind`: the set of things a streamer can trigger
    should grow without a backend release, and an unrecognised kind is surfaced
    as an alert by `events.to_wire` rather than rejected.
    """

    kind: str = ALERT
    user: str = ""
    #: Stable per-user key, for widgets that keep state per viewer. Defaults to
    #: `user` so a caller that only knows a nickname still gets a key.
    user_id: str = ""
    text: str = ""
    title: str = ""
    icon: str = "★"
    #: Gift value and repeat count. Without these a triggered gift is worth
    #: nothing, which makes the reward thresholds a widget might key on
    #: impossible to exercise from the editor.
    diamonds: int = 0
    count: int = 1


class HookRequest(BaseModel):
    """External webhook body."""

    user: str = ""
    user_id: str = ""
    text: str = ""
    title: str = ""
    icon: str = "★"
    kind: str = ALERT
    amount: float | None = None


# --------------------------------------------------------------------------
# overlays
# --------------------------------------------------------------------------


def _summary(overlay_id: str, record: dict[str, Any]) -> dict[str, Any]:
    config = record.get("config", {})
    return {
        "id": overlay_id,
        "name": record.get("name", "Untitled"),
        "username": record.get("username", ""),
        "theme": config.get("theme", DEFAULT_OVERLAY_CONFIG["theme"]),
        "config": config,
        "createdAt": record.get("createdAt", 0),
    }


@router.get("/api/overlays")
async def list_overlays():
    return {"overlays": [_summary(oid, rec) for oid, rec in store.all_overlays().items()]}


@router.post("/api/overlays")
async def create_overlay(req: CreateOverlayRequest):
    name = req.name.strip() or "Untitled"
    config = req.config if req.config is not None else dict(DEFAULT_OVERLAY_CONFIG)
    record = store.create_overlay(name, config)
    return {"overlay": _summary(record["id"], record)}


@router.patch("/api/overlays/{overlay_id}")
async def update_overlay(overlay_id: str, req: UpdateOverlayRequest):
    username_changed = False
    if req.username is not None:
        current = store.username_of(overlay_id)
        incoming = req.username.strip().lstrip("@")
        username_changed = incoming != current

    record = store.update_overlay(
        overlay_id,
        name=req.name.strip() if req.name is not None else None,
        username=req.username.strip().lstrip("@") if req.username is not None else None,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Overlay not found")

    # A different username means the running source is pointed at the wrong
    # room, so drop it; the overlay page re-requests the connection on reload.
    if username_changed:
        source = sources.get(overlay_id)
        if source is not None and source._running:
            await source.stop()

    return {"overlay": _summary(overlay_id, record)}


@router.get("/api/overlays/{overlay_id}")
async def get_overlay(overlay_id: str):
    record = store.get_overlay(overlay_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Overlay not found")
    return record


@router.delete("/api/overlays/{overlay_id}")
async def delete_overlay(overlay_id: str):
    if not store.delete_overlay(overlay_id):
        raise HTTPException(status_code=404, detail="Overlay not found")
    source = sources.pop(overlay_id, None)
    if source is not None:
        await source.stop()
    return {"status": "ok"}


@router.post("/api/overlays/{overlay_id}/config")
async def update_overlay_config(overlay_id: str, req: ConfigUpdateRequest):
    if not store.set_config(overlay_id, req.config):
        raise HTTPException(status_code=404, detail="Overlay not found")
    await events.emit_config(overlay_id, req.config)
    return {"status": "ok"}


# --------------------------------------------------------------------------
# live connection
# --------------------------------------------------------------------------


@router.post("/api/connect")
async def connect(req: ConnectRequest):
    overlay_id = req.overlay_id or "default"
    username = req.username.strip().lstrip("@")
    if not username:
        raise HTTPException(status_code=400, detail="username is required")

    existing = sources.get(overlay_id)
    if existing and existing._running and existing.username == username:
        # Idempotent path. The ConnectEvent for this source already fired
        # earlier, so anyone attaching now would otherwise never learn the
        # current state — push it explicitly.
        await hub.broadcast(existing.status_payload(), overlay_id=overlay_id)
        return {
            "status": "already-connected",
            "username": existing.username,
            "overlay_id": overlay_id,
            **existing.status_payload(),
        }

    if existing:
        await existing.stop()

    source = TikTokSource(username, overlay_id)
    sources[overlay_id] = source
    source._task = asyncio.create_task(source.start())
    return {"status": "connecting", "username": username, "overlay_id": overlay_id}


@router.post("/api/disconnect")
async def disconnect(req: ConnectRequest):
    overlay_id = req.overlay_id or "default"
    source = sources.pop(overlay_id, None)
    if source is not None:
        await source.stop()
    return {"status": "disconnected"}


@router.get("/api/overlays/{overlay_id}/status")
async def connection_status(overlay_id: str):
    source = sources.get(overlay_id)
    return source.status_payload() if source else {"type": "status", "connected": False, "message": "Offline"}


# --------------------------------------------------------------------------
# manual triggers and webhooks
# --------------------------------------------------------------------------


@router.post("/api/overlays/{overlay_id}/trigger")
async def trigger(overlay_id: str, req: TriggerRequest):
    """Emit an event into an overlay by hand.

    This is the seam that makes the overlay more than a chat mirror: anything
    that can POST here — a Stream Deck, a Discord bot, a cron job — appears on
    the stream without touching the backend.
    """
    if store.get_overlay(overlay_id) is None:
        raise HTTPException(status_code=404, detail="Overlay not found")

    await events.emit(
        overlay_id,
        Event(
            kind=req.kind,
            user=req.user,
            user_id=req.user_id,
            value=req.text,
            meta={
                "title": req.title,
                "icon": req.icon,
                "count": req.count,
                "giftName": req.text or "Gift",
                "diamonds": req.diamonds,
                "value": req.diamonds,
            },
        ),
    )
    return {"status": "ok", "kind": req.kind}


@router.post("/api/hooks/{overlay_id}")
async def webhook(overlay_id: str, req: HookRequest):
    """Alias for `trigger` with a flatter body, for external integrations.

    Kept separate rather than merged so the intent at the call site is
    readable, and so this path can grow its own auth later without changing
    what the dashboard's own button posts.
    """
    if store.get_overlay(overlay_id) is None:
        raise HTTPException(status_code=404, detail="Overlay not found")

    value = req.text
    if req.amount is not None and not value:
        value = f"{req.amount:g}"

    await events.emit(
        overlay_id,
        Event(
            kind=req.kind,
            user=req.user,
            user_id=req.user_id,
            value=value,
            meta={"title": req.title, "icon": req.icon, "count": 1},
        ),
    )
    return {"status": "ok"}


# --------------------------------------------------------------------------
# websocket
# --------------------------------------------------------------------------


@app.websocket("/ws/{client_type}/{overlay_id}")
async def websocket_endpoint(websocket: WebSocket, client_type: str, overlay_id: str):
    client_id = await hub.connect(websocket, client_type, overlay_id)
    try:
        record = store.get_overlay(overlay_id)
        config = record.get("config", DEFAULT_OVERLAY_CONFIG) if record else DEFAULT_OVERLAY_CONFIG
        await websocket.send_text(json.dumps({"type": "config", "config": config}, ensure_ascii=False))

        # Send a status snapshot on attach. Connection-state events are edge
        # triggered, so a client opening the socket after the handshake
        # finished would otherwise sit on "connecting" forever.
        source = sources.get(overlay_id)
        payload = source.status_payload() if source else {"type": "status", "connected": False, "message": "Offline"}
        await websocket.send_text(json.dumps(payload, ensure_ascii=False))

        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(client_id)


app.include_router(router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
