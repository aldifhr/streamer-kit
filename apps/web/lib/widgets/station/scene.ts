/**
 * The platform itself: layout, and the layers that never change.
 *
 * Everything static is drawn once into its own canvas and blitted per frame.
 * The station has fewer moving parts than the city but a longer dwell — a train
 * can sit at the platform for half a minute with the doors open — so anything
 * redrawn per frame here is a cost paid for every second of that.
 */

import { BAY, R, clamp, lerp, mulberry32, sanitize, shade, textW } from "../city/sprites";
import { drawPartsOn, mk, plateOn, txtOn } from "../city/scenery";
import type { Ctx } from "../city/scenery";
import type { Part } from "../city/sprites";

export interface Win {
  x: number;
  y: number;
  /** How dark it has to be before this window lights up. */
  thr: number;
  warm: boolean;
  ph: number;
}

export interface Prop {
  type: "pillar" | "bench" | "vending" | "kiosk" | "trash" | "gate";
  x: number;
  y: number;
  idx?: number;
  side?: -1 | 1;
  cv: HTMLCanvasElement;
}

export interface StationLayout {
  /** Canopy height — the roof hangs down from the top of the frame. */
  CH: number;
  /** Platform floor. */
  PY0: number;
  /** Near track, where trains stop. */
  TR0: number;
  /** Back track, where expresses pass. */
  BT0: number;
  /** Horizon: the base of the background buildings. */
  BG0: number;
  /** Front of the platform furniture. */
  PB: number;
}

export const CAR_W = 52;
export const CAR_H = 28;

const BPAL: [string, string, string][] = [
  ["#c0605a", "#9a443f", "#7a3430"],
  ["#d8b070", "#b08a50", "#8a6a36"],
  ["#7a98b8", "#5a7898", "#46607c"],
  ["#6aa89a", "#4a8878", "#386a5c"],
  ["#a888b8", "#8468a0", "#684e84"],
  ["#d8d0c0", "#b4aa98", "#8c8472"],
];

/**
 * Colour of the sky through the day.
 *
 * Each row is time, sky top, sky mid, sky horizon, sun/moon tint, glow tint,
 * then the wash the whole scene gets: rgb and strength. The reference tuned
 * these by eye over nine stops; they are kept as data so the clock is a lookup
 * rather than a second renderer.
 */
export const SKY_KEYS: number[][] = [
  [0.0, 58, 74, 138, 242, 160, 90, 240, 140, 90, 0.2, 0.55],
  [0.12, 90, 160, 224, 191, 224, 240, 255, 230, 200, 0.04, 0.1],
  [0.25, 63, 143, 224, 168, 216, 245, 0, 0, 0, 0, 0],
  [0.45, 74, 150, 224, 207, 230, 240, 0, 0, 0, 0, 0],
  [0.58, 58, 63, 138, 240, 122, 74, 250, 120, 70, 0.22, 0.35],
  [0.66, 21, 26, 74, 90, 58, 106, 40, 40, 110, 0.45, 0.8],
  [0.8, 7, 10, 36, 20, 26, 68, 15, 25, 85, 0.58, 1],
  [0.92, 10, 14, 48, 26, 32, 80, 15, 25, 85, 0.55, 0.95],
  [1.0, 58, 74, 138, 242, 160, 90, 240, 140, 90, 0.2, 0.55],
];

export function skyAt(tod: number): number[] {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    if (tod >= a[0] && tod <= b[0]) {
      const t = (tod - a[0]) / (b[0] - a[0]);
      return a.map((v, j) => (j === 0 ? tod : lerp(v, b[j], t)));
    }
  }
  return SKY_KEYS[0];
}

/** 0 by day, 1 at night. Drives lamps, windows and the star field. */
export const nightOf = (k: number[]) => k[11];

export function computeLayout(LW: number, LH: number): StationLayout {
  return {
    CH: R(LH * 0.12),
    PY0: R(LH * 0.63),
    TR0: R(LH * 0.63) - 2,
    BT0: R(LH * 0.63) - 2 - R(LH * 0.07),
    BG0: R(LH * 0.63) - 2 - R(LH * 0.07) - 4,
    PB: R(LH * 0.63 + (LH - LH * 0.63) * 0.55),
  };
}

