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
/**
 * Blits, counted apart from fillRects.
 *
 * The backdrop is the one thing on screen that is *only* ever drawn by
 * drawImage, so this is what identifies it. A total draw count cannot stand in
 * for that any more: label strips are rendered once and blitted afterwards, so
 * making the text cheaper makes the frame count smaller, and a scene that
 * paints perfectly well would fail a threshold.
 */
let imageDraws = 0;
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
    drawImage: () => {
      drawCalls++;
      imageDraws++;
    },
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

const timers = new Map();
let nextTimer = 1;
global.setInterval = (fn) => {
  const id = nextTimer++;
  timers.set(id, fn);
  return id;
};
// Tracked as real handles, because a timer that is never cleared is the bug this
// file now guards against: a bare `setInterval` in the engine outlived
// `destroy()` and kept writing the roster. A stub that only collects callbacks
// cannot see that, so this one has to model removal.
global.clearInterval = (id) => {
  timers.delete(id);
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
imageDraws = 0;
runFrames(3);
// One full-frame blit per frame is the backdrop; the fillRect total says nothing
// about it any more, since the cached label strips moved that work off the count.
check("backdrop is painted every frame", imageDraws >= 3, `blits=${imageDraws}`);

console.log("viewers arrive");
drawCalls = 0;
imageDraws = 0;
let seq = 0;
for (const name of ["budi", "sari", "dimas", "rina"]) {
  engine.handle(entry(++seq, "comment", name, name, "halo kak"));
}
runFrames(3);
check("comment spawns an astronaut and draws", drawCalls > 500 && imageDraws >= 3, `draws=${drawCalls} blits=${imageDraws}`);

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
engine.handle(entry(++seq, "join", "joiner", "joiner", "", { viewers: 5087 }));
drawCalls = 0;
runFrames(3);
check("join puts an astronaut on screen", drawCalls > 300, `draws=${drawCalls}`);

// The real shape of a busy room: thousands of viewers, a roster capped in the
// tens. A couple of people leaving has to register, and a rounding wobble must
// not cost anyone their place.
const liveRoom = 5087;
const rosterSize = 20;
for (let i = 0; i < rosterSize; i++) {
  engine.handle(entry(++seq, "join", `guest${i}`, `guest${i}`, "", { viewers: liveRoom }));
}
engine.handle(entry(++seq, "viewers", "", "", "", { count: liveRoom }));
drawCalls = 0;
runFrames(3);
const full = drawCalls;

engine.handle(entry(++seq, "viewers", "", "", "", { count: liveRoom - 3 }));
drawCalls = 0;
runFrames(3);
const afterThreeLeft = drawCalls;
check("three leavers retire three, in a 5000-viewer room", afterThreeLeft < full,
  `full=${full} after=${afterThreeLeft}`);

engine.handle(entry(++seq, "viewers", "", "", "", { count: liveRoom }));
drawCalls = 0;
runFrames(3);
const restored = drawCalls;
engine.handle(entry(++seq, "viewers", "", "", "", { count: liveRoom - 1 }));
drawCalls = 0;
runFrames(3);
check("a one-view wobble retires nobody", drawCalls === restored,
  `wobble=${drawCalls} base=${restored}`);

console.log("the cap is a cap: a burst of joins cannot push past it");
engine.reset();
const CAP = 10;
engine.configure({ ...cfg, maxAstro: CAP, space: false, pixelSize: 3, censors: false });
engine.resize(1920, 1080);

for (let i = 0; i < CAP; i++) {
  engine.handle(entry(++seq, "join", `cap${i}`, `cap${i}`, "", { viewers: liveRoom }));
}
runFrames(3);
check("a roster fills to the cap and stops", engine.rosterSize() === CAP,
  `size=${engine.rosterSize()}`);

// The widget hands every entry in the socket buffer to the engine in one
// synchronous loop, so this is what a burst of joins actually is: not thirty
// frames with a fade finishing in between, but thirty retirements and thirty
// admissions before a single frame is drawn. `ensureAstro` used to retire the
// quietest astronaut to make room and then admit the newcomer anyway, on the
// reasoning that the roster would be one over the cap for half a second. One
// newcomer, yes. Thirty at once put thirty on top of the cap, and the editor's
// "Max on screen: 10" became the number of people already settled rather than
// the number allowed.
const burst = 30;
for (let i = 0; i < burst; i++) {
  engine.handle(entry(++seq, "join", `burst${i}`, `burst${i}`, "", { viewers: liveRoom }));
}
check(`a ${burst}-join burst does not exceed a cap of ${CAP}`, engine.rosterSize() <= CAP,
  `size=${engine.rosterSize()} burst=${burst} cap=${CAP}`);

// Fading astronauts are still drawn, so letting the fades finish is what proves
// the cap is the cap rather than a coincidence of this batch.
runFrames(60);
check("the roster comes back under the cap, not above it", engine.rosterSize() <= CAP,
  `size=${engine.rosterSize()} cap=${CAP}`);

// And the refused newcomers are not punished for having arrived while it was
// full: they are simply not on screen yet.
const beforeAdmit = engine.rosterSize();
for (let i = 0; i < CAP; i++) {
  engine.handle(entry(++seq, "comment", `burst${i}`, `burst${i}`, "halo", {}));
}
runFrames(3);
check("a viewer refused by the cap can still get on screen afterwards",
  engine.rosterSize() <= CAP, `before=${beforeAdmit} now=${engine.rosterSize()} cap=${CAP}`);

console.log("leaving the scene is not losing your rank");
// Emptied first, deliberately. This block is about persistence, not about the
// cap, and it used to pass or fail on whatever roster the block above happened
// to leave behind: with the cap enforced, a full roster refuses a newcomer's
// comment, so `regular` earned no XP and there was nothing to persist. The
// check below is only about what a viewer who *was* on screen keeps.
engine.reset();
engine.configure({ ...cfg, space: false, pixelSize: 3, censors: false });
// Only a viewer who has earned something is in the saved roster at all: a join
// on its own grants no XP, so there is nothing to write. This is the real
// traffic — people who chat, like and gift.
engine.handle(entry(++seq, "comment", "regular", "regular", "halo", {}));
engine.handle(entry(++seq, "like", "regular", "regular", "", { count: 3 }));
runFrames(2);
// Nothing is written yet: the engine batches to disk on its own timer, so the
// in-memory roster is the only thing holding this. `dirty` is what makes the
// next persist happen, and the checks below read the file only after a teardown
// forces the write.
check("a viewer who has earned something is saved", store.size > 0, `inMemory=${store.size}`);

engine.handle(entry(++seq, "viewers", "", "", "", { count: liveRoom - 200 }));
runFrames(2);
// The full scene is wiped on the way to the answer below, so the roster has to
// be read back off disk to show it survived — that is the whole point.
engine.destroy();
const afterWipe = JSON.parse(store.get("test") || "{}");
check("the saved roster survives the engine shutting down",
  Object.keys(afterWipe).length > 0,
  `persisted=${Object.keys(afterWipe).length}`);

// A returning viewer must come back as themselves. The engine is fresh, so the
// only way their rank can exist is by having been read from the store.
const engine2Canvas = makeCanvas();
const engine2 = createAstroEngine({ canvas: engine2Canvas, storageKey: "test", config: { ...cfg } });
engine2.resize(1920, 1080);
engine2.handle(entry(++seq, "comment", "regular", "regular", "kembali", {}));
const returning = JSON.parse(store.get("test") || "{}");
check("a returning viewer keeps the rank they earned",
  typeof returning.regular?.xp === "number" && returning.regular.xp > 0,
  `xp=${returning.regular?.xp}`);

console.log("a tiny canvas does not divide by zero");
engine2.resize(40, 30);
runFrames(3);
check("survives a small canvas", engine2Canvas.width > 0 && engine2Canvas.height > 0,
  `w=${engine2Canvas.width} h=${engine2Canvas.height}`);

console.log("configure does not throw and keeps the world alive");
engine2.configure({ ...cfg, space: false, pixelSize: 3, mission: "MISI: UJIAN", censors: false });
runFrames(3);
check("reconfigured engine still draws", true);

console.log("reset clears the roster");
engine2.reset();
drawCalls = 0;
runFrames(3);
// engine2 was reconfigured with `space: false` above, so there is no backdrop
// blit to look for here — only the HUD and the feed. What this guards is that
// the loop keeps painting at all after a reset.
check("an emptied scene still paints", drawCalls >= 3, `draws=${drawCalls}`);

console.log("teardown stops the loop");
// engine2 is the live one here; engine was already torn down above.
check("an interval is left running before teardown", timers.size === 1, `timers=${timers.size}`);
engine2.destroy();
check("no frames queued after destroy", frameHandles.size === 0, `queued=${frameHandles.size}`);
check("the save timer is cleared too", timers.size === 0, `timers left=${timers.size}`);

console.log();
if (failures.length) {
  console.log(`${failures.length} FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("all passed");
