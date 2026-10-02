/**
 * Per-overlay state must be replaced, not conditionally kept.
 *
 * The editor loaded an overlay with `if (data.username) setUsername(...)`, which
 * means an overlay with no channel never clears the field: it keeps the handle
 * the previous overlay had. Open an overlay, type a channel, open a second one,
 * and the second shows the first one's handle — the editor claiming a channel the
 * user never typed, which looks like a backend that stayed connected to the old
 * room.
 *
 * The log carried over the same way, and so did the status and the error.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/scene");
const { loadedIdentity, EMPTY_IDENTITY } = require(path.join(OUT, "lib", "editor", "scene-load.js"));

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

/** What the two overlays in the report look like coming off the wire. */
const WITH_CHANNEL = { id: "a", username: "@satu", config: { type: "chat" } };
const NO_CHANNEL = { id: "b", config: { type: "chat" } };

console.log("the reported sequence: overlay one typed in, overlay two did not");
{
  const afterFirst = loadedIdentity(WITH_CHANNEL);
  check("the first overlay shows its channel", afterFirst.username === "@satu", `got ${afterFirst.username}`);

  const afterSecond = loadedIdentity(NO_CHANNEL, afterFirst);
  check("the second overlay shows no channel", afterSecond.username === "",
    `got "${afterSecond.username}" — it kept the first overlay's`);
  check("which is not the first overlay's handle", afterSecond.username !== "@satu");
}

console.log("a channel is shown when the overlay has one");
{
  check("second overlay with its own channel", loadedIdentity({ username: "@dua" }).username === "@dua");
  check("an empty string is a channel field left blank", loadedIdentity({ username: "" }).username === "");
  check("and stays blank rather than becoming something", loadedIdentity({ username: "" }).username !== "@satu");
}

console.log("anything that is not a string is treated as no channel");
{
  for (const bad of [undefined, null, 0, 1, false, true, {}, [], NaN]) {
    const got = loadedIdentity({ username: bad }, { username: "@satu", error: null }).username;
    check(`${JSON.stringify(bad) ?? "undefined"} is not a channel`, got === "", `got "${got}"`);
  }
}

console.log("a string that looks falsy is still a channel");
{
  // Truthiness would have dropped this one.
  check("zero as a string survives", loadedIdentity({ username: "0" }).username === "0");
  check("false as a string survives", loadedIdentity({ username: "false" }).username === "false");
}

console.log("an error from another overlay does not survive");
{
  const prev = { username: "@satu", error: "Overlay not found" };
  check("a clean load clears it", loadedIdentity(WITH_CHANNEL, prev).error === null,
    `got ${loadedIdentity(WITH_CHANNEL, prev).error}`);
  check("a load with no channel still clears it", loadedIdentity(NO_CHANNEL, prev).error === null);
}

console.log("the old conditional, shown to be wrong");
{
  // What the component used to do: only assign when the payload had something.
  const oldWay = (payload, previous) =>
    payload.username ? payload.username : previous.username;

  const afterFirst = oldWay(WITH_CHANNEL, { username: "" });
  check("old: the first overlay shows its channel", afterFirst === "@satu");
  check("old: the second overlay keeps the first one's", oldWay(NO_CHANNEL, { username: afterFirst }) === "@satu",
    "which is the reported bug");
  check("new: the second overlay does not", loadedIdentity(NO_CHANNEL, { username: "@satu" }).username === "");
}

console.log("degenerate input does not throw");
{
  check("null payload", loadedIdentity(null).username === "");
  check("undefined payload", loadedIdentity(undefined).username === "");
  check("no previous state", loadedIdentity(NO_CHANNEL).username === "");
  check("the empty default is empty", EMPTY_IDENTITY.username === "" && EMPTY_IDENTITY.error === null);
}

console.log();
assert.equal(typeof loadedIdentity, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}