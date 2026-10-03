"""YouTube Live as an event source.

Same contract as `TikTokSource` — `status_payload`, `is_running`,
`start_background`, `stop` — so `main.build_source` can hand either back and
nothing downstream has to know which platform it is talking to.

The transport is genuinely different, and pretending otherwise is the trap here.
TikTok pushes over a socket; YouTube's live chat is a **poll loop**, and the API
tells you how long to wait (`pollingIntervalMillis`) rather than letting you pick.
Polling faster is not free: it burns daily quota and earns a 429.

Three things YouTube does not have, and what is done about each:

- **No join events.** Nothing is synthesised for it, and nothing needs to be:
  both scenes create a person on the viewer's first event of any kind, before
  they look at the event's kind. A first chat message is a first chat message.
- **No push for the audience.** `RoomUserSeqEvent` carries it on TikTok. Here it
  is a second, slower poll of `liveStreamingDetails.concurrentViewers`.
- **Gifts are not a thing.** A Super Chat is money, so it maps to GIFT with the
  amount carried as diamonds. That mapping is a fiction the scenes will tell —
  a train running for a Super Chat is not the same thing as a train running for
  a rose — and it is the reader's call, not this module's, so the amount travels
  in `meta` where the renderer can be honest about it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from events import COMMENT, FOLLOW, GIFT, SHARE, VIEWERS, Event, dispatch, emit_error, emit_status
from sources.viewers_count import judge

logger = logging.getLogger("streamkit.youtube")

API = "https://www.googleapis.com/youtube/v3"

# Chat message types this module acts on. Everything else is either a system
# notice or a membership event with nothing to show, and passing it through
# would put sentences like "joined the channel" on an overlay as chat.
CHAT_KINDS = {
    "textMessage": COMMENT,
    "paidMessage": GIFT,
    "paidMessageTextOnly": GIFT,
    # Gifting memberships is how YouTube says "I brought someone in", which is
    # what SHARE means to these scenes — and a share draws a companion. Mapping
    # it to GIFT instead would either invent a zero-dollar train or attach an
    # amount YouTube never charged.
    "membershipGifting": SHARE,
    "giftMembership": SHARE,
    "newSponsorEvent": FOLLOW,
}

# The API asks for this long between chat polls; it is honoured, not treated as a
# suggestion, because the quota is daily and the rate limit is per second.
DEFAULT_POLL_MS = 5000
# How often to re-read the audience. A minute is unremarkable for a number that
# moves slowly, and each read costs quota.
VIEWERS_EVERY = 60.0
# Longest a chat page may run before the loop gives up. Ten pages is a lot of
# backlog after a backend restart; past that something is wrong upstream.
MAX_PAGES = 10

# A Super Chat amount arrives in micros of the currency the viewer paid in.
# Dollars are the useful unit for a threshold like "run an express past".
MICROS = 1_000_000


def display_name(author: dict[str, Any] | None) -> str | None:
    """A nickname worth showing, or None.

    YouTube drops the author's own display name in some responses, and an
    overlay that says "" looks broken in a way one saying a handle does not.
    """
    if not author:
        return None
    name = (author.get("displayName") or "").strip()
    return name or None


def display_id(author: dict[str, Any] | None) -> str:
    """The channel id, which is the stable per-viewer key YouTube actually has."""
    if not author:
        return ""
    return (author.get("channelId") or "").strip()


def super_chat_dollars(item: dict[str, Any]) -> int:
    """What a Super Chat was worth, in whole currency units.

    `amountMicros` is exact and `amountDisplayAmount` is a formatted string for
    the viewer; the first is the one to reason about and the second is what would
    be shown. Returns 0 for anything that is not a paid message, so a membership
    gift does not become a zero-diamond train.
    """
    details = item.get("snippet", {}).get("paidMessageDetails") or {}
    micros = details.get("amountMicros")
    if not isinstance(micros, str) or not micros.isdigit():
        return 0
    return int(int(micros) // MICROS)


def is_channel_id(value: str) -> bool:
    """Channel ids are `UC` plus 22 characters. A handle is anything else."""
    v = value.strip()
    return len(v) == 24 and v.startswith("UC")


class YouTubeSource:
    #: Read by `main._connect_room` so a reconnect can tell two sources apart
    #: when the channel name is the same on both platforms.
    source_name = "youtube"

    def __init__(self, channel: str, overlay_id: str) -> None:
        self.username = channel.strip().lstrip("@")
        self.overlay_id = overlay_id
        self._api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
        self._running = False
        self._connected = False
        self._task: asyncio.Task | None = None
        self._last_viewers = 0
        # The live video is resolved once and held, because resolving it costs
        # 100 units of the daily quota against 1 for a chat page. It is only
        # re-resolved when the stream actually ends.
        self._video_id: str | None = None
        self._page_token: str | None = None
        self._last_message_at = 0.0

    # --- lifecycle, identical in shape to TikTokSource ----------------------
    def status_payload(self) -> dict[str, Any]:
        if self._connected:
            return {
                "type": "status",
                "connected": True,
                "message": f"Connected to {self.username}",
            }
        if self._running:
            return {
                "type": "status",
                "connected": False,
                "connecting": True,
                "message": f"Connecting to {self.username}",
            }
        return {"type": "status", "connected": False, "message": "Offline"}

    def is_running(self) -> bool:
        return self._running

    def start_background(self) -> None:
        self._task = asyncio.create_task(self.start())

    async def stop(self) -> None:
        task = self._task
        self._task = None
        self._running = False
        self._connected = False
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001 — stopping is not a failure
                pass

    # --- API ----------------------------------------------------------------
    async def _get(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        import httpx

        q = dict(params)
        q["key"] = self._api_key
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{API}/{path}", params=q)
        if r.status_code >= 400:
            detail = ""
            try:
                detail = r.json().get("error", {}).get("message", "")
            except Exception:  # noqa: BLE001 — the body is not the point
                pass
            raise RuntimeError(f"YouTube API {r.status_code}: {detail or r.text[:120]}")
        return r.json()

    async def _channel_id(self) -> str:
        """Turn a handle into a channel id, or accept one that already is."""
        channel = self.username
        if is_channel_id(channel):
            return channel
        data = await self._get("channels", {"part": "id", "forUsername": channel})
        items = data.get("items") or []
        if not items:
            raise RuntimeError(f"no YouTube channel called {channel!r}")
        return items[0]["id"]

    async def _resolve_live_video(self) -> str | None:
        """The id of the video that is live right now, or None.

        This is the expensive call — 100 units against a daily default of 10,000
        — so it is made once per stream and then held. The cost of getting this
        wrong in the other direction is a channel that looks permanently offline.
        """
        channel_id = await self._channel_id()
        data = await self._get(
            "search",
            {"part": "snippet", "channelId": channel_id, "eventType": "live", "type": "video", "maxResults": "1"},
        )
        items = data.get("items") or []
        return items[0].get("id", {}).get("videoId") if items else None

    async def _concurrent_viewers(self, video_id: str) -> int | None:
        data = await self._get("videos", {"part": "liveStreamingDetails", "id": video_id})
        items = data.get("items") or []
        if not items:
            return None
        details = items[0].get("liveStreamingDetails") or {}
        if "actualEndTime" in details and "concurrentViewers" not in details:
            return None
        raw = details.get("concurrentViewers")
        if raw is None:
            return None
        try:
            return int(str(raw))
        except ValueError:
            return None

    # --- chat ---------------------------------------------------------------
    async def _poll_chat(self, video_id: str) -> int:
        """One round of chat pages. Returns how long the API asked us to wait."""
        wait_ms = DEFAULT_POLL_MS
        params: dict[str, str] = {"liveChatId": video_id, "part": "snippet,authorDetails", "maxResults": "200"}
        if self._page_token:
            params["pageToken"] = self._page_token

        pages = 0
        while pages < MAX_PAGES:
            data = await self._get("liveChatMessages", params)
            wait_ms = int(data.get("pollingIntervalMillis") or wait_ms)
            token = data.get("nextPageToken")
            for item in data.get("items") or []:
                self._handle_message(item)
            pages += 1
            # No token means the backlog is drained; holding the last one would
            # re-fetch the same page for ever.
            if not token:
                self._page_token = None
                break
            params["pageToken"] = token
            self._page_token = token
        else:
            logger.warning("youtube chat backlog still draining after %d pages", MAX_PAGES)
        return wait_ms

    def _handle_message(self, item: dict[str, Any]) -> None:
        snippet = item.get("snippet") or {}
        kind = CHAT_KINDS.get(snippet.get("type") or "")
        if kind is None:
            return
        author = item.get("authorDetails") or {}
        name = display_name(author)
        if not name:
            return
        user_id = display_id(author)

        if kind == COMMENT:
            text = (snippet.get("message") or "").strip()
            if not text:
                return
            dispatch(self.overlay_id, Event(kind=COMMENT, user=name, user_id=user_id, value=text))
            return

        if kind == GIFT:
            dollars = super_chat_dollars(item)
            text = (snippet.get("message") or "").strip()
            dispatch(
                self.overlay_id,
                Event(
                    kind=GIFT,
                    user=name,
                    user_id=user_id,
                    # The message is the payload, not a gift name: YouTube has no
                    # catalogue of gifts, and inventing one would put a word on
                    # screen that YouTube never said.
                    value=text,
                    meta={"diamonds": dollars, "source": "youtube", "superChat": dollars > 0},
                ),
            )
            return

        if kind == SHARE:
            dispatch(self.overlay_id, Event(kind=SHARE, user=name, user_id=user_id, meta={"source": "youtube"}))
            return

        dispatch(self.overlay_id, Event(kind=FOLLOW, user=name, user_id=user_id, meta={"source": "youtube"}))

    # --- main loop ----------------------------------------------------------
    async def start(self) -> None:
        if not self._api_key:
            self._running = False
            await emit_error(
                self.overlay_id,
                "YOUTUBE_API_KEY is not set on the backend; a YouTube source cannot connect without it",
            )
            return

        self._running = True
        next_viewers_at = 0.0
        offline_reported = False

        while self._running:
            try:
                if not self._video_id:
                    self._video_id = await self._resolve_live_video()
                    if not self._video_id:
                        # Not an error. A channel between streams looks exactly
                        # like this, and the overlay has a state for it.
                        if not offline_reported:
                            offline_reported = True
                            self._connected = False
                            await emit_status(self.overlay_id, connected=False, message=f"{self.username} is not live")
                        await asyncio.sleep(30)
                        continue
                    offline_reported = False
                    self._page_token = None
                    self._connected = True
                    await emit_status(self.overlay_id, connected=True, message=f"Connected to {self.username}")

                wait_ms = await self._poll_chat(self._video_id)

                now = time.monotonic()
                if now >= next_viewers_at:
                    next_viewers_at = now + VIEWERS_EVERY
                    viewers = await self._concurrent_viewers(self._video_id)
                    if viewers is None:
                        # The video ended between resolving and now.
                        self._video_id = None
                        self._page_token = None
                        continue
                    verdict = judge(viewers, self._last_viewers, 0)
                    self._last_viewers = verdict.last
                    if verdict.warning:
                        logger.warning(verdict.warning)
                    if verdict.count is not None:
                        dispatch(self.overlay_id, Event(kind=VIEWERS, meta={"count": verdict.count}))

                # The API's own interval is a floor as well as a target: polling
                # faster spends quota to be told to slow down.
                await asyncio.sleep(max(wait_ms, 1000) / 1000.0)

            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — the loop must outlive any one failure
                logger.warning("youtube source for %s: %s", self.username, exc)
                self._connected = False
                await emit_error(self.overlay_id, f"YouTube: {exc}")
                # The stream may simply have ended, which re-resolves cleanly.
                self._video_id = None
                self._page_token = None
                offline_reported = True
                await asyncio.sleep(15)
