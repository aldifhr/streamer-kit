"""Picking a platform, and what happens when you pick one that isn't there.

A TikTok handle and a YouTube channel name are both strings. That is the whole
problem this file is about: the backend cannot tell them apart from the name, so
the platform has to be stored beside it and has to be refused when it is wrong.
Silently substituting TikTok for an unrecognised source would connect somebody's
YouTube channel to TikTok and report it as working.
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import store  # noqa: E402

# Point the store at a scratch file before anything reads it. Doing this to the
# real overlays.json would rewrite somebody's production config.
store.OVERLAYS_FILE = Path(tempfile.mkdtemp()) / "overlays.json"
store._cache = None

FAILS: list[str] = []
COUNT = 0


def check(name: str, ok: bool, extra: object = "") -> bool:
    global COUNT
    COUNT += 1
    if not ok:
        FAILS.append(name)
        print(f"  FAIL {name}" + (f" — {extra}" if extra != "" else ""))
    return ok


print("\nwhich platforms exist")
check("there is a fixed list", store.SOURCES == ("tiktok", "youtube"), store.SOURCES)
check("tiktok is one of them", "tiktok" in store.SOURCES)
check("youtube is one of them", "youtube" in store.SOURCES)

print("\nnormalising a name")
check("tiktok stays tiktok", store.normalise_source("tiktok") == "tiktok")
check("youtube stays youtube", store.normalise_source("youtube") == "youtube")
check("case does not matter", store.normalise_source("YouTube") == "youtube")
check("padding does not matter", store.normalise_source("  tiktok  ") == "tiktok")
check("a missing source is tiktok", store.normalise_source(None) == "tiktok")
check("an empty source is tiktok", store.normalise_source("") == "tiktok")

print("\nper overlay")
rec = store.create_overlay("Test", {"type": "station"}) or {}
oid = rec["id"]
check("a new overlay defaults to tiktok", rec.get("source") == "tiktok", rec.get("source"))
check("a new overlay has no channel", rec.get("username") == "")

check("source_of reads it back", store.source_of(oid) == "tiktok")
check("source_of an unknown overlay is tiktok", store.source_of("does-not-exist") == "tiktok")

updated = store.update_overlay(oid, source="youtube") or {}
check("it can be switched", updated["source"] == "youtube", updated.get("source"))
check("the change persists", store.source_of(oid) == "youtube")

# An old record, written before the field existed, has to still read as TikTok:
# that is what every existing overlay actually was.
store._data()[oid].pop("source", None)
check("a record with no source is tiktok", store.source_of(oid) == "tiktok")
store.update_overlay(oid, source="tiktok")

print("\na source is stored beside the name, never inferred from it")
named = store.update_overlay(oid, username="nila") or {}
check("the name is stored", named["username"] == "nila", named.get("username"))
check("the platform is separate", named["source"] == "tiktok", named.get("source"))
switched = store.update_overlay(oid, source="youtube") or {}
check("switching keeps the name", switched["username"] == "nila", switched.get("username"))
check("switching sets the platform", switched["source"] == "youtube", switched.get("source"))
check(
    "both are read back independently",
    store.username_of(oid) == "nila" and store.source_of(oid) == "youtube",
)

print("\nan unrecognised platform")
# The store folds it, which is right for a config file written by an older
# build. The API refuses it, which is right for a request from the editor.
check("the store folds it to tiktok", store.normalise_source("twitch") == "tiktok")

print("\nthe API shape")
import main  # noqa: E402

check("the request carries a source", "source" in main.ConnectRequest.model_fields)
check("the patch carries a source", "source" in main.UpdateOverlayRequest.model_fields)
summary_fields = set(main._summary(oid, (store._record(oid) or {})).keys())
check("the summary reports a source", "source" in summary_fields, sorted(summary_fields))
check("a summary defaults a missing source", main._summary("nope", {})["source"] == "tiktok")

print("\nbuilding a source")
tiktok = main.build_source("tiktok", "nila", oid)
check("tiktok builds a tiktok source", type(tiktok).__name__ == "TikTokSource", type(tiktok).__name__)
check("it knows the channel", tiktok.username == "nila")

# YouTube has no source in this build yet. It must fail loudly rather than
# quietly building a TikTok client against a YouTube channel name.
raised = None
built = None
try:
    built = main.build_source("youtube", "nila", oid)
except Exception as exc:  # noqa: BLE001 — the point is what happens
    raised = exc
check(
    "youtube either builds a youtube source or refuses",
    raised is not None or type(built).__name__ == "YouTubeSource",
    f"built={type(built).__name__ if built else None} raised={raised}",
)
if raised is not None:
    check("the refusal explains itself", "youtube" in str(raised).lower(), str(raised))
    check("it is not a bare ImportError", not isinstance(raised, ImportError), type(raised).__name__)

print("\nunknown platforms are refused by the route, not substituted")
from fastapi import HTTPException  # noqa: E402


async def rejects(source: str) -> object:
    req = main.ConnectRequest(source=source, username="nila", overlay_id=oid)
    try:
        await main.connect(req)
        return None
    except HTTPException as exc:
        return exc
    except Exception as exc:  # noqa: BLE001
        return exc


err = asyncio.run(rejects("twitch"))
check("connecting to an unknown source fails", err is not None)
check("it fails with a 400", getattr(err, "status_code", None) == 400, getattr(err, "status_code", None))
check("the message lists the choices", "tiktok" in str(getattr(err, "detail", "")).lower(), str(getattr(err, "detail", "")))

err_blank = asyncio.run(rejects(""))
check("an empty source is not refused", err_blank is None or getattr(err_blank, "status_code", None) != 400, err_blank)


async def patch_rejects(source: str) -> object:
    req = main.UpdateOverlayRequest(source=source)
    try:
        await main.update_overlay(oid, req)
        return None
    except HTTPException as exc:
        return exc
    except Exception as exc:  # noqa: BLE001
        return exc


perr = asyncio.run(patch_rejects("twitch"))
check("patching an unknown source fails", perr is not None)
check("it fails with a 400", getattr(perr, "status_code", None) == 400, getattr(perr, "status_code", None))
check(
    "the stored source is untouched after a refusal",
    store.source_of(oid) == "youtube",
    store.source_of(oid),
)

good = asyncio.run(patch_rejects("tiktok"))
check("patching a known source works", good is None, getattr(good, "detail", good))
check("and it is stored", store.source_of(oid) == "tiktok", store.source_of(oid))

print()
if FAILS:
    print(f"{len(FAILS)} failed of {COUNT}")
    for f in FAILS:
        print("  - " + f)
    raise SystemExit(1)
print(f"all passed ({COUNT} assertions)")
