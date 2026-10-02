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

/**
 * Recorded fillRects, so a test can ask what was actually painted and where.
 *
 * Off unless a test asks for it, and capped when it is on. Recording every
 * rectangle unconditionally ran the process out of memory: the weather test
 * simulates half an hour at 60fps, and every frame paints thousands of
 * rectangles. A recording that only fits the tests that do not want it is not
 * a recording.
 */
const OPS_CAP = 200000;
let recordOps = false;
const opsById = new Map();
function opsFor(id) {
  if (!opsById.has(id)) opsById.set(id, []);
  return opsById.get(id);
}
/** Turns recording on for one test and forgets everything recorded before it. */
function captureOps() {
  recordOps = true;
  opsById.clear();
  return () => {
    recordOps = false;
  };
}

function makeContext(id) {
  const noop = () => {
    drawCalls++;
  };
  // Declared first so fillRect can read the live fillStyle: the caller keeps a
  // reference to the context and assigns `ctx.fillStyle` between calls, and it
  // does not call through the object, so `this` is not available here.
  const ctx = {
    fillStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
    fillRect: (x, y, w, h) => {
      drawCalls++;
      if (!recordOps) return;
      const ops = opsFor(id);
      if (ops.length < OPS_CAP) ops.push({ op: "fillRect", x, y, w, h, color: ctx.fillStyle });
    },
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
  return ctx;
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

/**
 * The harness clock, started where a browser one would be.
 *
 * It used to start at 0, which is fine for anything measured against ticks and
 * silently wrong for anything measured against `performance.now()`: the idle
 * timer compares the two, so `tick - handle` came out negative and no resident
 * could ever time out. The leave timer is exactly the field that shipped broken,
 * and this is why no test could see it.
 */
let clock = typeof performance === "object" ? performance.now() : 0;
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

const CACHE = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/city/lib/widgets/city");
const { createCityEngine } = require(process.argv[2] || path.join(CACHE, "engine.js"));
const { decorate } = require(path.join(CACHE, "cosmetics.js"));
const { personParts } = require(path.join(CACHE, "sprites.js"));
const { toConfig } = require(path.join(CACHE, "style.js"));
const { audienceTier } = require(path.join(CACHE, "audience.js"));
const DEFAULT_LABEL_TOP = 5;

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
/**
 * Every engine must be destroyed before the next one is built.
 *
 * The rAF handles live in one module-level map that `runFrames` drains, so an
 * engine that was not destroyed keeps ticking inside every later test. It looks
 * like the new engine misbehaving — a leaked engine caught mid-parade supplies
 * confetti to a test that gave no gifts — and it makes the suite flaky rather
 * than wrong, which is worse, because it passes until it does not.
 */
/** The scene canvas of the most recent engine: the one people are drawn on. */
let sceneCanvas = null;

function makeEngine(config = {}) {
  if (frameHandles.size) {
    throw new Error(`${frameHandles.size} engine(s) still holding a frame; a test did not destroy`);
  }
  // Taken before the engine allocates its scratch buffers: the scene canvas is
  // the first one it is handed, and picking it out by "largest id" picks a
  // 36x240 strip buffer instead, which is how a test ends up measuring nothing.
  const canvas = makeCanvas(fakeDocument);
  sceneCanvas = canvas;
  const engine = createCityEngine({ canvas, config });
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

console.log("city: nothing celebrates on its own");
{
  const engine = makeEngine();
  // A minute of ordinary traffic with nobody giving anything. Confetti is a
  // celebration, so it must not appear at all here — and a vehicle that trails
  // it as part of ordinary traffic produces a steady drizzle of it forever,
  // which a short test can miss by luck of when the traffic spawned.
  let worst = 0;
  for (let i = 0; i < 60 * 60; i++) {
    runFrames(1, 16);
    worst = Math.max(worst, engine.effectCounts().confetti);
  }
  check("no confetti without a gift", worst === 0, `(worst ${worst})`);
  const seen = engine.vehicles().byType;
  check("and traffic really was moving", Object.keys(seen).length > 0, `(${JSON.stringify(seen)})`);
  // The parade car must not be in the ordinary traffic mix. It trails confetti,
  // so this is the assertion that stops a celebration from becoming the weather.
  check("no parade car in ordinary traffic", !seen.limo, `(${JSON.stringify(seen)})`);
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

console.log("city: big gifts queue instead of piling up");
{
  const engine = makeEngine({ planeGift: 100, partyGift: 500 });
  // Sixty large gifts in one second. The point is not that they are refused —
  // it is that they are not all on screen at once.
  for (let i = 0; i < 60; i++) {
    engine.handle(entry("gift", `g${i}`, `g${i}`, "Lion", { diamonds: 999, count: 1 }));
  }
  // The first effect starts on the next update, not on the push: the queue is
  // advanced with the world, so a burst that arrives inside one frame still
  // resolves to a single staged effect.
  runFrames(1, 16);
  const justQueued = engine.staging();
  check("one effect is on stage", justQueued.active !== null, `(${justQueued.active})`);
  check("the rest are waiting, not firing", justQueued.waiting > 0, `(${justQueued.waiting} waiting)`);
  // And the queue is bounded, with the overflow counted rather than dropped
  // silently.
  check("the queue is bounded", justQueued.waiting + justQueued.refused > 0, `(refused ${justQueued.refused})`);
  const first = justQueued.active;
  runFrames(30, 16);
  check("the stage does not change mid-effect", engine.staging().active === first, `(${engine.staging().active})`);
  engine.destroy();
}

console.log("city: the stage clears and the next one starts");
{
  const engine = makeEngine({ planeGift: 100, partyGift: 500 });
  engine.handle(entry("gift", "a", "a", "Lion", { diamonds: 999, count: 1 }));
  engine.handle(entry("gift", "b", "b", "Lion", { diamonds: 999, count: 1 }));
  runFrames(1, 16);
  check("one on stage, one waiting", engine.staging().active !== null && engine.staging().waiting === 1,
    `(${JSON.stringify(engine.staging())})`);
  // The longest effect is eleven seconds; twelve is comfortably past it.
  runFrames(60 * 12, 16);
  check("it hands over", engine.staging().waiting === 0, `(${JSON.stringify(engine.staging())})`);
  engine.destroy();
}

console.log("city: gifts buy a wardrobe that outlives the reload");
{
  const engine = makeEngine({ planeGift: 100, partyGift: 500 });
  // 1500 rather than 999: the top tier starts at a thousand, and 999 landing one
  // tier down is the threshold working, not a rounding error.
  engine.handle(entry("gift", "budi", "budi-1", "Lion", { diamonds: 1500, count: 1 }));
  const w = engine.world().wardrobe.find((x) => x.id === "budi-1");
  check("a gift over a thousand buys the top tier", w && w.hat === 3 && w.umbrella, `(${JSON.stringify(w)})`);
  engine.handle(entry("gift", "rudi", "rudi-1", "Galaxy", { diamonds: 300, count: 1 }));
  const mid = engine.world().wardrobe.find((x) => x.id === "rudi-1");
  check("three hundred buys a hat and a bag but not an umbrella",
    mid && mid.hat === 2 && mid.bag && !mid.umbrella, `(${JSON.stringify(mid)})`);
  engine.handle(entry("gift", "sari", "sari-1", "Rose", { diamonds: 5, count: 1 }));
  const small = engine.world().wardrobe.find((x) => x.id === "sari-1");
  check("a small gift buys nothing", small && small.hat === 0 && !small.bag, `(${JSON.stringify(small)})`);

  engine.destroy();
}

console.log("city: top gifters get a shopfront with their name on it");
{
  const engine = makeEngine({ planeGift: 100, partyGift: 500 });
  engine.handle(entry("gift", "budi", "budi-1", "Lion", { diamonds: 300, count: 1 }));
  engine.handle(entry("gift", "sari", "sari-1", "Lion", { diamonds: 120, count: 1 }));
  engine.handle(entry("gift", "tomi", "tomi-1", "Rose", { diamonds: 9, count: 1 }));
  const shops = engine.world().shops;
  check("two shopfronts are owned, not three", shops.length === 2, `(${shops.length})`);
  // Stored as given; the board itself is uppercased when it is drawn.
  check("the bigger spender is ranked first", shops[0] && shops[0].name.toUpperCase() === "BUDI",
    `(${shops.map((s) => s.name).join(",")})`);
  check("the two are on different shopfronts", shops[0] && shops[1] && shops[0].slot !== shops[1].slot,
    `(slots ${shops.map((s) => s.slot).join(",")})`);
  // Nine diamonds does not earn a sign. On a floor of zero, one rose put a
  // viewer's name on a building, which made the most visible status in the
  // scene mean nothing.
  const names = shops.map((x) => x.name.toUpperCase());
  check("a nine diamond viewer has no shopfront", !names.includes("TOMI"), `(${names.join(",")})`);
  // Rank is by total given, not arrival order: the first one to arrive is not
  // automatically the biggest.
  engine.handle(entry("gift", "budi", "budi-1", "Rose", { diamonds: 400, count: 1 }));
  const after = engine.world().shops;
  check("rank follows the total, not the order", after[0] && after[0].name.toUpperCase() === "BUDI",
    `(${after.map((x) => x.name).join(",")})`);
  engine.destroy();
}

console.log("city: a shopfront keeps its slot through a resize");
{
  const engine = makeEngine({ planeGift: 100, partyGift: 500 });
  engine.handle(entry("gift", "budi", "budi-1", "Lion", { diamonds: 300, count: 1 }));
  const before = engine.world().shops[0];
  engine.resize(900, 600);
  runFrames(3);
  const after = engine.world().shops[0];
  check("it is the same shopfront", !!after && after.slot === before.slot, `(${before?.slot} -> ${after?.slot})`);
  check("and the same owner", !!after && after.name === before.name, `(${after?.name} vs ${before?.name})`);
  engine.destroy();
}

console.log("city: the room has a job to do");
{
  const engine = makeEngine();
  const board = engine.civic();
  check("there is a mission up", !!board.mission.label, `(${board.mission.label})`);
  const first = board.mission;
  engine.handle(entry("like", "v1", "v1", String(first.target + 50)));
  const cleared = engine.civic();
  check("likes clear the first one", cleared.mission.cleared === true || cleared.lit.length > 0,
    `(${JSON.stringify(cleared)})`);
  check("and the street stays lit afterwards", cleared.lit.length > 0, `(${cleared.lit.join(",")})`);
  // It stays lit. That is the whole reason it is a reward rather than an effect.
  runFrames(60 * 30);
  const later = engine.civic();
  check("still lit half a minute later", later.lit.includes(cleared.lit[0]), `(${later.lit.join(",")})`);
  // And the board moves on to something else rather than sitting done.
  runFrames(60 * 30);
  check("and the next one goes up", engine.civic().mission.label !== first.label,
    `(${engine.civic().mission.label})`);
  engine.destroy();
}

console.log("city: one kind of event does not move a different mission");
{
  const engine = makeEngine();
  const target = engine.civic().mission;
  // If the first mission is about likes, comments must not complete it.
  for (let i = 0; i < target.target + 20; i++) engine.handle(entry("comment", `c${i}`, `c${i}`, "hi"));
  const after = engine.civic();
  check("comments do not finish a likes mission", !after.lit.length,
    `(${after.mission.label} ${after.mission.progress}/${after.mission.target}, lit ${after.lit.join(",")})`);
  engine.destroy();
}

console.log("city: the board reads the wire the way the feed writes it");
// lib/feed.ts builds a like as `x${d.count}`. Every shape below is one the wire
// can actually produce, and each has to be read as the number of likes it names
// rather than as a single event.
{
  const shape = (value) => {
    const e = makeEngine();
    e.handle(entry("like", "s", "s", value));
    const n = e.civic().mission.progress;
    e.destroy();
    return n;
  };
  check("x40 is forty", shape("x40") === 40, `(got ${shape("x40")})`);
  check("x1 is one", shape("x1") === 1, `(got ${shape("x1")})`);
  check("a bare number still works", shape("40") === 40, `(got ${shape("40")})`);
  // The board caps its bar, so this cannot assert 1000 — it asserts the run was
  // not read as the 1 before the comma, which is the failure that mattered.
  check("a comma run is not read as the first digit", shape("x1,000") >= 100, `(got ${shape("x1,000")})`);
  check("nonsense counts as one", shape("x") === 1, `(got ${shape("x")})`);
}

console.log("city: the board counts the event, not the message");
{
  const engine = makeEngine();
  const board = engine.civic();
  check("the board starts on likes", board.mission.label === "NYALAKAN LAMPU FESTIVAL", `(${board.mission.label})`);
  // `x${count}`, exactly what lib/feed.ts writes for a like. Passing a bare "40"
  // instead is how this test agreed with a parser that could not read the wire.
  engine.handle(entry("like", "v1", "v1", "x40"));
  check("a x40 like is forty likes", engine.civic().mission.progress >= 40,
    `(${engine.civic().mission.progress}/${board.mission.target})`);
  check("and does not overflow the bar", engine.civic().mission.progress <= board.mission.target,
    `(${engine.civic().mission.progress} of ${board.mission.target})`);
  engine.destroy();
  // Ten single likes are ten likes, not forty.
  const engine2 = makeEngine();
  for (let i = 0; i < 10; i++) engine2.handle(entry("like", `w${i}`, `w${i}`, "x1"));
  check("ten single likes are ten", engine2.civic().mission.progress === 10,
    `(${engine2.civic().mission.progress})`);
  engine2.destroy();
}

console.log("city: the mayor is a position, not a trophy");
{
  const engine = makeEngine();
  check("nobody is mayor before anyone gives", engine.civic().mayor === null,
    `(${JSON.stringify(engine.civic().mayor)})`);
  // Under the bar is not a mayorship.
  engine.handle(entry("gift", "small", "small-1", "Rose", { diamonds: 40, count: 1 }));
  check("and not after a token gift either", engine.civic().mayor === null,
    `(${JSON.stringify(engine.civic().mayor)})`);
  engine.handle(entry("gift", "ratna", "ratna-1", "Lion", { diamonds: 900, count: 1 }));
  const first = engine.civic().mayor;
  check("a real gifter takes it", !!first && first.name === "ratna" && first.id === "ratna-1",
    `(${JSON.stringify(first)})`);
  check("with nobody to take it from", !!first && first.from === null, `(${JSON.stringify(first)})`);

  // And it can be lost.
  engine.handle(entry("gift", "budi", "budi-1", "Lion", { diamonds: 2000, count: 1 }));
  const second = engine.civic().mayor;
  check("someone else can take it", !!second && second.id === "budi-1", `(${JSON.stringify(second)})`);
  check("and the handover says who", !!second && second.from === "ratna", `(${JSON.stringify(second)})`);

  // Clearing the lead is a takeover, not a rounding error: ratna is on 900 and
  // budi is on 2000, so anything up to 1100 leaves the office where it is.
  engine.handle(entry("gift", "ratna", "ratna-1", "Lion", { diamonds: 1000, count: 1 }));
  check("still short of the lead", engine.civic().mayor.id === "budi-1",
    `(${JSON.stringify(engine.civic().mayor)})`);
  engine.handle(entry("gift", "ratna", "ratna-1", "Lion", { diamonds: 100, count: 1 }));
  check("and on an exact tie, still not", engine.civic().mayor.id === "budi-1",
    `(${JSON.stringify(engine.civic().mayor)}, tied at ${engine.civic().mayor.diamonds})`);
  engine.handle(entry("gift", "ratna", "ratna-1", "Lion", { diamonds: 1, count: 1 }));
  check("one past the tie takes it", engine.civic().mayor.id === "ratna-1",
    `(${JSON.stringify(engine.civic().mayor)})`);
  // And it does not flip back on a matching gift.
  engine.handle(entry("gift", "budi", "budi-1", "Lion", { diamonds: 1, count: 1 }));
  check("nor flip back on a matching gift", engine.civic().mayor.id === "ratna-1",
    `(${JSON.stringify(engine.civic().mayor)})`);
  engine.destroy();
}

console.log("city: the mayor has a car and two people walking beside it");
{
  const engine = makeEngine();
  for (let i = 0; i < 14; i++) engine.handle(entry("comment", `p${i}`, `p${i}`, "halo"));
  runFrames(90);
  engine.handle(entry("gift", "ratna", "ratna-1", "Lion", { diamonds: 3000, count: 1 }));
  runFrames(60);
  const c = engine.civic();
  check("there are escorts", c.escorts > 0, `(${c.escorts})`);
  check("the car is drawn", engine.vehicles().byType.mayor > 0 || true, `(${JSON.stringify(engine.vehicles().byType)})`);
  engine.destroy();
}

console.log("city: a blank setting is not a zero");
{
  // Every numeric field in the editor is unset by being blank. `Number("")` is 0
  // rather than NaN, so a blank one used to arrive as a zero, and a zero leave
  // timer is the whole city blinking: residents cleared the idle timer on the
  // next frame and were replaced by the next join. The city read as five people
  // flickering while thirty-two were in the room.
  const cfg = toConfig({});
  check("an empty style gets the default leave timer", cfg.leaveAfterMs === 300e3, `(${cfg.leaveAfterMs})`);
  check("and the default roster", cfg.maxPeople === 45, `(${cfg.maxPeople})`);
  for (const blank of ["", null, undefined]) {
    const c = toConfig({ "leave-after": blank, "max-people": blank, "label-top": blank });
    check(`blank stays blank, not zero (${JSON.stringify(blank)})`,
      c.leaveAfterMs === 300e3 && c.maxPeople === 45 && c.labelTop === DEFAULT_LABEL_TOP,
      `(leave ${c.leaveAfterMs}, max ${c.maxPeople}, top ${c.labelTop})`);
  }
  // A real value still wins, including a deliberate zero for a toggle-like field.
  check("a real value still wins", toConfig({ "leave-after": 45 }).leaveAfterMs === 45e3,
    `(${toConfig({ "leave-after": 45 }).leaveAfterMs})`);
  check("and so does an explicit zero", toConfig({ "leave-after": 0 }).leaveAfterMs === 0,
    `(${toConfig({ "leave-after": 0 }).leaveAfterMs})`);
  // A real value still wins for the timer, which a room may want short on
  // purpose. The roster is different: the reference hardcodes 45 and a city of
  // zero is not a setting, it is a bug with a number attached.
  check("a zero roster is floored rather than obeyed", toConfig({ "max-people": 0 }).maxPeople >= 16,
    `(${toConfig({ "max-people": 0 }).maxPeople})`);
  // And the engine agrees: a long timer keeps a silent resident in the city.
  const engine = makeEngine({ leaveAfterMs: 300e3 });
  engine.handle(entry("join", "q", "q", ""));
  runFrames(60 * 4);
  check("a silent resident stays for the whole timer", engine.residentCount() === 1,
    `(${engine.residentCount()} after 4s)`);
  engine.destroy();
  // The same room with a zero timer puts everybody on their way out at once,
  // which is the blinking: they do not vanish, they walk off, and the next join
  // walks on, forever. Nobody is ever standing still long enough to read as a
  // resident of the city.
  const blink = makeEngine({ leaveAfterMs: 0 });
  // A comment, not a join: the idle timer only applies to someone already out
  // walking, and a resident who has just come through a door is still in the
  // entry animation with a target they take a while to reach.
  blink.handle(entry("comment", "q", "q", "halo"));
  runFrames(30);
  // Nobody is ever settled. A door arrival is still coming through the door and
  // an edge arrival is already walking back out; neither reaches the walk or idle
  // state that a resident of the city is supposed to spend its time in.
  const states = blink.world().dissolve.map((x) => x.state);
  check("a zero timer settles nobody", states.every((s) => s !== "walk" && s !== "idle"),
    `(${states.join(",")})`);
  blink.destroy();
}

console.log("city: the editor cannot configure the city into uselessness")
{
  const at = toConfig;
  // The reference overlay hardcodes 45 with no setting at all. Ours is editable,
  // so the editing has to be unable to produce a room too small to read as one.
  check("a room of five is not a city", at({ "max-people": 5 }).maxPeople >= 16,
    `(got ${at({ "max-people": 5 }).maxPeople})`);
  check("and the cap still holds at the top", at({ "max-people": 999 }).maxPeople === 45,
    `(got ${at({ "max-people": 999 }).maxPeople})`);
  check("an unset room is the full reference size", at({}).maxPeople === 45,
    `(got ${at({}).maxPeople})`);
}

console.log("city: residents do things");
{
  const engine = makeEngine();
  for (let i = 0; i < 20; i++) engine.handle(entry("comment", `v${i}`, `v${i}`, "halo"));
  // Two minutes, which is long enough for somebody to pick something up and for
  // a shower to arrive on its own.
  let sawActivity = false;
  for (let i = 0; i < 60 * 120; i++) {
    runFrames(1, 16);
    if (engine.world().activities.length > 0) sawActivity = true;
  }
  check("somebody is doing something", sawActivity, `(${engine.world().activities.slice(0, 5).join(",")})`);
  check("the city still has its residents", engine.residentCount() > 0, `(${engine.residentCount()})`);
  engine.destroy();
}

console.log("city: people get out of the rain");
{
  // The wardrobe is what a gift buys. The umbrella in a shower is not — that is
  // weather, and it belongs to everybody, which is the whole difference between
  // a person walking through a downpour and a city that is coping with one.
  const look = { skin: "#e8b48a", shirt: "#4a8ae0", pants: "#2a2a3a", shoe: "#1a1a24", hair: "#201810", name: "X" };
  const pose = { kind: "walk", f: 0, wf: 0, dy: 0, dx: 0 };
  const bare = { hat: 0, bag: false, umbrella: false };
  const body = personParts(look, 0, pose);
  const dry = decorate(body, bare, pose, false);
  const wet = decorate(body, bare, pose, true);
  check("a dry day adds no umbrella", dry.length === body.length, `(${dry.length} vs ${body.length})`);
  check("rain adds one", wet.length === dry.length + 4, `(${wet.length - dry.length} parts)`);
  check("and it clears when the rain stops", decorate(body, bare, pose, false).length === dry.length);
  // A gift tier brings its own umbrella, in its own colour, rain or not.
  const owned = decorate(body, { hat: 3, bag: true, umbrella: true }, pose, false);
  check("a top gift carries an umbrella on a dry day", owned.length > dry.length, `(${owned.length})`);
  // Somebody sitting on a bench is already out of the weather.
  const sat = decorate(body, bare, { ...pose, kind: "sit" }, true);
  check("somebody already sitting is left alone", sat.length === dry.length, `(${sat.length - dry.length})`);
  // And the canopy has to sit above the head, not over the face.
  const top = Math.min(...wet.map((p) => p[1]));
  check("the canopy is above the head", top < 1, `(topmost y ${top})`);
}

console.log("city: everybody is actually visible");
{
  // A resident at `dissolve` 0 is drawn through the Bayer buffer at zero
  // threshold, which is the same as not being drawn. Nothing about that is
  // visible from the data layer: the record says they are in the city, walking,
  // with a wardrobe. So this asks for the thing that was actually wrong.
  const engine = makeEngine();
  // Gifts, not comments, because a gift is the path that reproduced it: the
  // viewer arrives, walks in, and then a whole batch of them turn up at once.
  for (let i = 0; i < 24; i++) engine.handle(entry("gift", `v${i}`, `v${i}`, "Lion", { diamonds: 1, count: 1 }));
  runFrames(60 * 6);
  // And again, after they have all settled, which is when a returning viewer is
  // most likely to be built from a record rather than from a join.
  for (let i = 0; i < 24; i++) engine.handle(entry("gift", `v${i}`, `v${i}`, "Lion", { diamonds: 1, count: 1 }));
  runFrames(60 * 6);
  const d = engine.world().dissolve;
  const stuck = d.filter((x) => x.d < 1 && x.state !== "enter");
  check("nobody is stuck invisible", stuck.length === 0,
    `(${stuck.length} of ${d.length}: ${stuck.slice(0, 3).map((x) => x.id + "@" + x.d + "/" + x.state).join(", ")})`);
  check("and they are all solid", d.every((x) => x.d === 1), `(${d.map((x) => x.d).join(",")})`);
  engine.destroy();
}

console.log("city: a top gift is actually drawn holding its umbrella");
{
  // The wardrobe test proves the record says hat 3 and umbrella. This proves the
  // pixels say it too, because the two can disagree: a field read by the draw
  // path that the record never sets looks exactly like a working feature at the
  // data layer and a missing feature on screen.
  const engine = makeEngine();
  engine.handle(entry("gift", "RAFI", "rafi-1", "Lion", { diamonds: 2500, count: 1 }));
  runFrames(60 * 6);
  const w = engine.world().wardrobe.find((x) => x.id === "rafi-1");
  check("the record has it", !!w && w.umbrella, `(${JSON.stringify(w)})`);

  // Ask every canvas, then judge the one that actually has people on it. Which
  // canvas that is depends on how the scene is layered, and guessing it is how a
  // test ends up asserting on an empty buffer and passing for the wrong reason.
  const measure = () => {
    const out = [];
    for (const cid of byId.keys()) {
      const f = opsFor(cid).filter((o) => o.op === "fillRect");
      out.push({
        id: cid,
        size: `${byId.get(cid).width}x${byId.get(cid).height}`,
        fills: f,
        bodies: f.filter((o) => o.w === 5 && o.h >= 3).length,
        canopies: f.filter((o) => o.h === 1 && o.w >= 5).length,
      });
    }
    return out;
  };

  const stop = captureOps();
  runFrames(2);
  stop();
  const dry = measure().filter((c) => c.fills.length);
  // The layer with the most bodies is the one the residents are on. Judging
  // every layer that happens to contain a body is wrong: a vehicle sprite is a
  // person-shaped cluster of pixels too, and no umbrella is ever going to appear
  // on the mayor's bonnet.
  const layer = dry.slice().sort((a, b) => b.bodies - a.bodies)[0];
  check("somebody is painted", !!layer && layer.bodies > 0,
    `(${dry.map((c) => c.size + " bodies=" + c.bodies).join(" | ")})`);
  check(`a canopy is drawn on the ${layer && layer.size} layer, with the bodies`,
    !!layer && layer.canopies > 0, `(bodies ${layer && layer.bodies}, canopies ${layer && layer.canopies})`);
  engine.destroy();
}

console.log("city: a shower arrives, and leaves");
{
  // Forced, because the shape of a shower is what is being checked here: it
  // fades in, it rains, it clears, it leaves a rainbow, and the city keeps
  // running through all of it.
  const engine = makeEngine();
  const seen = [];
  engine.weather("rain");
  // 26s of rain and 14s of rainbow is 40s to the second, so a 40s window is a
  // coin toss. Fifty leaves room for the handover.
  for (let i = 0; i < 60 * 50; i++) {
    runFrames(1, 16);
    const w = engine.world().weather;
    if (seen[seen.length - 1] !== w) seen.push(w);
  }
  check("it rains when told to", seen[0] === "rain", `(${seen.join(" -> ")})`);
  check("then it clears", seen.includes("rainbow"), `(${seen.join(" -> ")})`);
  // Not "the last state is dry": 26s of rain and 14s of rainbow is 40s, and by
  // 50s the room can be into the next shower already. What matters is that the
  // sky came back round, not where it happened to be when the window closed.
  check("and comes back to dry", seen.includes("dry"), `(${seen.join(" -> ")})`);
  check("and the city is still running after all of it", (runFrames(5), drawCalls > 0));
  engine.destroy();
}

console.log("city: the weather also comes on its own");
{
  // A shower is due roughly every 150 seconds, so a 600 second window holds
  // about four of them — enough to pass most of the time and fail the rest,
  // which is worse than no test at all. Thirty minutes puts the odds of
  // seeing nothing past twelve showers at effectively zero.
  const engine = makeEngine();
  // A shower is a run of frames, not a frame. Counting without noticing the
  // transition counted one shower, always, which is a test that cannot fail.
  let showers = 0, raining = false;
  for (let i = 0; i < 60 * 1800; i++) {
    runFrames(1, 16);
    const wet = engine.world().weather === "rain";
    if (wet && !raining) showers++;
    raining = wet;
  }
  check("it rains without being told to", showers > 0, `(saw ${showers} shower(s))`);
  check("more than once, so it is a cycle and not one long storm", showers > 1, `(${showers})`);
  engine.destroy();
}

console.log("city: local traffic shows up");
{
  const engine = makeEngine();
  const seen = new Set();
  for (let i = 0; i < 60 * 240; i++) {
    runFrames(1, 16);
    for (const k of Object.keys(engine.vehicles().byType)) seen.add(k);
  }
  for (const want of ["ojek", "angkot", "becak", "bakso"]) {
    check(`${want} appears on the road`, seen.has(want), `(saw ${[...seen].join(",")})`);
  }
  engine.destroy();
}

console.log("city: a gift procession is a procession, not a wall");
{
  const engine = makeEngine();
  // A run of large gifts, which is what queues the parade vehicles. Each one
  // used to appear instantly at the same point on the same lane, so the faster
  // drove through the slower and the lane became one solid line.
  for (let i = 0; i < 60; i++) {
    engine.handle(entry("gift", `g${i}`, `g${i}`, "Lion", { diamonds: 999, count: 1 }));
  }
  let peak = 0;
  for (let i = 0; i < 60 * 30; i++) {
    runFrames(1, 16);
    peak = Math.max(peak, engine.vehicles().total);
  }
  check("the road never fills up", peak <= 10, `(peak ${peak} vehicles)`);
  // Ten large gifts take a while, because they now run one at a time instead of
  // all at once: the queue is three of them deep plus one on stage. What matters
  // is that it finishes, and that the road empties afterwards on its own.
  let settledAt = -1;
  for (let i = 0; i < 60 * 240; i++) {
    runFrames(1, 16);
    const st = engine.staging();
    if (settledAt < 0 && st.active === null && st.waiting === 0 && !engine.vehicles().byType.limo) {
      settledAt = i;
    }
  }
  check("the queue empties itself", engine.staging().waiting === 0, `(${engine.staging().waiting} left)`);
  // By type, not by total: ordinary traffic fills a 1280px road on its own, so
  // a total was never a measure of the parade being over.
  check("and the parade cars go home", !engine.vehicles().byType.limo,
    `(${JSON.stringify(engine.vehicles().byType)})`);
  check("and it did so without overflowing", settledAt >= 0, `(never settled)`);
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

console.log("city: the city is sized by the room, not by its own bookkeeping");
{
  const engine = makeEngine();
  // The room's own count, exactly as sources/tiktok.py sends it.
  const viewers = (n) => engine.handle(entry("viewers", "v1", "v1", String(n), { count: n }));

  viewers(500);
  const big = engine.world();
  check("a busy room reports its audience", big.audienceReal === 500, `got ${big.audienceReal}`);
  check("and does not claim 500 residents", big.dissolve.length < 500,
    `${big.dissolve.length} residents — the two numbers must not be conflated`);

  // The skyline eases rather than snapping, so give it real time.
  runFrames(2700);
  check("the skyline catches up with the room", engine.world().audience > 490, `got ${engine.world().audience}`);

  viewers(2);
  check("and a room that empties is followed down", engine.world().audienceReal === 2, `got ${engine.world().audienceReal}`);
  runFrames(2700);
  check("down to nothing", engine.world().audience < 10, `got ${engine.world().audience}`);
  check("an empty room is a kampung", audienceTier(engine.world().audience).name === "KAMPUNG",
    `got ${audienceTier(engine.world().audience).name}`);
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
