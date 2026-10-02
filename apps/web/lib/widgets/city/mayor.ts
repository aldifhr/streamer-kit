/**
 * The pixel city — the mayor.
 *
 * Whoever has given the most this session, in a car with two people walking
 * beside it. Not a trophy for the first gift of the night: a position, so it is
 * worth taking, it can be lost, and the handover has to be visible to the room
 * or it is not a contest.
 */

/** How many walkers flank the car. Two reads as an escort; five reads as a mob. */
export const ESCORT = 2;
/** Below this, the room has not really got a mayor yet. */
export const MIN_DIAMONDS = 100;

export interface Mayor {
  id: string;
  name: string;
  diamonds: number;
  /** When the title arrived, so the banner can say who took it from whom. */
  since: number;
  /** The person they took it from, for one handover banner. */
  from: string | null;
}

export interface MayorOptions {
  now: () => number;
  onChange?: (mayor: Mayor, tookFrom: Mayor | null) => void;
}

export interface MayorState {
  /** Totals for the session. Kept for everyone, not just the leader. */
  totals: Map<string, { name: string; diamonds: number }>;
  who: Mayor | null;
}

export interface Mayorship {
  /** The current mayor, or null while nobody has cleared the bar. */
  current: () => Mayor | null;
  /** Counts a gift. Returns true when the title changed hands. */
  donate: (id: string, name: string, diamonds: number) => boolean;
  state: () => MayorState;
}

export function createMayor(opts: MayorOptions): Mayorship {
  const totals = new Map<string, { name: string; diamonds: number }>();
  let who: Mayor | null = null;

  return {
    current: () => who,

    donate(id, name, diamonds) {
      if (diamonds <= 0) return false;
      const rec = totals.get(id);
      if (rec) rec.diamonds += diamonds;
      else totals.set(id, { name, diamonds });

      const entry = totals.get(id)!;
      // The bar is on the candidate, not on the gap. A mayor leading by one
      // diamond has not won anything, and crowning them hands the title to
      // whoever gives one diamond more a second later.
      if (entry.diamonds < MIN_DIAMONDS) return false;
      if (who && who.id === id) return false;
      // Strictly greater, so two people on the same total cannot ping-pong the
      // title between them on alternating gifts.
      if (who && entry.diamonds <= who.diamonds) return false;

      const previous = who;
      who = { id, name, diamonds: entry.diamonds, since: opts.now(), from: previous ? previous.name : null };
      opts.onChange?.(who, previous);
      return true;
    },

    state: () => ({ totals, who }),
  };
}