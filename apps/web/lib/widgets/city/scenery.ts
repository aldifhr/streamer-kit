/**
 * The pixel city engine — part two of three: the static city.
 *
 * The skyline, the road, the sky gradient and the props are drawn once into
 * offscreen canvases and blitted. Redrawing a hundred buildings' worth of
 * fillRect every frame was most of the frame budget in the standalone version,
 * and none of it changes between frames except the gradient and the lights.
 */

import { BAY, OUT, R, mulberry32, textW } from "./sprites";
import type { Part } from "./sprites";
import { FONT } from "./font";

export type Ctx = CanvasRenderingContext2D;

/**
 * A backing store, optionally carrying the height of what was drawn into it.
 *
 * `carH` is the only per-canvas measurement the scene keeps, and it is read every
 * frame to place a vehicle on the road. Threading it through as a WeakMap meant
 * a lookup per car per frame; a declared optional field costs nothing.
 */
export type Sprite = HTMLCanvasElement & { carH?: number };

export function mk(w: number, h: number, doc: Document): HTMLCanvasElement {
  const c = doc.createElement("canvas");
  c.width = Math.max(1, Math.floor(w) || 1);
  c.height = Math.max(1, Math.floor(h) || 1);
  return c;
}

export interface Building {
  x: number;
  w: number;
  h: number;
  top: number;
  pal: string[];
  roof: number;
  shop: { text: string; color: string; aw: string[]; doorX: number };
}

export interface Door { x: number; y: number; openUntil: number }
export interface Win { x: number; y: number; thr: number; warm: boolean; ph: number }
export interface Sign { x: number; y: number; w: number; text: string; color: string; ph: number }
export interface Prop {
  type: "lamp" | "tree" | "bench" | "trash" | "mail" | "busstop";
  x: number;
  y: number;
  cv: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
}

const BPAL = [
  ["#c0605a", "#9a443f", "#7a3430", "#e8a890"], ["#d8b070", "#b08a50", "#8a6a36", "#f0d8a0"],
  ["#7a98b8", "#5a7898", "#46607c", "#a8c4dc"], ["#6aa89a", "#4a8878", "#386a5c", "#9ccfc0"],
  ["#a888b8", "#8468a0", "#684e84", "#d0b8e0"], ["#d8d0c0", "#b4aa98", "#8c8472", "#f0ece0"],
  ["#e0905a", "#b8703c", "#904e28", "#f4c090"],
];
const SIGNS = ["KOPI", "TOKO", "BAKSO", "ATM", "BUKU", "MART", "SALON", "APOTEK", "ROTI", "WARNET", "SATE", "BATIK"];
export const NEON = ["#ff5dc8", "#5dffd8", "#ffd95d", "#7da8ff", "#ff7a5d"];
const SHOP_H = 19;

export interface CityLayout {
  buildings: Building[];
  doors: Door[];
  wins: Win[];
  signs: Sign[];
  props: Prop[];
}

export function genCity(doc: Document, LW: number, LH: number, SY0: number, SY1: number): CityLayout {
  const rnd = mulberry32(7 + LW * 13 + LH);
  const buildings: Building[] = [], doors: Door[] = [], wins: Win[] = [], signs: Sign[] = [];
  let x = -6, si = Math.floor(rnd() * SIGNS.length);
  while (x < LW + 6) {
    const w = R(40 + rnd() * 26), h = R(LH * (0.26 + rnd() * 0.24));
    const pal = BPAL[Math.floor(rnd() * BPAL.length)];
    // The shop and its door are worked out here rather than patched on after the
    // building is pushed, so a Building is never briefly incomplete.
    let text = SIGNS[si++ % SIGNS.length];
    for (let t = 0; t < SIGNS.length && textW(text) + 6 > w - 6; t++) text = SIGNS[si++ % SIGNS.length];
    const doorX = x + 5 + Math.floor(rnd() * Math.max(1, w - 16));
    const b: Building = {
      x, w, h, top: SY0 - h, pal, roof: Math.floor(rnd() * 3),
      shop: { text, color: NEON[Math.floor(rnd() * NEON.length)], aw: [pal[3], "#ffffff"], doorX },
    };
    for (let wy = b.top + 9; wy < SY0 - SHOP_H - 5; wy += 10) {
      for (let wx = x + 5; wx < x + w - 8; wx += 8) {
        wins.push({ x: wx, y: wy, thr: 0.15 + rnd() * 0.6, warm: rnd() > 0.2, ph: rnd() * 100 });
      }
    }
    doors.push({ x: doorX + 3, y: SY0, openUntil: 0 });
    signs.push({ x: x + 3, y: SY0 - 19, w: textW(text) + 4, text, color: b.shop.color, ph: rnd() * 10 });
    buildings.push(b);
    x += w + Math.floor(rnd() * 3);
  }

  const props: Prop[] = [];
  const yb = SY1 + 3;
  for (const f of [0.1, 0.36, 0.62, 0.9]) props.push(prop(doc, "lamp", R(LW * f), yb));
  for (const f of [0.23, 0.49, 0.8]) props.push(prop(doc, "tree", R(LW * f), yb));
  props.push(prop(doc, "bench", R(LW * 0.43), yb), prop(doc, "trash", R(LW * 0.3), yb));
  props.push(prop(doc, "busstop", R(LW * 0.72), yb), prop(doc, "mail", R(LW * 0.55), yb));
  return { buildings, doors, wins, signs, props };
}

