#!/usr/bin/env node
"use strict";
/**
 * Bundles the compiled city engine into a single self-executing script and
 * writes a harness page that mounts it.
 *
 * The point is a real pixel check. Every other test in this repo asserts that
 * draw calls were made; none of them can say whether the picture that comes out
 * is a city or a black rectangle, and that is the failure mode a port of a
 * drawn scene actually has. This produces a page that draws the real engine on
 * a real canvas with synthetic events, so it can be looked at.
 *
 * The engine compiles to CommonJS with relative requires between its own four
 * modules and nothing outside them, so the bundle is a four-line module shim
 * around the real output. Nothing is rewritten, which is the part that matters:
 * what runs here is byte-for-byte what ships.
 */

const fs = require("fs");
const path = require("path");

const CACHE = process.argv[2] || path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/city/lib/widgets/city");
// Outside the repo on purpose: this is a build artefact, and it must never be
// a file git could pick up.
const OUT = process.argv[3] || "/root/.hermes/cache/scratch/city-harness.html";

const MODULES = ["config", "font", "sprites", "scenery", "engine"];

function moduleSource(name) {
  const file = path.join(CACHE, `${name}.js`);
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${file} — run \`npm run test:city\` first so tsc emits it`);
  }
  return fs.readFileSync(file, "utf8");
}

const parts = MODULES.map(
  (name) => `__def(${JSON.stringify(`./${name}`)}, function (module, exports, require) {\n${moduleSource(name)}\n});`,
).join("\n");

const bundle = `(function () {
"use strict";
var __mods = {};
var __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function require(id) {
  if (__cache[id]) return __cache[id].exports;
  var fn = __mods[id];
  if (!fn) throw new Error("module not bundled: " + id);
  var m = { exports: {} };
  __cache[id] = m;
  fn(m, m.exports, require);
  return m.exports;
}
${parts}
window.__createCityEngine = require("./engine").createCityEngine;
})();`;

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>city harness</title>
<style>
  html, body { margin: 0; height: 100%; background: #101018; }
  body { display: flex; flex-direction: column; }
  #frame { position: relative; flex: 1; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
  #bar { background: #1b1b24; color: #cfd0dc; font: 12px ui-monospace, monospace; padding: 6px 10px; }
  #bar b { color: #ffe08a; }
</style>
</head>
<body>
<div id="bar">booting…</div>
<div id="frame"><canvas id="c"></canvas></div>
<script>
${bundle}
</script>
<script>
(function () {
  var canvas = document.getElementById("c");
  var bar = document.getElementById("bar");
  var engine = window.__createCityEngine({
    canvas: canvas,
    config: { maxPeople: 45, cityName: "JAKARTA", dayLen: 300, fixedTime: 0.32 },
  });
  engine.resize(window.innerWidth, window.innerHeight);

  var seq = 0;
  function ev(kind, user, userId, value, meta) {
    seq += 1;
    return { id: kind + "-" + seq, seq: seq, ts: Date.now(), kind: kind, user: user,
             userId: userId, value: value || "", meta: meta || {} };
  }
  var names = [["BUDI","budi-1"],["SARI","sari-2"],["DIMAS","dimas-3"],["RINA","rina-4"],
               ["ANDI","andi-5"],["PUTRI","putri-6"],["FAJAR","fajar-7"],["NADIA","nadia-8"],
               ["YOGA","yoga-9"],["MAYA","maya-10"],["RIZKY","rizky-11"],["INTAN","intan-12"]];
  names.forEach(function (n) { engine.handle(ev("join", n[0], n[1])); });
  setTimeout(function () {
    engine.handle(ev("comment", "SARI", "sari-2", "kota ini keren banget"));
    engine.handle(ev("comment", "DIMAS", "dimas-3", "first time here"));
    engine.handle(ev("like", "RINA", "rina-4", "12"));
    engine.handle(ev("follow", "FAJAR", "fajar-7"));
    engine.handle(ev("share", "NADIA", "nadia-8"));
    engine.handle(ev("gift", "BUDI", "budi-1", "Rose", { giftName: "Rose", diamonds: 9, count: 3 }));
  }, 1400);
  setTimeout(function () {
    engine.handle(ev("gift", "MAYA", "maya-10", "Galaxy", { giftName: "Galaxy", diamonds: 220, count: 1 }));
  }, 3200);

  setInterval(function () {
    var c = engine.effectCounts();
    var t = engine.timeAccount();
    bar.innerHTML = "residents <b>" + engine.residentCount() + "</b>  sprites <b>" +
      (c.coins + c.hearts + c.confetti + c.sparks) + "</b>  sim <b>" +
      Math.round((t.simulated / t.wall) * 100) + "%</b> of wall clock";
  }, 250);
  window.__engine = engine;
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page);
console.log(OUT);
