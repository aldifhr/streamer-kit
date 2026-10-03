/**
 * The pixel station — configuration and the rules for reading it.
 *
 * Separate from the renderer because this is where a wrong value becomes an
 * invisible behaviour. The city already paid this bill once: every numeric
 * editor field is unset by being blank, and `Number("")` is 0 rather than NaN,
 * so `leave-after` arrived as 0, every resident cleared the idle timer on the
 * next frame, and the street was a queue of people blinking.
 */

export const DESTINATION_DEFAULTS = "PURWOKERTO, BANDUNG, JAKARTA, YOGYAKARTA, SURABAYA, CIREBON, SEMARANG";

/**
 * Destinations, cleaned.
 *
 * The bitmap font has no lowercase and the board is 62 pixels wide, so a long
 * name has to be cut rather than allowed to run off the sign. Empty entries and
 * duplicates go: a board listing "JAKARTA, , JAKARTA" looks broken.
 */
export function destinationsFrom(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const v = part.trim().toUpperCase();
    if (v && out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

/** Falls back to the defaults when a station is left with nowhere to go. */
export const destinationsOr = (raw: string | undefined): string[] => {
  const list = destinationsFrom(raw);
  return list.length ? list : destinationsFrom(DESTINATION_DEFAULTS);
};

export interface StationConfig {
  /** How many passengers the platform will hold before one is sent home. */
  maxPeople: number;
  /** Seconds a passenger can go quiet before they head for the train. */
  leaveAfter: number;
  /** Seconds one day lasts. */
  dayLen: number;
  /** Pinned time of day, 0..1. Unset runs the clock. */
  pinnedHour: number | null;
  /** Seconds a train waits with its doors open, before people hold it up. */
  dwell: number;
  /** Seconds between trains when nobody is waiting. */
  trainGapMin: number;
  trainGapMax: number;
  /** Diamonds at which a gold express runs past. */
  expressGift: number;
  /** Diamonds at which the station throws a party. */
  partyGift: number;
  /** 0 leaves it to the source size. */
  pixelSize: number;
  /** How many high-xp passengers get a name tag. */
  labelTop: number;
  /** Seconds a name tag stays up after anything happens. */
  labelActive: number;
  /** Lowercased, comma separated. */
  badWords: string;
  /**
   * What the hanging sign says.
   *
   * It used to be the literal string "STASIUN KOTA", which meant every station
   * in every stream was called the same thing. The city has had a name field
   * all along; the station not having one was an omission, not a decision.
   */
  stationName: string;
  /**
   * Where the trains go, comma separated.
   *
   * A station whose every service goes to the same seven cities is not a
   * station, it is a list.
   */
  destinations: string;
  /** Draws people arriving and leaving instead of running empty. */
  demo: boolean;
}

export const DEFAULT_STATION_CONFIG: StationConfig = {
  maxPeople: 30,
  leaveAfter: 300,
  dayLen: 300,
  pinnedHour: null,
  dwell: 14,
  trainGapMin: 16,
  trainGapMax: 30,
  expressGift: 100,
  partyGift: 500,
  pixelSize: 0,
  labelTop: 5,
  labelActive: 10,
  badWords: "",
  stationName: "STASIUN KOTA",
  destinations: DESTINATION_DEFAULTS,
  demo: false,
};

/**
 * The smallest platform worth drawing.
 *
 * The reference overlay hardcodes 45. Exposing the number is useful and also
 * makes the station configurable into uselessness: capped at 3, it admits three
 * people and turns every arrival after that into a departure, so the feed
 * scrolls past dozens while three stand there. Nobody does that on purpose, it
 * just saves low once.
 */
const MIN_PEOPLE = 8;
const MAX_PEOPLE = 45;

/**
 * A number the editor can actually produce.
 *
 * `Number.isFinite` on the raw value is not enough, because `Number("")`,
 * `Number(null)` and `Number(false)` are all 0. Every numeric field is unset by
 * being blank, so this is the guard that keeps a blank field meaning "leave it
 * alone" rather than "set it to zero".
 */
function num(v: unknown, fallback: number, min: number, max: number): number {
  if (v === null || v === undefined || v === true || v === false) return fallback;
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "on" || s === "1") return true;
    if (s === "false" || s === "off" || s === "0") return false;
  }
  return fallback;
}

export function toStationConfig(
  style: Record<string, string | number | boolean | undefined>,
): Partial<StationConfig> {
  const d = DEFAULT_STATION_CONFIG;
  const out: Partial<StationConfig> = {};

  const people = num(style["max-people"], d.maxPeople, MIN_PEOPLE, MAX_PEOPLE);
  if (people !== d.maxPeople) out.maxPeople = Math.round(people);

  const leave = num(style["leave-after"], d.leaveAfter, 30, 3600);
  if (leave !== d.leaveAfter) out.leaveAfter = leave;

  const dayLen = num(style["day-len"], d.dayLen, 30, 3600);
  if (dayLen !== d.dayLen) out.dayLen = dayLen;

  // Only the toggle freezes the clock.
  //
  // It was reading the hour field on its own as well, and that field is never
  // absent: the widget ships `pinned-hour: 0.3` in its defaults, so every scene
  // carries it whether anyone has touched the slider. The result was a station
  // permanently parked at 13:12 with the toggle off, the hour slider live and
  // doing nothing, and the day-length slider dead too.
  if (style["freeze-clock"] === true || style["freeze-clock"] === "true" || style["freeze-clock"] === "on") {
    out.pinnedHour = num(style["pinned-hour"], 0.3, 0, 0.99);
  }

  const dwell = num(style.dwell, d.dwell, 4, 60);
  if (dwell !== d.dwell) out.dwell = dwell;

  const gapMin = num(style["train-gap"], d.trainGapMin, 5, 300);
  if (gapMin !== d.trainGapMin) {
    out.trainGapMin = gapMin;
    out.trainGapMax = Math.max(gapMin, num(style["train-gap"], d.trainGapMax, 5, 300));
  }

  const express = num(style["express-gift"], d.expressGift, 1, 100000);
  if (express !== d.expressGift) out.expressGift = express;

  const party = num(style["party-gift"], d.partyGift, express, 1000000);
  if (party !== d.partyGift) out.partyGift = party;

  const px = num(style["pixel-size"], d.pixelSize, 0, 12);
  if (px !== d.pixelSize) out.pixelSize = Math.round(px);

  const labels = num(style["label-top"], d.labelTop, 0, 20);
  if (labels !== d.labelTop) out.labelTop = Math.round(labels);

  const labelActive = num(style["label-active"], d.labelActive, 1, 120);
  if (labelActive !== d.labelActive) out.labelActive = labelActive;

  if (typeof style["bad-words"] === "string" && style["bad-words"] !== d.badWords) {
    out.badWords = style["bad-words"];
  }
  // The font is upper-case only, so the name is folded here rather than at draw
  // time: two places doing it is how one of them ends up missing.
  if (typeof style["station-name"] === "string") {
    const nm = style["station-name"].trim().toUpperCase();
    if (nm !== d.stationName) out.stationName = nm || d.stationName;
  }
  if (typeof style.destinations === "string" && style.destinations !== d.destinations) {
    out.destinations = style.destinations;
  }
  if (style.demo !== undefined) {
    const demo = bool(style.demo, d.demo);
    if (demo !== d.demo) out.demo = demo;
  }
  return out;
}

export const RANKS = ["PENUMPANG", "LANGGANAN", "SULTAN"] as const;

/** xp thresholds, matching the city's ranks so a passenger carries over. */
export const RANK_XP = [0, 20, 80];
