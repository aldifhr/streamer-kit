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