export interface StationScene {
  layout: StationLayout;
  buildings: { x: number; w: number; h: number; top: number; pal: [string, string, string]; roof: number }[];
  wins: Win[];
  props: Prop[];
  sky: HTMLCanvasElement;
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  track: HTMLCanvasElement;
  platform: HTMLCanvasElement;
  canopy: HTMLCanvasElement;
  cone: HTMLCanvasElement;
  skyImg: ImageData;
}

const GRAY = "#4a4e5a";

function propCanvas(doc: Document, p: Omit<Prop, "cv">): HTMLCanvasElement {
  let c: HTMLCanvasElement;
  let parts: Part[];
  let ax = 2;
  const ay = 2;
  if (p.type === "pillar") {
    const h = p.y - 0 + 60;
    c = mk(26, h, doc);
    const g = c.getContext("2d") as Ctx;
    const fill = (x: number, y: number, w: number, hh: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(R(x), R(y), w, hh);
    };
    fill(9, 2, 8, h - 2, "#8a90a4");
    fill(9, 2, 2, h - 2, "#aab0c4");
    fill(15, 2, 2, h - 2, "#6a7084");
    for (let y = h - 12; y < h; y += 4) {
      fill(9, y, 8, 2, "#f0c030");
      fill(9, y + 2, 8, 2, "#2a2a34");
    }
    fill(8, 2, 10, 2, "#6a7084");
    if (p.idx === 1) {
      plateOn(g, 6, 14, 14, 9, "#2a5ac0");
      txtOn(g, "1", 12, 16, "#ffffff");
    }
    if (p.idx === 4) {
      plateOn(g, 2, 14, 22, 9, "#2a8a4a");
      txtOn(g, "EXIT", 4, 16, "#ffffff");
    }
    (c as HTMLCanvasElement & { anchorX?: number; anchorY?: number }).anchorX = 13;
    (c as HTMLCanvasElement & { anchorX?: number; anchorY?: number }).anchorY = c.height - 2;
    return c;
  }
  if (p.type === "bench") {
    c = mk(28, 14, doc);
    parts = [
      [0, 1, 22, 3, "#8a5a2a"],
      [0, 5, 22, 3, "#a06a32"],
      [2, 8, 3, 4, GRAY],
      [17, 8, 3, 4, GRAY],
    ];
  } else if (p.type === "trash") {
    c = mk(10, 14, doc);
    parts = [
      [0, 2, 6, 8, "#5a6a5a"],
      [-1, 0, 8, 2, "#7a8a7a"],
      [2, 4, 2, 4, "#46544a", true],
    ];
  } else if (p.type === "vending") {
    c = mk(20, 28, doc);
    parts = [
      [0, 0, 14, 22, "#2a5ac0"],
      [2, 2, 10, 10, "#bfe6f5", true],
      [3, 3, 2, 2, "#e04a4a", true],
      [6, 3, 2, 2, "#f0c030", true],
      [9, 3, 2, 2, "#4ac06a", true],
      [3, 7, 2, 2, "#e07a30", true],
      [6, 7, 2, 2, "#a050d0", true],
      [3, 14, 8, 2, "#14122e", true],
      [3, 18, 8, 2, "#8aa0e0", true],
    ];
  } else if (p.type === "kiosk") {
    c = mk(40, 34, doc);
    parts = [[0, 12, 32, 16, "#8a5a2a"], [2, 14, 28, 6, "#bfe6f5", true], [0, 8, 32, 4, "#e04a4a"], [0, 2, 32, 5, "#d8d0c0"], [4, 0, 24, 3, "#6a4a2a"]];
    for (let i = 0; i < 8; i++) parts.push([i * 4, 8, 2, 4, "#ffffff", true]);
  } else {
    c = mk(14, 22, doc);
    parts = [
      [0, 0, 6, 16, "#6a7084"],
      [1, 2, 4, 5, "#2a8a4a", true],
      [-2, 14, 10, 3, "#4a4e5a"],
    ];
  }
  const g = c.getContext("2d") as Ctx;
  drawPartsOn(
    g,
    parts.map((q) => [q[0] + ax, q[1] + ay, q[2], q[3], q[4], q[5]] as Part),
    0,
    0,
    false,
  );
  if (p.type === "kiosk") {
    plateOn(g, 5, 1, 17, 7, "#1c1830");
    txtOn(g, "KOPI", 8, 2, "#ffd95d");
  }
  const cc = c as HTMLCanvasElement & { anchorX?: number; anchorY?: number };
  cc.anchorX = Math.floor(c.width / 2) - 2;
  cc.anchorY = c.height - 3;
  return c;
}

