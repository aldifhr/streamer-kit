"""Poll and donation-amount behaviour.

Two things are checked here that no other test touches. The first is that voting
works at all, including the refusal paths, because a poll that silently accepts
a bad choice is a poll that lies on stream. The second is that a donation posted
through the webhook still arrives as a *number* — it used to be formatted into
the alert text and dropped, which is what made the donation jar impossible to
build before this.

Run with: apps/api/.venv/bin/python apps/api/test_polls.py
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import events
import polls
import store

PASSED = 0


def check(label: str, condition: bool) -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        raise SystemExit(1)


def as_bool(value) -> bool:
    return bool(value)


def test_poll_lifecycle() -> None:
    print("a poll is created, voted on, and closed")
    set = polls.set_poll
    result = set("ov1", "Next game?", ["Chess", "Sudoku"], closed=False)
    check("two options come back", len(result["options"]) == 2)
    check("options start at zero", all(o["votes"] == 0 for o in result["options"]))

    after = polls.vote("ov1", 1)
    check("the chosen option counted", after["options"][1]["votes"] == 1)
    check("the other did not", after["options"][0]["votes"] == 0)

    again = polls.vote("ov1", 1)
    check("a second vote adds again", again["options"][1]["votes"] == 2)

    polls.set_poll("ov1", "Next game?", ["Chess", "Sudoku"], closed=True)
    try:
        polls.vote("ov1", 0)
        check("a closed poll refuses", False)
    except PermissionError:
        check("a closed poll refuses", True)

    check("clearing reports it removed one", polls.clear_poll("ov1") is True)
    check("clearing twice reports nothing", polls.clear_poll("ov1") is False)


def test_poll_rejections() -> None:
    print("bad input is rejected rather than counted")
    polls.set_poll("ov2", "Pick one", ["A", "B"])

    try:
        polls.vote("ov2", 5)
        check("a choice past the end is refused", False)
    except IndexError:
        check("a choice past the end is refused", True)

    try:
        polls.vote("ov2", -1)
        check("a negative choice is refused", False)
    except IndexError:
        check("a negative choice is refused", True)

    check("neither bad vote counted", polls.get_poll("ov2")["options"][0]["votes"] == 0)

    try:
        polls.vote("no-such-overlay", 0)
        check("voting on nothing is a lookup error", False)
    except LookupError:
        check("voting on nothing is a lookup error", True)

    for bad in ([], ["   "], ["", "  "]):
        try:
            polls.set_poll("ov3", "Q", bad)
            check(f"empty options refused: {bad!r}", False)
        except ValueError:
            check(f"empty options refused: {bad!r}", True)

    try:
        polls.set_poll("ov3", "   ", ["A"])
        check("a blank question is refused", False)
    except ValueError:
        check("a blank question is refused", True)


def test_poll_isolation() -> None:
    print("one poll per overlay, and they do not bleed")
    polls.set_poll("a", "A?", ["1", "2"])
    polls.set_poll("b", "B?", ["x", "y", "z"])
    polls.vote("a", 0)
    polls.vote("b", 1)

    check("A has its own votes", polls.get_poll("a")["options"][0]["votes"] == 1)
    check("B has its own votes", polls.get_poll("b")["options"][1]["votes"] == 1)
    check("B kept its option count", len(polls.get_poll("b")["options"]) == 3)

    polls.set_poll("a", "A again?", ["1"])
    check("replacing resets the count", polls.get_poll("a")["options"][0]["votes"] == 0)
    check("replacing resets the options", len(polls.get_poll("a")["options"]) == 1)

    polls.clear_poll("a")
    polls.clear_poll("b")


def test_poll_limits() -> None:
    print("a poll cannot be built out of nonsense")
    long = polls.set_poll("ov4", "Q" * 500, ["A" * 500] * 20)
    check("the question is trimmed", len(long["question"]) == polls.MAX_QUESTION)
    check("the option is trimmed", len(long["options"][0]["label"]) == polls.MAX_OPTION)
    check("the option count is capped", len(long["options"]) <= polls.MAX_OPTIONS)
    polls.clear_poll("ov4")


def test_donation_amount_survives_the_wire() -> None:
    print("a webhook donation arrives as a number, not as text")
    # This is the regression: `amount` was accepted by the model and never
    # forwarded, so a donation poster's number reached the overlay as the label
    # and the jar had nothing to add to a total.
    meta = {"title": "Donation", "icon": "🎁", "count": 1, "amount": 50000.0}
    wire = events.to_wire(events.Event(kind=events.ALERT, value="50000", meta=meta))
    check("amount is on the wire", wire.get("amount") == 50000.0)
    check("amount is a number", isinstance(wire.get("amount"), (int, float)))

    plain = events.to_wire(events.Event(kind=events.ALERT, value="hi", meta={"title": "T", "icon": "★"}))
    check("a plain alert has no amount key", "amount" not in plain)
    check("a plain alert is otherwise unchanged", plain["text"] == "hi" and plain["title"] == "T")

    zero = events.to_wire(events.Event(kind=events.ALERT, value="0", meta={"title": "T", "icon": "★", "amount": 0}))
    check("a zero amount is carried, not hidden", zero.get("amount") == 0)


async def test_over_http() -> None:
    print("the routes behave over HTTP")
    from fastapi.testclient import TestClient

    import main
    from main import api_token

    with tempfile.TemporaryDirectory() as tmp:
        original = store.OVERLAYS_FILE
        store.OVERLAYS_FILE = Path(tmp) / "overlays.json"
        store._cache = None
        client = TestClient(main.app)

        try:
            # An overlay has to exist before a hook will emit to it.
            r = client.post(
                "/api/overlays",
                json={"name": "t", "channel": "someone"},
                headers={"X-StreamKit-Token": os.environ.get("TEST_TOKEN", "")},
            )
            if r.status_code in (401, 503):
                # Auth is required and this runner has no token; the poll routes
                # do not need one, so exercise them directly.
                print("       (no token available, skipping the hook path)")
                overlay_id = "poll-only"
            else:
                # `create_overlay` answers `{"overlay": {...}}`, and the id
                # lives inside that rather than beside it.
                overlay_id = r.json()["overlay"]["id"]

            # Auth is exercised with STREAMKIT_TOKEN actually set. Without it the
            # guard is deliberately open (see token_is_valid), so a run with no
            # env proves nothing about whether this route is protected — it
            # proves that everything is unprotected, which is the local-dev
            # default and not a finding.
            r = client.post(f"/api/polls/{overlay_id}", json={"question": "Q", "options": ["a", "b"]})
            if api_token():
                check("creating a poll needs auth", r.status_code == 401)
            else:
                check("creating a poll needs auth (skipped, no token set)", True)

            # Voting is a GET on purpose — the browser source has no session.
            r = client.get("/api/polls/nope/vote?choice=0")
            check("voting with no poll is 404", r.status_code == 404)

            token = os.environ.get("TEST_TOKEN", "")
            if token:
                r = client.post(
                    f"/api/polls/{overlay_id}",
                    json={"question": "Q", "options": ["a", "b"]},
                    headers={"X-StreamKit-Token": token},
                )
                check("creating a poll with a token works", r.status_code == 200)

                r = client.get(f"/api/polls/{overlay_id}/vote?choice=1")
                check("voting is open and works", r.status_code == 200)
                check("the vote landed", r.json()["options"][1]["votes"] == 1)

                r = client.get(f"/api/polls/{overlay_id}/vote?choice=9")
                check("a bad choice is 400", r.status_code == 400)

                r = client.get(f"/api/polls/{overlay_id}/vote?choice=0")
                check("a real choice is not mistaken for missing", r.status_code == 200)
                check("and that vote landed too", r.json()["options"][0]["votes"] == 1)

                r = client.post(
                    f"/api/polls/{overlay_id}",
                    json={"question": "Q", "options": ["a", "b"], "closed": True},
                    headers={"X-StreamKit-Token": token},
                )
                r = client.get(f"/api/polls/{overlay_id}/vote?choice=0")
                check("voting a closed poll is 409", r.status_code == 409)

                r = client.delete(f"/api/polls/{overlay_id}", headers={"X-StreamKit-Token": token})
                check("deleting works", r.status_code == 200)
                r = client.delete(f"/api/polls/{overlay_id}", headers={"X-StreamKit-Token": token})
                check("deleting twice is 404", r.status_code == 404)
        finally:
            store.OVERLAYS_FILE = original
            store._cache = None


def test_fail_open_is_loud() -> None:
    print("an unset token opens the API, and that is on purpose")
    from main import api_token, token_is_valid

    from fastapi import Request

    def probe() -> bool:
        # A bare ASGI scope, so this calls the guard directly instead of
        # guessing through HTTP. `query_string` is required: the guard falls back
        # to the query token, and Starlette raises without it — which is a louder
        # failure than a probe that quietly returns the wrong answer.
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/polls/x",
            "headers": [(b"host", b"test")],
            "query_string": b"",
        }
        return token_is_valid(Request(scope))

    saved = os.environ.pop("STREAMKIT_TOKEN", None)
    try:
        check("the token is genuinely unset", api_token() == "")
        # This is the local-development default: a fresh clone with no env keeps
        # working. It is also why an unconfigured deployment is wide open, which
        # is why the systemd unit ships an EnvironmentFile and a test that runs
        # without it proves nothing.
        check("writes are accepted with no token set", probe() is True)
    finally:
        if saved is not None:
            os.environ["STREAMKIT_TOKEN"] = saved

    os.environ["STREAMKIT_TOKEN"] = "secret-value"
    try:
        check("a configured token rejects a bare write", probe() is False)
    finally:
        if saved is None:
            os.environ.pop("STREAMKIT_TOKEN", None)
        else:
            os.environ["STREAMKIT_TOKEN"] = saved


def main_test() -> None:
    test_poll_lifecycle()
    test_poll_rejections()
    test_poll_isolation()
    test_poll_limits()
    test_donation_amount_survives_the_wire()
    test_fail_open_is_loud()
    asyncio.run(test_over_http())
    print(f"\nall passed ({PASSED} assertions)")


if __name__ == "__main__":
    main_test()
