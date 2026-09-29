import asyncio
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
OVERLAYS_FILE = CONFIG_DIR / "overlays.json"
DEFAULT_CONFIG_FILE = CONFIG_DIR / "default_config.json"

# Only the theme id lives here. Every other style default is owned by the
# frontend (apps/web/lib/config.ts) so the two can't drift apart — an earlier
# version mirrored the full schema here and silently overrode the frontend
# defaults with stale values.
DEFAULT_OVERLAY_CONFIG: dict[str, Any] = {
    "theme": "streamline",
}


def load_overlays() -> dict[str, Any]:
    if OVERLAYS_FILE.exists():
        return json.loads(OVERLAYS_FILE.read_text(encoding="utf-8"))
    return {}


def save_overlays(overlays: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(exist_ok=True)
    OVERLAYS_FILE.write_text(json.dumps(overlays, indent=2, ensure_ascii=False), encoding="utf-8")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, WebSocket] = {}
        self.overlay_clients: dict[str, str] = {}
        self.customizer_clients: set[str] = set()

    async def connect(self, websocket: WebSocket, client_type: str, overlay_id: str | None = None) -> str:
        await websocket.accept()
        client_id = str(uuid.uuid4())
        self.active[client_id] = websocket
        if client_type == "overlay" and overlay_id:
            self.overlay_clients[client_id] = overlay_id
        elif client_type == "customizer":
            self.customizer_clients.add(client_id)
        return client_id

    def disconnect(self, client_id: str) -> None:
        self.active.pop(client_id, None)
        self.overlay_clients.pop(client_id, None)
        self.customizer_clients.discard(client_id)

    async def broadcast(self, message: dict[str, Any], client_type: str | None = None, overlay_id: str | None = None) -> None:
        targets: set[str] = set()
        if client_type == "overlay" and overlay_id:
            targets = {cid for cid, oid in self.overlay_clients.items() if oid == overlay_id}
        elif client_type == "customizer":
            targets = self.customizer_clients.copy()
        else:
            targets = set(self.active.keys())

        data = json.dumps(message, ensure_ascii=False)
        disconnected: list[str] = []
        for cid in targets:
            ws = self.active.get(cid)
            if ws is None:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                disconnected.append(cid)
        for cid in disconnected:
            self.disconnect(cid)


manager = ConnectionManager()

# TikTok substitutes these when a viewer's profile is unavailable or deleted.
# Broadcasting them puts literal "Not found" / "?" on the overlay, so they are
# dropped rather than shown as if they were usernames.
PLACEHOLDER_NICKNAMES = {"", "?", "not found", "unknown", "-", "null", "none"}


def display_name(user: Any) -> str | None:
    """Return a nickname worth showing, or None if it is missing/placeholder."""

    if user is None:
        return None
    nickname = (getattr(user, "nickname", "") or "").strip()
    if nickname.lower() in PLACEHOLDER_NICKNAMES:
        return None
    return nickname