export function buildStationScene(doc: Document, LW: number, LH: number): StationScene {
  const layout = computeLayout(LW, LH);
  const { CH, PY0, TR0, BT0, BG0, PB } = layout;

  const buildings: StationScene["buildings"] = [];
  const wins: Win[] = [];
  const rnd = mulberry32(7 + LW * 13 + LH);
  let x = -6;
  while (x < LW + 6) {
    const w = R(34 + rnd() * 26);
    const h = Math.min(R(LH * (0.16 + rnd() * 0.18)), BG0 - CH - 6);
    const b = {
      x,
      w,
      h,
      top: BG0 - h,
      pal: BPAL[Math.floor(rnd() * BPAL.length)] as [string, string, string],
      roof: Math.floor(rnd() * 3),
    };
    for (let wy = b.top + 7; wy < BG0 - 6; wy += 9) {
      for (let wx = x + 4; wx < x + w - 7; wx += 8) {
        wins.push({ x: wx, y: wy, thr: 0.15 + rnd() * 0.6, warm: rnd() > 0.2, ph: rnd() * 100 });
      }
    }
    buildings.push(b);
    x += w + Math.floor(rnd() * 3);
  }

  const drafts: Omit<Prop, "cv">[] = [];
  [0.07, 0.29, 0.5, 0.71, 0.93].forEach((f, i) =>
    drafts.push({ type: "pillar", x: R(LW * f), y: PB, idx: i }),
  );
  drafts.push(
    { type: "bench", x: R(LW * 0.18), y: PY0 + R((LH - PY0) * 0.28) },
    { type: "bench", x: R(LW * 0.61), y: PY0 + R((LH - PY0) * 0.3) },
    { type: "bench", x: R(LW * 0.86), y: PY0 + R((LH - PY0) * 0.28) },
    { type: "vending", x: R(LW * 0.39), y: PY0 + R((LH - PY0) * 0.27) },
    { type: "kiosk", x: R(LW * 0.76), y: PY0 + R((LH - PY0) * 0.3) },
    { type: "trash", x: R(LW * 0.33), y: PY0 + R((LH - PY0) * 0.28) },
    { type: "gate", x: 9, y: PY0 + R((LH - PY0) * 0.33), side: -1 },
    { type: "gate", x: LW - 9, y: PY0 + R((LH - PY0) * 0.33), side: 1 },
  );
  const props: Prop[] = drafts.map((d) => ({ ...d, cv: propCanvas(doc, d) }));

  // --- sky -----------------------------------------------------------------
  const sky = mk(LW, TR0 + 2, doc);
  const skyCtx = sky.getContext("2d") as Ctx;
  const skyImg = skyCtx.createImageData(LW, TR0 + 2);

  // --- far buildings -------------------------------------------------------
  const far = mk(LW, BG0 + 2, doc);
  {
    const g = far.getContext("2d") as Ctx;
    const r2 = mulberry32(99 + LW);
    let fx = 0;
    while (fx < LW) {
      const w = Math.min(LW - fx, R(14 + r2() * 18));
      const h = R(LH * (0.2 + r2() * 0.2));
      g.fillStyle = "#8aa0c0";
      g.fillRect(fx, BG0 - h, w, h);
      g.fillStyle = "#9db3d0";
      for (let yy = BG0 - h + 3; yy < BG0 - 4; yy += 6) {
        for (let xx = fx + 2; xx < fx + w - 2; xx += 5) g.fillRect(xx, yy, 1, 2);
      }
      fx += w;
    }
  }

  // --- near buildings ------------------------------------------------------
  const mid = mk(LW, BG0 + 2, doc);
  {
    const g = mid.getContext("2d") as Ctx;
    buildings.forEach((b) => {
      const [wall, shd, roof] = b.pal;
      g.fillStyle = wall;
      g.fillRect(b.x, b.top, b.w, b.h);
      g.fillStyle = shd;
      g.fillRect(b.x + b.w - 3, b.top, 3, b.h);
      g.fillStyle = roof;
      g.fillRect(b.x - 1, b.top - 2, b.w + 2, 3);
      if (b.roof === 0) {
        g.fillStyle = "#6a6e7a";
        g.fillRect(b.x + 6, b.top - 8, 1, 6);
      } else if (b.roof === 1) {
        g.fillStyle = "#9a9eaa";
        g.fillRect(b.x + 8, b.top - 5, 8, 3);
        g.fillStyle = "#7a7e8a";
        g.fillRect(b.x + 10, b.top - 6, 4, 1);
      }
    });
    wins.forEach((w) => {
      g.fillStyle = "#e8e0d0";
      g.fillRect(w.x - 1, w.y - 1, 6, 7);
      g.fillStyle = "#27344f";
      g.fillRect(w.x, w.y, 4, 5);
      g.fillStyle = "#3a4a6a";
      g.fillRect(w.x, w.y, 4, 1);
    });
  }

  // --- ballast, back track, near track, overhead wires ---------------------
  const track = mk(LW, LH, doc);
  {
    const g = track.getContext("2d") as Ctx;
    g.fillStyle = "#7a7262";
    g.fillRect(0, BG0, LW, TR0 - BG0 + 1);
    const r3 = mulberry32(3 + LH);
    for (let i = 0; i < (LW * (TR0 - BG0)) / 14; i++) {
      g.fillStyle = r3() < 0.5 ? "#6e6656" : "#867e6e";
      g.fillRect(R(r3() * LW), R(BG0 + r3() * (TR0 - BG0)), 2, 1);
    }
    [BT0, TR0].forEach((by) => {
      g.fillStyle = "#5a5246";
      g.fillRect(0, by - 4, LW, 5);
      g.fillStyle = "#3a2e22";
      for (let bx = 0; bx < LW; bx += 6) g.fillRect(bx, by - 3, 3, 2);
      g.fillStyle = "#b8bac8";
      g.fillRect(0, by - 4, LW, 1);
      g.fillStyle = "#8a8c9c";
      g.fillRect(0, by - 1, LW, 1);
    });
    g.fillStyle = "#2a2a38";
    for (let px = 18; px < LW; px += 76) {
      g.fillRect(px, TR0 - 46, 2, 46);
      g.fillRect(px - 6, TR0 - 44, 14, 2);
      g.fillStyle = "#8a8c9c";
      g.fillRect(px - 5, TR0 - 42, 1, 3);
      g.fillRect(px + 6, TR0 - 42, 1, 3);
      g.fillStyle = "#2a2a38";
    }
    g.fillStyle = "#20202c";
    g.fillRect(0, TR0 - 38, LW, 1);
    g.fillRect(0, TR0 - 36, LW, 1);
  }

  // --- platform floor ------------------------------------------------------
  const platform = mk(LW, LH, doc);
  {
    const g = platform.getContext("2d") as Ctx;
    g.fillStyle = "#bdb8ac";
    g.fillRect(0, PY0, LW, LH - PY0);
    g.fillStyle = "#a8a498";
    for (let gx = 0; gx < LW; gx += 16) g.fillRect(gx, PY0, 1, LH - PY0);
    for (let gy = PY0 + 12; gy < LH; gy += 14) g.fillRect(0, gy, LW, 1);
    g.fillStyle = "#8a8478";
    g.fillRect(0, PY0, LW, 1);
    // The yellow line. It is the only thing on the platform that means
    // something, so it is drawn last and nothing else is drawn over it.
    g.fillStyle = "#f0c030";
    g.fillRect(0, PY0 + 3, LW, 2);
    g.fillStyle = "#d8b030";
    for (let gx = 0; gx < LW; gx += 3) g.fillRect(gx, PY0 + 6, 2, 1);
  }

  // --- canopy --------------------------------------------------------------
  const canopy = mk(LW, CH + 6, doc);
  {
    const g = canopy.getContext("2d") as Ctx;
    g.fillStyle = "#4a5062";
    g.fillRect(0, 0, LW, CH);
    g.fillStyle = "#5a6074";
    g.fillRect(0, CH - 5, LW, 3);
    g.fillStyle = "#2a2e3c";
    g.fillRect(0, CH - 2, LW, 2);
    g.fillStyle = "#14122e";
    g.fillRect(0, CH, LW, 1);
    for (let gx = 0; gx < LW; gx += 14) {
      g.fillStyle = "#3a3e4e";
      g.fillRect(gx, 2, 1, CH - 6);
      g.fillStyle = "#5a6074";
      g.fillRect(gx + 1, 2, 1, CH - 6);
    }
    g.fillStyle = "#8a8c9c";
    for (let gx = 6; gx < LW; gx += 52) g.fillRect(gx + 2, CH, 1, 3);
    g.fillStyle = "#e8e8d0";
    for (let gx = 6; gx < LW; gx += 52) g.fillRect(gx, CH + 3, 5, 2);
  }

  // --- spotlight cone, stretched to whoever is being applauded -------------
  const cone = mk(36, LH, doc);
  {
    const g = cone.getContext("2d") as Ctx;
    g.fillStyle = "#fff6c0";
    for (let y = 0; y < LH; y++) {
      const hw = 3 + Math.floor((y / LH) * 14);
      for (let cx = 18 - hw; cx <= 18 + hw; cx++) {
        if (((cx + y) & 1) === 0) g.fillRect(cx, y, 1, 1);
      }
    }
  }

  return { layout, buildings, wins, props, sky, far, mid, track, platform, canopy, cone, skyImg };
}

