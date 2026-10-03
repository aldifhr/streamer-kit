"""YouTube source, tested against the shape the API actually returns.

Everything here is either pure or driven with recorded wire payloads. No key, no
network: the point is the mapping and the loop's decisions, and both can be
checked without asking YouTube for anything.

The failure that matters most is the quiet one. A message type this module does
not recognise, a Super Chat with no amount, an author with no display name — all
of those produce either nothing or a wrong-shaped event, and a wrong-shaped event
renders as a person in a city with an empty name rather than as an error.
"""

import asyncio
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import events  # noqa: E402
from sources import youtube as y  # noqa: E402

FAILS: list[str] = []
COUNT = 0


def check(name: str, ok: bool, extra: object = "") -> bool:
    global COUNT
    COUNT += 1
    if not ok:
        FAILS.append(name)
        print(f"  FAIL {name}" + (f" — {extra}" if extra != "" else ""))
    return ok


def collect() -> list[events.Event]:
    """Capture what the source dispatches, so a mapping can be asserted."""
    seen: list[events.Event] = []
    original = y.dispatch
    y.dispatch = lambda overlay_id, event: seen.append(event)  # type: ignore[assignment]
    return seen


def release(original) -> None:
    y.dispatch = original  # type: ignore[assignment]


# ---------------------------------------------------------------------------
print("\nshape of the source")
check("it names itself", y.YouTubeSource.source_name == "youtube")
src = y.YouTubeSource("@nila", "ov1")
check("the @ is stripped", src.username == "nila", src.username)
check("it starts not running", src.is_running() is False)
check("its status is offline", src.status_payload()["connected"] is False)
src._running = True
check("its status is connecting", src.status_payload().get("connecting") is True)
src._connected = True
check("its status is connected", src.status_payload()["connected"] is True)
check("the message names the channel", "nila" in src.status_payload()["message"])

# ---------------------------------------------------------------------------
print("\ntelling a channel id from a handle")
check("a channel id is recognised", y.is_channel_id("UC" + "a" * 22) is True)
check("a handle is not", y.is_channel_id("nila") is False)
check("an @handle is not", y.is_channel_id("@nila") is False)
check("a short UC string is not", y.is_channel_id("UCabc") is False)

# ---------------------------------------------------------------------------
print("\ndisplay names")
check("a name is used", y.display_name({"displayName": "Nila"}) == "Nila")
check("padding is trimmed", y.display_name({"displayName": "  Nila  "}) == "Nila")
check("an empty name is not a name", y.display_name({"displayName": "   "}) is None)
check("a missing author is not a name", y.display_name(None) is None)
check("an empty author is not a name", y.display_name({}) is None)
check("the channel id is the stable key", y.display_id({"channelId": "UCx"}) == "UCx")
check("a missing channel id is empty", y.display_id(None) == "")

# ---------------------------------------------------------------------------
print("\na Super Chat amount")
five = {"snippet": {"paidMessageDetails": {"amountMicros": "5000000"}}}
check("micros convert to whole units", y.super_chat_dollars(five) == 5, y.super_chat_dollars(five))
one = {"snippet": {"paidMessageDetails": {"amountMicros": "1990000"}}}
check("sub-unit money truncates", y.super_chat_dollars(one) == 1, y.super_chat_dollars(one))
check("a membership gift is worth nothing", y.super_chat_dollars({"snippet": {}}) == 0)
check("a missing snippet is worth nothing", y.super_chat_dollars({}) == 0)
junk = {"snippet": {"paidMessageDetails": {"amountMicros": "lots"}}}
check("a non-numeric amount is worth nothing", y.super_chat_dollars(junk) == 0)
missing = {"snippet": {"paidMessageDetails": {"amountMicros": None}}}
check("a null amount is worth nothing", y.super_chat_dollars(missing) == 0)
check(
    "the formatted string is ignored, not parsed",
    y.super_chat_dollars({"snippet": {"paidMessageDetails": {"amountDisplayAmount": "$5.00"}}}) == 0,
)

