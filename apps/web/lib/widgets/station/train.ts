/**
 * Trains: the thing that makes this a station and not a street.
 *
 * A train arrives, opens its doors, waits while people get on and off, closes,
 * and leaves. That waiting is the point — it is what makes a departure a
 * departure rather than a person stepping off the edge of the frame, and it is
 * why `dwell` can be held open while anybody is still boarding.
 */

import { R, clamp, ease, lerp, rand, sanitize, shade, textW } from "../city/sprites";
import { mk, plateOn, txtOn } from "../city/scenery";
import type { Ctx } from "../city/scenery";
import type { Part } from "../city/sprites";
import { CAR_H, CAR_W } from "./scene";
import { DESTINATIONS } from "./config";

export type TrainPhase = "arrive" | "dwell" | "close" | "depart";
export type TrainRole = "mid" | "cabR" | "cabL";

export interface Scheme {
  body: string;
  stripe: string;
  roof: string;
}

export const SCHEMES: Scheme[] = [
  { body: "#d8dce8", stripe: "#e04a4a", roof: "#aab0c4" },
  { body: "#e8e8f0", stripe: "#2a7ad8", roof: "#b0b8cc" },
  { body: "#34528c", stripe: "#f0c030", roof: "#1c3468" },
  { body: "#4a9a6a", stripe: "#ffffff", roof: "#356e4c" },
];

export const EXPRESS_SCHEME: Scheme = { body: "#c83a3a", stripe: "#ffffff", roof: "#8a2a2a" };
export const GOLD_SCHEME: Scheme = { body: "#e8c040", stripe: "#fff0a0", roof: "#b8902a" };

export interface Train {
  dir: 1 | -1;
  n: number;
  len: number;
  scheme: Scheme;
  gold: boolean;
  banner: HTMLCanvasElement | null;
  dest: string;
  phase: TrainPhase;
  t: number;
  startX: number;
  stopX: number;
  x: number;
  /** 0 closed, 1 open. */
  open: number;
  dwellT: number;
  dwellMax: number;
  nextEmerge: number;
  /**
   * When the doors first started being held past their schedule.
   *
   * The hold is a clamp on `dwellT`, and a clamp alone cannot expire: it pulls
   * the counter back below the threshold every frame, so a train with somebody
   * always boarding sat at the platform for as long as the room cared to keep
   * it there, and people accumulated without limit. This is the clock that ends
   * it. Null means not currently held.
   */
  heldSince: number | null;
  doors: { x: number }[];
}

export interface Passer {
  dir: 1 | -1;
  n: number;
  len: number;
  x: number;
  speed: number;
  gold: boolean;
  banner: HTMLCanvasElement | null;
  scheme: Scheme;
  conf: number;
  t: number;
}

/**
 * How long a train will wait past its schedule for stragglers, in ms.
 *
 * Eight seconds is roughly a full crossing of the platform at the walking
 * speed passengers use. Beyond that somebody is stuck, not slow.
 */
export const HOLD_MAX = 8000;

export const carsFor = (LW: number) => clamp(Math.floor((LW * 0.8) / (CAR_W + 2)), 2, 4);
export const trainLen = (n: number) => n * (CAR_W + 2) - 2;

function carParts(role: TrainRole, scm: Scheme, light: string): Part[] {
  const glass = "#bfe6f5";
  const dk = "#22222e";
  const P: Part[] = [];
  const add = (x: number, y: number, w: number, h: number, c: string, n?: boolean) =>
    P.push([x, y, w, h, c, n]);
  add(0, 2, 52, 23, scm.body);
  add(1, 0, 50, 3, scm.roof);
  add(0, 15, 52, 3, scm.stripe, true);
  add(2, 25, 48, 2, "#3a3a46");
  add(3, 26, 13, 2, dk);
  add(36, 26, 13, 2, dk);
  [5, 9, 38, 43].forEach((x) => add(x, 27, 3, 1, "#7a7a8c", true));
  add(2, 5, 6, 8, glass, true);
  add(19, 5, 6, 8, glass, true);
  add(27, 5, 6, 8, glass, true);
  add(10, 4, 7, 19, shade(scm.body, 0.82));
  add(11, 5, 5, 8, glass, true);
  add(35, 4, 7, 19, shade(scm.body, 0.82));
  add(36, 5, 5, 8, glass, true);
  if (role === "mid") {
    add(44, 5, 6, 8, glass, true);
  } else {
    add(44, 3, 8, 22, shade(scm.body, 0.9));
    add(45, 5, 5, 9, "#7ab8d8", true);
    add(51, 19, 1, 3, light, true);
  }
  return P;
}