/** Draws parts into an arbitrary context, with an outline pass first. */
export function drawPartsOn(
  g: Ctx,
  parts: Part[],
  ox: number,
  oy: number,
  mirror: boolean,
  outline = true,
) {
  const M = mirror ? (p: Part) => [9 - (p[0] + p[2]), p[1], p[2], p[3], p[4], p[5]] as Part : (p: Part) => p;
  if (outline) {
    g.fillStyle = OUT;
    for (const q of parts) {
      if (q[5]) continue;
      const p = M(q);
      g.fillRect(ox + p[0] - 1, oy + p[1] - 1, p[2] + 2, p[3] + 2);
    }
  }
  for (const q of parts) {
    const p = M(q);
    g.fillStyle = p[4];
    g.fillRect(ox + p[0], oy + p[1], p[2], p[3]);
  }
}

/** Draws 3x5 text into an arbitrary context. */
export function txtOn(g: Ctx, s: string, x: number, y: number, c: string) {
  x = R(x);
  y = R(y);
  g.fillStyle = c;
  for (let i = 0; i < s.length; i++) {
    const glyph = s[i] in FONT ? FONT[s[i]] : undefined;
    if (!glyph) continue;
    for (let k = 0; k < 15; k++) if (glyph[k] === "1") g.fillRect(x + i * 4 + (k % 3), y + Math.floor(k / 3), 1, 1);
  }
}


/** Draws text into the live context. */
export function txt(g: Ctx, s: string, x: number, y: number, c: string) {
  txtOn(g, s, x, y, c);
}

export function txtOutlineOn(g: Ctx, s: string, x: number, y: number, c: string, o: string) {
  txtOn(g, s, x - 1, y, o);
  txtOn(g, s, x + 1, y, o);
  txtOn(g, s, x, y - 1, o);
  txtOn(g, s, x, y + 1, o);
  txtOn(g, s, x, y, c);
}

export function plateOn(g: Ctx, x: number, y: number, w: number, h: number, c: string) {
  x = R(x);
  y = R(y);
  g.fillStyle = c;
  g.fillRect(x + 1, y, w - 2, h);
  g.fillRect(x, y + 1, w, h - 2);
}

