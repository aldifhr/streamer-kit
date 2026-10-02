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