const carCache = new WeakMap<Document, Map<string, HTMLCanvasElement>>();

function partsCanvas(doc: Document, parts: Part[], w: number, h: number, ox: number, oy: number) {
  const c = mk(w, h, doc);
  const g = c.getContext("2d") as Ctx;
  g.fillStyle = "#14122e";
  parts.forEach((p) => {
    if (!p[5]) g.fillRect(ox + p[0] - 1, oy + p[1] - 1, p[2] + 2, p[3] + 2);
  });
  parts.forEach((p) => {
    g.fillStyle = p[4];
    g.fillRect(ox + p[0], oy + p[1], p[2], p[3]);
  });
  return c;
}

function flipCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const f = mk(src.width, src.height, src.ownerDocument);
  const g = f.getContext("2d") as Ctx;
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return f;
}

export function carCanvas(doc: Document, role: TrainRole, scm: Scheme, light: string): HTMLCanvasElement {
  let perDoc = carCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    carCache.set(doc, perDoc);
  }
  const key = role + scm.body + light;
  const hit = perDoc.get(key);
  if (hit) return hit;
  const made =
    role === "cabL"
      ? flipCanvas(carCanvas(doc, "cabR", scm, light))
      : partsCanvas(doc, carParts(role, scm, light), CAR_W + 2, CAR_H + 2, 1, 1);
  perDoc.set(key, made);
  return made;
}

export function makeBanner(doc: Document, text: string): HTMLCanvasElement {
  const s = sanitize(text).slice(0, 34);
  const w = textW(s) + 10;
  const c = mk(w, 11, doc);
  const g = c.getContext("2d") as Ctx;
  plateOn(g, 0, 0, w, 11, "#14122e");
  g.fillStyle = "#fff4c2";
  g.fillRect(1, 1, w - 2, 9);
  g.fillStyle = "#ffe08a";
  g.fillRect(1, 1, w - 2, 1);
  txtOn(g, s, 5, 3, "#c03030");
  return c;
}

export interface NewTrainOpts {
  gold?: boolean;
  text?: string;
}

export function newTrain(doc: Document, LW: number, dwellMs: number, opts?: NewTrainOpts): Train {
  const o = opts || {};
  const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  const n = carsFor(LW);
  const len = trainLen(n);
  const stop = R(LW / 2 - len / 2);
  const startX = dir > 0 ? -len - 8 : LW + 8;
  return {
    dir,
    n,
    len,
    scheme: o.gold ? GOLD_SCHEME : SCHEMES[Math.floor(Math.random() * SCHEMES.length)],
    gold: !!o.gold,
    banner: o.text ? makeBanner(doc, o.text) : null,
    dest: DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)],
    phase: "arrive",
    t: 0,
    startX,
    stopX: stop,
    x: startX,
    open: 0,
    dwellT: 0,
    dwellMax: o.gold ? 22 : dwellMs / 1000,
    nextEmerge: 0,
    heldSince: null,
    doors: [],
  };
}

export interface TrainUpdate {
  /** Set when a train finished leaving, so the caller can schedule the next. */
  departed: boolean;
  /** Set on the frames where something worth announcing happened. */
  announce: string | null;
}

