/**
 * The pixel city engine — part one of three: drawing primitives and sprites.
 *
 * Everything here is layout in a low-resolution backing store. The store is
 * deliberately smaller than the frame and the browser scales it back up, which
 * is what makes the whole thing read as pixel art rather than as small sprites
 * on a sharp background.
 */

/** Bayer 4x4, for the dithered dissolve and the sky gradient. */
export const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export const R = Math.round;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
import { FONT } from "./font";

export const OUT = "#14122e";
export const PLATE = "rgba(10,8,34,.85)";

/**
 * Uppercase, and drop anything the font cannot draw.
 *
 * A missing glyph used to be drawn as a gap in the plate behind it, so a
 * non-latin nickname produced a name plate with a hole in it.
 */
export const sanitize = (s: unknown) =>
  String(s ?? "")
    .toUpperCase()
    .split("")
    .filter((c) => c in FONT)
    .join("");

export const textW = (s: string) => Math.max(0, s.length * 4 - 1);

/** A 32-bit FNV hash, so a viewer keeps the same face between reloads. */
export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** The same hash seeded into a generator, so a look is stable per viewer. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKINS = ["#f6d0b0", "#e8b48a", "#c68a5c", "#9a6a44", "#6e4a30"];
const HAIRS = ["#2a1a12", "#5a3a22", "#a0602a", "#d8b050", "#c8c8d0", "#b03a2a", "#1a1a1a"];
const SHIRTS = ["#e04a4a", "#4a8ae0", "#4ac06a", "#e0b030", "#a050d0", "#e07a30", "#30b0b0", "#e060a0", "#f0f0f0", "#505a70"];
const PANTS = ["#2a3a6a", "#3a3a3a", "#6a4a2a", "#4a5a3a", "#7a7a8a"];

const shadeCache = new Map<string, string>();
export function shade(hex: string, f: number): string {
  const key = hex + f;
  let v = shadeCache.get(key);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = `rgb(${R(((n >> 16) & 255) * f)},${R(((n >> 8) & 255) * f)},${R((n & 255) * f)})`;
    shadeCache.set(key, v);
  }
  return v;
}

