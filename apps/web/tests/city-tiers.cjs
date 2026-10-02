/**
 * The street itself has to change with the room, not just the backdrop.
 *
 * Making a five-tier ladder and then wiring one rung to it is how you ship a
 * commit message that describes five features and delivers one. These cases
 * hold every rung to its own numbers, so the tiers cannot quietly collapse back
 * into "the skyline is a bit taller" with the rest of the table aspirational.
 *
 * The layout is baked, so this is asserted on what `genCity` produced rather than
 * on a rendered frame — the pixels are a consequence of these numbers.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/city/lib/widgets/city");
const { genCity, TIER_LOOKS } = require(path.join(OUT, "scenery.js"));
const { AUDIENCE_TIERS } = require(path.join(OUT, "audience.js"));

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

/**
 * A document just real enough to build a layout.
 *
 * `prop` draws its sprite onto a scratch canvas, so the 2D context has to exist
 * and accept writes — nothing is ever read back, which is why the layout can be
 * asserted on numbers instead of pixels.
 */
const ctx2d = () => ({
  fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, font: "",
  fillRect() {}, strokeRect() {}, clearRect() {}, drawImage() {}, fillText() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
  save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {},
});
const stubDoc = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d() }),
};

const LW = 320, LH = 180, SY0 = 104, SY1 = 140;
const build = (tier) => genCity(stubDoc, LW, LH, SY0, SY1, {}, tier);

console.log("each tier builds a different street");
{
  const built = TIER_LOOKS.map((_, tier) => build(tier));
  check("one layout per tier", built.length === 5, `got ${built.length}`);
  for (let i = 1; i < built.length; i += 1) {
    check(`tier ${i} differs from tier ${i - 1}`,
      JSON.stringify(built[i].buildings) !== JSON.stringify(built[i - 1].buildings),
      "the layouts are identical — the tier changed nothing");
  }
}

console.log("a kampung is narrow, low and has alleys");
{
  const v = build(0).buildings;
  const widest = Math.max(...v.map((b) => b.w));
  const tallest = Math.max(...v.map((b) => b.h));
  check("frontages are the narrowest of any tier", widest <= 34, `widest ${widest}`);
  check("and only one or two storeys", tallest <= Math.round(LH * 0.23), `tallest ${tallest} of ${LH}`);
  const gaps = v.slice(1).map((b, i) => b.x - (v[i].x + v[i].w));
  check("with gaps between them", Math.max(...gaps) >= 2, `widest gap ${Math.max(...gaps)}`);
}

console.log("a metropolis is wide, tall and packed shoulder to shoulder");
{
  const v = build(4).buildings;
  check("frontages are the widest", Math.min(...v.map((b) => b.w)) > Math.max(...build(0).buildings.map((b) => b.w)),
    "a big room should have wider frontages than a small one");
  check("buildings are several storeys", Math.max(...v.map((b) => b.h)) >= Math.round(LH * 0.43),
    `tallest ${Math.max(...v.map((b) => b.h))}`);
  const gaps = v.slice(1).map((b, i) => b.x - (v[i].x + v[i].w));
  check("packed with no alley left", Math.min(...gaps) === 0, `tightest gap ${Math.min(...gaps)}`);
}

console.log("height and frontage only ever go up with the room");
{
  for (let i = 1; i < TIER_LOOKS.length; i += 1) {
    const a = build(i - 1).buildings, b = build(i).buildings;
    check(`tier ${i} is at least as tall as tier ${i - 1}`,
      Math.max(...b.map((x) => x.h)) >= Math.max(...a.map((x) => x.h)));
    check(`tier ${i} has at least as many lit windows as tier ${i - 1}`,
      build(i).wins.length >= build(i - 1).wins.length,
      `${build(i - 1).wins.length} -> ${build(i).wins.length}`);
  }
  check("a kampung lights fewer windows than a metropolis",
    build(4).wins.filter((w) => w.thr < 0.4).length > build(0).wins.filter((w) => w.thr < 0.4).length,
    "the lit fraction in the look table is not reaching the windows");
}

console.log("a bigger room gets more lamps");
{
  const lamps = (tier) => build(tier).props.filter((p) => p.type === "lamp").length;
  check("a kampung is dimly lit", lamps(0) === 1, `got ${lamps(0)}`);
  check("lamps increase with the room", lamps(1) > lamps(0) && lamps(2) > lamps(1), `${lamps(0)},${lamps(1)},${lamps(2)}`);
  check("a metropolis is fully lit", lamps(4) === 4, `got ${lamps(4)}`);
}

console.log("lamps are spread, not bunched at one end");
{
  const xs = build(2).props.filter((p) => p.type === "lamp").map((p) => p.x).sort((a, b) => a - b);
  check("three lamps cover the street", xs.length === 3, `got ${xs.length}`);
  check("the first is near the left edge", xs[0] < LW * 0.25, `got ${xs[0]}`);
  check("the last is near the right edge", xs[xs.length - 1] > LW * 0.75, `got ${xs[xs.length - 1]}`);
}

console.log("a one-lamp kampung still has its lamp somewhere sensible");
{
  const xs = build(0).props.filter((p) => p.type === "lamp").map((p) => p.x);
  check("it is on the street", xs.length === 1 && xs[0] > LW * 0.3 && xs[0] < LW * 0.7, `got ${xs}`);
}

console.log("the tier table and the look table agree on how many there are");
{
  check("a look per tier", TIER_LOOKS.length === AUDIENCE_TIERS.length,
    `${TIER_LOOKS.length} looks, ${AUDIENCE_TIERS.length} tiers`);
  for (let i = 1; i < TIER_LOOKS.length; i += 1) {
    check(`look ${i} is at least as busy as ${i - 1}`,
      TIER_LOOKS[i].lit >= TIER_LOOKS[i - 1].lit && TIER_LOOKS[i].lamps >= TIER_LOOKS[i - 1].lamps,
      JSON.stringify(TIER_LOOKS[i]));
  }
}

console.log("a tier out of range falls back rather than breaking");
{
  const out = genCity(stubDoc, LW, LH, SY0, SY1, {}, 99);
  check("too high is the top tier", JSON.stringify(out.buildings) === JSON.stringify(build(4).buildings));
  const low = genCity(stubDoc, LW, LH, SY0, SY1, {}, -3);
  check("too low is the bottom tier", JSON.stringify(low.buildings) === JSON.stringify(build(0).buildings));
  check("and no arguments at all still builds", genCity(stubDoc, LW, LH, SY0, SY1).buildings.length > 0);
}

console.log("owner signs still work at every tier");
{
  for (let tier = 0; tier < 5; tier += 1) {
    const layout = genCity(stubDoc, LW, LH, SY0, SY1, { 0: { name: "RAFI", tier: 0 } }, tier);
    const owned = layout.signs.filter((s) => s.owned);
    check(`tier ${tier} shows the owner's name`, owned.length === 1 && owned[0].text === "RAFI",
      `got ${JSON.stringify(owned)}`);
  }
}

console.log();
assert.equal(typeof TIER_LOOKS, "object");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}