export function updateTrain(tr: Train, dt: number, LW: number, busy: boolean, now: number): TrainUpdate {
  const out: TrainUpdate = { departed: false, announce: null };
  tr.t += dt;
  if (tr.phase === "arrive") {
    const k = tr.t / 5;
    tr.x = lerp(tr.startX, tr.stopX, ease(k));
    if (k >= 1) {
      tr.phase = "dwell";
      tr.t = 0;
      tr.x = tr.stopX;
      out.announce = "arrived";
    }
  } else if (tr.phase === "dwell") {
    tr.open = Math.min(1, tr.open + dt / 0.7);
    tr.dwellT += dt;
    // The doors stay open while anyone is still crossing the platform, for at
    // most HOLD_MAX seconds past their schedule. A passenger whose target is
    // unreachable must not be able to park a train at the station.
    const holding = busy && tr.heldSince === null && tr.dwellT >= tr.dwellMax - 2;
    if (holding) tr.heldSince = now;
    if (!busy) tr.heldSince = null;
    if (busy && tr.heldSince !== null && now - tr.heldSince < HOLD_MAX) {
      tr.dwellT = Math.min(tr.dwellT, tr.dwellMax - 1.5);
    }
    if (tr.dwellT >= tr.dwellMax) {
      tr.phase = "close";
      tr.t = 0;
      out.announce = "closing";
    }
  } else if (tr.phase === "close") {
    tr.open = Math.max(0, tr.open - dt / 0.7);
    if (tr.open <= 0) {
      tr.phase = "depart";
      tr.t = 0;
      out.announce = "departing";
    }
  } else if (tr.phase === "depart") {
    // A train leaving to the right has to travel to the far edge; one leaving
    // to the left has to travel off the near one. Getting this wrong parks the
    // train in the middle of the frame while it is visibly accelerating.
    const dist = tr.dir > 0 ? LW - tr.stopX + 12 : -(tr.stopX + tr.len + 12);
    const k = tr.t / 7;
    tr.x = tr.stopX + dist * Math.pow(Math.min(1, Math.max(0, k)), 3);
    if (k >= 1) {
      out.departed = true;
    }
  }
  tr.doors.length = 0;
  for (let i = 0; i < tr.n; i++) {
    const cx = tr.x + i * (CAR_W + 2);
    tr.doors.push({ x: cx + 13.5 }, { x: cx + 38.5 });
  }
  return out;
}

/** The train currently stopped with its doors open, or null. */
export function dwelling(tr: Train | null): Train | null {
  return tr && tr.phase === "dwell" && tr.open > 0.85 ? tr : null;
}

/** The nearest door to an x, which is where a passenger aims. */
export function nearestDoor(tr: Train, x: number): number {
  let best = tr.doors.length ? tr.doors[0].x : tr.x;
  let bd = Infinity;
  for (const d of tr.doors) {
    const dd = Math.abs(d.x - x);
    if (dd < bd) {
      bd = dd;
      best = d.x;
    }
  }
  return best;
}

export function spawnPasser(doc: Document, LW: number, gold: boolean, text?: string): Passer {
  const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  const n = gold ? 4 : 5 + Math.floor(Math.random() * 2);
  const len = trainLen(n);
  return {
    dir,
    n,
    len,
    x: dir > 0 ? -len - 10 : LW + 10,
    speed: gold ? 48 : rand(120, 160),
    gold,
    banner: gold ? makeBanner(doc, text || "") : null,
    scheme: gold ? GOLD_SCHEME : EXPRESS_SCHEME,
    conf: 0,
    t: 0,
  };
}

export function updatePasser(ps: Passer, dt: number, LW: number): boolean {
  ps.x += ps.dir * ps.speed * dt;
  ps.t += dt;
  if (ps.gold) ps.conf -= dt;
  return (ps.dir > 0 && ps.x > LW + 12) || (ps.dir < 0 && ps.x < -ps.len - 12);
}

export function drawCars(
  doc: Document,
  g: Ctx,
  n: number,
  dir: 1 | -1,
  scheme: Scheme,
  x: number,
  base: number,
): void {
  for (let i = 0; i < n; i++) {
    let role: TrainRole = "mid";
    let light = "#ffe9a0";
    if (i === 0) {
      role = "cabL";
      light = dir < 0 ? "#ffe9a0" : "#ff4a4a";
    }
    if (i === n - 1) {
      role = "cabR";
      light = dir > 0 ? "#ffe9a0" : "#ff4a4a";
    }
    g.drawImage(carCanvas(doc, role, scheme, light), R(x) + i * (CAR_W + 2) - 1, base - CAR_H - 1);
    if (i < n - 1) {
      g.fillStyle = "#22222e";
      g.fillRect(R(x + i * (CAR_W + 2) + CAR_W - 1), base - 9, 3, 2);
    }
  }
}

