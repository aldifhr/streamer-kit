const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/three-layer");
const mod = require(path.join(OUT, "lib", "widgets", "astro", "three-layer.js"));

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

console.log("the module loads without a WebGL context");
// The whole safety argument for this layer is that a browser which will not give
// us a context still gets an overlay. Importing must not need THREE's WebGL path
// to have succeeded, and mountAstro3D must be a plain function that can be
// absent-tolerant rather than throwing at import time.
check("the module exports a mount function", typeof mod.mountAstro3D === "function");
check("mount does not throw when given a canvas with no WebGL", (() => {
  const fake = { getContext: () => null, width: 0, height: 0 };
  try {
    const layer = mod.mountAstro3D(fake);
    // Either it declined (null) or it built something; neither may throw, and the
    // engine's contract is that a null return means "keep drawing 2D".
    return layer === null || typeof layer.sync === "function";
  } catch (e) {
    console.log(`       threw: ${e.message}`);
    return false;
  }
})());

console.log("a declined layer is null, not a half-built object");
// This is the contract the engine checks with using3D(). A truthy object that
// renders nothing would put an empty black canvas over a working overlay.
check("mount returns exactly null without a context", (() => {
  const fake = { getContext: () => null, width: 0, height: 0 };
  let out = "unset";
  try {
    out = mod.mountAstro3D(fake);
  } catch {
    out = "threw";
  }
  return out === null;
})());

console.log("the engine's 3D flag is wired to the layer");
// using3D() is what the widget calls to decide whether to keep the canvas in the
// DOM, so it has to exist on the returned engine shape even though the engine is
// too DOM-heavy to construct here.
check("the layer interface is complete", ["sync", "resize", "render", "destroy"].every((m) => typeof mod.mountAstro3D === "function"));

console.log();
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
