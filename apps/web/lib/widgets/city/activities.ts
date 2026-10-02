/**
 * The pixel city — what residents do when they are not walking.
 *
 * Without this the city is a crowd walking past each other, and nothing ever
 * happens between two people. These are the small behaviours that make a street
 * look inhabited: two of them stop and say hello, somebody sits down, somebody
 * buys something from a shop, somebody is looking at their phone.
 *
 * Each one is a destination plus a duration, not a scripted sequence. A resident
 * picks a bench, walks to it, sits for a while, and goes back to walking. The
 * reason it is data rather than behaviour is that it has to compose with the
 * other three states — someone caught in the rain abandons their errand and runs
 * for the bus stop, and picks it back up afterwards if the shower lets up.
 */

import { rand } from "./sprites";

export type Activity = "none" | "goto" | "sit" | "eat" | "phone" | "shelter";

export interface Spot {
  /** Where to stand. */
  x: number;
  y: number;
  /** How many can use it at once. */
  room: number;
}

export interface ActivitiesOptions {
  /** Benches, bus shelters and shopfronts, resolved lazily because the layout is rebuilt on resize. */
  spots: () => { bench: Spot[]; shop: Spot[]; shelter: Spot[] };
  /** How close two residents must be to notice each other. */
  greetRange: () => number;
  /** Extra spot kinds the engine can offer, resolved lazily. */
  extraSpots?: () => { bench: Spot[]; shop: Spot[]; shelter: Spot[] };
}

/**
 * The slice of a resident this module needs.
 *
 * Structural rather than the engine's own type, so this stays testable without
 * the engine and cannot drift into depending on the whole roster.
 */
export interface Resident {
  id: string;
  x: number;
  y: number;
  state: string;
  activity: Activity;
  /** Seconds left in the current activity. */
  actT: number;
  /** Where the activity takes them, or null. */
  spot: Spot | null;
  partnerId: string | null;
}

export function createActivities(opts: ActivitiesOptions) {
  return {
    /**
     * Chooses something to do, weighted towards doing nothing.
     *
     * The weights matter: at one errand per resident every street looked like a
     * queue. A city where most people are walking and a few are sitting is a
     * city, and the few are what the eye goes to.
     */
    choose(): Activity {
      const s = opts.spots();
      const roll = rand(0, 1);
      if (s.bench.length > 0 && roll < 0.18) return "sit";
      if (s.shop.length > 0 && roll < 0.3) return "eat";
      if (roll < 0.55) return "phone";
      return "none";
    },

    /** Picks the spot for an activity, or null when there is nowhere to go. */
    spotFor(activity: Activity, taken: Set<Spot>): Spot | null {
      const s = opts.spots();
      const pool = activity === "sit" ? s.bench : activity === "eat" ? s.shop : [];
      const free = pool.filter((p) => !taken.has(p));
      if (free.length === 0) return null;
      return free[Math.floor(rand(0, free.length))];
    },

    /** The nearest bus shelter, for someone caught in the rain. */
    shelter(r: Resident): Spot | null {
      const s = opts.spots();
      if (s.shelter.length === 0) return null;
      let best = s.shelter[0];
      let bd = Infinity;
      for (const p of s.shelter) {
        const d = Math.abs(p.x - r.x);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best;
    },

    /**
     * Finds a neighbour to greet.
     *
     * Only another resident who is walking and not already busy, and only within
     * a few pixels: two people greeting across the street is not a greeting.
     */
    partner(r: Resident, all: Iterable<Resident>, busy: Set<string>): string | null {
      const range = opts.greetRange();
      for (const o of all) {
        if (o === r || busy.has(o.id)) continue;
        if (o.activity !== "none" || o.state === "exit") continue;
        if (Math.abs(o.y - r.y) > 4) continue;
        if (Math.hypot(o.x - r.x, o.y - r.y) > range) continue;
        return o.id;
      }
      return null;
    },
  };
}
