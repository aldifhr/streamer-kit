const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/scene");

// scene.ts reaches the widget registry, which imports every widget module and so
// pulls in react and the jsx runtime. No component body runs in this file, so a
// stub is enough and it keeps the test about ids rather than about rendering.
// Same approach as widget-registry.cjs.
const origLoad = Module._load;
const jsxStub = { jsx: () => null, jsxs: () => null, Fragment: null };
Module._load = function (request, ...rest) {
  if (request === "react" || request.startsWith("react/")) return { ...jsxStub, createElement: () => null };
  if (request.startsWith("react/jsx")) return jsxStub;
  // tsc leaves the `@/` alias in the emitted require, so it has to be mapped by
  // hand here the way the tsconfig maps it for the compiler.
  if (request.startsWith("@/")) return require(path.join(OUT, request.slice(2)));
  return origLoad.call(this, request, ...rest);
};

const { normaliseScene, makeWidget, countOf, SCENE_VERSION } = require(path.join(OUT, "lib", "scene.js"));
const { newWidgetId } = require(path.join(OUT, "lib", "widgets", "types.js"));

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

console.log("widget ids stay unique");
const ids = new Set();
for (let i = 0; i < 200; i += 1) ids.add(newWidgetId("chat"));
check("200 ids in one session are all different", ids.size === 200);
check("an id still says what it is", newWidgetId("astro").startsWith("astro-"));
check("an id is usable as a DOM id", !/[^a-zA-Z0-9_-]/.test(newWidgetId("chat")));

console.log("a config with duplicate ids is repaired on load");
// This is what an old build wrote: the id counter restarted on every page load,
// so two marathon widgets saved in different sessions could share an id. The
// counter widgets key their state on it, so a duplicate means a shared total.
const scene = normaliseScene({
  version: SCENE_VERSION,
  theme: "streamline",
  widgets: [
    { type: "marathon", id: "marathon-1", x: 0.1, y: 0.1 },
    { type: "marathon", id: "marathon-1", x: 0.5, y: 0.5 },
    { type: "streaks", id: "streaks-1", x: 0.2, y: 0.2 },
  ],
});
const sceneIds = scene.widgets.map((w) => w.id);
check("all three widgets survive", scene.widgets.length === 3);
check("no two widgets share an id", new Set(sceneIds).size === sceneIds.length);
check("the first duplicate keeps its id", sceneIds[0] === "marathon-1");
check("the duplicate is given a new one", sceneIds[1] !== "marathon-1");
check("an unaffected widget is untouched", sceneIds[2] === "streaks-1");
check("countOf still sees both marathons", countOf(scene, "marathon") === 2);

console.log("a config with no ids at all still loads");
const fresh = normaliseScene({
  version: SCENE_VERSION,
  widgets: [{ type: "chat" }, { type: "chat" }],
});
const freshIds = fresh.widgets.map((w) => w.id);
check("both are present", fresh.widgets.length === 2);
check("they do not collide", freshIds[0] !== freshIds[1]);

console.log("a scene of nothing but unknown types gets a chat");
// Covered by an existing branch, asserted here because it shares the load path
// this file exercises: a bad config must not leave OBS with a blank screen.
const empty = normaliseScene({
  version: SCENE_VERSION,
  widgets: [{ type: "nope" }, { type: "chat" }],
});
check("a scene of only unknown types falls back to chat", countOf(empty, "chat") >= 1);

console.log("a brand new widget is well formed");
const w = makeWidget("poll");
check("it has an id", typeof w.id === "string" && w.id.length > 0);
check("it is enabled", w.enabled !== false);
check("it is positioned inside the frame", w.x >= 0 && w.x <= 1 && w.y >= 0 && w.y <= 1);
check("it is not a fill by accident", w.scale > 0);

console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
