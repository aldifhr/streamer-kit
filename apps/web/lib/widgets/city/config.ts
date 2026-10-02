/**
 * The pixel city.
 *
 * A port of the standalone overlay the streamer wrote as one HTML file. It was
 * built for its own canvas, its own WebSocket and its own event shape, none of
 * which exist here, so the shape of the port is deliberate:
 *
 * - The city, the people, the vehicles and the sky are all engine state on a
 *   loop the engine owns. React mounts a canvas and hands it entries; it does not
 *   re-render per frame. See `widget.tsx` for why that matters.
 * - The wall clock follows what `carry` has accumulated, for the same reason the
 *   astronaut scene does: stepping by the gap since the last frame that ran makes
 *   a display that cannot hold the budget run the whole city in slow motion.
 * - Effects have ceilings. The original grew `coins`, `hearts`, `confetti` and
 *   `sparks` without limit and had no age limit on anything except coins, so a
 *   busy room buried the city under sprites and dropped frames. Every kind here
 *   has both.
 * - The dissolve is used for entering and leaving, not `globalAlpha`, because a
 *   per-pixel Bayer threshold is what this scene looks like. Easing the exit in
 *   rather than out is what made the original blink: the sprite sat at nearly
 *   full opacity for the whole exit and then was gone in one frame.
 */

import type { Entry } from "../types";

export interface CityConfig {
  /** Residents on screen at once. */
  maxPeople: number;
  /** Seconds of silence before someone heads home. */
  leaveAfterMs: number;
  /** Seconds for one full day/night cycle. */
  dayLen: number;
  /** Pin the clock instead of cycling it. */
  fixedTime: number | null;
  rankXP: number[];
  labelTop: number;
  labelActiveMs: number;
  badWords: string[];
  /** Backing-store divisor. 0 derives one from the frame. */
  pixelSize: number;
  /** Skip the city, sky and road; draw only the residents. */
  transparent: boolean;
  showHud: boolean;
  showLabels: boolean;
  /** Name shown in the corner, empty for none. */
  cityName: string;
  partyGift: number;
  planeGift: number;
  storeKey: string;
}

export const DEFAULT_CITY_CONFIG: CityConfig = {
  maxPeople: 45,
  leaveAfterMs: 300e3,
  dayLen: 300,
  fixedTime: null,
  rankXP: [0, 20, 80],
  labelTop: 5,
  labelActiveMs: 10e3,
  badWords: ["anjing", "bangsat", "kontol", "memek", "asu", "fuck", "shit"],
  pixelSize: 0,
  transparent: false,
  showHud: true,
  showLabels: true,
  cityName: "",
  partyGift: 500,
  planeGift: 100,
  storeKey: "city_pixel_v1",
};

export const CITY_RANKS = ["WARGA", "JUARA", "SULTAN"];

/** Resident roster size, and the effect counts, for tests and the editor. */
export interface CityEngine {
  handle: (entry: Entry) => void;
  resize: (w: number, h: number) => void;
  configure: (config: Partial<CityConfig>) => void;
  /** Residents on screen, including ones mid-dissolve. */
  residentCount: () => number;
  /** Live effect counts, per kind. Their sum is the scene's per-frame cost. */
  effectCounts: () => { coins: number; hearts: number; confetti: number; sparks: number };
  /** Total simulated seconds stepped against the wall clock it was given. */
  timeAccount: () => { simulated: number; wall: number };
  /** Resident counts keyed by stable user id, for the editor's inspector. */
  residents: () => { id: string; name: string; rank: number; xp: number }[];
  reset: () => void;
  destroy: () => void;
}

export interface CityEntry {
  kind: Entry["kind"];
  user: string;
  userId: string;
  text: string;
  value: string;
  meta: Entry["meta"];
}
