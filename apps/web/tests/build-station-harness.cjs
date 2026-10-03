/**
 * The station harness.
 *
 * The Node tests cover the state machine; they cannot tell you the platform
 * looks like a station. This bundles the same compiled modules into a page and
 * drives them with a synthetic feed, so the drawing can actually be looked at
 * and measured rather than assumed.
 *
 * The module list is the point. The shim resolves relative ids from it, and a
 * module missing here throws on first `require` — which presents as a blank
 * canvas, exactly like a real one. That is how `audience` was missed once.
 */

const fs = require("fs");
const path = require("path");

const CACHE = path.join(__dirname, "../../../node_modules/.cache/stream-kit/station");
const OUT = path.join(__dirname, "../../../node_modules/.cache/stream-kit/station-harness.html");

/**
 * `id` is the string a module actually asks `require` for.
 *
 * It is not a friendly name: the compiled output says `../city/sprites`, and
 * registering it under `sprites` produces `module not bundled` at load time --
 * which shows up as a blank canvas and nothing else.
 */
const MODULES = [
  // The city's own modules require each other as "./font", "./sprites" and so
  // on, while the station's require them as "../city/sprites". Both spellings
  // have to resolve, so each module is registered under every id that asks for
  // it rather than the one that reads best here.
  { name: "lib/widgets/city/font", ids: ["../city/font", "./font"] },
  { name: "lib/widgets/city/sprites", ids: ["../city/sprites", "./sprites"] },
  { name: "lib/widgets/city/scenery", ids: ["../city/scenery", "./scenery"] },
  { name: "lib/widgets/city/audience", ids: ["../city/audience", "./audience"] },
  { name: "lib/widgets/station/config", ids: ["./config"] },
  { name: "lib/widgets/station/scene", ids: ["./scene"] },
  { name: "lib/widgets/station/train", ids: ["./train"] },
  { name: "lib/widgets/station/engine", ids: ["./engine"] },
];

const missing = MODULES.filter((m) => !fs.existsSync(path.join(CACHE, m.name + ".js")));
if (missing.length) {
  console.error(
    "missing compiled modules: " +
      missing.map((m) => m.name).join(", ") +
      "\nrun `npm run test:station` first",
  );
  process.exit(1);
}

/**
 * Module bodies are spliced in, not interpolated.
 *
 * The compiled output contains template literals of its own, and a `${` or a
 * backtick inside the outer template literal ends the builder's string and
 * emits a syntax error that points at the wrapper rather than at the module.
 * A placeholder has no such problem.
 */
const parts = MODULES.map((m) => {
  const src = fs.readFileSync(path.join(CACHE, m.name + ".js"), "utf8");
  // Concatenation, not a template literal: `src` is file content and may itself
  // contain backticks and `${`, which would terminate this string and emit a
  // syntax error pointing at the wrapper instead of at the module.
  const body = "function (module, exports, require) {\n" + src + "\n});";
  return m.ids.map((id) => "__def(" + JSON.stringify(id) + ", " + body).join("\n");
}).join("\n");

