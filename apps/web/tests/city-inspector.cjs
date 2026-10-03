/**
 * The decision log.
 *
 * Written because a live room with hundreds of watchers was rendering a village,
 * and nothing on screen or in the socket log said why. A viewer cannot tell a
 * city that is being ignored from a city that is working — both look like a
 * number that is not moving — so the log exists to name the reason.
 *
 * The case that matters most is the full street: a room full of new arrivals
 * whose number still does not move, because every arrival pushes somebody out.
 * Nothing else in the product says that.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/city/lib/widgets/city");
const { createInspector, formatAge, MAX_NOTES } = require(path.join(OUT, "inspector.js"));
const fs = require("node:fs");

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

console.log("it is a ring, not a growing list");
{
  const ins = createInspector(4);
  for (let i = 1; i <= 10; i += 1) ins.push("event", `line ${i}`, i * 100);
  const notes = ins.notes();
  check("it never grows past its bound", notes.length === 4, `got ${notes.length}`);
  check("and keeps the newest", notes[3].text === "line 10", `got ${notes[3].text}`);
  check("and drops the oldest", notes[0].text === "line 7", `got ${notes[0].text}`);
  check("in order", notes.map((n) => n.text).join(",") === "line 7,line 8,line 9,line 10",
    notes.map((n) => n.text).join(","));
}

console.log("a log that grows without limit is its own slowdown");
{
  const ins = createInspector(MAX_NOTES);
  for (let i = 0; i < MAX_NOTES * 3; i += 1) ins.push("event", "x", i);
  check("a busy room stays bounded", ins.size() === MAX_NOTES, `got ${ins.size()}`);
}

console.log("clearing resets it");
{
  const ins = createInspector(8);
  ins.push("join", "a", 0);
  ins.push("gift", "b", 1);
  ins.clear();
  check("notes are gone", ins.notes().length === 0, `got ${ins.notes().length}`);
  check("and the tally too", Object.keys(ins.tally()).length === 0, JSON.stringify(ins.tally()));
}

console.log("the tally says what the room did");
{
  const ins = createInspector();
  ins.push("join", "a", 0);
  ins.push("join", "b", 1);
  ins.push("refused", "c", 2);
  ins.push("gift", "d", 3);
  const t = ins.tally();
  check("joins counted", t.join === 2, `got ${t.join}`);
  check("refusals counted", t.refused === 1, `got ${t.refused}`);
  check("gifts counted", t.gift === 1, `got ${t.gift}`);
  check("and the tally is a copy", (() => { t.join = 99; return ins.tally().join === 2; })(),
    "mutating the result must not change the log");
}

console.log("the reason travels with the event");
{
  // The whole point: a line that only says what happened is not an explanation.
  const ins = createInspector();
  ins.push("refused", "budi masuk, ratna dikeluarkan — jalan penuh 16", 0);
  const line = ins.notes()[0].text;
  check("names who came in", line.includes("budi"), line);
  check("names who went out", line.includes("ratna"), line);
  check("and says the street was full", line.includes("penuh"), line);
}

console.log("the buffer does not decide what is worth recording");
{
  // It records everything it is given, including repeats. Keeping a steady room
  // quiet is the engine's job — it only writes an audience line when the number
  // changes — and a filter here would silently drop a real second event that
  // happened to read the same as the one before it.
  const ins = createInspector();
  for (let i = 1; i <= 50; i += 1) ins.push("audience", `penonton ${i}`, i);
  check("every push is recorded", ins.size() === 50, `got ${ins.size()}`);
  check("including identical repeats", ins.notes()[1].text === "penonton 2", `got ${ins.notes()[1].text}`);
  check("and each one is counted", ins.tally().audience === 50, `got ${ins.tally().audience}`);
}

console.log("leaving is a journey, not a blink");
{
  // A resident who vanishes where they stand reads as a glitch, whatever the
  // code intended. These hold the three exits to being visible departures:
  // walking somewhere, then being gone only once they have arrived.
  const src = fs.readFileSync(
    path.resolve(__dirname, "../lib/widgets/city/engine.ts"), "utf8");

  check("there is a bus exit at all", /exitMode = "bus"/.test(src),
    "someone leaving should be able to walk to the stop");
  check("and it is a declared mode", /exitMode: "edge" \| "door" \| "bus"/.test(src),
    "a mode the type does not allow is dead code");
  check("boarding waits before the resident is gone", /exitT = -1\.1/.test(src),
    "walking to the stop and vanishing is the same blink with extra steps");
  check("the bus is the stop, not an empty spot",
    /activities\.shelter\(p\)/.test(src), "the destination should be the shelter");
  check("and boarding does not drift upward",
    /if \(p\.exitMode !== "bus"\) \{\s*\n\s*p\.y -= 5 \* dt/.test(src),
    "rising on a bus looks like being lifted off the street");
  check("the log says which way they left", /jalan ke halte/.test(src),
    "a log that cannot name the departure cannot explain it");
}

console.log("ages read at a glance");
{
  check("seconds", formatAge(0, 5000) === "5s", `got ${formatAge(0, 5000)}`);
  check("minutes", formatAge(0, 125_000) === "2m", `got ${formatAge(0, 125_000)}`);
  check("hours and minutes", formatAge(0, 3_720_000) === "1j 2m", `got ${formatAge(0, 3_720_000)}`);
  check("a clock that went backwards does not read negative", formatAge(5000, 0) === "0s",
    `got ${formatAge(5000, 0)}`);
}

console.log("empty is not an error");
{
  const ins = createInspector();
  check("no notes yet", ins.notes().length === 0);
  check("no tally yet", Object.keys(ins.tally()).length === 0);
  check("size zero", ins.size() === 0);
}

console.log();
assert.equal(typeof createInspector, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}