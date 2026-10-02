"use strict";
/**
 * Astronaut motion has to match the wall clock, not the frame rate.
 *
 * The frame loop skipped any tick arriving inside the 60fps budget, then stepped
 * physics by the gap since the previous tick *that ran* — the same 16.7ms whether
 * one tick ran or two. Every skip threw away a frame's worth of time, and the
 * loss compounded: a display holding only 30Hz moved everything at half speed,
 * permanently. That is what "the transitions are still wrong" looked like — drift
 * against real time that never recovered.
 *
 * Measuring this needs a measurement that survives saturation. An earlier
 * version of this file asserted on the roster's fade, which completed inside
 * 420ms, and therefore passed against the broken code — the fade had long since
 * hit its cap in both cases. The engine now reports the simulated time it has
 * been stepped by, and the assertion is on the shortfall: the difference between
 * the wall clock it was given and the motion it produced.
 */

const path = require("path");

function makeContext() {
  const noop = () => {};
  return {
    fillStyle: "",
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillRect: noop,
    drawImage: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
  };
}

function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: () => makeContext() };
}

let clock = 1000;
global.performance = { now: () => clock };
const frameHandles = new Set();
global.requestAnimationFrame = (fn) => {
  frameHandles.add(fn);
  return 1;
};
global.cancelAnimationFrame = (h) => frameHandles.delete(h);
global.document = { createElement: (tag) => (tag === "canvas" ? makeCanvas() : {}) };

const { createAstroEngine, DEFAULT_ASTRO_CONFIG } = require(
  process.argv[2] ||
    path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/astro/lib/widgets/astro/engine.js"),
);

let failures = [];
function check(label, cond, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

function spawn() {
  const canvas = makeCanvas();
  const engine = createAstroEngine({
    canvas,
    storageKey: `motion-${Math.random()}`,
    config: { ...DEFAULT_ASTRO_CONFIG },
  });
  engine.resize(1281, 579);
  return engine;
}

/** Delivers `seconds` of wall clock as frames arriving at `fps`. */
function drive(engine, seconds, fps) {
  const stepMs = 1000 / fps;
  const end = clock + seconds * 1000;
  while (clock < end) {
    clock = Math.min(end, clock + stepMs);
    const queued = [...frameHandles.entries()];
    frameHandles.clear();
    for (const [, fn] of queued) fn();
  }
}

console.log("the loop steps by the time it was actually given");
// 30Hz means every other frame arrives inside the 16.7ms budget and is skipped.
// If the step is the gap since the last tick that ran, the engine is handed
// 16.7ms for every 33.3ms of real time and simulates half of the clock.
const RATIOS = [
  { fps: 30, label: "30Hz", worst: 0.9 },
  { fps: 24, label: "24Hz", worst: 0.9 },
  { fps: 60, label: "60Hz", worst: 0.95 },
  { fps: 144, label: "144Hz", worst: 0.95 },
];
for (const { fps, label, worst } of RATIOS) {
  const engine = spawn();
  drive(engine, 6, fps);
  const { simulated, wall } = engine.timeAccount();
  const ratio = wall > 0 ? simulated / wall : 0;
  check(
    `${label} simulates at least ${Math.round(worst * 100)}% of real time`,
    ratio >= worst,
    `simulated ${simulated.toFixed(2)}s of ${wall.toFixed(2)}s (${Math.round(ratio * 100)}%)`
  );
  engine.destroy();
}

console.log("\nthe shortfall does not grow over time");
// One skipped frame is a rounding error; a compounding loop is what makes a scene
// look permanently wrong. Running long has to cost no more than running short.
for (const fps of [30, 24]) {
  const engine = spawn();
  drive(engine, 4, fps);
  const early = engine.timeAccount();
  const earlyRatio = early.simulated / early.wall;
  drive(engine, 20, fps);
  const late = engine.timeAccount();
  const lateRatio = late.simulated / late.wall;
  check(
    `${fps}Hz loses no more after 24s than after 4s`,
    lateRatio >= earlyRatio - 0.02,
    `${Math.round(earlyRatio * 100)}% at 4s, ${Math.round(lateRatio * 100)}% at 24s`
  );
  engine.destroy();
}

console.log("\na long stall does not teleport the scene");
// The step is capped so coming back from a hidden tab does not fling every
// astronaut across the map in a single frame.
{
  const engine = spawn();
  engine.handle({
    id: "c1", seq: 1, ts: clock, kind: "comment",
    user: "u1", userId: "u1", value: "hi", meta: {},
  });
  drive(engine, 1, 60);
  const before = engine.astroPosition();
  clock += 10000; // ten seconds in a hidden tab
  const queued = [...frameHandles.entries()];
  frameHandles.clear();
  for (const [, fn] of queued) fn();
  const after = engine.astroPosition();
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  check("a 10s stall moves the astronaut less than one screen", moved < 200, `moved ${moved.toFixed(1)}px`);
  check("a stall does not credit the loop with the whole ten seconds",
    engine.timeAccount().simulated < 2, `credited ${engine.timeAccount().simulated.toFixed(2)}s`);
  engine.destroy();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