export function lighten(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${R(r + (255 - r) * f)},${R(g + (255 - g) * f)},${R(b + (255 - b) * f)})`;
}

export interface Look {
  skin: string;
  hair: string;
  style: number;
  shirt: string;
  pants: string;
  shoe: string;
  bag: boolean;
  bagc: string;
  stripe: boolean;
}

/** A resident's appearance, derived from their id so it survives a reload. */
export function lookFor(key: string): Look {
  const r = mulberry32(hash32(key));
  const pick = (a: string[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    style: Math.floor(r() * 5),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoe: r() < 0.5 ? "#222030" : "#f4f4f4",
    bag: r() < 0.25,
    bagc: pick(SHIRTS),
    stripe: r() < 0.35,
  };
}

/** A box of pixels: x, y, w, h, colour, and whether it skips the outline. */
export type Part = [number, number, number, number, string, boolean?];

export interface Pose {
  kind: "idle" | "walk" | "jump" | "cheer" | "wave" | "dance" | "clap";
  f: number;
  wf: number;
  dy: number;
  dx: number;
}

/**
 * The walk cycle.
 *
 * Two opposing frames rather than four, and the phase comes from time rather than
 * a frame counter: the original advanced a counter per update, so the legs moved
 * in time with the frame rate rather than with the walk. On a display that could
 * not hold the budget the stride slowed down and the residents appeared to
 * wade.
 */
export function poseOf(moving: boolean, t: number, emote: Emote | null, now: number): Pose {
  const pose: Pose = { kind: "idle", f: 0, wf: 0, dy: 0, dx: 0 };
  if (emote && now < emote.until) {
    pose.kind = emote.type;
    if (emote.type === "jump") pose.dy = -R(Math.abs(Math.sin(((now - emote.start) / 1000) * 5)) * 5);
    else if (emote.type === "cheer") pose.dy = -R(Math.abs(Math.sin((now / 1000) * 6)) * 4);
    else if (emote.type === "dance") {
      pose.wf = Math.floor(now / 220) % 2;
      pose.dy = -pose.wf;
      pose.dx = pose.wf ? 1 : -1;
    } else if (emote.type === "wave" || emote.type === "clap") pose.wf = Math.floor(now / 160) % 2;
  } else if (moving) {
    pose.kind = "walk";
    pose.f = R(t * 8) % 4;
    pose.dy = pose.f === 1 || pose.f === 3 ? -1 : 0;
  }
  return pose;
}

export interface Emote {
  type: "jump" | "cheer" | "wave" | "dance" | "clap";
  start: number;
  until: number;
}

/**
 * A resident's body, in pixels.
 *
 * Rank shows rather than being cosmetic: rank 1 adds an eye and rank 2 a crown
 * and a chest stripe, so a regular can see who has been generous without reading
 * a single label.
 */
export function personParts(L: Look, rank: number, pose: Pose): Part[] {
  const A: Part[] = [];
  const add = (x: number, y: number, w: number, h: number, c: string, n?: boolean) => A.push([x, y, w, h, c, n]);
  const shirtD = shade(L.shirt, 0.72), pantsD = shade(L.pants, 0.7);
  const k = pose.kind, f = pose.f, wf = pose.wf;
  // Which of the four leg stances: two apart, two together, then the bent
  // landing pose used by jumps and cheering.
  let nearX = 4, farX = 3;
  let legs: "A" | "B" | "T" | "bent" = "T";
  let arms = 0;
  if (k === "walk") {
    nearX = [5, 4, 2, 4][f];
    farX = [2, 4, 5, 4][f];
    legs = (["A", "T", "B", "T"] as const)[f] as "A" | "B" | "T";
  } else if (k === "jump" || k === "cheer") {
    arms = 2;
    legs = "bent";
  } else if (k === "wave") arms = 1;
  else if (k === "dance") {
    if (wf) { arms = 1; legs = "A"; } else { arms = 3; legs = "B"; }
  } else if (k === "clap") arms = 4;

  if (L.bag) add(1, 7, 2, 4, L.bagc);
  // Far arm.
  if (arms === 2 || arms === 3) {
    add(1, 3, 2, 4, shirtD);
    add(1, 2, 2, 1, L.skin);
  } else {
    add(farX, 7, 2, 3, shirtD);
    add(farX, 10, 2, 1, L.skin);
  }
  // Legs.
  if (legs === "A") {
    add(2, 11, 2, 4, pantsD); add(5, 11, 2, 4, L.pants);
    add(2, 15, 3, 1, L.shoe); add(5, 15, 3, 1, L.shoe);
  } else if (legs === "B") {
    add(5, 11, 2, 4, pantsD); add(2, 11, 2, 4, L.pants);
    add(2, 15, 3, 1, L.shoe); add(5, 15, 3, 1, L.shoe);
  } else if (legs === "T") {
    add(3, 11, 2, 4, pantsD); add(4, 11, 2, 4, L.pants);
    add(3, 15, 4, 1, L.shoe);
  } else {
    add(3, 11, 3, 4, L.pants);
    add(3, 15, 4, 1, L.shoe);
  }
  // Torso.
  add(2, 6, 5, 5, L.shirt);
  if (L.stripe) add(2, 8, 5, 1, shade(L.shirt, 0.8), true);
  if (rank >= 2) add(2, 6, 5, 1, "#ffcd3c", true);
  // Near arm.
  if (arms === 1 || arms === 2) {
    add(6, 3, 2, 4, L.shirt);
    add(6 + wf, 2, 2, 1, L.skin);
  } else if (arms === 4) {
    add(5, 7, 2, 2, L.shirt);
    add(6 - wf, 8, 3, 2, L.skin);
  } else if (arms === 3) {
    add(4, 7, 2, 3, L.shirt);
    add(4, 10, 2, 1, L.skin);
  } else {
    add(nearX, 7, 2, 3, L.shirt);
    add(nearX, 10, 2, 1, L.skin);
  }
  // Head.
  add(2, 1, 5, 5, L.skin);
  const st = L.style;
  if (st === 0) { add(2, 0, 5, 2, L.hair); add(2, 2, 1, 2, L.hair); }
  else if (st === 1) { add(2, 0, 5, 2, L.hair); add(1, 2, 2, 7, L.hair); }
  else if (st === 2) { add(2, 0, 5, 2, L.bagc); add(6, 2, 3, 1, shade(L.bagc, 0.8)); add(2, 2, 1, 2, L.hair); }
  else if (st === 3) { add(1, 0, 6, 2, L.bagc); add(1, 2, 2, 6, L.bagc); add(3, 5, 3, 1, L.bagc); }
  else { add(2, 0, 5, 2, "#1a1a1a"); add(2, 2, 1, 2, L.hair); }
  if (rank >= 1) add(4, 3, 3, 1, "#0a0a12", true);
  else add(5, 3, 1, 1, "#1a1420", true);
  if (rank >= 2) {
    add(2, -1, 5, 1, "#ffcd3c");
    add(2, -2, 1, 1, "#ffcd3c"); add(4, -2, 1, 1, "#ffcd3c");
    add(6, -2, 1, 1, "#ffcd3c");
  }
  return A;
}

export function rankFor(xp: number, rankXP: number[]): number {
  let s = 0;
  rankXP.forEach((m, i) => {
    if (xp >= m) s = i;
  });
  return s;
}

/** Level from XP, on a square root so the early ranks come quickly. */
export const levelFor = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp)));
