/**
 * How much city there is, derived from how many people are watching.
 *
 * The number behind this is real: the TikTok source sends the live room's own
 * viewer count on every heartbeat, and until now the city ignored it entirely.
 * `KOTA 16` on the HUD was never sixteen viewers — it was how many residents
 * happened to be drawn, which drifts from the audience badly in both directions.
 * A busy room showed a quiet street, and a room that emptied kept its full cast
 * until they timed out.
 *
 * So the city is sized by the room. Two rules make that watchable rather than
 * distracting:
 *
 * - It eases toward the real count instead of snapping, so a room oscillating
 *   around a boundary does not flicker between two skylines.
 * - Growth is expressed as a fraction of one fully-drawn skyline that is revealed
 *   rather than redrawn. The backdrop is baked once at full height and uncovered
 *   from the top, which is what lets the skyline grow continuously without
 *   rebaking layers on every heartbeat.
 *
 * A falling count shrinks the city too. That is the honest direction: the room
 * emptying should be visible, not hidden behind residents who have not timed out.
 */

export interface AudienceTier {
  /** Name shown on the HUD when the city reaches this tier. */
  name: string;
  /** Viewer count at which this tier starts. */
  from: number;
}

export const AUDIENCE_TIERS: AudienceTier[] = [
  { name: "KAMPUNG", from: 0 },
  { name: "KELURAHAN", from: 10 },
  { name: "KECAMATAN", from: 50 },
  { name: "KOTA", from: 200 },
  { name: "METROPOLIS", from: 500 },
];

/** What this tier is called, and which one it is. */
export function audienceTier(count: number): { index: number; name: string; from: number } {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  let index = 0;
  for (let i = 0; i < AUDIENCE_TIERS.length; i += 1) {
    if (n >= AUDIENCE_TIERS[i].from) index = i;
  }
  return { index, name: AUDIENCE_TIERS[index].name, from: AUDIENCE_TIERS[index].from };
}

/**
 * How far past a boundary the audience has to move before the city changes.
 *
 * Found by running the live overlay with `?debug=1` and reading its own log: a
 * room sitting on the KAMPUNG/KELURAHAN boundary produced 9, 10, 11, 10, 9, 11
 * in a few seconds, and the tier log read KAMPUNG → KELURAHAN → KAMPUNG. Every
 * crossing re-lays the whole street — new buildings, every resident repositioned,
 * every vehicle dropped — so a room that wobbled by one viewer rebuilt the city
 * several times a minute. Two reports that looked unrelated had one cause.
 *
 * The margin is small on purpose. Large enough that ordinary movement around a
 * threshold does not count, small enough that a room genuinely emptying still
 * reaches the right tier within a few viewers.
 */
export const TIER_HYSTERESIS = 3;

/**
 * The tier to actually use, given the one in force and the audience now.
 *
 * Kept separate from `audienceTier` on purpose: that one answers "what does this
 * number mean on its own", which is what the header and the log want. This
 * answers "should the city change", which is a different question and needs to
 * know where it started.
 */
export function settledTier(currentIndex: number, count: number): number {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  const here = Math.max(0, Math.min(currentIndex, AUDIENCE_TIERS.length - 1));

  // Up first: one crossing per call, so a jump past several tiers walks up
  // rather than teleporting, and the log gets a line for each step.
  const up = AUDIENCE_TIERS[here + 1];
  if (up && n >= up.from + TIER_HYSTERESIS) return here + 1;

  // Down only once the audience is below this tier's own floor, by the margin.
  // Dropping straight to the tier the number implies would defeat the point.
  //
  // Walked with a loop, not by recursing into this function: a recursive step
  // has to re-add the margin to preserve the test, and that margin then blocks
  // the next step down as well, so the walk stopped one tier short every time
  // and a room that emptied settled at KELURAHAN instead of KAMPUNG.
  let down = here;
  while (down > 0 && n < AUDIENCE_TIERS[down].from - TIER_HYSTERESIS) {
    down -= 1;
  }
  return down;
}

/** The next tier's threshold, or null at the top. */
export function nextThreshold(count: number): number | null {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  for (const t of AUDIENCE_TIERS) {
    if (t.from > n) return t.from;
  }
  return null;
}

/**
 * How much of the skyline to show, from 0 to 1.
 *
 * Grows quickly out of a small room, because the first arrivals are the whole
 * point of a live, then flattens so a room of four thousand is not twice the
 * city of four hundred. A square-root curve: loud when it is nearly empty,
 * calm when it is busy.
 */
export function audienceGrowth(count: number): number {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  // 1000 viewers is treated as a full skyline.
  return Math.min(1, Math.sqrt(n / 1000));
}

/**
 * Ease the shown value toward the real one.
 *
 * Rises quickly so the city visibly fills when a room fills, and falls slowly so
 * one quiet heartbeat does not empty a street that was busy a second ago.
 */
export function easeAudience(shown: number, target: number, dtSeconds: number): number {
  // Seconds, because that is what the engine's frame delta already is — passing
  // milliseconds here made the city take an hour to notice a full room, which
  // looked like the feature simply not working.
  const dt = Math.max(0, Math.min(0.05, dtSeconds));
  const rising = target > shown;
  // Per second, so the result does not depend on the frame rate.
  const rate = rising ? 0.35 : 0.12;
  const next = shown + (target - shown) * Math.min(1, rate * dt);
  return Math.abs(next - target) < 0.5 ? target : next;
}

/** `KOTA 16` becomes `MENYAPA 231`, with both numbers kept honest. */
export function formatAudience(shownCount: number, residentCount: number): string {
  const tier = audienceTier(shownCount);
  return `${tier.name} ${Math.round(shownCount)}  ${residentCount} WARGA`;
}