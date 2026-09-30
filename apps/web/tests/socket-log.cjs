const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/log");
const { append, clock, summariseEvent, MAX_LINES } = require(path.join(OUT, "lib", "socket-log.js"));

let passed = 0;
function check(label, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    process.exitCode = 1;
  }
}

console.log("the log is bounded");
// A busy room sends a comment every second or two. An unbounded list in the
// editor is a slow leak across a long shift, and React keeps every node.
let lines = [];
for (let i = 0; i < 5000; i += 1) {
  lines = append(lines, { id: i, at: Date.now(), kind: "event", text: `line ${i}` });
}
check(`a long session stays at ${MAX_LINES}`, lines.length === MAX_LINES);
check("the newest line survives", lines[lines.length - 1].text === "line 4999");
check("the oldest is dropped", lines[0].text === `line ${5000 - MAX_LINES}`);
check("a short log is untouched", append([], { id: 1, at: 0, kind: "status", text: "x" }).length === 1);

console.log("event lines are readable and counted");
// "it is connected" and "it is receiving" look identical from the status chip.
// The point of the log is that a working room is visibly working.
const counts = {};
const first = summariseEvent({ type: "comment", user: "Udang", text: "GG" }, counts);
check("a comment names the speaker and the text", first.includes("Udang") && first.includes("GG"));
check("a comment is counted", first.includes("#1"));
const second = summariseEvent({ type: "comment", user: "Monmon", text: "kelaz" }, counts);
check("the second comment is counted too", second.includes("#2"), second);
const third = summariseEvent({ type: "like" }, counts);
check("a different kind counts separately", third.includes("#1"), third);

console.log("odd frames do not throw");
// The log is a diagnostic. It must not be the thing that breaks.
check("no user is fine", summariseEvent({ type: "join" }, counts).includes("join"));
check("no text is fine", summariseEvent({ type: "gift" }, counts).includes("gift"));
check("a missing type is fine", summariseEvent({}, counts).includes("?"));
check("null user does not print", !summariseEvent({ type: "like", user: null }, counts).includes("null"));

console.log("timestamps are readable");
check("a time is h:m:s", /^\d{2}:\d{2}:\d{2}$/.test(clock(Date.now())));
check("midnight is 00:00:00", clock(new Date(2026, 0, 1, 0, 0, 0).getTime()) === "00:00:00");
check("9am pads", clock(new Date(2026, 0, 1, 9, 5, 3).getTime()) === "09:05:03");

console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
