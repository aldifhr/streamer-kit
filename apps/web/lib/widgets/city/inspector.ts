/**
 * Why the city looks the way it does.
 *
 * A viewer watching the overlay cannot tell a city that is being ignored from a
 * city that is working. Both look identical: the number sits still. That is the
 * whole problem this log exists for — the case that prompted it was a live room
 * with hundreds of watchers rendering a village, and nothing on screen or in the
 * socket log said why.
 *
 * So a line is written where a decision is made, not where a thing happens, and
 * it carries the reason as well as the event. "joined" says nothing. "joined,
 * and pushed budi-1 out because the street was full" is the line that makes the
 * next five minutes make sense.
 *
 * It is a bounded ring: a busy room produces a line per event, and a log that
 * grows without limit is its own kind of slowdown.
 */

export type NoteKind =
  | "audience"
  | "tier"
  | "join"
  | "leave"
  | "refused"
  | "gift"
  | "mission"
  | "mayor"
  | "weather"
  | "event";

export interface Note {
  /** Milliseconds since the engine started. */
  at: number;
  kind: NoteKind;
  text: string;
}

export interface CityInspector {
  push(kind: NoteKind, text: string, at: number): void;
  notes(): Note[];
  clear(): void;
  /** Counts by kind, for a one-line summary of what the room did. */
  tally(): Record<string, number>;
  size(): number;
}

export const MAX_NOTES = 120;

export function createInspector(max = MAX_NOTES): CityInspector {
  // A ring rather than an array that is trimmed: trimming shifts every element,
  // and this is called on the event path where that would show up as jitter.
  const buf: Note[] = new Array(max);
  let head = 0;
  let len = 0;
  const counts: Record<string, number> = {};

  return {
    push(kind, text, at) {
      buf[head] = { at, kind, text };
      head = (head + 1) % max;
      if (len < max) len += 1;
      counts[kind] = (counts[kind] ?? 0) + 1;
    },
    notes() {
      // Oldest first, which is how a person reads a log.
      const out: Note[] = new Array(len);
      const start = (head - len + max) % max;
      for (let i = 0; i < len; i += 1) out[i] = buf[(start + i) % max];
      return out;
    },
    clear() {
      head = 0;
      len = 0;
      for (const k of Object.keys(counts)) delete counts[k];
    },
    tally() {
      return { ...counts };
    },
    size() {
      return len;
    },
  };
}

/** `1 jam 2 menit` style stamp, so gaps in the log are readable at a glance. */
export function formatAge(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}j ${m % 60}m`;
}