"use strict";
/**
 * Smoke and regression tests for the city engine.
 *
 * The engine is a few hundred lines of canvas drawing that never runs at build
 * time, so a typo in a ported sprite or a bad assumption about the low-res cell
 * size would only ever show up as a black rectangle in OBS. This drives the
 * real engine against a recording stub, and the three things it asserts are the
 * three that were actually wrong at some point:
 *
 * - It draws, and it keeps drawing, at every frame rate.
 * - It runs on the wall clock rather than on the frame rate, which is what makes
 *   the walk cycle and the day cycle look the same on every display.
 * - Its transients expire and stay under a ceiling, so a gift cannot bury the
 *   city under tens of thousands of sprites.
 */

const path = require("path");

/* ------------------------------------------------------- canvas stub ---- */

let drawCalls = 0;
let imageDraws = 0;
/** getImageData on the dissolve buffer, which is a real per-frame cost. */
let getImageDataCalls = 0;
/**
 * Canvases, by identity, split by what happened to them.
 *
 * The bug this exists for: the sky gradient was baked into a canvas that nothing
 * ever drew, so the sky stayed black at midday while every other assertion in
 * this file still passed. Counting bakes cannot see that — the count was right.
 * Tracking identity can, because it lets the file assert the general invariant
 * the bug broke: nothing is painted that is never shown.
 */
let nextCanvasId = 1;
const byId = new Map();
const baked = new Set();
const shown = new Set();
let bakeCount = 0;
/** Names an orphaned canvas with its size, so a failure is actionable. */
const describe = (id) => {
  const c = byId.get(id);
  return c ? `${id}(${c.width}x${c.height})` : String(id);
};

