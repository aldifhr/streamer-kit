/**
 * The city's size, derived from the room.
 *
 * The number this is built on is real and was already arriving: the TikTok
 * source sends the live room's viewer count on every heartbeat, and the city
 * ignored it. `KOTA 16` on the HUD was never sixteen viewers — it was the cast
 * currently being drawn, which drifts from the audience badly in both
 * directions.
 *
 * The easing matters as much as the tiers. The real count arrives several times
 * a second, so drawing it directly would rebuild the silhouette that often, and
 * a room oscillating around a boundary would flicker between two skylines.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/city/lib/widgets/city");
const {
  AUDIENCE_TIERS,
  audienceTier,
  audienceGrowth,
  easeAudience,
  formatAudience,
  nextThreshold,
  settledTier,
  TIER_HYSTERESIS,
} = require(path.join(OUT, "audience.js"));

/** Runs the easing for a number of seconds at 60fps, since the rates are per second. */
const run = (from, to, seconds) => {
  let s = from;
  for (let i = 0; i < seconds * 60; i += 1) s = easeAudience(s, to, 0.016);
  return s;
};

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

console.log("tiers follow the count");
{
  check("an empty room is a kampung", audienceTier(0).name === "KAMPUNG", `got ${audienceTier(0).name}`);
  check("nine is still a kampung", audienceTier(9).name === "KAMPUNG", `got ${audienceTier(9).name}`);
  check("ten is a kelurahan", audienceTier(10).name === "KELURAHAN", `got ${audienceTier(10).name}`);
  check("fifty is a kecamatan", audienceTier(50).name === "KECAMATAN", `got ${audienceTier(50).name}`);
  check("two hundred is a kota", audienceTier(200).name === "KOTA", `got ${audienceTier(200).name}`);
  check("five hundred is a metropolis", audienceTier(500).name === "METROPOLIS", `got ${audienceTier(500).name}`);
  check("and it holds at the top", audienceTier(90_000).name === "METROPOLIS");
}

console.log("every tier threshold is reachable and ordered");
{
  const thresholds = AUDIENCE_TIERS.map((t) => t.from);
  for (let i = 1; i < thresholds.length; i += 1) {
    check(`${thresholds[i - 1]} < ${thresholds[i]}`, thresholds[i - 1] < thresholds[i],
      `got ${thresholds[i - 1]}, ${thresholds[i]}`);
  }
  check("the next threshold is one the room has not passed", nextThreshold(5) === 10, `got ${nextThreshold(5)}`);
  check("and none once it is at the top", nextThreshold(5000) === null, `got ${nextThreshold(5000)}`);
}

console.log("nonsense counts do not become cities");
{
  for (const bad of [undefined, null, NaN, -1, -0, "abc", {}, []]) {
    const t = audienceTier(bad);
    check(`${JSON.stringify(bad) ?? "undefined"} is treated as empty`, t.name === "KAMPUNG" && t.index === 0,
      `got ${t.name}`);
  }
}

console.log("growth is a fraction, and never leaves 0..1");
{
  check("an empty room shows nothing new", audienceGrowth(0) === 0, `got ${audienceGrowth(0)}`);
  check("a full room shows everything", audienceGrowth(1000) === 1, `got ${audienceGrowth(1000)}`);
  check("beyond the top it stays at one", audienceGrowth(1e9) === 1, `got ${audienceGrowth(1e9)}`);
  check("a bad count shows nothing", audienceGrowth(NaN) === 0, `got ${audienceGrowth(NaN)}`);

  for (const n of [0, 1, 7, 50, 200, 999, 1000, 5000]) {
    const g = audienceGrowth(n);
    check(`${n} is between 0 and 1`, g >= 0 && g <= 1, `got ${g}`);
  }
}

console.log("growth is loud when small and calm when busy");
{
  // A square-root curve, so the first arrivals fill the screen and a room of
  // thousands is not a wildly different city from a room of hundreds.
  check("one viewer is already a sliver", audienceGrowth(1) > 0, `got ${audienceGrowth(1)}`);
  check("four viewers beat one", audienceGrowth(4) > audienceGrowth(1));
  check("ten times the viewers is not ten times the city",
    audienceGrowth(1000) / audienceGrowth(100) < 4,
    `ratio ${(audienceGrowth(1000) / audienceGrowth(100)).toFixed(2)}`);
  check("growth is monotonic", [1, 10, 100, 500].every((n, i, a) => i === 0 || audienceGrowth(n) > audienceGrowth(a[i - 1])));
}

console.log("the city eases rather than snapping");
{
  check("an empty city starts empty", easeAudience(0, 0, 0.016) === 0);
  check("a jump from nothing does not arrive instantly", easeAudience(0, 500, 0.016) < 500,
    `got ${easeAudience(0, 500, 0.016)}`);
  check("but it does move", easeAudience(0, 500, 0.016) > 0, `got ${easeAudience(0, 500, 0.016)}`);
  check("ten seconds fills most of the gap", run(0, 500, 10) > 450, `got ${run(0, 500, 10).toFixed(0)}`);
  check("a minute finishes it", Math.abs(run(0, 500, 60) - 500) < 1, `got ${run(0, 500, 60).toFixed(2)}`);
}