const bundle = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>station harness</title>
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
<div id="frame"><canvas id="c"></canvas></div>
<div id="bar">loading</div>
<script>
// The registry has to exist before the module bodies run. Emitting the modules
// first -- the more natural order to write -- throws on the first __def call and
// leaves a blank canvas with no message. Note the plain text: this comment sits
// inside the template literal below, and a backtick here closes it.
var __cache = {};
var __mods = {};
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
__PARTS__
</script>
<script>
function harnessFail(bar, e) {
  var msg = e && e.stack ? String(e.stack).split(String.fromCharCode(10)).slice(0, 3).join(" | ") : String(e);
  bar.innerHTML = '<b style="color:#ff7a7a">harness failed</b> ' + msg;
  console.error("harness failed", e);
}
window.addEventListener("error", function (ev) { harnessFail(document.getElementById("bar"), ev.error || ev.message); });
(function () {
 try {
  var q0 = new URLSearchParams(location.search);
  var cv = document.getElementById("c");
  var bar = document.getElementById("bar");
  var engine = require("./engine").createStationEngine(document, cv, {
    demo: false,
    dayLen: 600,
    stationName: q0.get("name") || "STASIUN KOTA",
    destinations: q0.get("dest") || "PURWOKERTO, BANDUNG, JAKARTA, YOGYAKARTA, SURABAYA, CIREBON, SEMARANG",
  });
  var q = new URLSearchParams(location.search);
  engine.resize(cv.clientWidth, cv.clientHeight);
  engine.start();

  // A fake room size, so the effect of the audience can be looked at without a
  // live stream. The viewers query parameter puts N people in the room.
  var fakeViewers = q.get("viewers");
  if (fakeViewers !== null) {
    var seqV = 0;
    setInterval(function () {
      engine.handle({ id: "v" + seqV++, seq: 0, ts: Date.now(), kind: "viewers", user: "", userId: "", value: "", meta: { count: +fakeViewers } });
    }, 400);
  }

  var NAMES = ["BUDI", "SARI", "DIMAS", "RINA", "ANDI", "PUTRI", "FAJAR", "NADIA", "YOGA", "MAYA", "RIZKY", "INTAN"];
  var seq = 0;
  function feed(kind, i, value, meta) {
    return {
      id: kind + "-" + i + "-" + seq, seq: seq++, ts: Date.now(),
      kind: kind, user: NAMES[i % NAMES.length], userId: NAMES[i % NAMES.length].toLowerCase() + (i % NAMES.length),
      value: value || "", meta: meta || {},
    };
  }

  // A bus of viewers so the platform is never empty in the shot.
  var joined = 0;
  function pushJoins(n) {
    for (var i = 0; i < n; i++) engine.handle(feed("join", joined++, null, {}));
  }
  pushJoins(+q.get("people") || 14);

  // Some activity, so xp, ranks, gifts and emotes are all visible.
  engine.handle(feed("comment", 2, "HALO STASIUN", {}));
  engine.handle(feed("gift", 3, "", { diamonds: 40, giftName: "ROSE" }));
  engine.handle(feed("like", 4, "", { count: 10 }));
  engine.handle(feed("follow", 5, "", {}));
  engine.handle(feed("share", 6, "", {}));
  engine.handle(feed("share", 6, "", {}));
  engine.handle(feed("share", 6, "", {}));
  if (q.get("people") !== "0") pushJoins(4);

  var ui = setInterval(function () {
    engine.handle(feed("like", seq % 9, "", { count: 8 }));
    engine.handle(feed("comment", seq % 7, "SEMANGAT", {}));
  }, 900);

  function paint() {
    var s = engine.snapshot();
    bar.innerHTML =
      "<b>" + s.trainPhase + "</b> open " + s.trainOpen + " doors " + s.doors +
      " &nbsp;|&nbsp; on platform <b>" + s.onPlatform + "</b> queued " + (s.states.queued || 0) +
      " &nbsp;|&nbsp; room " + s.audienceShown + " " + s.tier + " cars " + s.cars +
      " ambient " + s.ambient + " real " + s.real + " friends " + (s.friends || 0) + " dest " + (s.dest || "-") + " name " + (s.name || "-") +
      " &nbsp;|&nbsp; passers " + s.passers + " sprites " + s.sprites + " 💎 " + s.diamonds +
      " &nbsp;|&nbsp; " + s.LW + "x" + s.LH;
  }
  setInterval(paint, 250);
  paint();
  window.__station = engine;
  window.__stopHarness = function () { clearInterval(ui); };
 } catch (e) { harnessFail(document.getElementById("bar"), e); }
})();
</script>
</body>
</html>`;

fs.writeFileSync(OUT, bundle.replace("__PARTS__", () => parts));
console.log("wrote " + OUT);