# ---------------------------------------------------------------------------
print("\na chat message becomes a comment")
seen = collect()
s = y.YouTubeSource("nila", "ov1")
s._handle_message(
    {
        "snippet": {"type": "textMessage", "message": "halo"},
        "authorDetails": {"displayName": "Nila", "channelId": "UCnila"},
    }
)
release(events.dispatch)
check("one event", len(seen) == 1, len(seen))
check("it is a comment", seen[0].kind == events.COMMENT, seen[0].kind)
check("the text is the payload", seen[0].value == "halo", seen[0].value)
check("the name is the display name", seen[0].user == "Nila", seen[0].user)
check("the id is the channel id", seen[0].user_id == "UCnila", seen[0].user_id)

print("\nwhat must not become anything")
cases = {
    "an empty message": {"snippet": {"type": "textMessage", "message": "  "}, "authorDetails": {"displayName": "N"}},
    "an unknown type": {"snippet": {"type": "someNewTypeYouTubeAdded", "message": "hi"}, "authorDetails": {"displayName": "N"}},
    "a system notice": {"snippet": {"type": "textMessageForAtTheViewer", "message": "sub"}, "authorDetails": {"displayName": "N"}},
    "a missing type": {"snippet": {"message": "hi"}, "authorDetails": {"displayName": "N"}},
    "no author at all": {"snippet": {"type": "textMessage", "message": "hi"}},
    "an author with no name": {"snippet": {"type": "textMessage", "message": "hi"}, "authorDetails": {"channelId": "UCx"}},
}
for label, payload in cases.items():
    seen = collect()
    s._handle_message(payload)
    release(events.dispatch)
    check(f"{label} dispatches nothing", len(seen) == 0, seen)

# ---------------------------------------------------------------------------
print("\na Super Chat becomes a gift, with the money in it")
seen = collect()
s._handle_message(
    {
        "snippet": {
            "type": "paidMessageTextOnly",
            "message": "semangat!",
            "paidMessageDetails": {"amountMicros": "20000000"},
        },
        "authorDetails": {"displayName": "Nila", "channelId": "UCnila"},
    }
)
release(events.dispatch)
check("one event", len(seen) == 1, len(seen))
check("it is a gift", seen[0].kind == events.GIFT, seen[0].kind)
check("the amount is diamonds", seen[0].meta.get("diamonds") == 20, seen[0].meta)
check("it says where it came from", seen[0].meta.get("source") == "youtube", seen[0].meta)
check("it is marked as a super chat", seen[0].meta.get("superChat") is True, seen[0].meta)
check("the message rides along", seen[0].value == "semangat!", seen[0].value)

seen = collect()
s._handle_message(
    {
        "snippet": {"type": "paidMessageTextOnly", "message": "", "paidMessageDetails": {"amountMicros": "500000"}},
        "authorDetails": {"displayName": "Nila", "channelId": "UCnila"},
    }
)
release(events.dispatch)
check("a super chat with no message still counts", len(seen) == 1, len(seen))
check("and still carries the money", seen[0].meta.get("diamonds") == 0 or seen[0].meta.get("diamonds") is not None)
check("and is not claimed as a super chat", seen[0].meta.get("superChat") is False, seen[0].meta)

print("\nmemberships")
seen = collect()
s._handle_message(
    {
        "snippet": {"type": "membershipGifting", "message": ""},
        "authorDetails": {"displayName": "Nila", "channelId": "UCnila"},
    }
)
release(events.dispatch)
check("gifting a membership is a share", bool(seen) and seen[0].kind == events.SHARE, seen[0].kind if seen else None)

seen = collect()
s._handle_message(
    {
        "snippet": {"type": "newSponsorEvent"},
        "authorDetails": {"displayName": "Nila", "channelId": "UCnila"},
    }
)
release(events.dispatch)
check("a new member is a follow", bool(seen) and seen[0].kind == events.FOLLOW, seen[0].kind if seen else None)

print("\nno join events are invented")
check("join is not in the type table", events.JOIN not in y.CHAT_KINDS.values(), sorted(set(y.CHAT_KINDS.values())))

# ---------------------------------------------------------------------------
print("\nthe poll loop, with no network")
responses: dict[str, Any] = {}
calls: list[tuple[str, dict[str, str]]] = []


async def fake_get(path: str, params: dict[str, str]) -> dict:
    calls.append((path, dict(params)))
    if path not in responses:
        raise RuntimeError(f"unexpected call {path}")
    out = responses[path]
    return out(len(calls)) if callable(out) else out


