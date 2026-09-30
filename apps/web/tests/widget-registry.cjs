"use strict";
/**
 * Asserts the invariants the landing page depends on.
 *
 * Two kinds, and the second is the one that bit us.
 *
 * 1. Every widget in the registry has a non-empty, unique id, and the label,
 *    icon and blurb the widget grid renders. These are cheap and obvious, and
 *    their absence is still worth catching: `label` doubles as the human name in
 *    every failure message below, so a missing one makes the report useless.
 *
 * 2. The module that renders the grid is a client module. This is the one that
 *    shipped thirteen blank cards.
 *
 *    app/page.tsx is a server component, and every widget module is "use
 *    client". A server component importing WIDGET_LIST does not get the widget
 *    objects — it gets client-reference proxies, one per entry. The array keeps
 *    its length, so the heading still said 13, and every field on every entry
 *    read undefined: no icon, no name, no blurb, no "full frame" badge even for
 *    the one widget that sets it. No throw, no warning, and the type check was
 *    clean because the proxy satisfies WidgetType just as well as the real thing
 *    satisfies it at compile time.
 *
 *    `require` below cannot see any of that. Node has no client boundary, so it
 *    gets the real objects however the grid is written, and check 1 passes
 *    against a page that is rendering nothing at all. The invariant has to be
 *    asserted where the boundary is, which means reading the file.
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

  // The three fields the landing page's widget grid renders, and the badge.
  // A widget missing any of them still passes the id check above and still
  // draws an empty card.
  for (const field of ["label", "icon", "blurb"]) {
    const value = w[field];
    if (typeof value !== "string" || !value.trim()) {
      fail(`[${i}] "${w.id ?? "(no id)"}" — ${field} is ${value === undefined ? "undefined" : JSON.stringify(value)}`);
    }
  }
}

console.log("the widget grid reads the registry from a client module");
/**
 * The boundary check. `require` sees the real objects either way, so the only
 * place this can fail is the source of the component that does the reading.
 *
 * A server component is not automatically wrong here — one that only passes a
 * widget through to a client child would be fine. What is not fine is one that
 * reads these fields itself, which is what leaves them undefined at runtime
 * with no error anywhere. So this is a coarse check, and it is deliberately so:
 * it fails loudly and points at the file to look at, rather than passing
 * silently on a page that renders nothing.
 */
const GRID = path.join(__dirname, "../lib/landing/WidgetGrid.tsx");
if (!fs.existsSync(GRID)) {
  fail("lib/landing/WidgetGrid.tsx is gone — re-point this check at whatever renders the widget grid");
} else {
  const grid = fs.readFileSync(GRID, "utf8");
  if (!/^\s*["']use client["']/.test(grid)) {
    fail('lib/landing/WidgetGrid.tsx is not "use client" — a server component gets client-reference proxies and the grid renders blank');
  }
  if (!/\bWIDGET_LIST\b/.test(grid)) {
    fail("lib/landing/WidgetGrid.tsx no longer reads WIDGET_LIST — the grid is no longer driven by the registry");
  }
  if (!grid.includes("w.icon") || !grid.includes("w.label") || !grid.includes("w.blurb")) {
    fail("lib/landing/WidgetGrid.tsx stopped rendering icon/label/blurb — check the grid still shows each widget");
  }
  if (!grid.includes("w.fill")) {
    fail("lib/landing/WidgetGrid.tsx stopped reading w.fill — full-frame widgets lose their badge");
  }
}

console.log();
if (failures) {
  console.log(`${failures} problem(s)`);
  process.exit(1);
}
console.log("every widget has a unique, present id");
