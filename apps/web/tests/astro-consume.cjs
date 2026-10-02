/**
 * Which feed entries reach the engine, and in what order.
 *
 * The buffers here are built by replaying the feed's own line —
 * `setEntries((prev) => [entry, ...prev].slice(0, BUFFER_MAX))` — rather than
 * written out by hand. The previous version of this file spelled its buffers
 * oldest first, which is the one shape the feed never produces, and so it
 * agreed with an implementation that had the order exactly backwards: tests
 * green, every scene frozen at whatever was on screen when it mounted. A
 * hand-written literal cannot catch that class of mistake; a producer replayed
 * through the same code path can.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/astro-consume");
const { takeNew } = require(path.join(OUT, "lib", "widgets", "astro", "consume.js"));

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

const seq = (n) => ({ seq: n });

/** The feed's buffer, capped the way the feed caps it. */
const BUFFER_MAX = 50;
function feed(...ns) {
  let buf = [];
  for (const n of ns) buf = [seq(n), ...buf].slice(0, BUFFER_MAX);
  return buf;
}
/** One message at a time, the way a socket delivers them. */
function next(buf, n) {
  return [seq(n), ...buf].slice(0, BUFFER_MAX);
}
const run = (buf, consumed) => takeNew(buf, consumed);
const order = (fresh) => fresh.map((e) => e.seq).join(",");

console.log("a first pass hands over everything, oldest first");
{
  const { fresh, consumed } = run(feed(1, 2, 3), 0);
  check("every entry is new", fresh.length === 3, order(fresh));
  check("in the order it happened", order(fresh) === "1,2,3", order(fresh));
  check("the marker ends on the newest", consumed === 3, `got ${consumed}`);
}

console.log("a re-render hands over nothing");
{
  const buf = feed(1, 2, 3);
  const first = run(buf, 0);
  const second = run(buf, first.consumed);
  check("nothing is replayed", second.fresh.length === 0, order(second.fresh));
  check("the marker does not move", second.consumed === 3, `got ${second.consumed}`);
}

console.log("messages arriving one at a time all arrive");
// The shape of a live room. This is what failed in production: the first
// message was handed over and every message after it was dropped, so the city
// kept the one resident it had when the widget mounted and never grew again.
{
  let buf = [];
  let consumed = 0;
  const seen = [];
  for (let n = 1; n <= 12; n++) {
    buf = next(buf, n);
    const r = run(buf, consumed);
    consumed = r.consumed;
    seen.push(...r.fresh.map((e) => e.seq));
  }
  check("all twelve arrive", seen.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12", seen.join(","));
  check("each arrives exactly once", new Set(seen).size === 12, `${new Set(seen).size} distinct`);
}

console.log("a burst arriving between renders all arrive");
// React batches, so several messages can land in the buffer between two
// renders. Whatever arrived while it was busy still has to be delivered.
{
  const first = run(feed(1, 2, 3, 4, 5), 0);
  const second = run(feed(1, 2, 3, 4, 5, 6, 7), first.consumed);
  check("only the two new entries", order(second.fresh) === "6,7", order(second.fresh));
  check("the marker follows", second.consumed === 7, `got ${second.consumed}`);
}

console.log("a trimmed buffer still works");
// The feed keeps a fixed number of entries, so the oldest are dropped. If the
// marker is behind the oldest retained entry, everything retained is new — and a
// marker that failed to advance would replay the whole buffer forever.
{
  const trimmed = feed(41, 42, 43, 44);
  const { fresh, consumed } = run(trimmed, 12);
  check("a marker behind the buffer yields the whole buffer", fresh.length === 4, order(fresh));
  check("still oldest first", order(fresh) === "41,42,43,44", order(fresh));
  check("the marker jumps to the newest", consumed === 44, `got ${consumed}`);
}

console.log("a long busy room keeps up and stops replaying");
{
  let buf = [];
  let consumed = 0;
  let handed = 0;
  for (let n = 1; n <= 400; n++) {
    buf = next(buf, n);
    const r = run(buf, consumed);
    consumed = r.consumed;
    handed += r.fresh.length;
  }
  check("every one of 400 was handed over once", handed === 400, `${handed} handed over`);
  const idle = run(buf, consumed);
  check("and a re-render afterwards replays nothing", idle.fresh.length === 0, order(idle.fresh));
}

console.log("a marker exactly at a retained entry yields the rest");
{
  const { fresh } = run(feed(10, 11, 12), 10);
  check("seq 10 is not new", order(fresh) === "11,12", order(fresh));
}

console.log("the old arithmetic, shown to be wrong against a real buffer");
// The implementation this replaced read its marker off the last element. Under
// a prepend that is the oldest retained entry, so the scan matched on the very
// first comparison and the engine was handed nothing after the opening pass.
{
  const oldWay = (buf, consumed) => {
    let start = buf.length - 1;
    while (start >= 0 && buf[start].seq > consumed) start--;
    return { fresh: buf.slice(start + 1), consumed: Math.max(consumed, buf[0].seq) };
  };
  const buf = feed(1, 2, 3, 4, 5);
  const a = oldWay(buf, 0);
  check("old: the first pass looks fine", a.fresh.length === 5, order(a.fresh));
  const b = oldWay(buf, a.consumed);
  check("old: and then it stops delivering entirely", b.fresh.length === 0, `${b.fresh.length} — the room stopped growing`);

  const fixed = run(buf, 0);
  check("new: a re-render hands over nothing", run(buf, fixed.consumed).fresh.length === 0);
  check("new: because a later entry does arrive", order(run(feed(1, 2, 3, 4, 5, 6), fixed.consumed).fresh) === "6");
}

console.log("degenerate inputs do not throw");
// The effect runs on every render, including the very first when the buffer is
// still empty, so an empty buffer has to be a no-op rather than a crash.
{
  check("an empty buffer is a no-op", run([], 0).fresh.length === 0);
  check("an empty buffer keeps the marker", run([], 7).consumed === 7, `got ${run([], 7).consumed}`);
  check("one entry is handed over", run(feed(1), 0).fresh.length === 1);
  check("nothing new on a single held entry", run(feed(1), 1).fresh.length === 0);
  check("a marker past the newest yields nothing", run(feed(1), 99).fresh.length === 0);
}

console.log();
assert.equal(typeof takeNew, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
