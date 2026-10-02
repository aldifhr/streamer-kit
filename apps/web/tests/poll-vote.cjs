/**
 * The rule that decides whether a poll's buttons are live.
 *
 * The bug: `apps/api/polls.py` shapes a poll without a `mine` field, the widget
 * typed one anyway, and then asked `poll.mine !== null`. Against `undefined` that
 * is true, so every button was disabled before anybody voted and the widget —
 * whose entire reason for existing is being voted on — could not be voted on.
 *
 * Every case below is a payload `_shape()` can actually produce, plus the ones
 * it will produce once it starts sending `mine`. Hand-written shapes only mean
 * something if they come from the producer; that has bitten this repo three times
 * now, so where the producer is TypeScript it is imported and compiled rather
 * than imitated.
 */

const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/astro-consume");
const { votedState } = require(path.join(OUT, "lib", "widgets", "poll-vote.js"));

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

/** Exactly what `_shape()` returns: no `mine`. */
const fromBackend = (extra = {}) => ({
  id: "p1",
  question: "What next?",
  options: [
    { label: "Yes", votes: 3 },
    { label: "No", votes: 5 },
  ],
  closed: false,
  ...extra,
});

console.log("a payload without `mine` leaves the buttons live");
// The regression. If this ever fails, the widget is disabled before anyone votes.
{
  const poll = fromBackend();
  check("the payload really has no mine", !("mine" in poll));
  const s = votedState(poll, null, true);
  check("absent mine reads as null", s.mine === null, `got ${JSON.stringify(s.mine)}`);
  check("and nobody has voted", s.voted === false, `got ${s.voted}`);
  check("so the buttons are enabled", s.voted === false);
  check("and the result stays hidden", s.reveal === false, `got ${s.reveal}`);
}

console.log("a recorded local vote closes the poll to this browser");
{
  const s = votedState(fromBackend(), "1", true);
  check("voted", s.voted === true);
  check("the choice is highlighted", s.chosenIndex === 1, `got ${s.chosenIndex}`);
  check("and the result shows", s.reveal === true);
}

console.log("show-results off still hides the numbers");
{
  check("a voted viewer sees no percentages when the style says no",
    votedState(fromBackend(), "0", false).reveal === false);
}

console.log("a closed poll shows its result either way");
{
  check("nobody voted", votedState(fromBackend({ closed: true }), null, true).reveal === true);
  check("somebody voted", votedState(fromBackend({ closed: true }), "2", true).reveal === true);
}

console.log("a backend that does send `mine` is believed");
{
  // Not what `_shape()` does today. When it does, this is what should happen,
  // and `mine` must win over nothing rather than be ignored.
  const s = votedState(fromBackend({ mine: "0" }), null, true);
  check("voted", s.voted === true);
  check("the chosen option is picked up", s.chosenIndex === 0, `got ${s.chosenIndex}`);
  check("an explicit null means no vote", votedState(fromBackend({ mine: null }), null, true).voted === false);
}

console.log("an index the backend made up is not a choice");
{
  check("out of range is ignored", votedState(fromBackend({ mine: "9" }), null, true).chosenIndex === -1,
    `got ${votedState(fromBackend({ mine: "9" }), null, true).chosenIndex}`);
  check("negative is ignored", votedState(fromBackend({ mine: "-1" }), null, true).chosenIndex === -1);
  check("words are ignored", votedState(fromBackend({ mine: "Yes" }), null, true).chosenIndex === -1,
    "a label is not an index");
  check("but a word still counts as a vote", votedState(fromBackend({ mine: "Yes" }), null, true).voted === true);
}

console.log("the old comparison, shown to be wrong");
// What the component used to do, against the payload the backend actually sends.
{
  const oldVoted = (poll) => poll.mine !== null;
  check("old: a backend payload reads as already voted", oldVoted(fromBackend()) === true,
    "which is how the buttons ended up disabled for everyone");
  check("new: the same payload reads as not voted", votedState(fromBackend(), null, true).voted === false);
}

console.log("degenerate payloads do not throw");
{
  const empty = { id: "p", question: "", options: [], closed: false };
  check("no options is not a vote", votedState(empty, null, true).voted === false);
  check("a choice against no options highlights nothing", votedState(empty, "0", true).chosenIndex === -1);
  check("an empty open poll reveals nothing", votedState(empty, null, true).reveal === false);
  check("an empty closed one still counts as settled", votedState({ ...empty, closed: true }, null, true).reveal === true);
}

console.log();
assert.equal(typeof votedState, "function");
if (process.exitCode) {
  console.log("FAILED");
} else {
  console.log(`all passed (${passed} assertions)`);
}
