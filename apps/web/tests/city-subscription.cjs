/**
 * What the city is actually subscribed to, tested through the filter it goes
 * through in production.
 *
 * The city stayed at "KAMPUNG 0" in a live room with hundreds watching, and the
 * feature's own tests were green. They were green because they call
 * `engine.handle()` directly, and the widget never does that: the feed buffer is
 * filtered by `selectKinds` on the way in, so a kind the widget did not list is
 * removed before the engine exists. A harness that skips the filter cannot see
 * this class of bug at all.
 *
 * So these cases take a real wire payload, run it through `FROM_WIRE`, filter it
 * exactly as the widget does, and only then hand it to the engine. Five bugs in
 * this repo have now come from a test using a path the product does not take.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/feed-contract");
const { FROM_WIRE } = require(path.join(OUT, "lib", "feed-wire.js"));
const { selectKinds } = require(path.join(OUT, "lib", "widgets", "select.js"));

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

/** The kinds the city widget asks for, read from its own source. */
function cityKinds() {
  const src = require("node:fs").readFileSync(
    path.resolve(__dirname, "../lib/widgets/city/widget.tsx"),
    "utf8",
  );
  const m = src.match(/kinds:\s*\[([^\]]*)\]/);
  if (!m) throw new Error("city/widget.tsx no longer declares kinds");
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

const KINDS = cityKinds();

console.log("the city listens for the room's size");
{
  check("viewers is in the city's kinds", KINDS.includes("viewers"), `got ${JSON.stringify(KINDS)}`);
}

console.log("a viewers frame survives the filter");
{
  // What sources/tiktok.py sends on every heartbeat.
  const entry = FROM_WIRE.viewers({ count: 231, total_user: 231 });
  const kept = selectKinds([entry], KINDS);
  check("the entry normalises", entry.kind === "viewers", `got ${entry.kind}`);
  check("and the count arrives in meta", Number(entry.meta.count) === 231, `got ${entry.meta.count}`);
  check("the filter keeps it", kept.length === 1, `kept ${kept.length} of 1`);
  check("with the number intact", Number(kept[0]?.meta.count) === 231, `got ${kept[0] && kept[0].meta.count}`);
}

console.log("every kind the engine needs in production is delivered");
{
  // A kind the engine branches on but does not subscribe to is code that can
  // never run, which is exactly how the city sat at zero in a full room.
  const needed = ["viewers", "comment", "like", "follow", "share", "gift", "join"];
  for (const kind of needed) {
    check(`${kind} is delivered`, KINDS.includes(kind), `missing from ${JSON.stringify(KINDS)}`);
  }
}

console.log("alerts are left out on purpose");
{
  // `alert` carries the editor's "this person left" test button, and it also
  // carries webhook donations. Subscribing the city to it would make every
  // donation spawn a resident walking around the street, so the trade is
  // deliberate: the city drives residents from joins and the idle timer, and the
  // editor's leave button is a simulator affordance rather than a live one.
  check("alert is not subscribed", !KINDS.includes("alert"), `got ${JSON.stringify(KINDS)}`);
  check("and the donation jar is the widget that does take them",
    /donation[\w.]*\.(tsx|ts)/.test(require("node:fs").readFileSync(
      path.resolve(__dirname, "../lib/widgets/registry.ts"), "utf8")) ||
    require("node:fs").existsSync(path.resolve(__dirname, "../lib/widgets/donationjar.tsx")),
    "the registry should carry a widget that listens for alerts");
}

console.log("the filter drops nothing the city needs");
{
  const payloads = {
    viewers: { count: 42, total_user: 42 },
    comment: { user: "a", userId: "a", text: "halo" },
    like: { user: "a", userId: "a", count: 10, totalLikes: 40 },
    follow: { user: "a", userId: "a" },
    share: { user: "a", userId: "a", count: 2 },
    gift: { user: "a", userId: "a", giftName: "Lion", count: 1, value: 500 },
    join: { user: "a", userId: "a", viewers: 3 },
  };
  for (const [kind, payload] of Object.entries(payloads)) {
    const entry = FROM_WIRE[kind](payload);
    const kept = selectKinds([entry], KINDS);
    check(`${kind} arrives`, kept.length === 1, `filtered out`);
  }
}

console.log("an empty kinds list is not a silent success");
{
  // `selectKinds` returns nothing for an empty list rather than everything, which
  // is the safe direction but would leave the city frozen with no error.
  check("no kinds means nothing", selectKinds([FROM_WIRE.viewers({ count: 5 })], []).length === 0);
}

console.log();
assert.equal(typeof selectKinds, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}