"use strict";
/**
 * Asserts the invariant the landing page depends on: every widget in the
 * registry has a non-empty, unique id.
 *
 * React reports a missing key and a duplicated key with different messages,
 * and "Each child in a list should have a unique key prop" is the *missing*
 * one — so a widget whose `id` came out undefined would look exactly like this
 * and be easy to misread as a duplicate.
 *
 * The registry pulls in every widget module, so react and the jsx runtime are
 * stubbed: only the component bodies are never called here.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");

// outDir root. The compiled tree mirrors apps/web, so "@/lib/css" lands at
// OUT/lib/css and the registry at OUT/lib/widgets/registry.js.
const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/registry");

if (!fs.existsSync(path.join(OUT, "lib", "widgets", "registry.js"))) {
  console.error(`not compiled: ${path.join(OUT, "lib", "widgets", "registry.js")}`);
  console.error("run: npm run test:registry");
  process.exit(1);
}

// tsc does not rewrite the "@/..." alias into the emitted requires.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    request = path.join(OUT, request.slice(2));
  }
  return origResolve.call(this, request, ...rest);
};

const reactStub = {
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: () => [null, () => {}],
  useCallback: (fn) => fn,
  forwardRef: (fn) => fn,
};
const jsxStub = new Proxy({}, { get: () => () => null });

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "react") return reactStub;
  if (request.startsWith("react/")) return jsxStub;
  return origLoad.call(this, request, ...rest);
};

const registry = require(path.join(OUT, "lib", "widgets", "registry.js"));

let failures = 0;
const fail = (msg) => {
  console.log(`  FAIL ${msg}`);
  failures++;
};

const list = registry.WIDGET_LIST;
const types = registry.WIDGET_TYPES;
console.log(`WIDGET_LIST = ${list.length}, WIDGET_TYPES = ${Object.keys(types).length}`);

if (list.length !== Object.keys(types).length) {
  fail(`list and type map disagree: ${list.length} vs ${Object.keys(types).length}`);
}

const seen = new Set();
for (const [i, w] of list.entries()) {
  const id = w.id;
  if (id === undefined) fail(`[${i}] ${w.label ?? "(no label)"} — id is undefined`);
  else if (typeof id !== "string") fail(`[${i}] ${w.label} — id is ${typeof id}, not a string`);
  else if (!id.length) fail(`[${i}] ${w.label} — id is empty`);
  else if (seen.has(id)) fail(`[${i}] duplicate id "${id}"`);
  else {
    seen.add(id);
    if (!types[id]) fail(`[${i}] "${id}" is not a key in WIDGET_TYPES`);
    else console.log(`  ok   ${id}`);
  }
}

console.log();
if (failures) {
  console.log(`${failures} problem(s)`);
  process.exit(1);
}
console.log("every widget has a unique, present id");
