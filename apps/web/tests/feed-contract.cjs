/**
 * From what the backend sends to what the jar adds up.
 *
 * Two contracts meet in this file, and both were wrong in ways nothing could see
 * from inside a widget:
 *
 * - A gift's `diamonds` is the total for the whole send. `sources/tiktok.py`
 *   sends `diamond_count * repeat_count`; the trigger endpoint now agrees. The
 *   jar used to multiply by `count` as well, so the two disagreed about what the
 *   number meant — and while `count` was not being forwarded the result happened
 *   to be right for live gifts and wrong for triggered ones, which is the worst
 *   kind of wrong: it looks correct until it does not.
 * - A hook donation arrives as an alert carrying `amount`. The backend forwards
 *   it and `FROM_WIRE` dropped it, so the number crossed the wire and was thrown
 *   away before the jar could read it. Every webhook donation was worth zero.
 *
 * Every payload below is built the way the producer builds it. Where the
 * producer is Python the arithmetic is copied across verbatim and the number it
 * produces is stated in the test, so a change on the other side has something to
 * disagree with.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/feed-contract");
const { FROM_WIRE } = require(path.join(OUT, "lib", "feed-wire.js"));
// The jar's own arithmetic, imported rather than copied. An earlier version of
// this file carried a copy of `valueOf`, mutated both the same way, and passed —
// which is the whole reason this line exists.
const { jarValue } = require(path.join(OUT, "lib", "widgets", "jar-value.js"));

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

/** The jar's own weights, so the test reads its arithmetic and not a likeness. */
const W = { gift: 1, like: 0.05, follow: 25, share: 15, donation: 1 };

/** What sources/tiktok.py puts on the wire for a gift. */
function tiktokGift({ diamonds, repeats }) {
  return { giftName: "Rose", count: repeats, diamonds: null, value: diamonds * repeats };
}

/** What the trigger endpoint puts on the wire, after the fix. */
function triggeredGift({ diamonds, repeats }) {
  return { giftName: "Lion", count: repeats, diamonds: diamonds * repeats, value: diamonds * repeats };
}

console.log("a plain gift is worth its diamonds");
{
  const wire = tiktokGift({ diamonds: 50, repeats: 1 });
  const entry = FROM_WIRE.gift(wire);
  check("the wire total is 50", wire.value === 50, `got ${wire.value}`);
  check("the entry carries 50", entry.meta.diamonds === 50, `got ${entry.meta.diamonds}`);
  check("the jar adds 50", jarValue(entry, "gift", W) === 50, `got ${jarValue(entry, "gift", W)}`);
}

console.log("a repeated gift is worth the run, not one of it");
{
  // The case in the report: five diamonds, sent three times.
  const wire = tiktokGift({ diamonds: 5, repeats: 3 });
  const entry = FROM_WIRE.gift(wire);
  check("the wire total is 15", wire.value === 15, `got ${wire.value}`);
  check("the entry carries 15", entry.meta.diamonds === 15, `got ${entry.meta.diamonds}`);
  check("the jar adds 15, not 45", jarValue(entry, "gift", W) === 15, `got ${jarValue(entry, "gift", W)}`);
  check("the label still says it was three", entry.value === "Rose x3", `got ${entry.value}`);
}

console.log("a big repeated gift stays exact");
{
  const wire = tiktokGift({ diamonds: 1000, repeats: 10 });
  const entry = FROM_WIRE.gift(wire);
  check("the wire total is 10000", wire.value === 10000, `got ${wire.value}`);
  check("the jar adds 10000", jarValue(entry, "gift", W) === 10000, `got ${jarValue(entry, "gift", W)}`);
}

console.log("a triggered gift is worth what a live one would be");
// The inconsistency: the trigger used to send the per-unit figure, so a
// Stream Deck gift of five sent three times was worth five while a real one was
// worth fifteen.
{
  const live = FROM_WIRE.gift(tiktokGift({ diamonds: 5, repeats: 3 }));
  const trig = FROM_WIRE.gift(triggeredGift({ diamonds: 5, repeats: 3 }));
  check("both arrive as 15", live.meta.diamonds === 15 && trig.meta.diamonds === 15,
    `live ${live.meta.diamonds}, triggered ${trig.meta.diamonds}`);
  check("and the jar treats them the same", jarValue(live, "gift", W) === jarValue(trig, "gift", W),
    `${jarValue(live, "gift", W)} vs ${jarValue(trig, "gift", W)}`);
}