/**
 * The sky, quantised to nine levels.
 *
 * A smooth gradient across a 320-pixel-wide canvas banding badly under
 * `image-rendering: pixelated`; the ordered dither hides it without a blur, and
 * the same 4x4 matrix is what the dissolve uses, so people fade on the same
 * grain the sky is painted on.
 */
export function paintSky(scene: StationScene, k: number[]): void {
  const g = scene.sky.getContext("2d") as Ctx;
  const h = scene.sky.height;
  const w = scene.sky.width;
  const d = scene.skyImg.data;
  const L = 9;
  for (let y = 0; y < h; y++) {
    const t = Math.pow(y / h, 1.2);
    const rr = lerp(k[1], k[4], t);
    const gg = lerp(k[2], k[5], t);
    const bb = lerp(k[3], k[6], t);
    for (let x = 0; x < w; x++) {
      const bay = BAY[(x & 3) + ((y & 3) << 2)] / 16;
      const i = (y * w + x) * 4;
      d[i] = Math.floor((rr / 255) * (L - 1) + bay) * (255 / (L - 1));
      d[i + 1] = Math.floor((gg / 255) * (L - 1) + bay) * (255 / (L - 1));
      d[i + 2] = Math.floor((bb / 255) * (L - 1) + bay) * (255 / (L - 1));
      d[i + 3] = 255;
    }
  }
  g.putImageData(scene.skyImg, 0, 0);
}

