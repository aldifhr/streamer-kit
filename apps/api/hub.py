"""WebSocket client registry and fan-out.

Kept separate from the event layer so that "who is listening" and "what
happened" stay independent: a new event source never needs to know how
broadcasting works, and a new client type never needs to know what an event is.
"""

import asyncio
import json
import uuid
from typing import Any

from fastapi import WebSocket

OVERLAY = "overlay"
CUSTOMIZER = "customizer"

#: Messages buffered for one client before it is judged not to be keeping up.
#:
#: Sized for a burst, not a steady rate: two thousand events dispatched in 58ms
#: will fill a small queue with a healthy client still attached, and a limit low
#: enough to catch that is low enough to fail on real spikes. A busy room sends a
#: comment every second or so, so this is well over a minute of slack.
CLIENT_QUEUE_LIMIT = 4096

#: Consecutive full-queue events before a client is dropped.
#:
#: One overflow is a burst and means nothing. A client that is still behind after
#: this many is not going to catch up, and every message it never drains is
#: memory someone else is paying for.
CLIENT_OVERFLOW_STRIKES = 50

#: How long one send may take before the socket is considered wedged.
#:
#: Not the same as a timeout on the whole broadcast: each client gets its own,
#: so one stalled OBS cannot delay anyone else and is dropped on its own clock.
SEND_TIMEOUT_S = 5.0


class Hub:
    def __init__(self) -> None:
        self.active: dict[str, WebSocket] = {}
        # client id to the overlay it is watching, for every client type that
        # names one. The customizer panel edits a specific scene's config, so it
        # is bound to that scene for delivery purposes even though it is not a
        # broadcast client.
        self.overlay_clients: dict[str, str] = {}
        self.customizer_clients: set[str] = set()
        # One bounded queue and one writer task per client.
        #
        # Sending inline meant `await ws.send_text(...)` in a loop, so a browser
        # source that had stopped reading held up every other client behind it:
        # measured at 0.1ms with all clients healthy and 250.5ms with one slow
        # socket among eight, and a real stalled send takes however long the
        # socket takes to give up rather than a quarter of a second.
        self._queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._writers: dict[str, asyncio.Task[None]] = {}
        self._strikes: dict[str, int] = {}

    async def connect(self, websocket: WebSocket, client_type: str, overlay_id: str | None = None) -> str:
        await websocket.accept()
        client_id = str(uuid.uuid4())
        self.active[client_id] = websocket
        self._queues[client_id] = asyncio.Queue(maxsize=CLIENT_QUEUE_LIMIT)
        self._writers[client_id] = asyncio.create_task(self._writer(client_id, websocket))
        if overlay_id:
            self.overlay_clients[client_id] = overlay_id
        if client_type == CUSTOMIZER:
            self.customizer_clients.add(client_id)
        return client_id

    def disconnect(self, client_id: str) -> None:
        self.active.pop(client_id, None)
        self.overlay_clients.pop(client_id, None)
        self.customizer_clients.discard(client_id)
        self._queues.pop(client_id, None)
        self._strikes.pop(client_id, None)
        task = self._writers.pop(client_id, None)
        if task is not None:
            task.cancel()

    async def _writer(self, client_id: str, ws: WebSocket) -> None:
        """Drain one client's queue, on that client's own clock."""
        queue = self._queues[client_id]
        while True:
            message = await queue.get()
            try:
                # Serialised on the way out, not on the way in: a queued viewer
                # count that gets coalesced must not have been encoded already.
                await asyncio.wait_for(
                    ws.send_text(json.dumps(message, ensure_ascii=False)),
                    timeout=SEND_TIMEOUT_S,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                # A source OBS tore down mid-send, or one that stopped reading
                # long enough to time out. Either way it is not coming back.
                self.disconnect(client_id)
                return

    def _send(self, client_id: str, message: dict[str, Any]) -> None:
        """Hand a message to one client without waiting for it.

        Nothing is thrown away silently. A viewer count is the one thing that
        goes stale by definition — only the latest number is ever true — so a
        queued one is replaced rather than kept. A chat comment or a gift is not
        stale, so those are never dropped: the queue grows to hold them and the
        client is judged on its drain rate instead.

        The first version disconnected a client the instant its queue filled,
        which killed four healthy clients during a two-thousand-event burst.
        Dropping the client after it has stayed behind this many times is the
        distinction between a spike and a socket that has stopped reading.
        """
        queue = self._queues.get(client_id)
        if queue is None:
            return

        coalesce = message.get("type") == "viewers"
        while True:
            try:
                if coalesce and queue.qsize() > 0:
                    # Replace the oldest queued viewer count rather than adding
                    # another one behind it.
                    dropped = queue.get_nowait()
                    if dropped.get("type") != "viewers":
                        queue.put_nowait(dropped)
                        continue
                queue.put_nowait(message)
                self._strikes[client_id] = 0
                return
            except asyncio.QueueFull:
                self._strikes[client_id] = self._strikes.get(client_id, 0) + 1
                if self._strikes[client_id] >= CLIENT_OVERFLOW_STRIKES:
                    self.disconnect(client_id)
                return

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

        for cid in targets:
            if cid not in self.active:
                continue
            self._send(cid, message)


hub = Hub()
