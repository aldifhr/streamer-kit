import { clamp } from "./sprites";

/**
 * The pixel city — the effect queue.
 *
 * Big gifts used to fire everything at once. A run of them stacked rockets on
 * rockets, confetti on confetti, and the road filled with parade vehicles until
 * none of it could be read: the point of a celebration is seeing it happen, and
 * a hundred of them landing in the same second is a still frame.
 *
 * So the large effects are staged. A gift that clears the bar goes on the queue
 * and waits its turn; one effect runs at a time, for as long as it takes to
 * actually be seen. The small ones — a single rose, a like — are not staged,
 * because the whole point of them is that they are immediate.
 *
 * The queue is bounded. Past that, further gifts are counted and reported rather
 * than silently vanishing, so the editor can show the overflow instead of the
 * scene quietly lying about how much attention it received.
 */


export type StagedKind = "party" | "plane" | "parade" | "bazaar" | "fire" | "storm";

/** How long each effect holds the stage, in ms. */
const DURATION: Record<StagedKind, number> = {
  party: 9000,
  plane: 8000,
  parade: 11000,
  bazaar: 12000,
  fire: 10000,
  storm: 6000,
};

export interface Staged {
  kind: StagedKind;
  /** The viewer it is for, for the banner text. */
  by: string;
  amount: number;
  started: number;
  until: number;
}

export interface StagingOptions {
  /** How many may be waiting. Beyond this they are refused and counted. */
  max: number;
  run: (effect: Staged) => void;
  /** Called when an effect is refused, so the overflow is visible somewhere. */
  onRefused?: (kind: StagedKind, total: number) => void;
}

export interface Staging {
  /** Queues an effect, or refuses it if the queue is full. */
  push: (kind: StagedKind, by: string, amount: number, now: number) => boolean;
  /** Starts whichever effect is next, and reports when the active one ends. */
  update: (now: number) => void;
  active: () => Staged | null;
  waiting: () => number;
  /** Effects refused since the last reset, for the editor's inspector. */
  refused: () => number;
  reset: () => void;
}

/**
 * What a gift is worth, in stage terms.
 *
 * Below the bar nothing is staged: coins and a jump, right now. At or above it
 * the gift becomes a scene event, and the queue decides when it happens.
 */
export function stagedKindFor(diamonds: number, planeAt: number, partyAt: number): StagedKind | null {
  if (diamonds >= partyAt) return "party";
  if (diamonds >= planeAt) return "parade";
  return null;
}

export function createStaging(opts: StagingOptions): Staging {
  const queue: Staged[] = [];
  let current: Staged | null = null;
  let refusedTotal = 0;

  return {
    push(kind, by, amount, now) {
      if (queue.length >= opts.max) {
        refusedTotal += amount;
        opts.onRefused?.(kind, refusedTotal);
        return false;
      }
      queue.push({ kind, by, amount, started: now, until: now + DURATION[kind] });
      return true;
    },
    update(now) {
      // An effect is only replaced by a finished one. A gift arriving during a
      // party must not cut the party short, which is the whole reason the
      // ending is a time and not an arrival.
      if (current) {
        if (now < current.until) return;
        current = null;
      }
      const next = queue.shift();
      if (!next) return;
      next.started = now;
      next.until = now + DURATION[next.kind];
      current = next;
      opts.run(next);
    },
    active: () => current,
    waiting: () => queue.length,
    refused: () => refusedTotal,
    reset() {
      queue.length = 0;
      current = null;
      refusedTotal = 0;
    },
  };
}

/**
 * 0 to 1 through an effect, for anything that animates with it.
 *
 * Returns 0 rather than a negative for an effect that has not started, because
 * callers multiply by it and a negative would run the fireworks backwards.
 */
export function stagedProgress(effect: Staged | null, now: number): number {
  if (!effect) return 0;
  return clamp((now - effect.started) / Math.max(1, effect.until - effect.started), 0, 1);
}
