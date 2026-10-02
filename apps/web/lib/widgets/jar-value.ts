/**
 * What one event is worth to the donation jar.
 *
 * Its own module so the arithmetic can be tested against real payloads without a
 * React renderer. A copy of this function inside a test proves nothing: when the
 * jar multiplied a gift by its repeat count, the test that was supposed to catch
 * it carried a copy of the same mistake and agreed with it.
 *
 * The contract with the backend, which is the thing worth stating plainly:
 *
 * - `meta.diamonds` on a gift is the *total* for the whole send. Five diamonds
 *   sent three times arrives as fifteen, from both producers.
 * - `meta.count` on a like is how many likes the run stood for. It is a count in
 *   its own right, not a multiplier on money — reading it as one is what made a
 *   gift total get counted twice.
 * - `meta.amount` on an alert is a webhook donation, present only when there was
 *   a real one.
 */

import { num } from "./style";
import type { Entry } from "./types";

export type Source = "gift" | "like" | "follow" | "share" | "donation";

/** What one of each event is worth by default, in jar units. */
export const DEFAULT_WEIGHTS: Record<Source, number> = {
  gift: 1,
  like: 0.05,
  follow: 25,
  share: 15,
  donation: 1,
};

export function jarValue(e: Entry, source: Source): number {
  switch (source) {
    case "gift": {
      // A gift's worth is its diamonds, and `diamonds` is already the total for
      // the whole send — five diamonds sent three times arrives as fifteen, from
      // both producers: `sources/tiktok.py` and the trigger endpoint agree on
      // that now. Multiplying by `count` as well was the double count, and it
      // was live in the opposite direction: the trigger used to send the
      // per-unit figure, so a triggered gift was worth a third of a real one.
      //
      // `count` is deliberately not read here. It is a repeat count for a
      // label, not a multiplier on money, and the two being confused is what
      // made the number a guess.
      return num(e.meta, "diamonds", 0);
    }
    case "like":
      return Math.max(1, num(e.meta, "count", 1));
    case "follow":
    case "share":
      return 1;
    case "donation":
      return num(e.meta, "amount", 0);
    default:
      return 0;
  }
}
