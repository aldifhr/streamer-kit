/**
 * What the audience is told when the room cannot be reached, and what is not.
 *
 * The string on screen used to be whatever came off the socket:
 *
 *     Connection failed: TikTokLive v7.0.1 -> UserOfflineError
 *
 * which is a note written for whoever is fixing it, broadcast to everyone
 * watching, inside a red box that looked like the overlay had crashed rather
 * than the stream being off. The technical detail is not thrown away — it is
 * still the document title — but it is not part of the picture any more.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/overlay");
const { noticeFor } = require(path.join(OUT, "lib", "overlay", "notice.js"));

let passed = 0;
function check(label, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}   ${detail}`);
    process.exitCode = 1;
  }
}

// The exact string that was on screen.
const RAW = "Connection failed: TikTokLive v7.0.1 -> UserOfflineError";

console.log("the audience gets a sentence about the situation");
{
  const n = noticeFor(RAW);
  check("it says the stream is off", n.headline === "STREAMER IS OFFLINE", n.headline);
  check("the library version is not on screen", !n.headline.includes("TikTokLive"));
  check("nor the exception name", !JSON.stringify(n).includes("UserOfflineError"), JSON.stringify(n));
  check("and nothing technical leaks into the detail",
    !(n.detail || "").includes("Error"), n.detail);
}

console.log("a room that is not live reads as that, not as a crash");
{
  for (const err of [
    "Connection failed: TikTokLive v7.0.1 -> UserOfflineError",
    "UserOfflineError",
    "user not live",
    "stream has ended",
  ]) {
    const n = noticeFor(err);
    check(`"${err.slice(0, 34)}" is not a crash message`,
      n.headline === "STREAMER IS OFFLINE", n.headline);
  }
}

console.log("anything unknown does not get an invented reason");
{
  // The tempting failure here is to classify harder — "account blocked",
  // "network problem" — so the notice feels more helpful. Every one of those
  // would be a guess, and a wrong guess about why someone's stream is down is
  // worse than a general statement that is certainly true.
  const n = noticeFor("Connection failed: socket closed unexpectedly");
  check("it still says the stream is offline", n.headline === "STREAMER IS OFFLINE", n.headline);
  check("and blames nothing specific",
    !/blocked|network|token|auth/i.test(JSON.stringify(n)), JSON.stringify(n));
}

console.log("a channel in the message is used, and not mangled");
{
  const n = noticeFor("Connection failed: UserOfflineError (@room.live)");
  check("it names the channel", (n.detail || "").includes("room.live"), n.detail);
  check("without the @ repeated", !(n.detail || "").includes("@@"), n.detail);

  const bare = noticeFor("UserOfflineError", "other.room");
  check("an explicit username is used too", (bare.detail || "").includes("other.room"), bare.detail);
}

console.log("odd input does not throw");
{
  for (const bad of [null, undefined, "", 0, {}, []]) {
    let n = null;
    let threw = null;
    try {
      n = noticeFor(bad);
    } catch (e) {
      threw = e;
    }
    check(`${JSON.stringify(bad)} is handled`, threw === null && n && n.headline === "STREAMER IS OFFLINE",
      threw ? `threw ${threw.message}` : JSON.stringify(n));
  }
  const errObj = noticeFor(new Error("UserOfflineError"));
  check("an Error instance works", errObj.headline === "STREAMER IS OFFLINE", errObj.headline);
}

console.log("with no channel there is still a second line");
{
  // A headline alone on a 1280-wide source is a lot of emptiness; and the
  // fallback should not be blank, because blank reads as a rendering fault.
  const n = noticeFor(RAW);
  check("there is always a detail", typeof n.detail === "string" && n.detail.length > 0,
    `got ${JSON.stringify(n.detail)}`);
}

console.log();
assert.equal(typeof noticeFor, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}