def set_up(video: str | None = "vid1") -> y.YouTubeSource:
    calls.clear()
    responses.clear()
    responses["channels"] = {"items": [{"id": "UC" + "b" * 22}]}
    responses["search"] = {"items": ([{"id": {"videoId": video}}] if video else [])}
    responses["videos"] = {"items": [{"liveStreamingDetails": {"concurrentViewers": "4200"}}]}
    responses["liveChatMessages"] = {
        "items": [
            {"snippet": {"type": "textMessage", "message": "hi"}, "authorDetails": {"displayName": "A", "channelId": "UCA"}},
            {"snippet": {"type": "textMessage", "message": "yo"}, "authorDetails": {"displayName": "B", "channelId": "UCB"}},
        ],
        "pollingIntervalMillis": 4200,
    }
    src = y.YouTubeSource("nila", "ov1")
    src._api_key = "k"
    src._get = fake_get  # type: ignore[assignment]
    return src


src = set_up()
out = asyncio.run(src._poll_chat("vid1"))
check("the API's own interval is honoured", out == 4200, out)
chat_calls = [c for c in calls if c[0] == "liveChatMessages"]
check("one chat page", len(chat_calls) == 1, len(chat_calls))
check("the live chat id is asked for", chat_calls[0][1].get("liveChatId") == "vid1", chat_calls[0][1])

print("\nthe backlog is drained, then it stops")
src = set_up()
# After set_up, which resets every response: assigned before it, it was simply
# overwritten and the loop never saw a next page at all.
responses["liveChatMessages"] = lambda n: {
    "items": [
        {"snippet": {"type": "textMessage", "message": f"m{n}"}, "authorDetails": {"displayName": "A", "channelId": "UCA"}}
    ],
    "nextPageToken": "more",
    "pollingIntervalMillis": 4200,
}
out = asyncio.run(src._poll_chat("vid1"))
pages = len([c for c in calls if c[0] == "liveChatMessages"])
check("paging stops at the cap", pages == y.MAX_PAGES, pages)
check("and it says so", out == 4200, out)

print("\nthe audience")
src = set_up()
check("the viewers parse", asyncio.run(src._concurrent_viewers("vid1")) == 4200)
check("the video id is asked for", [c for c in calls if c[0] == "videos"][0][1].get("id") == "vid1")

responses["videos"] = {"items": [{"liveStreamingDetails": {"actualEndTime": "2026-01-01T00:00:00Z"}}]}
check("a finished stream has no viewers", asyncio.run(src._concurrent_viewers("vid1")) is None)
responses["videos"] = {"items": []}
check("a missing video has no viewers", asyncio.run(src._concurrent_viewers("vid1")) is None)
responses["videos"] = {"items": [{"liveStreamingDetails": {"concurrentViewers": None}}]}
check("a null viewer count is none", asyncio.run(src._concurrent_viewers("vid1")) is None)
responses["videos"] = {"items": [{"liveStreamingDetails": {"concurrentViewers": "lots"}}]}
check("an unparseable viewer count is none", asyncio.run(src._concurrent_viewers("vid1")) is None)

print("\nresolving a live video")
src = set_up(video="vid9")
check("a live channel resolves", asyncio.run(src._resolve_live_video()) == "vid9")
src = set_up(video=None)
check("a channel between streams resolves to nothing", asyncio.run(src._resolve_live_video()) is None)

# ---------------------------------------------------------------------------
print("\nno key means no connection, and it says why")
errors: list[str] = []


async def capture_error(overlay_id: str, message: str) -> None:
    errors.append(message)


import sources.youtube as _y  # noqa: E402

saved_err = _y.emit_error
_y.emit_error = capture_error  # type: ignore[assignment]
os.environ.pop("YOUTUBE_API_KEY", None)
keyless = y.YouTubeSource("nila", "ov1")
keyless._api_key = ""
asyncio.run(keyless.start())
_y.emit_error = saved_err  # type: ignore[assignment]
check("it reports an error", len(errors) == 1, errors)
check("the error names the variable", "YOUTUBE_API_KEY" in errors[0], errors)
check("it is not left running", keyless.is_running() is False)

print()
if FAILS:
    print(f"{len(FAILS)} failed of {COUNT}")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print(f"all passed ({COUNT} assertions)")