console.log("a falling count falls slowly");
{
  // One quiet heartbeat must not empty a street that was busy a second ago.
  const down = easeAudience(500, 0, 0.016);
  check("a busy city does not empty in one frame", down > 400, `got ${down}`);
  // Falling is deliberately slower than rising, so the timings differ.
  // Falling is deliberately slower, so ten seconds is not enough to empty a
  // busy street — and that is the point: one quiet heartbeat should not empty it.
  check("ten seconds only partly empties it", run(500, 0, 10) > 100, `got ${run(500, 0, 10).toFixed(0)}`);
  check("and it is still on its way down", run(500, 0, 20) < run(500, 0, 10), "falling must keep going");
  check("a minute empties it", run(500, 0, 60) === 0, `got ${run(500, 0, 60).toFixed(2)}`);
  // Compared as a fraction of the gap, because the raw values sit at opposite
  // ends of the range and comparing those numbers says nothing.
  const rise = run(0, 500, 5) / 500;
  const fall = (500 - run(500, 0, 5)) / 500;
  check("a filling room closes more of its gap than an emptying one", rise > fall,
    `rise ${rise.toFixed(3)} vs fall ${fall.toFixed(3)}`);
}

console.log("easing is frame-rate independent and bounded");
{
  check("a long frame moves no further than its share",
    Math.abs(easeAudience(0, 1000, 0.016) - easeAudience(0, 1000, 0.048)) < 3 * easeAudience(0, 1000, 0.016),
    "three frames of 16ms should roughly match one of 48ms");
  check("a negative dt does not reverse it", easeAudience(100, 200, -0.05) >= 100, `got ${easeAudience(100, 200, -0.05)}`);
  check("an absurd dt does not overshoot", easeAudience(0, 100, 100) <= 100, `got ${easeAudience(0, 100, 100)}`);
  check("already there is still there", easeAudience(300, 300, 0.016) === 300);
}

console.log("the HUD says which number is which");
{
  const line = formatAudience(231, 16);
  check("the audience leads", line.startsWith("KOTA 231"), `got ${line}`);
  check("the cast is labelled, not conflated", line.includes("16 WARGA"), `got ${line}`);
  check("a quiet room reads as one", formatAudience(0, 0) === "KAMPUNG 0  0 WARGA", `got ${formatAudience(0, 0)}`);
  check("and a full one does not hide the cast", formatAudience(5000, 45).includes("45 WARGA"));
}

console.log();
assert.equal(typeof audienceTier, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
// ---------------------------------------------------------------------------
console.log("a tier does not flicker on its own threshold");
{
  // Read off a live overlay running with ?debug=1: a room on the
  // KAMPUNG/KELURAHAN boundary produced exactly this, in this order.
  const live = [9, 10, 11, 10, 9, 11, 10, 9];
  const margin = TIER_HYSTERESIS;

  let tier = 0;
  const flat = [];
  for (const n of live) flat.push(audienceTier(n).index);
  const hys = [];
  for (const n of live) {
    tier = settledTier(tier, n);
    hys.push(tier);
  }

  const changes = (arr) => arr.filter((v, i) => i > 0 && v !== arr[i - 1]).length;
  check("reading the number flat flips the tier " + changes(flat) + " times",
    changes(flat) > 3, `flat: ${flat.join(",")}`);
  check("settling it flips far fewer", changes(hys) <= 1, `settled: ${hys.join(",")}`);
  // The wobble never gets past the threshold plus its margin, so the city should
  // not have moved at all. My first expectation here was that it should end up in
  // KELURAHAN — which is the flicker itself, not the fix.
  check("and the city never moved at all", hys.every((v) => v === 0),
    `settled: ${hys.join(",")}`);

  // A room genuinely past the threshold still goes, and stays.
  // 40 is KELURAHAN, not KECAMATAN — 50 is where that starts. And the walk is one
  // step per call, so a big room needs a few frames to climb, which is what puts
  // a line in the log for each step.
  let grown = 0;
  for (const n of live) grown = settledTier(grown, 40);
  check("a room past the boundary climbs to KELURAHAN", grown === 1, `got ${grown}`);
  for (let i = 0; i < 10; i += 1) grown = settledTier(grown, 41);
  check("and does not come back down while it holds there", grown === 1, `got ${grown}`);

  let high = 0;
  for (let i = 0; i < 12; i += 1) high = settledTier(high, 60);
  check("a room of 60 walks up to KECAMATAN one step at a time", high === 2, `got ${high}`);
  for (let i = 0; i < 6; i += 1) high = settledTier(high, 56);
  check("and stays there while it holds", high === 2, `got ${high}`);

  // The margin has to be worth its cost: a room that empties still gets there.
  let empty = 1;
  for (let i = 0; i < 20; i += 1) empty = settledTier(empty, 0);
  check("a room that empties still reaches the bottom tier", empty === 0, `got ${empty}`);

  // And a room that grows must still climb.
  let big = 0;
  for (let i = 0; i < 40; i += 1) big = settledTier(big, 3000);
  check("a full room still reaches the top tier", big === 4, `got ${big}`);

  // Climbing is one step at a time so the log gets a line per step.
  let climbing = 0;
  const steps = [];
  for (let i = 0; i < 40; i += 1) {
    climbing = settledTier(climbing, 3000);
    steps.push(climbing);
  }
  check("no step skips a tier", steps.every((v, i) => i === 0 || v === steps[i - 1] || v === steps[i - 1] + 1),
    steps.join(","));
  check("and it is monotonic", steps.every((v, i) => i === 0 || v >= steps[i - 1]), steps.join(","));

  check("the margin is a real number", margin >= 1 && margin <= 10, `got ${margin}`);
}

console.log("the first tier has nothing below it");
{
  check("a down step from KAMPUNG stays put", settledTier(0, 0) === 0);
  // An out-of-range index is clamped to the top, then walked back down like any
  // other starting point — which is the path that used to stop one tier short.
  check("an unknown index is clamped, then settled", settledTier(99, 0) === 0,
    `got ${settledTier(99, 0)}`);
  check("and a negative one climbs when the room is big",
    settledTier(-3, 100) === 1, `got ${settledTier(-3, 100)}`);
}
console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
