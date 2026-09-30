"use strict";
/**
 * Where an overlay's widget sits in the frame.
 *
 * The first version of this returned `display: flex` with `justify-content` and
 * `align-items` derived from x/y. It looked like corner alignment, passed
 * review, passed the type check, and did nothing at all: `.sk-widget` is
 * `position: absolute` with no inset and no width, so it shrink-wraps its own
 * content and has no free space for either property to distribute, and with
 * every inset left auto it sits at its static position. Every non-full-frame
 * overlay drew in the top-left corner with x/y ignored, and the only place that
 * is visible is OBS.
 *
 * So the checks below are about the things that actually move the box — an inset
 * from an edge and a compensating translate. A test that only asked for "returns
 * an object" would have passed the broken version, which is the reason to write
 * these at all.
 *
 * No react stub needed: the module's only import is a type, and tsc erases it.
 */

const path = require("path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/align");
const { anchorTo } = require(path.join(OUT, "lib", "alignment.js"));

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures += 1;
  }
}

/** Exactly one of a pair is a real anchor; the other has to be auto. */
function anchored(style, a, b) {
  const first = style[a];
  const second = style[b];
  const isAuto = (v) => v === "auto" || v === undefined;
  return (isAuto(first) && !isAuto(second)) || (!isAuto(first) && isAuto(second));
}

console.log("each corner anchors to one edge and grows inwards");
{
  const tl = anchorTo(0, 0);
  check("top-left takes the top and left edges",
    tl.left === "0" && tl.top === "0" && tl.right === "auto" && tl.bottom === "auto",
    JSON.stringify(tl));
  check("top-left does not translate", tl.transform === "translate(0%, 0%)", tl.transform);

  const bl = anchorTo(0, 1);
  check("bottom-left takes the left and bottom edges",
    bl.left === "0" && bl.bottom === "0" && bl.top === "auto", JSON.stringify(bl));
  check("bottom-left grows upwards", bl.transform === "translate(0%, -100%)", bl.transform);

  const tr = anchorTo(1, 0);
  check("top-right takes the right and top edges",
    tr.right === "0" && tr.top === "0" && tr.left === "auto", JSON.stringify(tr));
  check("top-right grows leftwards", tr.transform === "translate(-100%, 0%)", tr.transform);

  const br = anchorTo(1, 1);
  check("bottom-right takes the right and bottom edges",
    br.right === "0" && br.bottom === "0", JSON.stringify(br));
  check("bottom-right grows in both directions",
    br.transform === "translate(-100%, -100%)", br.transform);
}

console.log("the middle is the middle");
{
  const c = anchorTo(0.5, 0.5);
  check("centred is anchored at 50% on both axes",
    c.left === "50%" && c.top === "50%", JSON.stringify(c));
  check("centred is pulled back by half its own size",
    c.transform === "translate(-50%, -50%)", c.transform);
  // The 0.4/0.6 band, so a value just off centre still reads as a corner rather
  // than snapping to the middle of the frame.
  check("just inside the band is still centred", anchorTo(0.45, 0.55).left === "50%");
  check("just outside the band is a corner", anchorTo(0.35, 0.55).left === "0");
}

console.log("never two anchors on one axis");
{
  // left and right together would stretch the box across the frame instead of
  // letting it hug its own corner, and that is the mistake a rewrite makes.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
    const s = anchorTo(x, y);
    check(`(${x}, ${y}) anchors horizontally once`, anchored(s, "left", "right"), JSON.stringify(s));
    check(`(${x}, ${y}) anchors vertically once`, anchored(s, "top", "bottom"), JSON.stringify(s));
  }
}

console.log("it moves the box, rather than asking flexbox to");
{
  // The exact shape of the bug this replaced. A style carrying only flex
  // distribution properties is inert on a shrink-to-fit absolutely positioned
  // box, so its presence means the fix has been undone.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
    const s = anchorTo(x, y);
    check(`(${x}, ${y}) sets an edge, not a flex distribution`,
      !("justifyContent" in s) && !("alignItems" in s) && !("display" in s), JSON.stringify(s));
    check(`(${x}, ${y}) compensates with a translate`, typeof s.transform === "string" && s.transform.startsWith("translate("), JSON.stringify(s));
  }
}

console.log("a full-frame widget is left to the class that fills it");
{
  // `.sk-fill` pins the box to all four edges with `inset: 0; transform: none`.
  // An inline inset or transform beats a class, so a fill widget handed these
  // would get a corner to sit in — which is what the astronaut canvas did.
  const s = anchorTo(0.5, 0.5, true);
  check("a fill widget gets nothing at all", Object.keys(s).length === 0, JSON.stringify(s));
  check("a fill widget is unanchored", anchored(s, "left", "right") === false, JSON.stringify(s));
  check("fill defaults to off", Object.keys(anchorTo(0, 0, false)).length > 0);
}

console.log();
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log("all passed");
