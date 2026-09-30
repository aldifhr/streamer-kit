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
const run = (buf, consumed) => takeNew(buf, consumed);

console.log("a first pass hands over everything");
// The common case on a page that has just loaded: the buffer is already full of
// history and none of it has been seen.
{
  const buf = [seq(1), seq(2), seq(3)];
  const { fresh, consumed } = run(buf, 0);
  check("every entry is new", fresh.length === 3, JSON.stringify(fresh));
  check("the marker ends on the newest", consumed === 3, `got ${consumed}`);
}

console.log("a re-render hands over nothing");
// Any re-render that is not a new message — a resize, a style change, a parent
// state change — runs this effect again. Replaying the buffer on those is what
// awarded XP again for the same comment.
{
  const buf = [seq(1), seq(2), seq(3)];
  const first = run(buf, 0);
  const second = run(buf, first.consumed);
  check("nothing is replayed", second.fresh.length === 0, JSON.stringify(second.fresh));
  check("the marker does not move", second.consumed === 3, `got ${second.consumed}`);
}

console.log("only what is new is handed over");
{
  const buf = [seq(1), seq(2), seq(3), seq(4), seq(5)];
  const first = run(buf, 0);
  const grown = [...buf, seq(6), seq(7)];
  const second = run(grown, first.consumed);
  check("only the two new entries", second.fresh.map((e) => e.seq).join() === "6,7", JSON.stringify(second.fresh.map((e) => e.seq)));
  check("the marker follows", second.consumed === 7, `got ${second.consumed}`);
}

console.log("a trimmed buffer still works");
// The feed keeps a fixed number of entries, so the oldest are dropped. If the
// marker is behind the oldest retained entry, everything retained is new — and a
// marker that failed to advance would replay the whole buffer forever.
{
  const trimmed = [seq(41), seq(42), seq(43), seq(44)];
  const { fresh, consumed } = run(trimmed, 12);
  check("a marker behind the buffer yields the whole buffer", fresh.length === 4, JSON.stringify(fresh.length));
  check("the marker jumps to the newest", consumed === 44, `got ${consumed}`);
}

console.log("a marker exactly at the oldest yields the rest");
{
  const buf = [seq(10), seq(11), seq(12)];
  const { fresh } = run(buf, 10);
  check("seq 10 is not new", fresh.map((e) => e.seq).join() === "11,12", JSON.stringify(fresh.map((e) => e.seq)));
}

console.log("the old arithmetic, shown to be wrong");
// This is the bug: advancing on the *oldest* retained entry, which is what the
// widget used to do. It looks correct on the first pass and diverges on the
// second, which is exactly why it was never noticed.
{
  const oldWay = (buf, consumed) => {
    let start = buf.length - 1;
    while (start >= 0 && buf[start].seq > consumed) start--;
    const fresh = buf.slice(start + 1);
    const next = buf.length ? Math.max(consumed, buf[0].seq) : consumed;
    return { fresh, consumed: next };
  };
  const buf = [seq(1), seq(2), seq(3), seq(4), seq(5)];
  const a = oldWay(buf, 0);
  check("old: first pass is fine", a.fresh.length === 5, JSON.stringify(a.fresh.length));
  check("old: but the marker lags on the oldest", a.consumed === 1, `got ${a.consumed}`);

  const b = oldWay(buf, a.consumed);
  check("old: so the second pass replays four entries", b.fresh.length === 4, `got ${b.fresh.length} — each replay awards XP again`);

  const fixed = run(buf, 0);
  const fixedAgain = run(buf, fixed.consumed);
  check("new: the second pass replays nothing", fixedAgain.fresh.length === 0, `got ${fixedAgain.fresh.length}`);
}

console.log("degenerate inputs do not throw");
// The effect runs on every render, including the very first when the buffer is
// still empty, so an empty buffer has to be a no-op rather than a crash.
{
  check("an empty buffer is a no-op", run([], 0).fresh.length === 0);
  check("an empty buffer keeps the marker", run([], 7).consumed === 7, `got ${run([], 7).consumed}`);
  check("one entry is handed over", run([seq(1)], 0).fresh.length === 1);
  check("nothing new on a single held entry", run([seq(1)], 1).fresh.length === 0);
}

console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