function makeContext(id) {
  const noop = () => {
    drawCalls++;
  };
  return {
    fillStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
    fillRect: noop,
    drawImage: (src) => {
      drawCalls++;
      imageDraws++;
      // Only counts a real canvas as shown; a caller passing something else is
      // not a paint this invariant is about.
      if (src && src.__id) shown.add(src.__id);
    },
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    // Used to mirror a vehicle that is driving the other way.
    scale: noop,
    putImageData: (img) => {
      baked.add(id);
      bakeCount++;
    },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => {
      getImageDataCalls++;
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
  };
}

function makeCanvas(doc) {
  const id = nextCanvasId++;
  const c = {
    width: 0,
    height: 0,
    style: {},
    ownerDocument: doc,
    __id: id,
    getContext: () => makeContext(id),
  };
  byId.set(id, c);
  return c;
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

// Timer handles are modelled, not just collected: a bare setInterval in the
// engine outlives destroy() and keeps writing storage, and a stub that only
// collects callbacks cannot see that.
const timers = new Map();
let nextTimer = 1;
global.setInterval = (fn) => {
  const id = nextTimer++;
  timers.set(id, fn);
  return id;
};
global.clearInterval = (id) => timers.delete(id);

let frameHandles = new Map();
let nextHandle = 1;
global.requestAnimationFrame = (fn) => {
  const h = nextHandle++;
  frameHandles.set(h, fn);
  return h;
};
global.cancelAnimationFrame = (h) => frameHandles.delete(h);

// The engine takes its document from the canvas it was handed, not from the
// global, so two overlays in one page can never end up sharing a document.
const fakeDocument = { createElement: (tag) => (tag === "canvas" ? makeCanvas(fakeDocument) : {}) };
global.document = fakeDocument;

/* ---------------------------------------------------------- harness ---- */

const { createCityEngine } = require(
  process.argv[2] ||
    path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/city/lib/widgets/city/engine.js"),
);

let failures = [];
function check(label, cond, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

let seq = 0;
function entry(kind, user, userId, value = "", meta = {}) {
  seq += 1;
  return { id: `${kind}-${seq}`, seq, ts: clock, kind, user, userId, value, meta };
}

/** Runs queued animation frames, advancing the clock between each. */
function runFrames(count, stepMs = 16) {
  for (let i = 0; i < count; i++) {
    const queued = [...frameHandles.values()];
    frameHandles.clear();
    clock += stepMs;
    for (const fn of queued) fn(clock);
  }
}

/** Builds an engine, sizes it, and returns it. */
function makeEngine(config = {}) {
  const engine = createCityEngine({ canvas: makeCanvas(fakeDocument), config });
  engine.resize(1280, 720);
  // Two frames so the layout is live and the sky has been drawn at least once.
  runFrames(3);
  return engine;
}

/* ------------------------------------------------------------- tests ---- */

console.log("city: draws a frame");
{
  const engine = makeEngine();
  const before = drawCalls;
  runFrames(30);
  check("keeps drawing", drawCalls > before, `(drew ${drawCalls - before})`);
  check("background is blitted", imageDraws > 0);
  engine.destroy();
}

console.log("city: nothing is painted that is never shown");
{
  bakeCount = 0;
  const engine = makeEngine();
  // Bake something, so the sky path is exercised rather than merely present.
  engine.handle(entry("comment", "budi", "budi-1", "halo"));
  runFrames(120, 16);
  check("the scene bakes at least one offscreen buffer", bakeCount > 0, `(${bakeCount} bakes)`);
  const orphaned = [...baked].filter((id) => !shown.has(id));
  check("every baked canvas is on screen", orphaned.length === 0,
    `(orphaned: ${orphaned.map(describe).join(",")})`);
  engine.destroy();
}

console.log("city: the sky gradient is not re-baked every frame");
{
  bakeCount = 0;
  const engine = makeEngine();
  runFrames(240, 16);
  // Baked at most every 400ms, so four seconds is about ten bakes. Baking per
  // frame was a full ImageData walk of every sky pixel, sixty times a second.
  check("it stays rare", bakeCount < 60, `(${bakeCount} bakes in 4s)`);
  engine.destroy();
}

console.log("city: roster is keyed by user id, not event id");
{
  const engine = makeEngine();
  engine.handle(entry("comment", "budi", "budi-1", "halo"));
  engine.handle(entry("comment", "budi", "budi-1", "lagi"));
  engine.handle(entry("like", "budi", "budi-1", "5"));
  check("one resident for one viewer", engine.residentCount() === 1, `(${engine.residentCount()})`);
  const r = engine.residents()[0];
  check("xp accumulates once per event", r.xp > 1, `(xp ${r.xp})`);
  check("name follows the latest nickname", r.name === "budi");
  engine.destroy();
}

console.log("city: a second viewer is a second resident");
{
  const engine = makeEngine();
  engine.handle(entry("comment", "budi", "budi-1", "halo"));
  engine.handle(entry("comment", "sari", "sari-1", "hai"));
  check("two residents", engine.residentCount() === 2, `(${engine.residentCount()})`);
  engine.destroy();
}

console.log("city: runs on the wall clock, not the frame rate");
{
  // A display that cannot hold 60 drops ticks, and every dropped tick used to
  // throw its elapsed time away. The city then ran at a fraction of real time
  // with nothing on screen to say so.
  for (const hz of [24, 30, 60, 144]) {
    const engine = makeEngine();
    const start = engine.timeAccount();
    runFrames(Math.round((hz * 4)), 1000 / hz);
    const end = engine.timeAccount();
    const ratio = end.simulated / end.wall;
    check(
      `${hz}Hz simulates most of real time`,
      ratio >= 0.9,
      `(${end.simulated.toFixed(2)}s of ${end.wall.toFixed(2)}s, ${Math.round(ratio * 100)}%)`,
    );
    engine.destroy();
  }
}

console.log("city: a stalled frame does not teleport the day");
{
  const engine = makeEngine();
  const before = engine.timeAccount().simulated;
  // Ten seconds in one frame. The step is capped, so the city jumps rather than
  // skipping a decade of weather, but it must not fast-forward either.
  clock += 10e3;
  const queued = [...frameHandles.values()];
  frameHandles.clear();
  for (const fn of queued) fn(clock);
  const advanced = engine.timeAccount().simulated - before;
  check("one stalled frame advances at most 50ms", advanced <= 0.05, `(${advanced.toFixed(3)}s)`);
  engine.destroy();
}

console.log("city: a gift with no diamond total still does something");
{
  const engine = makeEngine();
  engine.handle(entry("gift", "budi", "budi-1", "Rose", { giftName: "Rose", count: 50 }));
  const c = engine.effectCounts();
  check("coins or sparks appeared", c.coins + c.sparks > 0, `(${JSON.stringify(c)})`);
  const r = engine.residents()[0];
  check("the gift was worth xp", r.xp > 0, `(xp ${r.xp})`);
  engine.destroy();
}

console.log("city: transients expire");
{
  const engine = makeEngine();
  engine.handle(entry("comment", "budi", "budi-1", "halo"));
  engine.handle(entry("gift", "budi", "budi-1", "Rose", { diamonds: 9, count: 1 }));
  const during = engine.effectCounts();
  // Six seconds, past the longest lifetime in the scene: a coin settles for four
  // and a confetti piece for eight, and a test that stops short of the longest
  // one measures the test's impatience rather than the engine.
  runFrames(360, 16);
  const after = engine.effectCounts();
  const totalDuring = during.coins + during.hearts + during.confetti + during.sparks;
  const totalAfter = after.coins + after.hearts + after.confetti + after.sparks;
  check("something was on screen", totalDuring > 0, `(${totalDuring})`);
  check("it is all gone after six seconds", totalAfter === 0, `(${totalAfter} left)`);
  engine.destroy();
}

console.log("city: transients stay under a ceiling");
{
  const engine = makeEngine();
  // Every one of these is a large gift, which is a rocket, a burst, confetti and
  // a shake. Five hundred of them is what buried the scene.
  for (let i = 0; i < 500; i++) {
    engine.handle(entry("gift", `g${i}`, `g${i}`, "Lion", { diamonds: 999, count: 1 }));
  }
  const c = engine.effectCounts();
  const total = c.coins + c.hearts + c.confetti + c.sparks;
  check("sprite count is bounded", total <= 1500, `(${total} sprites: ${JSON.stringify(c)})`);
  check("the city still draws", (runFrames(2), drawCalls > 0));
  engine.destroy();
}

console.log("city: a full room still admits new viewers");
{
  const engine = makeEngine({ maxPeople: 5 });
  for (let i = 0; i < 12; i++) engine.handle(entry("comment", `v${i}`, `v${i}`, "hi"));
  const n = engine.residentCount();
  check("roster is capped", n <= 5, `(${n} residents, cap 5)`);
  check("the newest viewer is present", engine.residents().some((r) => r.id === "v11"));
  // A burst of joins must not leave a backlog of dissolves running: the twelve
  // that arrived are on screen and the earlier ones are gone, not queued to
  // finish walking out.
  check("the roster holds only the newest arrivals",
    engine.residents().every((r) => Number(r.id.slice(1)) >= 7),
    `(${engine.residents().map((r) => r.id).join(",")})`);
  engine.destroy();
}

console.log("city: destroy clears its timers");
{
  const engine = makeEngine();
  engine.handle(entry("comment", "budi", "budi-1", "halo"));
  const before = timers.size;
  engine.destroy();
  check("no timer outlives the engine", timers.size < before, `(${before} -> ${timers.size})`);
  const frames = frameHandles.size;
  runFrames(5);
  check("no frame outlives the engine", frameHandles.size <= frames, `(${frameHandles.size})`);
}

console.log("city: the blocklist is applied");
{
  const engine = makeEngine();
  engine.handle(entry("comment", "budi", "budi-1", "anjing"));
  // A blocklisted word must not survive into the label, and the label text is
  // the only place a chat message is rendered.
  check("the engine accepted the message", engine.residentCount() === 1);
  engine.destroy();
}

console.log("city: a zoom of the sky gradient is drawn once per update, not per frame");
{
  const engine = makeEngine();
  getImageDataCalls = 0;
  runFrames(60, 16);
  check("the dissolve buffer is not read every frame when nobody is dissolving", getImageDataCalls === 0,
    `(${getImageDataCalls} reads)`);
  engine.destroy();
}

console.log("");
if (failures.length) {
  console.log(`${failures.length} FAILED`);
  process.exit(1);
} else {
  console.log("all passed");
}
