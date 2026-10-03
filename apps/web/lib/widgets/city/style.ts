/**
 * The pixel city — reading the editor's style fields.
 *
 * Separate from the widget because this is where a wrong value becomes an
 * invisible behaviour: a blank number used to arrive as a zero, and a zero
 * leave timer is not a number nobody noticed, it is the whole city blinking.
 * It is here so it can be tested without a renderer.
 */

import { DEFAULT_CITY_CONFIG } from "./config";
import type { CityConfig } from "./config";

/**
 * The smallest room worth calling a city.
 *
 * The reference overlay simply hardcodes 45 and there is no setting to get
 * wrong. Exposing `max-people` is useful, and it also makes the city
 * configurable into uselessness: a room capped at 5 admits five people and
 * turns every other arrival into a swap, so the street holds a handful while
 * the feed scrolls past dozens. Nobody breaks it deliberately, it just saves
 * low once. The floor is what makes the setting safe to keep.
 */
const MIN_PEOPLE = 16;

/**
 * `?debug=1` on the overlay turns the decision log on, whatever the scene says.
 *
 * The flag in the style map alone was not enough, and that was the whole point:
 * the log is what you reach for when the city is wrong, and reaching for it
 * required a live broadcast change to save first. The scene's own setting still
 * applies — this only ever turns it on.
 */
function debugAskedFor(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

export function toConfig(style: Record<string, string | number | boolean | undefined>): Partial<CityConfig> {
  /**
   * Reads a numeric style, falling back when the field is not actually a number.
   *
   * `Number.isFinite` on the raw value is not enough, because `Number("")`,
   * `Number(null)` and `Number(false)` are all 0 rather than NaN. Every numeric
   * field in the editor is unset by being blank, so a blank one arrived as a
   * zero: `leave-after` became 0, every resident cleared the idle timer on the
   * very next frame, and the city was a queue of people appearing and leaving
   * in the same instant.
   */
  const n = (k: string, d: number) => {
    const v = style[k];
    if (v === undefined || v === null || v === "") return d;
    const num = Number(v);
    return Number.isFinite(num) ? num : d;
  };
  const b = (k: string, d: boolean) => (style[k] === undefined ? d : Boolean(style[k]));
  return {
    maxPeople: Math.max(
      MIN_PEOPLE,
      Math.min(DEFAULT_CITY_CONFIG.maxPeople, n("max-people", DEFAULT_CITY_CONFIG.maxPeople)),
    ),
    leaveAfterMs: n("leave-after", 300) * 1000,
    dayLen: n("day-len", DEFAULT_CITY_CONFIG.dayLen),
    // A toggle rather than a number, because midnight is a legitimate hour to
    // pin and `0` used to mean both "midnight" and "not pinned": every city came
    // up locked at 00:00 and the day cycle never ran.
    fixedTime: b("pin-hour", false) ? n("pinned-hour", 0.3) : null,
    rankXP: [0, 20, 80],
    labelTop: n("label-top", DEFAULT_CITY_CONFIG.labelTop),
    labelActiveMs: n("label-active", 10) * 1000,
    badWords: String(style["bad-words"] ?? DEFAULT_CITY_CONFIG.badWords.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pixelSize: n("pixel-size", 0),
    transparent: b("transparent", false),
    showHud: b("show-hud", true),
    // Off unless asked for: this one draws text down the side of the overlay, and
    // an overlay that quietly grew a debug panel would be showing it to every
    // viewer on the stream.
    debug: b("debug", false) || debugAskedFor(),
    showLabels: b("show-labels", true),
    cityName: String(style["city-name"] ?? ""),
    partyGift: n("party-gift", 500),
    planeGift: n("plane-gift", 100),
    storeKey: "city_pixel_v1",
  };
}