class TikTokLiveClient:
    def __init__(self, username: str, overlay_id: str) -> None:
        self.username = username
        self.overlay_id = overlay_id
        self._client = None
        # _running means "a connection was attempted"; _connected means the
        # WebSocket handshake with TikTok actually completed. Reporting the
        # latter is what makes a newly-attached client's status honest.
        self._running = False
        self._connected = False
        self._task: asyncio.Task | None = None

    def status_payload(self) -> dict[str, Any]:
        if self._connected:
            return {
                "type": "status",
                "connected": True,
                "message": f"Connected to @{self.username}",
            }
        if self._running:
            return {
                "type": "status",
                "connected": False,
                "connecting": True,
                "message": f"Connecting to @{self.username}",
            }
        return {"type": "status", "connected": False, "message": "Offline"}

    async def start(self) -> None:
        try:
            from TikTokLive import TikTokLiveClient as Client
            from TikTokLive.events import (
                ConnectEvent, DisconnectEvent, CommentEvent, LikeEvent,
                GiftEvent, RoomUserSeqEvent, JoinEvent
            )
        except ImportError:
            await manager.broadcast({
                "type": "error",
                "message": "TikTokLive library not installed. Run: pip install TikTokLive"
            }, overlay_id=self.overlay_id)
            return

        self._client = Client(unique_id=self.username)
        self._running = True

        @self._client.on(ConnectEvent)
        async def on_connect(_):
            self._connected = True
            await manager.broadcast({
                "type": "status",
                "connected": True,
                "message": f"Connected to @{self.username}"
            }, overlay_id=self.overlay_id)

        @self._client.on(DisconnectEvent)
        async def on_disconnect(_):
            self._running = False
            self._connected = False
            await manager.broadcast({
                "type": "status",
                "connected": False,
                "message": "Disconnected"
            }, overlay_id=self.overlay_id)

        @self._client.on(CommentEvent)
        async def on_comment(event):
            name = display_name(event.user)
            if not name:
                return
            await manager.broadcast({
                "type": "comment",
                "user": name,
                "text": event.comment
            }, overlay_id=self.overlay_id)

        @self._client.on(LikeEvent)
        async def on_like(event):
            name = display_name(event.user)
            if not name:
                return
            await manager.broadcast({
                "type": "like",
                "user": name,
                "count": event.count,
                "totalLikes": event.total
            }, overlay_id=self.overlay_id)

        @self._client.on(GiftEvent)
        async def on_gift(event):
            if event.gift is None:
                return
            name = display_name(event.user)
            if not name:
                return
            await manager.broadcast({
                "type": "gift",
                "user": name,
                "giftName": event.gift.name or "Gift",
                "count": event.repeat_count,
                "value": event.gift.diamond_count * event.repeat_count
            }, overlay_id=self.overlay_id)

        # JoinEvent is sparse — TikTok batches member messages rather than
        # sending one per viewer — so treat it as a bonus, not a source of
        # truth for who is in the room.
        @self._client.on(JoinEvent)
        async def on_join(event):
            name = display_name(event.user)
            if not name:
                return
            await manager.broadcast({
                "type": "join",
                "user": name,
                "viewers": event.member_count
            }, overlay_id=self.overlay_id)

        @self._client.on(RoomUserSeqEvent)
        async def on_viewer(event):
            await manager.broadcast({
                "type": "viewers",
                "count": event.total_user
            }, overlay_id=self.overlay_id)

        try:
            await self._client.start()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self._running = False
            self._connected = False
            await manager.broadcast({
                "type": "error",
                "message": f"Connection failed: {e}"
            }, overlay_id=self.overlay_id)
        finally:
            self._connected = False
            await manager.broadcast({
                "type": "status",
                "connected": False,
                "message": "Disconnected"
            }, overlay_id=self.overlay_id)

    async def stop(self) -> None:
        self._running = False
        self._connected = False
        if self._client is not None:
            try:
                await asyncio.wait_for(self._client.disconnect(), timeout=5)
            except asyncio.TimeoutError:
                pass
            except Exception:
                pass
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        self._client = None
        self._task = None


live_clients: dict[str, TikTokLiveClient] = {}


class ConnectRequest(BaseModel):
    username: str
    overlay_id: str | None = None


class CreateOverlayRequest(BaseModel):
    name: str


class UpdateOverlayRequest(BaseModel):
    name: str | None = None
    username: str | None = None


class ConfigUpdateRequest(BaseModel):
    config: dict[str, Any]
    overlay_id: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for client in live_clients.values():
        await client.stop()


