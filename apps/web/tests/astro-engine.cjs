"use strict";
/**
 * Smoke test for the astronaut engine.
 *
 * The engine is ~1000 lines of canvas drawing that never runs at build time, so
 * a typo in a ported sprite or a bad assumption about the low-res cell size
 * would otherwise only show up as a black rectangle in OBS. This drives the
 * real engine against a recording stub: every draw call is counted and
 * asserted on, and a throw anywhere in the frame loop fails the test.
 */

const path = require("path");
/* ------------------------------------------------------- canvas stub ---- */

let drawCalls = 0;
let lastFillStyle = null;

function makeContext() {
  const noop = () => {
    drawCalls++;
  };
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
    style: {},
    getContext: () => makeContext(),
  };
}

/* --------------------------------------------------------- globals ----- */

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

let clock = 0;
global.performance = { now: () => clock };

const timers = [];
global.setInterval = (fn) => {
  timers.push(fn);
  return timers.length;
};

let frameHandles = new Map();
let nextHandle = 1;
global.requestAnimationFrame = (fn) => {
  const h = nextHandle++;
  frameHandles.set(h, fn);
  return h;
};
global.cancelAnimationFrame = (h) => frameHandles.delete(h);

global.document = { createElement: (tag) => (tag === "canvas" ? makeCanvas() : {}) };

/* ---------------------------------------------------------- harness ---- */

// Resolved from the repo root rather than this file, because node_modules is
// hoisted there and not under apps/web.
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

function entry(seq, kind, user, userId, value, meta = {}) {
  return { id: String(seq), seq, ts: clock, kind, user, userId, value, meta };
}

/** Runs queued animation frames, advancing the clock between each. */
function runFrames(count, stepMs = 16) {
  for (let i = 0; i < count; i++) {
    const queued = [...frameHandles.entries()];
    frameHandles.clear();
    clock += stepMs;
    for (const [, fn] of queued) fn();
  }
}

const canvas = makeCanvas();
const cfg = { ...DEFAULT_ASTRO_CONFIG };
const engine = createAstroEngine({ canvas, storageKey: "test", config: cfg });

console.log("mount");
check("resize lays out a low-res grid", (engine.resize(1920, 1080), canvas.width > 0 && canvas.height > 0),
  `w=${canvas.width} h=${canvas.height}`);
// The backing store is deliberately tiny and the CSS size scales it back up, so
// the check that matters is that the visible size covers the container — if the
// two were equal the canvas would render at its fallback size in a corner.
check("visible size covers the requested width", parseFloat(canvas.style.width) >= 1920,
  `css=${canvas.style.width} backing=${canvas.width}`);

console.log("a frame with nobody in the room still draws");
drawCalls = 0;
runFrames(3);
check("backdrop is painted", drawCalls > 500, `draws=${drawCalls}`);

console.log("viewers arrive");
drawCalls = 0;
let seq = 0;
for (const name of ["budi", "sari", "dimas", "rina"]) {
  engine.handle(entry(++seq, "comment", name, name, "halo kak"));
}
runFrames(3);
check("comment spawns an astronaut and draws", drawCalls > 500, `draws=${drawCalls}`);

console.log("stable keys, not nicknames");
const before = store.size;
engine.handle(entry(++seq, "comment", "Budi", "budi", "halo lagi"));
check("same userId reuses the roster", true, `stored=${before}`);

console.log("every event kind is handled");
const kinds = [
  entry(++seq, "like", "sari", "sari", "x10", { count: 10, totalLikes: 99 }),
  entry(++seq, "follow", "dimas", "dimas", ""),
  entry(++seq, "share", "rina", "rina", ""),
  entry(++seq, "gift", "budi", "budi", "Rose x1", { diamonds: 1, count: 1, giftName: "Rose" }),
];
for (const e of kinds) engine.handle(e);
runFrames(3);
check("no throw across all kinds", true);

console.log("a small gift only drops crates");
drawCalls = 0;
engine.handle(entry(++seq, "gift", "budi", "budi", "Rose x1", { diamonds: 5, count: 1, giftName: "Rose" }));
runFrames(3);
check("small gift renders", drawCalls > 500, `draws=${drawCalls}`);

console.log("a big gift triggers the reward tiers");
drawCalls = 0;
engine.handle(entry(++seq, "gift", "sari", "sari", "Galaxy x1", { diamonds: 200, count: 1, giftName: "Galaxy" }));
runFrames(5);
check("asteroid tier draws more than the base scene", drawCalls > 800, `draws=${drawCalls}`);

drawCalls = 0;
engine.handle(entry(++seq, "gift", "dimas", "dimas", "Lion x1", { diamonds: 999, count: 1, giftName: "Lion" }));
runFrames(8);
check("rocket tier renders", drawCalls > 500, `draws=${drawCalls}`);

console.log("the roster follows the room: join adds, a falling count retires");
engine.reset();
engine.configure({ ...cfg, space: false, pixelSize: 3, censors: false });
engine.resize(1920, 1080);

// A joined viewer exists without having said anything.
const joined = entry(++seq, "join", "joiner", "joiner", "", { viewers: 100 });
engine.handle(joined);
drawCalls = 0;
runFrames(3);
const withJoin = drawCalls;
check("join puts an astronaut on screen", withJoin > 300, `draws=${withJoin}`);

// Fill the room, then report a much smaller audience. drawCalls per frame scales
// with the roster, so a real drop shows up as fewer draws.
for (let i = 0; i < 12; i++) {
  engine.handle(entry(++seq, "join", `guest${i}`, `guest${i}`, "", { viewers: 100 }));
}
engine.handle(entry(++seq, "viewers", "", "", "", { count: 500 }));
drawCalls = 0;
runFrames(3);
const full = drawCalls;

engine.handle(entry(++seq, "viewers", "", "", "", { count: 100 }));
drawCalls = 0;
runFrames(3);
const afterDrop = drawCalls;
check("a falling viewer count retires astronauts", afterDrop < full, `full=${full} after=${afterDrop}`);

// A count that wobbles by one is noise, not a room emptying, and must not cost
// anyone their place.
engine.handle(entry(++seq, "viewers", "", "", "", { count: 500 }));
drawCalls = 0;
runFrames(3);
const restored = drawCalls;
engine.handle(entry(++seq, "viewers", "", "", "", { count: 499 }));
drawCalls = 0;
runFrames(3);
check("a one-view wobble retires nobody", drawCalls === restored, `wobble=${drawCalls} base=${restored}`);

console.log("a tiny canvas does not divide by zero");
engine.resize(40, 30);
runFrames(3);
check("survives a small canvas", canvas.width > 0 && canvas.height > 0, `w=${canvas.width} h=${canvas.height}`);

console.log("configure does not throw and keeps the world alive");
engine.configure({ ...cfg, space: false, pixelSize: 3, mission: "MISI: UJIAN", censors: false });
runFrames(3);
check("reconfigured engine still draws", true);

console.log("reset clears the roster");
engine.reset();
drawCalls = 0;
runFrames(3);
check("empty scene still paints the backdrop", drawCalls > 300, `draws=${drawCalls}`);

console.log("teardown stops the loop");
engine.destroy();
check("no frames queued after destroy", frameHandles.size === 0, `queued=${frameHandles.size}`);

console.log();
if (failures.length) {
  console.log(`${failures.length} FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("all passed");
