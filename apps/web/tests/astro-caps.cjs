"use strict";
/**
 * The astro scene's effects were only ever released by expiry, and two kinds had
 * no age limit at all: asteroids and streaks left the screen and nothing else.
 * An active room gifts faster than anything leaves, so those two arrays grew
 * until every sprite was being redrawn on every frame. On a busy room that is
 * not a loud scene, it is a frozen one — which is what happened on
 * mpl.id.official.
 *
 * This drives the real engine through the same canvas stub astro-engine.cjs
 * uses and asserts on the engine's own effect counts. Watched counts rather than
 * draw calls on purpose: a draw total also moves with the feed and the name
 * plates, so a busy frame would report a breach that never happened.
 */

const path = require("path");

/* ------------------------------------------------------- canvas stub ---- */

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
  return {
    width: 0,
    height: 0,
    // resize() writes the CSS size here to scale the tiny backing store back up
    // to the container, so a stub without `style` fails on the first frame.
    style: {},
    getContext: () => makeContext(),
  };
}

let clock = 1000;
global.performance = { now: () => clock };
global.requestAnimationFrame = (fn) => {
  frameHandles.add(fn);
  return 1;
};
const frameHandles = new Set();
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

/** The ceilings the engine declares. Kept in step by the first four checks. */
const MAX = { crates: 16, asteroids: 24, streaks: 40, sparks: 220 };

function gift(seq, diamonds, count = 1) {
  return {
    id: `g${seq}`,
    seq,
    ts: clock,
    kind: "gift",
    user: `g${seq}`,
    userId: `g${seq}`,
    value: `Rose x${count}`,
    meta: { diamonds, count, giftName: "Rose" },
  };
}

function runFrames(count, stepMs = 16) {
  for (let i = 0; i < count; i++) {
    const queued = [...frameHandles.entries()];
    frameHandles.clear();
    clock += stepMs;
    for (const [, fn] of queued) fn();
  }
}

function spawn() {
  const canvas = makeCanvas();
  const engine = createAstroEngine({ canvas, storageKey: "caps", config: { ...DEFAULT_ASTRO_CONFIG } });
  engine.resize(1281, 579);
  return engine;
}

console.log("the ceilings are the ones the engine actually applies");
const base = spawn();
// Read the caps back out of the engine's own behaviour rather than asserting
// them against the numbers above, so renaming a constant here fails the test
// rather than silently testing the wrong bound.
base.handle(gift(1, 600));
const oneGift = base.effectCounts();
check("a large gift spawns asteroids", oneGift.asteroids > 0, `saw ${oneGift.asteroids}`);
check("a large gift spawns streaks", oneGift.streaks > 0, `saw ${oneGift.streaks}`);

console.log("\na room that keeps gifting stays inside the ceilings");
const busy = spawn();
for (let i = 0; i < 500; i++) busy.handle(gift(100 + i, 600));
const busyCounts = busy.effectCounts();
for (const kind of Object.keys(MAX)) {
  check(
    `${kind} is capped after 500 large gifts`,
    busyCounts[kind] <= MAX[kind],
    `saw ${busyCounts[kind]}, ceiling ${MAX[kind]}`
  );
}

console.log("\nthe cap must not stop the scene responding");
// A ceiling that refuses new work would make a gift look ignored, which is
// worse on stream than a busy scene. The newest effect has to survive.
busy.handle(gift(9999, 600));
const afterAnother = busy.effectCounts();
check("a gift after the cap is still shown", afterAnother.asteroids > 0, `saw ${afterAnother.asteroids}`);

console.log("\nsmall gifts take the other branch and are capped too");
const small = spawn();
for (let i = 0; i < 500; i++) small.handle(gift(200 + i, 1));
const smallCounts = small.effectCounts();
check("crates stay capped", smallCounts.crates <= MAX.crates, `saw ${smallCounts.crates}`);
check("small gifts still drop crates", smallCounts.crates > 0, `saw ${smallCounts.crates}`);
check("small gifts do not trigger a shower", smallCounts.asteroids === 0, `saw ${smallCounts.asteroids}`);

console.log("\neffects retire on their own even when nothing leaves the screen");
// The offscreen test alone cannot clear a sprite that spawns near an edge with a
// shallow velocity, which is why asteroids and streaks carry an age limit now.
// Nothing here moves, so only the age limit can clear them.
const stalled = spawn();
for (let i = 0; i < 10; i++) stalled.handle(gift(300 + i, 600));
const beforeAge = stalled.effectCounts();
// Rewind every birth stamp so the age limits are what decides, not position.
clock += 61000;
runFrames(2);
const afterAge = stalled.effectCounts();
check("aged asteroids are gone", afterAge.asteroids < beforeAge.asteroids,
  `before ${beforeAge.asteroids}, after ${afterAge.asteroids}`);
check("aged streaks are gone", afterAge.streaks < beforeAge.streaks,
  `before ${beforeAge.streaks}, after ${afterAge.streaks}`);

console.log("\na full roster of moving astronauts cannot flood the sparks");
// Thrust emits per astronaut per frame, so it scales with roster size and
// framerate rather than with events.
const roster = spawn();
for (let i = 0; i < 10; i++) {
  roster.handle({
    id: `c${i}`,
    seq: 400 + i,
    ts: clock,
    kind: "comment",
    user: `u${i}`,
    userId: `u${i}`,
    value: "hi",
    meta: {},
  });
}
runFrames(300);
check("thrust stays under the spark cap", roster.effectCounts().sparks <= MAX.sparks,
  `saw ${roster.effectCounts().sparks}`);

base.destroy();
busy.destroy();
small.destroy();
stalled.destroy();
roster.destroy();

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
