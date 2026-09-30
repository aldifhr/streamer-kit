const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/drag");
const {
  parseEditorMessage,
  isEditMode,
  anchorFromPointer,
  isRemoveMessage,
} = require(path.join(OUT, "lib", "drag.js"));

let passed = 0;
function check(label, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    process.exitCode = 1;
  }
}

console.log("a move is understood and clamped");
const moved = parseEditorMessage({ kind: "streamkit:widget-moved", id: "w1", x: 0.25, y: 0.75 });
check("a move comes back", moved && moved.kind === "streamkit:widget-moved");
check("it keeps the id", moved.id === "w1");
check("it keeps the position", moved.x === 0.25 && moved.y === 0.75);

const off = parseEditorMessage({ kind: "streamkit:widget-moved", id: "w1", x: 1.8, y: -0.4 });
check("a position past the edge is clamped to the frame", off.x === 1 && off.y === 0);

console.log("garbage is refused, not obeyed");
// The overlay is a public page and can be embedded by anyone, so an unvalidated
// message here would let a hostile parent place widgets, or delete one, in a
// live overlay.
for (const bad of [
  null,
  undefined,
  "streamkit:widget-moved",
  42,
  [],
  {},
  { kind: "streamkit:widget-moved" },
  { kind: "streamkit:widget-moved", id: "w1" },
  { kind: "streamkit:widget-moved", id: 1, x: 0, y: 0 },
  { kind: "streamkit:widget-moved", id: "w1", x: "0.5", y: 0.5 },
  { kind: "streamkit:widget-moved", id: "w1", x: NaN, y: 0.5 },
  { kind: "streamkit:widget-moved", id: "w1", x: Infinity, y: 0.5 },
  { kind: "something-else", id: "w1" },
  { kind: "streamkit:unknown-thing", id: "w1" },
]) {
  check(`refused: ${JSON.stringify(bad)}`, parseEditorMessage(bad) === null);
}

console.log("a NaN never reaches the config");
// A NaN position would survive every comparison and poison the saved scene
// permanently, with no way back through the editor.
const nanMove = parseEditorMessage({ kind: "streamkit:widget-moved", id: "w", x: NaN, y: 0.5 });
check("a NaN coordinate is refused outright", nanMove === null);

console.log("select and remove are distinct");
const sel = parseEditorMessage({ kind: "streamkit:widget-selected", id: "w2" });
check("a selection parses", sel && sel.id === "w2");
const none = parseEditorMessage({ kind: "streamkit:widget-selected", id: null });
check("deselecting is allowed", none && none.id === null);
check("a numeric id is refused", parseEditorMessage({ kind: "streamkit:widget-selected", id: 5 }) === null);

const remove = parseEditorMessage({ kind: "streamkit:widget-remove", id: "w3" });
check("a removal parses", remove && isRemoveMessage(remove));
check("a move is not a removal", !isRemoveMessage(moved));
check("a removal without an id is refused", parseEditorMessage({ kind: "streamkit:widget-remove" }) === null);

console.log("edit mode is opt-in");
check("edit=1 turns it on", isEditMode("1") === true);
check("anything else leaves it off", isEditMode("0") === false);
check("an absent param leaves it off", isEditMode(undefined) === false);
// The bug this guards: the value was fed back through URLSearchParams, where
// "1" parses as a key with no value and never matches.
check("the bare string 1 is enough", isEditMode("1") === true);
check("the word '1' is not confused with true", isEditMode("true") === false);

console.log("the pointer maps to the frame");
const frame = { width: 1920, height: 1080 };
check("top left is 0,0", JSON.stringify(anchorFromPointer({ x: 0, y: 0 }, { x: 0, y: 0 }, frame)) === JSON.stringify({ x: 0, y: 0 }));
check("bottom right is 1,1", JSON.stringify(anchorFromPointer({ x: 1920, y: 1080 }, { x: 0, y: 0 }, frame)) === JSON.stringify({ x: 1, y: 1 }));
check("the centre is the centre", JSON.stringify(anchorFromPointer({ x: 960, y: 540 }, { x: 0, y: 0 }, frame)) === JSON.stringify({ x: 0.5, y: 0.5 }));

// Grabbing a widget by its middle and dropping it in the middle of the frame
// must leave it in the middle, not snap its corner to the pointer.
const off1 = anchorFromPointer({ x: 1060, y: 590 }, { x: 100, y: 50 }, frame);
check("a grab offset is honoured", Math.abs(off1.x - 0.5) < 0.001 && Math.abs(off1.y - 0.5) < 0.001, JSON.stringify(off1));

const past = anchorFromPointer({ x: 5000, y: -400 }, { x: 0, y: 0 }, frame);
check("a drag past the edge clamps", past.x === 1 && past.y === 0);
check("a zero-size frame gives null", anchorFromPointer({ x: 1, y: 1 }, { x: 0, y: 0 }, { width: 0, height: 100 }) === null);

console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
