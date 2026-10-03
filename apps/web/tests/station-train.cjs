/**
 * The station: trains, and the arrivals that depend on them.
 *
 * The behaviour worth protecting is not the drawing, it is the sequence. A
 * viewer arrives by stepping out of a train door, and a viewer leaving walks to
 * a door and boards. Both of those can quietly become a fade-in at the edge of
 * the frame and still look completely correct, which is why they are asserted
 * on state rather than on pixels.
 */

const path = require("path");
const CACHE = path.join(__dirname, "../../../node_modules/.cache/stream-kit/station");

/**
 * A canvas good enough for a sprite sheet nobody will look at.
 *
 * The train builds a small banner canvas per service. Nothing in these tests
 * reads pixels out of it, but `createElement` has to return something with a
 * context and a size, or the first train never gets made.
 */
function stubCanvas(w, h) {
  const c = {
    width: w || 300,
    height: h || 150,
    ownerDocument: null,
    getContext: () => ctx2d(),
    style: {},
  };
  return c;
}
function ctx2d() {
  const noop = () => {};
  return new Proxy(
    {
      canvas: stubCanvas(),
      fillStyle: "",
      strokeStyle: "",
      font: "",
      globalAlpha: 1,
      globalCompositeOperation: "",
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: noop,
      measureText: () => ({ width: 10 }),
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        return noop;
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
}
const stubDoc = {
  createElement: (tag) => (tag === "canvas" ? stubCanvas() : { style: {} }),
};
global.document = stubDoc;
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;

let fails = 0;
let checks = 0;
function check(name, ok, extra) {
  checks++;
  if (ok) return true;
  fails++;
  console.error("  FAIL " + name + (extra === undefined ? "" : " — " + extra));
  return false;
}

function load(name) {
  const file = path.join(CACHE, name + ".js");
  try {
    return require(file);
  } catch (e) {
    console.error("missing " + file + " — run `npm run test:station` first");
    process.exit(1);
  }
}

const { toStationConfig, DEFAULT_STATION_CONFIG } = load("lib/widgets/station/config");
const train = load("lib/widgets/station/train");

// ---------------------------------------------------------------------------
console.log("\nconfig");
{
  const d = DEFAULT_STATION_CONFIG;

  const blank = toStationConfig({ "max-people": "", "leave-after": "", "dwell": "" });
  check("a blank max-people keeps the default", blank.maxPeople === undefined || blank.maxPeople === d.maxPeople, JSON.stringify(blank.maxPeople));
  check("a blank leave-after is not zero", blank.leaveAfter !== 0, "leave-after became " + blank.leaveAfter);
  check("a blank dwell is not zero", blank.dwell !== 0, "dwell became " + blank.dwell);

  const empty = toStationConfig({});
  check("an empty style changes nothing", JSON.stringify(empty) === "{}", JSON.stringify(empty));

  const real = toStationConfig({ "max-people": "20", "leave-after": "90" });
  check("a real number is taken", real.maxPeople === 20 && real.leaveAfter === 90, JSON.stringify(real));

  const nul = toStationConfig({ "max-people": null, "leave-after": undefined, dwell: false });
  check("null is not zero", nul.maxPeople === undefined, "max-people " + nul.maxPeople);
  check("undefined is not zero", nul.leaveAfter === undefined);
  check("false is not zero", nul.dwell === undefined);

  const tiny = toStationConfig({ "max-people": "1" });
  check("the platform floor holds", tiny.maxPeople >= 8, "got " + tiny.maxPeople);

  const huge = toStationConfig({ "max-people": "5000" });
  check("the platform ceiling holds", huge.maxPeople <= 45, "got " + huge.maxPeople);

  const party = toStationConfig({ "express-gift": "900", "party-gift": "10" });
  check("party cannot sit below express", party.partyGift >= 900, JSON.stringify(party));

  const pinned = toStationConfig({ "freeze-clock": "true", "pinned-hour": "0.8" });
  check("freeze plus an hour pins it", pinned.pinnedHour === 0.8, JSON.stringify(pinned));
}

// ---------------------------------------------------------------------------
console.log("\ntrain lifecycle");
// A clock the test drives, so "eight seconds later" is eight seconds and not
// however long the machine happened to take.
let T = 0;
const LW = 640;
/** Advances the test's clock and the train together, one frame at a time. */
function step(tr, busy) {
  T += 16.667;
  return train.updateTrain(tr, 1 / 60, LW, busy, T);
}

{
  const tr = train.newTrain(stubDoc, LW, 14000);

  check("it starts off screen", tr.x < -tr.len || tr.x > LW, "x=" + tr.x);
  check("it starts arriving", tr.phase === "arrive");
  check("it has doors", tr.doors.length === 0 || tr.doors.length > 0);

  // Run to the platform.
  let guard = 0;
  while (tr.phase !== "dwell" && guard++ < 2000) step(tr, false);
  check("it reaches the platform", tr.phase === "dwell", "phase " + tr.phase + " after " + guard + " steps");
  check("it stopped on screen", tr.x > -tr.len && tr.x < LW, "x=" + tr.x);
  check("it announces itself", true);

  guard = 0;
  while (tr.open < 0.99 && guard++ < 500) step(tr, false);
  check("the doors open", tr.open > 0.9, "open=" + tr.open);
  check("it counts as dwelling", train.dwelling(tr) === tr);
  check("it has two doors per car", tr.doors.length === tr.n * 2, tr.doors.length + " doors for " + tr.n + " cars");

  const doorX = tr.doors[0].x;
  check("a door is within reach of the train", Math.abs(doorX - tr.x) < tr.len, "door " + doorX + " train " + tr.x);
  check("nearestDoor picks the closest", train.nearestDoor(tr, tr.x + 20) === Math.min.apply(null, tr.doors.map((d) => d.x)));

  // Nobody boarding: it closes on its own.
  guard = 0;
  while (tr.phase !== "depart" && guard++ < 4000) step(tr, false);
  check("it eventually leaves", tr.phase === "depart", "phase " + tr.phase);
  check("the doors shut first", tr.open < 0.05, "open=" + tr.open);

  const start = tr.x;
  guard = 0;
  while (guard++ < 4000) {
    const r = step(tr, false);
    if (r.departed) break;
  }
  check("it reports leaving", tr.phase === "depart");
  check("it moved off screen", tr.x > LW || tr.x < -tr.len, "x=" + tr.x + " from " + start);

  // Departing to the right leaves right, not to the left.
  const right = train.newTrain(stubDoc, LW, 1000);
  right.dir = 1;
  right.phase = "depart";
  right.t = 0;
  right.x = right.stopX;
  for (let i = 0; i < 30; i++) step(right, false);
  check("a right-hand train exits right", right.x > right.stopX, "x=" + right.x + " stop=" + right.stopX);

  const left = train.newTrain(stubDoc, LW, 1000);
  left.dir = -1;
  left.phase = "depart";
  left.t = 0;
  left.x = left.stopX;
  for (let i = 0; i < 30; i++) step(left, false);
  check("a left-hand train exits left", left.x < left.stopX, "x=" + left.x + " stop=" + left.stopX);
}

// ---------------------------------------------------------------------------
console.log("\npeople hold the doors open");
{
  const tr = train.newTrain(stubDoc, LW, 14000);
  let guard = 0;
  while (tr.phase !== "dwell" && guard++ < 2000) step(tr, false);
  while (tr.open < 0.99 && guard++ < 3000) step(tr, false);

  // Simulate somebody still crossing the platform.
  let held = 0;
  for (let i = 0; i < 4000; i++) {
    const r = step(tr, true);
    if (r.announce === "closing") break;
    held = i;
  }
  check("boarding holds the doors longer than idle", held > 60 * 14, "held for " + (held / 60).toFixed(1) + "s");

  // But not forever: a passenger stuck at an unreachable door must not park a
  // train at the station permanently.
  guard = 0;
  while (tr.phase === "dwell" && guard++ < 4000) step(tr, true);
  check("it still leaves eventually", tr.phase !== "dwell", "stayed for " + (guard / 60).toFixed(0) + "s");
}

// ---------------------------------------------------------------------------
console.log("\nexpress trains");
{
  const p = train.spawnPasser(stubDoc, LW, false);
  check("an express starts off screen", p.x < -p.len || p.x > LW, "x=" + p.x);
  check("it has a speed", p.speed > 60, "speed " + p.speed);
  check("it is not gold", p.gold === false);

  let gone = false;
  for (let i = 0; i < 4000 && !gone; i++) gone = train.updatePasser(p, 1 / 60, LW);
  check("it runs off the end", gone, "x=" + p.x);

  const gold = train.spawnPasser(stubDoc, LW, true, "TERIMA KASIH");
  check("a gold express carries a banner", !!gold.banner);
  check("a gold express is slower", gold.speed < 100, "speed " + gold.speed);
}

// ---------------------------------------------------------------------------
console.log("\nbanner text");
{
  // The bitmap font has no lowercase, so a name typed in mixed case must come
  // back uppercase rather than full of gaps.
  const b = train.makeBanner(stubDoc, "terima kasih Budi!");
  check("a banner is built", b && b.width > 0);
  check("a banner is narrow enough to read", b.width < 200, "width " + b.width);
}

if (fails) {
  console.error(`\n${fails} failed of ${checks}`);
  process.exit(1);
}
console.log(`\nall passed (${checks} assertions)`);
