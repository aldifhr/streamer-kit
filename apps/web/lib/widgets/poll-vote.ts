/**
 * Whether this browser has already voted, and what it picked.
 *
 * Pulled out of the component because the bug it prevents was not a rendering
 * mistake but a contract one, and a contract is only worth anything if it is
 * testable. `apps/api/polls.py` shapes a poll as id, question, options, closed
 * and updatedAt — there is no `mine`. The widget declared one, typed as
 * `string | null`, and then asked `poll.mine !== null`. Against `undefined` that
 * is true, so the buttons were disabled from the first paint and a viewer could
 * not vote at all: the widget was gated on a field the server does not send.
 *
 * The rule now lives here, where the absent field is normalised once instead of
 * at each of the three places that used to read it.
 */

/** The parts of a poll payload this decision depends on. */
export interface PollVoteState {
  id: string;
  options: { label: string; votes: number }[];
  closed: boolean;
  /**
   * Which option this viewer chose, if the backend ever says.
   *
   * Optional on purpose: today it never does, and typing it as required is what
   * let `undefined` through to a `!== null` comparison.
   */
  mine?: string | null;
}

export interface VotedState {
  /** True once this browser has voted, or the poll is closed to new votes. */
  voted: boolean;
  /** The backend's answer, normalised so absent means "no answer". */
  mine: string | null;
  /** Whether results should be shown. */
  reveal: boolean;
  /** Index of the option this browser picked, or -1. */
  chosenIndex: number;
}

/**
 * Reads the vote state out of a poll payload and the browser's own record.
 *
 * `choice` is what this browser sent and got back. It is per-browser by nature:
 * the vote endpoint is a GET so that OBS, which cannot present a session, can
 * still reach it — which means there is nowhere on the server to remember who
 * voted. That limits this to stopping a second click in the same browser, and it
 * is worth being honest about that rather than implying one vote per viewer.
 */
export function votedState(
  poll: PollVoteState,
  choice: string | null,
  showResults: boolean,
): VotedState {
  // The one line the whole bug turned on: `undefined` has to become `null` here,
  // before anything compares it.
  const mine = poll.mine ?? null;
  const voted = choice !== null || mine !== null;

  const index = choice !== null ? Number(choice) : Number(mine);
  const chosenIndex = Number.isInteger(index) && index >= 0 && index < poll.options.length ? index : -1;

  return {
    voted,
    mine,
    // A closed poll shows its result whether or not this browser voted: the
    // question is settled, and hiding the answer from people who happened to
    // arrive late helps nobody.
    reveal: showResults && (poll.closed || voted),
    chosenIndex,
  };
}
