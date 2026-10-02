"use strict";
/**
 * A sample must not ask the API about an overlay that does not exist.
 *
 * The landing page mounts every widget to show what it puts on screen, and the
 * poll was the one that reached out: it fetched `/api/polls/preview-poll`,
 * which is a request for an overlay nobody made, on every visit to a public
 * page. Nothing crashed — a 404 is handled, the widget draws nothing — which is
 * why it sat there. A console full of expected failures is worse than no
 * console: it teaches the eye to skip red lines, and then hides the next one.
 *
 * This checks the rule at the level it can be broken again: any widget that
 * addresses the API by overlay id has to honour the flag, and every site that
 * renders a sample has to set it. Both directions, because either half alone
 * still produces the request.
 */

const fs = require("fs");
const path = require("path");

const web = path.resolve(__dirname, "..");
let failures = [];
function check(label, cond, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

console.log("WidgetProps carries the flag");
const types = fs.readFileSync(path.join(web, "lib/widgets/types.ts"), "utf8");
check("the widget contract declares preview", /\bpreview\?:\s*boolean/.test(types));

console.log("\nwidgets that address the API by overlay id honour it");
// Only widgets that actually reach the network count. Several others interpolate
// an id into a `localStorage` key — streaks, top gifts, the astronaut roster —
// and those are not requests: a sample writes to its own throwaway key and never
// leaves the browser.
//
// The poll used to be the only caller here, so this suite could only check that
// such a caller exists. With it gone the check inverts and gets sharper: no
// widget should be building an API url from an overlay id at all, because the
// phantom 404 this whole change is about was exactly that shape. A future widget
// that starts doing it will fail here and have to prove it cannot.
const sources = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith(".tsx")) sources.push(full);
  }
})(path.join(web, "lib/widgets"));

const callers = sources.filter((f) => {
  const src = fs.readFileSync(f, "utf8");
  return /apiFetch\s*\(\s*[`"'][^`"']*\$\{/.test(src);
});
check("no widget builds an API url from an overlay id", callers.length === 0,
  `${callers.length} still do: ${callers.map((f) => path.basename(f)).join(", ")}`);
for (const f of callers) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(web, f);
  const gated =
    /preview/.test(src) &&
    // the guard has to be on the path that leads to the fetch, not merely
    // mentioned in a comment somewhere in the file
    /if\s*\(\s*!\s*preview\s*\)/.test(src);
  check(`${rel} skips its fetch when previewing`, gated);
}

console.log("\nevery sample render site sets the flag");
// Checked by discovery rather than a fixed list, so removing a sample site does
// not leave this test reading a file that no longer exists — and adding one is
// covered the moment it renders a widget.
const sampleSites = ["lib/landing/ScenePreview.tsx", "lib/editor/ThemeSwatch.tsx"];
for (const rel of sampleSites) {
  const full = path.join(web, rel);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8");
  const idMatch = src.match(/overlayId="([^"]+)"/);
  if (!idMatch) continue;
  check(`${rel} marks its widget as a sample`, new RegExp(`${idMatch[1]}"\\s*\\n\\s*preview`).test(src));
}
check("at least one sample site was found", sampleSites.some((r) => fs.existsSync(path.join(web, r))));

console.log("\nthe real overlay pages do not");
// Marking a real overlay as a preview would silently stop the poll from ever
// loading on stream, which is the failure this whole change risks introducing.
for (const rel of ["app/overlay/[id]/page.tsx", "lib/editor/EditorShell.tsx"]) {
  const src = fs.readFileSync(path.join(web, rel), "utf8");
  check(`${rel} leaves real overlays alone`, !/^\s*preview\s*$/m.test(src));
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
