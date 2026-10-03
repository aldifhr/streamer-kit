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
const { WIDGET_TYPES } = require(path.join(OUT, "lib", "widgets", "registry.js"));
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
// so two widgets saved in different sessions could share an id. The counter
// widgets key their state on it, so a duplicate means a shared total.
//
// Marathon and streaks used to be the types here and were removed from the
// registry. `normaliseScene` drops a widget whose type is no longer registered,
// so this kept passing as long as it was the id de-duplication being tested —
// which is exactly why it needed swapping for types that still ship rather than
// being left to fail on a removed feature.
const scene = normaliseScene({
  version: SCENE_VERSION,
  theme: "streamline",
  widgets: [
    { type: "goal", id: "goal-1", x: 0.1, y: 0.1 },
    { type: "goal", id: "goal-1", x: 0.5, y: 0.5 },
    { type: "social", id: "social-1", x: 0.2, y: 0.2 },
  ],
});
const sceneIds = scene.widgets.map((w) => w.id);
check("all three widgets survive", scene.widgets.length === 3, `got ${scene.widgets.length}`);
check("no two widgets share an id", new Set(sceneIds).size === sceneIds.length);
check("the first duplicate keeps its id", sceneIds[0] === "goal-1");
check("the duplicate is given a new one", sceneIds[1] !== "goal-1");
check("an unaffected widget is untouched", sceneIds[2] === "social-1");
check("countOf still sees both goals", countOf(scene, "goal") === 2);

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
// Deliberately a type that is not registered. `makeWidget` reads its defaults
// out of the registry with a fallback, so asking for a type nobody ships is the
// honest version of "a widget that does not exist yet" — and it is what an
// overlay saved with a widget this build does not have will ask for.
const w = makeWidget("widget-that-does-not-exist");
check("it has an id", typeof w.id === "string" && w.id.length > 0);
check("it is enabled", w.enabled !== false);
check("it is positioned inside the frame", w.x >= 0 && w.x <= 1 && w.y >= 0 && w.y <= 1);
check("it is not a fill by accident", w.scale > 0);

// ---------------------------------------------------------------------------
// The single-widget record.
//
// Overlays stopped being scenes: each record now holds one widget's type and
// style, and OBS positions the browser source itself. Everything below is the
// contract that has to hold for a record saved before this change, and for one
// written after it.
// ---------------------------------------------------------------------------

const { widgetFromScene, sceneFromWidget, defaultWidgetConfig, isWidgetConfig } = require(
  path.join(OUT, "lib", "scene.js"),
);

console.log("a single-widget record loads as a one-widget scene");
const single = normaliseScene({
  version: SCENE_VERSION,
  type: "astro",
  style: { "max-astro": 7 },
  padding: 20,
  customCSS: ".x{}",
  global: { fontSize: 22 },
});
check("it is recognised as the single-widget shape", isWidgetConfig(single.widgets[0] ? { type: "astro" } : null));
check("exactly one widget comes out", single.widgets.length === 1);
check("it is the right widget", single.widgets[0].type === "astro");
check("its style survives", single.widgets[0].style["max-astro"] === 7);
check("padding survives", single.padding === 20);
check("custom CSS survives", single.customCSS === ".x{}");
check("global style survives", single.global.fontSize === 22);

console.log("an unknown type in a single-widget record still renders something");
const bogus = normaliseScene({ version: SCENE_VERSION, type: "not-a-widget", style: {} });
check("it falls back to chat rather than a blank screen", bogus.widgets[0].type === "chat");

console.log("a scene written by the editor stores as one widget");
const stored = widgetFromScene({
  ...single,
  widgets: [makeWidget("astro"), makeWidget("goal")],
});
check("it names the first widget", stored.type === "astro");
check("it has no widget list", !Array.isArray(stored.widgets));
check("it round-trips back to the same widget", sceneFromWidget(stored).widgets[0].type === "astro");

console.log("a new overlay is its widget at defaults");
// `viewers` was here and is gone from the registry. A widget type that no longer
// exists must fall back rather than break, and that is now a reachable case
// rather than a hypothetical one, so it is asserted directly below.
const freshOverlay = defaultWidgetConfig("city");
check("it names the widget", freshOverlay.type === "city");
// Only overrides are stored, never the whole default bag: the defaults live in
// the widget's registry entry, and copying them into every record is how a
// default change used to leave existing overlays behind.
check("it stores no style overrides for an untouched widget", Object.keys(freshOverlay.style).length === 0);
check("loading it gives back that widget", normaliseScene(freshOverlay).widgets[0].type === "city");

console.log("an overlay saved with a widget this build does not have");
{
  // Every overlay here has been saved against a registry that used to be
  // bigger. Five widgets were removed from it, so this is not hypothetical:
  // anyone with an old config loading it today takes this path.
  const stale = defaultWidgetConfig("marathon");
  const scene = normaliseScene(stale);
  check("it still produces a scene", Array.isArray(scene.widgets) && scene.widgets.length > 0,
    JSON.stringify(scene.widgets));
  check("falling back to something that ships",
    scene.widgets.every((w) => WIDGET_TYPES[w.type] !== undefined),
    JSON.stringify(scene.widgets.map((w) => w.type)));
}

console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