app = FastAPI(title="Stream-Kit", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/overlays")
async def list_overlays():
    overlays = load_overlays()
    result = []
    for oid, data in overlays.items():
        result.append({
            "id": oid,
            "name": data.get("name", "Untitled"),
            "username": data.get("username", ""),
            "theme": data.get("config", {}).get("theme", DEFAULT_OVERLAY_CONFIG["theme"]),
            "config": data.get("config", {}),
            "createdAt": data.get("createdAt", 0),
        })
    return {"overlays": result}


@app.post("/api/overlays")
async def create_overlay(req: CreateOverlayRequest):
    overlays = load_overlays()
    overlay_id = str(uuid.uuid4())
    overlays[overlay_id] = {
        "name": req.name.strip(),
        "username": "",
        "config": DEFAULT_OVERLAY_CONFIG.copy(),
        "createdAt": time.time(),
    }
    save_overlays(overlays)
    return {
        "overlay": {
            "id": overlay_id,
            "name": req.name.strip(),
            "username": "",
            "theme": DEFAULT_OVERLAY_CONFIG["theme"],
            "createdAt": overlays[overlay_id]["createdAt"],
        }
    }


@app.patch("/api/overlays/{overlay_id}")
async def update_overlay(overlay_id: str, req: UpdateOverlayRequest):
    overlays = load_overlays()
    if overlay_id not in overlays:
        raise HTTPException(status_code=404, detail="Overlay not found")

    record = overlays[overlay_id]
    username_changed = False

    if req.name is not None:
        record["name"] = req.name.strip()
    if req.username is not None:
        new_username = req.username.strip().lstrip("@")
        username_changed = new_username != record.get("username", "")
        record["username"] = new_username

    save_overlays(overlays)

    # A different username means the running client is pointed at the wrong
    # room, so drop it; the overlay page re-requests the connection on reload.
    if username_changed and live_clients.get(overlay_id) and live_clients[overlay_id]._running:
        await live_clients[overlay_id].stop()

    return {"overlay": record}


@app.get("/api/overlays/{overlay_id}")
async def get_overlay(overlay_id: str):
    overlays = load_overlays()
    if overlay_id not in overlays:
        raise HTTPException(status_code=404, detail="Overlay not found")
    return overlays[overlay_id]


@app.delete("/api/overlays/{overlay_id}")
async def delete_overlay(overlay_id: str):
    overlays = load_overlays()
    if overlay_id not in overlays:
        raise HTTPException(status_code=404, detail="Overlay not found")
    del overlays[overlay_id]
    save_overlays(overlays)
    return {"status": "ok"}


@app.post("/api/overlays/{overlay_id}/config")
async def update_overlay_config(overlay_id: str, req: ConfigUpdateRequest):
    overlays = load_overlays()
    if overlay_id not in overlays:
        raise HTTPException(status_code=404, detail="Overlay not found")
    overlays[overlay_id]["config"] = req.config
    save_overlays(overlays)
    await manager.broadcast(
        {"type": "config", "config": req.config},
        client_type="overlay",
        overlay_id=overlay_id,
    )
    return {"status": "ok"}


@app.post("/api/connect")
async def connect(req: ConnectRequest):
    overlay_id = req.overlay_id or "default"

    existing = live_clients.get(overlay_id)
    if existing and existing._running and existing.username == req.username:
        # Idempotent path. The ConnectEvent for this client already fired
        # earlier, so anyone attaching now would otherwise never learn the
        # current state — push it explicitly.
        await manager.broadcast(existing.status_payload(), overlay_id=overlay_id)
        return {
            "status": "already-connected",
            "username": existing.username,
            "overlay_id": overlay_id,
            **existing.status_payload(),
        }

    if existing:
        await existing.stop()

    client = TikTokLiveClient(req.username, overlay_id)
    live_clients[overlay_id] = client
    client._task = asyncio.create_task(client.start())
    return {"status": "connecting", "username": req.username, "overlay_id": overlay_id}


@app.post("/api/disconnect")
async def disconnect(req: ConnectRequest):
    overlay_id = req.overlay_id or "default"
    if overlay_id in live_clients:
        await live_clients[overlay_id].stop()
        del live_clients[overlay_id]
    return {"status": "disconnected"}


@app.websocket("/ws/{client_type}/{overlay_id}")
async def websocket_endpoint(websocket: WebSocket, client_type: str, overlay_id: str):
    client_id = await manager.connect(websocket, client_type, overlay_id)
    try:
        overlays = load_overlays()
        config = overlays.get(overlay_id, {}).get("config", DEFAULT_OVERLAY_CONFIG)
        await websocket.send_text(json.dumps({"type": "config", "config": config}))

        # Send a status snapshot on attach. Connection-state events are edge
        # triggered, so a client opening the socket after the handshake
        # finished would otherwise sit on "connecting" forever.
        existing = live_clients.get(overlay_id)
        await websocket.send_text(
            json.dumps(
                existing.status_payload()
                if existing
                else {"type": "status", "connected": False, "message": "Offline"}
            )
        )
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
        manager.disconnect(client_id)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