console.log("a count on a gift does not multiply a total that is already total");
// The wire does not send `count` for a gift today, so the jar's old
// multiplication was dead code that happened to give the right answer. Dead code
// with a right answer is worse than a bug: the day anything forwards `count`, the
// total doubles with nothing to show for it. This entry is the shape the wire
// would send if it did, and the answer must not move.
{
  const entry = { kind: "gift", user: "u", userId: "u", value: "Rose x3", meta: { diamonds: 15, count: 3 } };
  check("a total with a count beside it stays 15", jarValue(entry, "gift", W) === 15,
    `got ${jarValue(entry, "gift", W)}`);
  check("and a total with no count is 15 too", jarValue({ ...entry, meta: { diamonds: 15 } }, "gift", W) === 15);
  check("a per-unit figure is not silently multiplied up either",
    jarValue({ ...entry, meta: { diamonds: 5, count: 3 } }, "gift", W) === 5,
    `got ${jarValue({ ...entry, meta: { diamonds: 5, count: 3 } }, "gift", W)}`);
}

console.log("a like run is several likes, and is not money");
{
  const entry = FROM_WIRE.like({ user: "u", userId: "u", count: 10, totalLikes: 40 });
  check("the entry says x10", entry.value === "x10", `got ${entry.value}`);
  check("the count survives", entry.meta.count === 10, `got ${entry.meta.count}`);
  check("the jar adds ten likes", jarValue(entry, "like", W) === 10, `got ${jarValue(entry, "like", W)}`);
}

console.log("a like count that is not a number does not become one");
{
  for (const bad of [0, -3, undefined, null, "abc", {}]) {
    const entry = FROM_WIRE.like({ user: "u", userId: "u", count: bad, totalLikes: 1 });
    check(`${JSON.stringify(bad)} falls back to one`, jarValue(entry, "like", W) === 1,
      `got ${jarValue(entry, "like", W)}`);
  }
}

console.log("a webhook donation survives normalisation");
{
  // What main.py puts on the wire for POST /api/hooks with an amount.
  const entry = FROM_WIRE.alert({ user: "anon", userId: "", text: "50000", title: "Donation", icon: "★", amount: 50000 });
  check("the amount is kept", entry.meta.amount === 50000, `got ${entry.meta.amount}`);
  check("and is a number", typeof entry.meta.amount === "number");
  check("the jar adds it", jarValue(entry, "donation", W) === 50000, `got ${jarValue(entry, "donation", W)}`);
}

console.log("a fractional donation is kept as a fraction");
{
  const entry = FROM_WIRE.alert({ text: "12.5", amount: 12.5 });
  check("the amount is kept", entry.meta.amount === 12.5, `got ${entry.meta.amount}`);
  check("the jar adds it", jarValue(entry, "donation", W) === 12.5, `got ${jarValue(entry, "donation", W)}`);
}

console.log("an alert with no usable amount contributes nothing");
// An ordinary editor test from the trigger panel has no amount and must not tip
// the pot, so the field is left out rather than set to a zero the jar has to
// recognise.
{
  for (const bad of [undefined, null, "", 0, -5, "abc", {}, NaN, Infinity]) {
    const entry = FROM_WIRE.alert({ text: "hello", amount: bad });
    check(`${JSON.stringify(bad) ?? "undefined"} is not counted`, jarValue(entry, "donation", W) === 0,
      `got ${jarValue(entry, "donation", W)}`);
  }
}

console.log("a numeric string is still a number");
// A webhook written in shell or a spreadsheet posts "50000" as text more often
// than anyone would like, and it is unambiguous.
{
  const entry = FROM_WIRE.alert({ text: "50000", amount: "50000" });
  check("a numeric string is accepted", entry.meta.amount === 50000, `got ${entry.meta.amount}`);
}

console.log("the alert keeps the fields it always had");
{
  const entry = FROM_WIRE.alert({ user: "d", userId: "d", text: "hi", title: "T", icon: "!", amount: 10 });
  check("title", entry.meta.title === "T");
  check("icon", entry.meta.icon === "!");
  check("text", entry.value === "hi");
  check("user", entry.user === "d");
  check("kind", entry.kind === "alert");
}

console.log();
assert.equal(typeof FROM_WIRE, "object");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