/**
 * Doors, drawn over the cars.
 *
 * The opening is two panels sliding apart with a lit interior between them.
 * `open` is a fraction, so a passenger stepping through a half-open door looks
 * like it is squeezing, which is what it looks like in life.
 */
export function drawDoors(g: Ctx, tr: Train, base: number): void {
  if (tr.open <= 0) return;
  tr.doors.forEach((d) => {
    const cx = R(d.x);
    const y0 = base - CAR_H + 4;
    const iw = R(5 * tr.open);
    const pw = Math.ceil((5 - iw) / 2);
    g.fillStyle = "#14122e";
    g.fillRect(cx - 4, y0, 8, 19);
    if (iw > 0) {
      g.fillStyle = "#f0cc78";
      g.fillRect(cx - Math.floor(iw / 2), y0 + 1, iw, 17);
      g.fillStyle = "#fff0b0";
      g.fillRect(cx - Math.floor(iw / 2), y0 + 1, iw, 4);
      g.fillStyle = "#8a6a3a";
      g.fillRect(cx - Math.floor(iw / 2), y0 + 15, iw, 3);
    }
    const dc = shade(tr.scheme.body, 0.82);
    g.fillStyle = dc;
    g.fillRect(cx - 3, y0 + 1, pw, 17);
    g.fillRect(cx + 3 - pw, y0 + 1, pw, 17);
    if (pw >= 2) {
      g.fillStyle = "#bfe6f5";
      g.fillRect(cx - 3, y0 + 3, pw, 5);
      g.fillRect(cx + 3 - pw, y0 + 3, pw, 5);
    }
  });
}

export function drawBannerOn(g: Ctx, banner: HTMLCanvasElement, cx: number, y: number): void {
  const bw = banner.width;
  const bx = R(cx - bw / 2);
  for (let i = 0; i < bw; i++) g.drawImage(banner, i, 0, 1, 11, bx + i, y, 1, 11);
}

/** Lit windows and a headlight beam, both only after dark. */
export function drawTrainLights(g: Ctx, tr: Train, base: number, LW: number, night: number): void {
  g.globalAlpha = clamp(night * 0.95, 0, 1);
  g.fillStyle = "#ffd98a";
  for (let i = 0; i < tr.n; i++) {
    const cx = R(tr.x) + i * (CAR_W + 2);
    const top = base - CAR_H;
    [2, 19, 27].forEach((x) => g.fillRect(cx + x, top + 5, 6, 8));
    g.fillRect(cx + 11, top + 5, 5, 8);
    g.fillRect(cx + 36, top + 5, 5, 8);
    if (i !== 0 && i !== tr.n - 1) g.fillRect(cx + 44, top + 5, 6, 8);
  }
  g.globalAlpha = clamp(night * 0.5, 0, 1);
  g.fillStyle = "#ffe9a0";
  const fx = tr.dir > 0 ? tr.x + tr.len : tr.x - 20;
  const y0 = base - 9;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 2 + (i >> 2); j++) {
      if (((i + j) & 1) === 0) {
        g.fillRect(R(tr.dir > 0 ? fx + i : fx + 19 - i), y0 + j - ((i >> 2) >> 1), 1, 1);
      }
    }
  }
  g.globalAlpha = 1;
  void LW;
}

export function drawPasserLights(g: Ctx, ps: Passer, base: number, night: number): void {
  g.globalAlpha = clamp(night * 0.9, 0, 1);
  g.fillStyle = "#ffd98a";
  for (let i = 0; i < ps.n; i++) {
    const cx = R(ps.x) + i * (CAR_W + 2);
    const top = base - CAR_H;
    [2, 19, 27, 44].forEach((x) => g.fillRect(cx + x, top + 5, 6, 8));
  }
  g.globalAlpha = 1;
}
