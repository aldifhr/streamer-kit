/**
 * Buffer filtering, split out of `feed.ts`.
 *
 * `selectKinds` is a pure function of the buffer, and it lives here rather than
 * in feed.ts because of what the import graph does: feed.ts imports scene.ts,
 * scene.ts imports the widget registry, and the registry imports chat.tsx. So a
 * widget that only wants `selectKinds` ends up pulling in the whole cycle, and
 * the registry's WIDGET_TYPES is read before it finishes initialising — a TDZ
 * ReferenceError ("Cannot access 'd' before initialization") on the landing
 * page, thrown from whichever module happened to be entered first.
 *
 * Nothing in here may import feed.ts, scene.ts, or the registry, or the cycle
 * comes straight back. Keep it leaves: types only.
 */

import type { Entry, EventKind } from "@/lib/widgets/types";

/** The subset of a widget's kinds present in the buffer, newest first. */
export function selectKinds(entries: Entry[], kinds: EventKind[]): Entry[] {
  if (kinds.length === 0) return [];
  const set = new Set(kinds);
  return entries.filter((e) => set.has(e.kind));
}
