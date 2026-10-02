"""WebSocket client registry and fan-out.

Kept separate from the event layer so that "who is listening" and "what
happened" stay independent: a new event source never needs to know how
broadcasting works, and a new client type never needs to know what an event is.
"""

import json
import uuid
from typing import Any

from fastapi import WebSocket

OVERLAY = "overlay"
CUSTOMIZER = "customizer"


class Hub:
    def __init__(self) -> None:
        self.active: dict[str, WebSocket] = {}
        # client id to the overlay it is watching, for every client type that
        # names one. The customizer panel edits a specific scene's config, so it
        # is bound to that scene for delivery purposes even though it is not a
        # broadcast client.
        self.overlay_clients: dict[str, str] = {}
        self.customizer_clients: set[str] = set()

    async def connect(self, websocket: WebSocket, client_type: str, overlay_id: str | None = None) -> str:
        await websocket.accept()
        client_id = str(uuid.uuid4())
        self.active[client_id] = websocket
        if overlay_id:
            self.overlay_clients[client_id] = overlay_id
        if client_type == CUSTOMIZER:
            self.customizer_clients.add(client_id)
        return client_id

    def disconnect(self, client_id: str) -> None:
        self.active.pop(client_id, None)
        self.overlay_clients.pop(client_id, None)
        self.customizer_clients.discard(client_id)

    def _targets(self, client_type: str | None, overlay_id: str | None) -> set[str]:
        """Who should receive this message.

        An overlay id is a boundary, not a hint. Every producer passes one and
        none of them pass a client type, so a filter that only applied when
        `client_type == OVERLAY` fell straight through to "everyone" — and two
        streams on the same backend received each other's comments, each other's
        config and each other's connection status. A scene's own id decides who
        hears about it, whatever kind of client is listening.
        """
        if overlay_id:
            return {cid for cid, oid in self.overlay_clients.items() if oid == overlay_id}
        if client_type == CUSTOMIZER:
            return self.customizer_clients.copy()
        if client_type == OVERLAY:
            # Overlays with no id, kept apart from any stray client that never
            # named a scene.
            return set(self.overlay_clients.keys())
        return set(self.active.keys())

    async def broadcast(
        self,
        message: dict[str, Any],
        client_type: str | None = None,
        overlay_id: str | None = None,
    ) -> None:
        targets = self._targets(client_type, overlay_id)
        if not targets:
            return

        data = json.dumps(message, ensure_ascii=False)
        dead: list[str] = []
        for cid in targets:
            ws = self.active.get(cid)
            if ws is None:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                # A browser source that OBS tore down mid-send is normal, not an
                # error worth propagating. Drop the client and keep going.
                dead.append(cid)
        for cid in dead:
            self.disconnect(cid)


hub = Hub()
