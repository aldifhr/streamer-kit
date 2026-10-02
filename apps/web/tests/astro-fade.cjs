"use strict";
/**
 * Astronaut transitions have to be continuous, not a blink.
 *
 * Two things combined to produce it. The exit was eased in, which holds the
 * alpha near full for most of the transition and collapses it at the very end —
 * so an astronaut spent nearly all of its exit looking solid and then
 * disappeared in one frame. And the draw was skipped entirely below 2% opacity,
 * which turned the last sliver of a fade into a hard cut. Together they read as
 * a blink: the sprite was there, then it was not.
 *
 * The assertion has to be on the shape of the curve, not on whether it finished.
 * A test that only checks "reached zero eventually" passes against both versions
 * — the blink is in the middle of the transition, where a final-state check
 * cannot see it. These sample the alpha across the whole fade and require it to
 * move every step.
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
    storageKey: `fade-${Math.random()}`,
    config: { ...DEFAULT_ASTRO_CONFIG },
  });
  engine.resize(1281, 579);
  return engine;
}

function join(seq) {
  return {
    id: `c${seq}`, seq, ts: clock, kind: "comment",
    user: `u${seq}`, userId: `u${seq}`, value: "hi", meta: {},
  };
}

/** Steps `seconds` of wall clock, sampling alpha as it goes. */
function sampleAlpha(engine, seconds, fps) {
  const stepMs = 1000 / fps;
  const end = clock + seconds * 1000;
  const samples = [];
  while (clock < end) {
    clock = Math.min(end, clock + stepMs);
    const queued = [...frameHandles.entries()];
    frameHandles.clear();
    for (const [, fn] of queued) fn();
    samples.push(engine.alphaNow());
  }
  return samples;
}

/** Samples that never rendered at all, which is the blink. */
function countDrawn(samples) {
  return samples.filter((a) => a > 0).length;
}

console.log("the exit never skips a frame on its way out");
// Three seconds is far longer than FADE_OUT, so every sample should be drawn and
// the alpha should walk down to nothing. A blink shows up here as a sample at
// exactly zero partway through, surrounded by samples above it.
{
  const engine = spawn();
  engine.handle(join(0));
  // Let the entry finish first, so this measures only the exit.
  sampleAlpha(engine, 1.5, 60);
  engine.beginLeave();
  // Stop well before the fade completes: the roster entry is deleted the moment
  // it does, and reading alpha from a deleted astronaut returns zero, which is
  // indistinguishable from the blink this test is looking for. FADE_OUT is 520ms
  // and the entry goes at `leave >= 1`, so half that is measured instead.
  const samples = sampleAlpha(engine, 0.45, 60);
  const zeros = samples.filter((a) => a <= 0).length;
  check("no sample during the exit is fully invisible", zeros === 0, `${zeros} samples at zero`);
  check("the exit is drawn for its whole length", countDrawn(samples) === samples.length,
    `${countDrawn(samples)} of ${samples.length}`);
  engine.destroy();
}

console.log("\nthe exit alpha decreases monotonically");
// Eased in, the curve holds near full opacity and then drops: the movement is
// bunched at the end, which is the blink. What a smooth exit needs is for the
// alpha to be strictly lower than the sample before it, frame after frame, with
// no plateau at full and no cliff into nothing.
{
  const engine = spawn();
  engine.handle(join(0));
  sampleAlpha(engine, 1.5, 60);
  engine.beginLeave();
  const samples = sampleAlpha(engine, 0.45, 60);

  let plateaus = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] >= samples[i - 1] - 1e-9) plateaus++;
  }
  check("the alpha never holds still during the exit", plateaus === 0, `${plateaus} plateau frames`);

  // Halfway through the exit the sprite must already be visibly on its way, not
  // still looking solid. This is the assertion that fails against easeIn.
  const half = samples[Math.floor(samples.length / 2)];
  check("halfway through the exit it is already well past half faded",
    half < 0.6, `alpha ${half.toFixed(3)}`);

  const last = samples[samples.length - 1];
  const secondLast = samples[samples.length - 2];
  const drop = secondLast - last;
  check("the final frame fades rather than cutting", drop < 0.2,
    `dropped ${drop.toFixed(3)} in the last frame`);
  engine.destroy();
}

console.log("\nthe entry is continuous too");
// A roster appearing should ramp, not pop. Same shape check as the exit.
{
  const engine = spawn();
  engine.handle(join(0));
  const samples = sampleAlpha(engine, 0.4, 60);
  check("the entry starts invisible", samples[0] < 0.15, `alpha ${samples[0].toFixed(3)}`);
  check("the entry reaches full opacity", samples[samples.length - 1] > 0.99);
  let jumps = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] - samples[i - 1] > 0.25) jumps++;
  }
  check("no frame jumps straight to visible", jumps === 0, `${jumps} jumps`);
  engine.destroy();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
