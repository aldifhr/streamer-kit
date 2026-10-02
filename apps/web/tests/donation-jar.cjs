/**
 * The donation jar's arithmetic, without a React renderer.
 *
 * The bug this locks down was a marker read off the wrong end of the buffer. The
 * feed prepends, so `entries[entries.length - 1]` is the oldest retained entry,
 * not the newest; the marker therefore trailed everything already counted and the
 * next render counted it again. The effect had no dependency array, so it ran on
 * every render and the total climbed with no new event behind it.
 *
 * `takeNew` is the same helper the city and the astronaut use, so these cases are
 * the jar's half of that contract: a run of events counted once, a re-render
 * counted nothing, and a trimmed buffer neither double-counting nor losing the
 * events that arrived while it was busy.
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
const BUFFER_MAX = 200;
function push(buf, n) {
  return [seq(n), ...buf].slice(0, BUFFER_MAX);
}

/**
 * One pass of the jar's effect: hand back what is new and the new marker.
 *
 * `takeNew` is what the component calls, so this is the component's arithmetic
 * rather than a re-statement of it.
 */
function pass(entries, lastSeq) {
  const { fresh, consumed } = takeNew(entries, lastSeq);
  return { fresh, consumed, added: fresh.length };
}

console.log("a run of events is counted once");
{
  let buf = [];
  let last = 0;
  let counted = 0;
  for (let n = 1; n <= 5; n++) {
    buf = push(buf, n);
    const r = pass(buf, last);
    last = r.consumed;
    counted += r.added;
  }
  check("five events, five counts", counted === 5, `got ${counted}`);
}

console.log("re-rendering does not count anything again");
// The effect used to have no dependency array, so every render re-ran it against
// an unchanged buffer.
{
  let buf = [];
  let last = 0;
  let counted = 0;
  for (let n = 1; n <= 5; n++) {
    buf = push(buf, n);
    const r = pass(buf, last);
    last = r.consumed;
    counted += r.added;
  }
  for (let i = 0; i < 20; i++) {
    const r = pass(buf, last);
    last = r.consumed;
    counted += r.added;
  }
  check("twenty re-renders add nothing", counted === 5, `got ${counted} — the total grew on its own`);
}

console.log("the old marker, shown against a real buffer");
{
  // What the component used to do: filter above the marker, then set the marker
  // from the last element of a prepended buffer.
  const oldWay = (entries, marker) => {
    const fresh = entries.filter((e) => e.seq > marker);
    return { fresh: fresh.length, marker: entries.length ? entries[entries.length - 1].seq : marker };
  };
  let buf = [];
  let marker = 0;
  let counted = 0;
  for (let n = 1; n <= 6; n++) {
    buf = push(buf, n);
    const r = oldWay(buf, marker);
    marker = r.marker;
    counted += r.fresh;
  }
  check("old: six events count as far more than six", counted > 6, `got ${counted}`);

  let nbuf = [];
  let nmarker = 0;
  let ncounted = 0;
  for (let n = 1; n <= 6; n++) {
    nbuf = push(nbuf, n);
    const r = pass(nbuf, nmarker);
    nmarker = r.consumed;
    ncounted += r.added;
  }
  check("new: six events count as six", ncounted === 6, `got ${ncounted}`);
}

console.log("a busy room that outruns the buffer");
// BUFFER_MAX is 200. A room can produce more than that between two renders, and
// the marker then sits behind everything still retained.
{
  let buf = [];
  let last = 0;
  let counted = 0;
  for (let n = 1; n <= 600; n++) {
    buf = push(buf, n);
    const r = pass(buf, last);
    last = r.consumed;
    counted += r.added;
  }
  check("every event that was still retained is counted once", counted === 600, `got ${counted}`);
  check("and the buffer really is capped", buf.length === BUFFER_MAX, `got ${buf.length}`);
  check("holding the newest", buf[0].seq === 600, `got ${buf[0].seq}`);
}

console.log("a gap while the buffer turns over loses nothing that is kept");
{
  // Two hundred events arrive, nothing is read, then two hundred more.
  let buf = [];
  for (let n = 1; n <= 200; n++) buf = push(buf, n);
  const first = pass(buf, 0);
  check("the first pass hands over the buffer", first.added === 200, `got ${first.added}`);
  check("oldest first, so the recent list is in order", first.fresh[0].seq === 1 && first.fresh[199].seq === 200,
    `got ${first.fresh[0].seq}..${first.fresh[199].seq}`);

  for (let n = 201; n <= 400; n++) buf = push(buf, n);
  const second = pass(buf, first.consumed);
  check("the next batch is the newer half only", second.added === 200, `got ${second.added}`);
  check("and starts where the first left off", second.fresh[0].seq === 201, `got ${second.fresh[0].seq}`);
}

console.log("a marker left far behind by a long idle");
{
  const buf = [];
  for (let n = 500; n <= 505; n++) buf.push(seq(n));
  buf.reverse(); // newest first
  const r = pass(buf, 12);
  check("everything retained is handed over", r.added === 6, `got ${r.added}`);
  check("the marker jumps to the newest", r.consumed === 505, `got ${r.consumed}`);
}

console.log("degenerate inputs do not throw");
{
  check("an empty buffer is a no-op", pass([], 0).added === 0);
  check("an empty buffer keeps the marker", pass([], 7).consumed === 7, `got ${pass([], 7).consumed}`);
  check("one event, one count", pass(push([], 1), 0).added === 1);
  check("nothing new on a held entry", pass(push([], 1), 1).added === 0);
}

console.log();
assert.equal(typeof takeNew, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