export const stars = Array.from({ length: 90 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.6,
  ph: Math.random() * 6,
  sp: 0.6 + Math.random() * 2,
}));

export const clouds = Array.from({ length: 5 }, (_, i) => ({
  x: i * 0.22,
  y: 0.2 + Math.random() * 0.3,
  s: 0.7 + Math.random() * 0.8,
  v: 1.5 + Math.random() * 2,
}));

const glowCache = new Map<number, HTMLCanvasElement>();

export function glowCanvas(doc: Document, r: number): HTMLCanvasElement {
  const hit = glowCache.get(r);
  if (hit) return hit;
  const c = mk(r * 2 + 1, r * 2 + 1, doc);
  const g = c.getContext("2d") as Ctx;
  g.fillStyle = "#ffd98a";
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const dist = Math.hypot(x, y) / r;
      if (dist > 1) continue;
      if (dist < 0.35 || (dist < 0.65 && ((x + y) & 1) === 0) || (x % 2 === 0 && y % 2 === 0)) {
        g.fillRect(x + r, y + r, 1, 1);
      }
    }
  }
  glowCache.set(r, c);
  return c;
}

/** The station clock. `tod` is 0..1 across a day, with dawn at 0. */
export function clockStr(tod: number): string {
  const h24 = (tod * 24 + 6) % 24;
  const hh = Math.floor(h24);
  const mm = Math.floor((h24 % 1) * 60);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

/**
 * The hanging boards: what the train is doing, where it is going, and the time.
 *
 * The status word blinks while the doors are open because a platform that has
 * just announced its own departure is the one thing here worth repeating.
 */
export function drawBoards(
  g: Ctx,
  LW: number,
  CH: number,
  stationName: string,
  trainState: string,
  dest: string | null,
  tod: number,
  blinkOn: boolean,
): void {
  const bw = 62;
  const bh = 26;
  const bx = R(LW * 0.3) - 31;
  const by = CH + 3;
  g.fillStyle = "#8a8c9c";
  g.fillRect(bx + 8, CH, 1, 3);
  g.fillRect(bx + bw - 9, CH, 1, 3);
  plateOn(g, bx, by, bw, bh, "#0c0a1a");
  g.fillStyle = "#f0c030";
  g.fillRect(bx, by, bw, 1);
  txtOn(g, "JALUR 1", bx + 3, by + 3, "#ffb830");
  txtOn(g, clockStr(tod), bx + bw - 23, by + 3, "#ffffff");
  txtOn(g, trainState, bx + 3, by + 10, blinkOn ? "#ffffff" : "#7dff9a");
  txtOn(g, ("KE " + (dest || "...")).slice(0, 14), bx + 3, by + 17, "#ffb830");

  const nm = sanitize(stationName) || "STASIUN";
  const nw = textW(nm) + 10;
  const nx = R(LW * 0.62) - R(nw / 2);
  const ny = CH + 4;
  g.fillStyle = "#8a8c9c";
  g.fillRect(nx + 6, CH, 1, 4);
  g.fillRect(nx + nw - 7, CH, 1, 4);
  plateOn(g, nx, ny, nw, 11, "#2a5ac0");
  g.fillStyle = "#6a8ae0";
  g.fillRect(nx + 1, ny + 1, nw - 2, 1);
  txtOn(g, nm, nx + 5, ny + 3, "#ffffff");
}

/** The analogue clock on the middle pillar. */
export function drawPillarClock(g: Ctx, cx: number, CH: number, tod: number): void {
  const x = cx;
  const y = CH + 28;
  plateOn(g, x - 8, y - 8, 17, 17, "#14122e");
  plateOn(g, x - 7, y - 7, 15, 15, "#f4f4ff");
  g.fillStyle = "#14122e";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillRect(R(x + Math.sin(a) * 6), R(y - Math.cos(a) * 6), 1, 1);
  }
  const h24 = (tod * 24 + 6) % 24;
  const hh = ((h24 % 12) / 12) * Math.PI * 2;
  const mm = (h24 % 1) * Math.PI * 2;
  lineTo(g, x, y, x + Math.sin(hh) * 3, y - Math.cos(hh) * 3, "#14122e");
  lineTo(g, x, y, x + Math.sin(mm) * 5, y - Math.cos(mm) * 5, "#c03030");
}

/** Bresenham, one pixel at a time. Clock hands only. */
function lineTo(g: Ctx, x0: number, y0: number, x1: number, y1: number, c: string): void {
  x0 = R(x0);
  y0 = R(y0);
  x1 = R(x1);
  y1 = R(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = c;
  for (let n = 0; n < 200; n++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Lamp glow on the canopy. */
export function drawCanopyLights(doc: Document, g: Ctx, LW: number, CH: number, night: number): void {
  const glow = glowCanvas(doc, 13);
  g.globalAlpha = clamp(night * 0.6, 0, 1);
  for (let x = 6; x < LW; x += 52) g.drawImage(glow, x + 2 - 13, CH + 4 - 13 + 4);
  g.globalAlpha = clamp(night * 0.9, 0, 1);
  g.fillStyle = "#fff6c0";
  for (let x = 6; x < LW; x += 52) g.fillRect(x, CH + 3, 5, 2);
  g.globalAlpha = 1;
}

/** Night wash applied over the whole scene, from the sky keys. */
export function nightWash(k: number[]): { r: number; g: number; b: number; a: number } | null {
  if (k[10] <= 0.005) return null;
  return { r: R(k[7]), g: R(k[8]), b: R(k[9]), a: k[10] };
}

export { shade };