function prop(doc: Document, type: Prop["type"], x: number, y: number): Prop {
  let w: number, h: number, parts: Part[], ax: number, ay: number;
  const GRAY = "#4a4e5a";
  if (type === "lamp") {
    w = 14; h = 34; ax = 1; ay = 1;
    parts = [[1, 7, 2, 24, GRAY], [1, 4, 8, 2, GRAY], [6, 3, 5, 3, "#e8e0b0"], [0, 30, 4, 2, GRAY]];
  } else if (type === "tree") {
    w = 21; h = 31; ax = 1; ay = 1;
    parts = [[8, 18, 3, 11, "#6a4a2a"], [2, 9, 15, 9, "#3f9a4a"], [4, 3, 11, 8, "#3f9a4a"],
      [0, 12, 19, 5, "#357f3e"], [5, 5, 4, 3, "#63c46a", true], [3, 11, 4, 2, "#63c46a", true],
      [11, 14, 6, 2, "#2a6a32", true]];
  } else if (type === "bench") {
    w = 20; h = 12; ax = 2; ay = 1;
    parts = [[0, 1, 16, 3, "#8a5a2a"], [0, 5, 16, 2, "#a06a32"], [1, 7, 2, 3, GRAY], [13, 7, 2, 3, GRAY]];
  } else if (type === "trash") {
    w = 10; h = 14; ax = 2; ay = 2;
    parts = [[0, 2, 6, 8, "#5a6a5a"], [-1, 0, 8, 2, "#7a8a7a"], [2, 4, 2, 4, "#46544a", true]];
  } else if (type === "mail") {
    w = 10; h = 14; ax = 2; ay = 2;
    parts = [[0, 3, 6, 7, "#d0403a"], [1, 0, 4, 3, "#d0403a"], [2, 5, 2, 1, "#ffffff", true]];
  } else {
    w = 32; h = 34; ax = 2; ay = 5;
    parts = [[0, 4, 26, 2, "#5a7898"], [1, 6, 2, 20, "#7a8aa0"], [23, 6, 2, 20, "#7a8aa0"],
      [3, 8, 20, 12, "#bfe6f5", true], [5, 19, 16, 2, "#8a5a2a"]];
  }
  const c = mk(w, h, doc);
  const g = c.getContext("2d")!;
  drawPartsOn(g, parts.map((p) => [p[0] + ax, p[1] + ay, p[2], p[3], p[4], p[5]] as Part), 0, 0, false);
  if (type === "busstop") {
    plateOn(g, 6, 1, 15, 7, "#2a5ac0");
    txtOn(g, "BUS", 8, 3, "#ffffff");
  }
  return {
    type,
    x,
    y,
    cv: c,
    anchorX: type === "lamp" ? 6 : Math.floor(c.width / 2),
    anchorY: c.height - 2,
  };
}

/** The whole scene, baked once per layout. */
export interface CityLayers {
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  sky: HTMLCanvasElement;
  /**
   * The sky's own context, kept alongside the canvas.
   *
   * The gradient is re-baked into this canvas a few times a minute. Holding the
   * context here rather than beside the engine is what keeps the canvas and the
   * buffer in step — when the two lived apart, the gradient was written to a
   * canvas nothing ever drew, and the sky stayed black at midday.
   */
  skyCtx: Ctx;
  cone: HTMLCanvasElement;
  skyImg: ImageData;
}

export function buildLayers(
  doc: Document,
  layout: CityLayout,
  LW: number,
  LH: number,
  SY0: number,
  SY1: number,
  ROAD0: number,
): CityLayers {
  const sky = mk(LW, SY1 + 2, doc);
  const skyCtx = sky.getContext("2d")!;
  const skyImg = skyCtx.createImageData(LW, SY1 + 2);

  const far = mk(LW, SY0, doc);
  {
    const g = far.getContext("2d")!;
    const rnd = mulberry32(99 + LW);
    let x = 0;
    while (x < LW) {
      const w = Math.min(LW - x, R(14 + rnd() * 18)), h = R(LH * (0.2 + rnd() * 0.2));
      g.fillStyle = "#8aa0c0";
      g.fillRect(x, SY0 - h, w, h);
      g.fillStyle = "#9db3d0";
      for (let yy = SY0 - h + 3; yy < SY0 - 4; yy += 6) {
        for (let xx = x + 2; xx < x + w - 2; xx += 5) g.fillRect(xx, yy, 1, 2);
      }
      x += w;
    }
  }

  const mid = mk(LW, SY0 + 2, doc);
  {
    const g = mid.getContext("2d")!;
    for (const b of layout.buildings) {
      const [wall, shd, roof] = b.pal;
      g.fillStyle = wall; g.fillRect(b.x, b.top, b.w, b.h);
      g.fillStyle = shd; g.fillRect(b.x + b.w - 3, b.top, 3, b.h);
      g.fillStyle = roof; g.fillRect(b.x - 1, b.top - 2, b.w + 2, 3);
      g.fillStyle = shd; g.fillRect(b.x - 1, b.top + 1, b.w + 2, 1);
      if (b.roof === 0) { g.fillStyle = "#6a6e7a"; g.fillRect(b.x + 6, b.top - 8, 1, 6); }
      else if (b.roof === 1) {
        g.fillStyle = "#9a9eaa"; g.fillRect(b.x + 8, b.top - 5, 8, 3);
        g.fillStyle = "#7a7e8a"; g.fillRect(b.x + 10, b.top - 6, 4, 1);
      } else {
        g.fillStyle = "#7a5a3a"; g.fillRect(b.x + 8, b.top - 10, 8, 7);
        g.fillStyle = "#4a3a2a"; g.fillRect(b.x + 9, b.top - 3, 1, 2); g.fillRect(b.x + 14, b.top - 3, 1, 2);
      }
      const s = b.shop, y0 = SY0 - SHOP_H;
      g.fillStyle = shd; g.fillRect(b.x, y0, b.w, SHOP_H);
      g.fillStyle = "#9fd0e6"; g.fillRect(b.x + 3, SY0 - 8, b.w - 6, 8);
      g.fillStyle = "#c8e8f4"; g.fillRect(b.x + 3, SY0 - 8, b.w - 6, 1);
      for (let i = 0; i < b.w - 4; i += 3) {
        g.fillStyle = (i / 3) % 2 ? s.aw[1] : s.aw[0];
        g.fillRect(b.x + 2 + i, SY0 - 11, 3, 3);
      }
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(b.x + 2, SY0 - 8, b.w - 4, 1);
      g.fillStyle = "#3a2a22"; g.fillRect(s.doorX - 1, SY0 - 10, 8, 10);
      g.fillStyle = "#7a4a2a"; g.fillRect(s.doorX, SY0 - 9, 6, 9);
      g.fillStyle = "#ffd23f"; g.fillRect(s.doorX + 4, SY0 - 5, 1, 1);
    }
    for (const w of layout.wins) {
      g.fillStyle = "#e8e0d0"; g.fillRect(w.x - 1, w.y - 1, 6, 7);
      g.fillStyle = "#27344f"; g.fillRect(w.x, w.y, 4, 5);
      g.fillStyle = "#3a4a6a"; g.fillRect(w.x, w.y, 4, 1);
    }
    for (const s of layout.signs) {
      plateOn(g, s.x, s.y, s.w, 7, "#1c1830");
      txtOn(g, s.text, s.x + 2, s.y + 1, "#8a86a8");
    }
  }

  const ground = mk(LW, LH, doc);
  {
    const g = ground.getContext("2d")!;
    g.fillStyle = "#cfc8b8"; g.fillRect(0, SY0, LW, SY1 - SY0 + 3);
    g.fillStyle = "#bdb5a4";
    for (let x = 0; x < LW; x += 12) g.fillRect(x, SY0, 1, SY1 - SY0 + 3);
    for (let y = SY0 + 8; y < SY1 + 3; y += 12) g.fillRect(0, y, LW, 1);
    g.fillStyle = "#b8b0a0"; g.fillRect(0, SY0, LW, 2);
    g.fillStyle = "#e8e2d4"; g.fillRect(0, SY1 + 3, LW, 2);
    g.fillStyle = "#8a8478"; g.fillRect(0, SY1 + 5, LW, 1);
    g.fillStyle = "#4b4e5a"; g.fillRect(0, ROAD0, LW, LH - ROAD0);
    const rnd = mulberry32(5 + LH);
    g.fillStyle = "#454854";
    for (let i = 0; i < (LW * (LH - ROAD0)) / 40; i++) g.fillRect(rnd() * LW, ROAD0 + rnd() * (LH - ROAD0), 2, 1);
    const rh = LH - ROAD0, my = ROAD0 + R(rh * 0.6);
    g.fillStyle = "#e8c84a";
    for (let x = 0; x < LW; x += 14) g.fillRect(x, my, 8, 1);
    g.fillStyle = "#d8d8e0"; g.fillRect(0, ROAD0 + 1, LW, 1); g.fillRect(0, LH - 2, LW, 1);
    const cx = R(LW * 0.62);
    g.fillStyle = "#e8e8f0";
    for (let y = ROAD0 + 3; y < LH - 3; y += 4) g.fillRect(cx, y, 22, 2);
  }

  const cone = mk(36, LH, doc);
  {
    const g = cone.getContext("2d")!;
    g.fillStyle = "#fff6c0";
    for (let y = 0; y < LH; y++) {
      const hw = 3 + Math.floor((y / LH) * 14);
      for (let x = 18 - hw; x <= 18 + hw; x++) if (((x + y) & 1) === 0) g.fillRect(x, y, 1, 1);
    }
  }

  return { far, mid, ground, sky, skyCtx, cone, skyImg };
}
