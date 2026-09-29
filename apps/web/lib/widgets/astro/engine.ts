/**
 * The astronaut scene, as an engine.
 *
 * Ported from a standalone single-file overlay. What changed and why:
 *
 * - It no longer opens its own WebSocket. Events arrive through the scene's
 *   shared feed, so a scene with this widget and a chat widget still has one
 *   socket, and the editor's test-alert button drives this widget for free.
 * - It no longer reads its config from a module constant or URL parameters.
 *   Every knob is a style key, so the editor can drive it and a theme can
 *   restate it like any other widget.
 * - It sizes to its container rather than the window, so it works as one
 *   widget inside a scene instead of only as a whole page.
 * - It is destroyable. The original ran a bare requestAnimationFrame loop for
 *   the life of the document, which leaks under React's double-mount.
 *
 * The drawing itself is unchanged: the pixel font, the hand-rotated sprites,
 * the dithered background and the crate/asteroid/rocket behaviour are the
 * point of the thing.
 */

import type { Entry } from "@/lib/widgets/types";

export interface AstroConfig {
  maxAstro: number;
  sleepAfterMs: number;
  despawnAfterMs: number;
  promoteGift: number;
  asteroidGift: number;
  rocketGift: number;
  rankXP: number[];
  decorStation: number;
  decorNebula: number;
  labelTop: number;
  labelActiveMs: number;
  badWords: string[];
  /** Pixel size of one low-res cell. 0 derives it from the canvas. */
  pixelSize: number;
  /** Draw the space background rather than leaving OBS's canvas transparent. */
  space: boolean;
  mission: string;
  showHud: boolean;
  showLabels: boolean;
  showFeed: boolean;
  /** Squash anything outside the 3x5 glyph set rather than dropping it. */
  censors: boolean;
}

export const DEFAULT_ASTRO_CONFIG: AstroConfig = {
  maxAstro: 45,
  sleepAfterMs: 3 * 60e3,
  despawnAfterMs: 10 * 60e3,
  promoteGift: 10,
  asteroidGift: 100,
  rocketGift: 500,
  rankXP: [0, 20, 80],
  decorStation: 100,
  decorNebula: 300,
  labelTop: 8,
  labelActiveMs: 60e3,
  badWords: ["anjing", "bangsat", "kontol", "memek", "asu", "fuck", "shit"],
  pixelSize: 0,
  space: true,
  mission: "",
  showHud: true,
  showLabels: true,
  showFeed: true,
  censors: true,
};

const RANKS = ["KADET", "ASTRONOT", "KOMANDAN"];

export interface AstroEngine {
  handle: (entry: Entry) => void;
  resize: (w: number, h: number) => void;
  /** Applied without a remount, so a slider drag does not restart the world. */
  configure: (next: AstroConfig) => void;
  reset: () => void;
  destroy: () => void;
}

/* ------------------------------------------------------------------ font */

const FONT: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101110110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111",
  "0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110", "4": "101101111001001",
  "5": "111100110001110", "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
  " ": "000000000000000", ".": "000000000000010", ",": "000000000010100", "!": "010010010000010", "?": "110001010000010",
  ":": "000010000010000", "-": "000000111000000", "+": "000010111010000", "'": "010010000000000", "/": "001001010100100",
  "(": "010100100100010", ")": "010001001001010", "%": "101001010100101", "#": "101111101111101", "_": "000000000000111",
};

/**
 * The 3x5 font has no lowercase, so a name is upper-cased and then squashed to
 * the glyph set. Also the entry point for the profanity mask, which is applied
 * before this so a masked word never reaches the letter filter.
 */
const ALLOWED = /[^A-Z0-9 .,!?:\-+'\/()%#_]/g;

interface Stored {
  name: string;
  xp: number;
  rank: number;
  hue: number;
  badge: boolean;
  drones: number;
}

interface Astro {
  id: string;
  name: string;
  xp: number;
  rank: number;
  hue: number;
  badge: boolean;
  drones: { x: number; y: number }[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  theta: number;
  t: number;
  ph: number;
  lastActive: number;
  sleeping: boolean;
  bubble: string;
  bubbleUntil: number;
  pulseAt: number;
  waveUntil: number;
  flipAt: number;
}

type Part = [number, number, number, number, string, boolean?];

const OUT = "#14122e";

export function createAstroEngine(opts: {
  canvas: HTMLCanvasElement;
  storageKey: string;
  config: AstroConfig;
}): AstroEngine {
  const { canvas, storageKey } = opts;
  let cfg = opts.config;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  let W = 0;
  let H = 0;
  let PX = 4;
  let LW = 320;
  let LH = 180;
  let bg: HTMLCanvasElement | null = null;
  let nebula: HTMLCanvasElement | null = null;

  const astros = new Map<string, Astro>();
  const crates: { x: number; y: number; vx: number; vy: number; born: number }[] = [];
  const asteroids: { x: number; y: number; vx: number; vy: number; r: number; rows: number[]; cr: number[][] }[] = [];
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; decay: number; c: string; s: number }[] = [];
  const streaks: { x: number; y: number; vx: number; vy: number; delay: number; len: number }[] = [];
  const feed: { text: string; t: number }[] = [];
  let rocket: { x: number; y: number; t: number; dur: number } | null = null;
  let partyUntil = 0;
  let totalDiamonds = 0;

  let store: Record<string, Stored> = {};
  let dirty = false;

  // Live viewer count as TikTok last reported it, and the roster size it was
  // seen at. TikTok sends no per-viewer leave event — WebcastRoomUserSeqMessage
  // carries a count and a list of ranked contributors, not the audience — so a
  // drop in the count is the only evidence available that people have left.
  let viewersNow = 0;
  let viewersBaseline = 0;

  try {
    store = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    // A corrupt or unavailable store must not stop the overlay from rendering;
    // the worst case is that ranks start over.
    store = {};
  }
  setInterval(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(store));
      dirty = false;
    } catch {
      /* private mode, quota — the roster is a nicety, not a requirement */
    }
  }, 10000);

  /* ------------------------------------------------------------- helpers */

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const R = Math.round;

  const stars = Array.from({ length: 110 }, () => ({
    x: Math.random(),
    y: Math.random(),
    c: Math.random() < 0.15 ? 2 : 1,
    ph: rand(0, 6),
    sp: rand(0.6, 2.2),
    d: rand(0.3, 1),
  }));

  function hashHue(s: string) {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }

  /**
   * Built once per config change rather than per call. The original compiled
   * these inside `clean()`, which ran on every message.
   *
   * The word's own length is kept alongside the pattern so a masked word is
   * replaced by as many asterisks as it had letters, which is what stops the
   * original text being readable by counting characters.
   */
  let masks: { re: RegExp; len: number }[] = [];
  const buildMasks = () => {
    masks = cfg.censors
      ? cfg.badWords
          .filter(Boolean)
          .map((w) => ({ re: new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), len: w.length }))
      : [];
  };
  buildMasks();

  function clean(t: unknown) {
    let s = String(t || "");
    for (const m of masks) s = s.replace(m.re, "*".repeat(m.len));
    return s;
  }

  const sanitize = (s: string) => s.toUpperCase().replace(ALLOWED, "");
  const textW = (s: string) => Math.max(0, s.length * 4 - 1);

  function rect(x: number, y: number, w: number, h: number, c: string) {
    ctx!.fillStyle = c;
    ctx!.fillRect(R(x), R(y), w, h);
  }

  function drawText(s: string, x: number, y: number, c: string) {
    x = R(x);
    y = R(y);
    ctx!.fillStyle = c;
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]];
      if (!g) continue;
      for (let k = 0; k < 15; k++) {
        if (g[k] === "1") ctx!.fillRect(x + i * 4 + (k % 3), y + Math.floor(k / 3), 1, 1);
      }
    }
  }

  function plate(x: number, y: number, w: number, h: number, c: string) {
    x = R(x);
    y = R(y);
    ctx!.fillStyle = c;
    ctx!.fillRect(x + 1, y, w - 2, h);
    ctx!.fillRect(x, y + 1, w, h - 2);
  }

  function label(s: string, cx: number, y: number, textCol: string, plateCol: string) {
    const w = textW(s);
    plate(cx - w / 2 - 2, y - 2, w + 4, 9, plateCol);
    drawText(s, cx - w / 2, y, textCol);
  }

  /* -------------------------------------------------------------- sprites */

  /** Rotation by quarter turns, done on the part list so edges stay crisp. */
  function xf(p: Part, k: number): Part {
    const [x, y, w, h, c, n] = p;
    if (k === 1) return [15 - (y + h), 2 + x, h, w, c, n];
    if (k === 2) return [13 - (x + w), 17 - (y + h), w, h, c, n];
    if (k === 3) return [y - 2, 15 - (x + w), h, w, c, n];
    return p;
  }

  function drawParts(parts: Part[], ox: number, oy: number, k: number) {
    const T = k ? parts.map((p) => xf(p, k)) : parts;
    ctx!.fillStyle = OUT;
    for (const p of T) if (!p[5]) ctx!.fillRect(ox + p[0] - 1, oy + p[1] - 1, p[2] + 2, p[3] + 2);
    for (const p of T) {
      ctx!.fillStyle = p[4];
      ctx!.fillRect(ox + p[0], oy + p[1], p[2], p[3]);
    }
  }

  function astroParts(a: Astro, wf: number, leg: number, waving: boolean) {
    const P: Part[] = [];
    const add = (x: number, y: number, w: number, h: number, c: string, n?: boolean) => P.push([x, y, w, h, c, n]);
    const acc = `hsl(${a.hue},78%,58%)`;
    const HELM = "#f4f4ff";
    const SUIT = "#dfe2f5";
    const GLOVE = "#b8bdd8";
    const gold = a.rank >= 2;
    const v1 = gold ? "#e6b03a" : "#3a56b8";
    const v2 = gold ? "#9a6412" : "#1d2a6a";

    add(1, 9, 2, 3, SUIT);
    add(1, 12, 2, 1, GLOVE);
    if (waving) {
      add(10, 8, 3, 1, SUIT);
      add(11 + wf, 3, 2, 6, SUIT);
      add(11 + wf, 2, 2, 1, GLOVE);
    } else {
      add(10, 9, 2, 3, SUIT);
      add(10, 12, 2, 1, GLOVE);
    }

    const lx = 4 - leg;
    const rx = 7 + leg;
    add(lx, 13, 2, 3, SUIT);
    add(rx, 13, 2, 3, SUIT);
    add(lx, 16, 2, 1, acc);
    add(rx, 16, 2, 1, acc);

    add(3, 8, 7, 5, HELM);
    add(3, 12, 7, 1, a.rank >= 1 ? acc : GLOVE, true);
    add(5, 9, 3, 2, acc, true);
    if (gold) add(3, 8, 2, 1, "#ffcd3c", true);
    if (a.badge) add(8, 9, 2, 2, "#ffcd3c", true);

    add(4, 0, 5, 1, a.rank >= 1 ? acc : HELM);
    add(3, 1, 7, 1, HELM);
    add(2, 2, 9, 4, HELM);
    add(3, 6, 7, 1, HELM);
    add(4, 7, 5, 1, HELM);
    if (gold) {
      add(6, -2, 1, 2, "#ffcd3c");
      add(6, -3, 1, 1, "#fff6c8");
    }

    add(4, 2, 5, 1, v1, true);
    add(3, 3, 7, 1, v1, true);
    add(3, 4, 7, 1, v2, true);
    add(4, 5, 5, 1, v2, true);
    add(4, 3, 1, 1, gold ? "#fff0b0" : "#8fb8ff", true);
    if (a.sleeping) {
      add(4, 4, 2, 1, "#e9f7ff", true);
      add(7, 4, 2, 1, "#e9f7ff", true);
    } else {
      add(5, 4, 1, 1, "#e9f7ff", true);
      add(7, 4, 1, 1, "#e9f7ff", true);
    }
    return P;
  }

  /* ------------------------------------------------------------- lifecycle */

  function rankFor(xp: number) {
    let s = 0;
    cfg.rankXP.forEach((m, i) => {
      if (xp >= m) s = i;
    });
    return s;
  }

  const levelFor = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp)));

  /**
   * Retire astronauts when the viewer count falls.
   *
   * The count is a number, not a list of names, so a drop can only say "somebody
   * left", never who. Two guards keep that from eating the roster on a bad
   * reading:
   *
   *   - the first report only sets the baseline, because the roster is built
   *     from joins that started arriving before the first count landed;
   *   - a drop is ignored unless it is both a real fall and larger than the
   *     count is noisy by. The count flickers, and a single dip during a burst
   *     of joins is not a room emptying.
   *
   * Whoever goes is whoever has been quiet longest. That is a guess, but it is
   * the best one available: a viewer who has neither chatted, gifted, liked nor
   * followed in the longest is the one most likely to have closed the tab.
   */
  function retireForDrop() {
    if (!viewersBaseline) {
      viewersBaseline = viewersNow;
      return;
    }
    const drop = viewersBaseline - viewersNow;
    // A fall worth acting on: not rounding noise, and not a fraction of a room
    // that is simply churning through viewers.
    if (drop <= 0 || drop < Math.max(2, viewersBaseline * 0.02)) return;
    viewersBaseline = viewersNow;

    const gone = Math.min(drop, astros.size);
    for (let i = 0; i < gone; i++) {
      let quietest: Astro | null = null;
      for (const a of astros.values()) {
        if (!quietest || a.lastActive < quietest.lastActive) quietest = a;
      }
      if (!quietest) break;
      astros.delete(quietest.id);
      delete store[quietest.id];
      dirty = true;
    }
  }

  function ensureAstro(userId: string, nick: string) {
    const id = String(userId || "anon");
    let a = astros.get(id);
    if (a) {
      if (nick) a.name = nick;
      return a;
    }
    if (astros.size >= cfg.maxAstro) {
      let oldest: Astro | null = null;
      for (const o of astros.values()) if (!oldest || o.lastActive < oldest.lastActive) oldest = o;
      if (oldest) astros.delete(oldest.id);
    }
    const rec = store[id] || ({} as Stored);
    const xp = rec.xp || 0;
    a = {
      id,
      name: nick || rec.name || id,
      xp,
      rank: Math.max(rec.rank || 0, rankFor(xp)),
      hue: rec.hue != null ? rec.hue : hashHue(id),
      badge: !!rec.badge,
      drones: [],
      x: rand(16, Math.max(17, LW - 16)),
      y: rand(LH * 0.15, LH * 0.8),
      vx: rand(-4, 4),
      vy: rand(-4, 4),
      theta: rand(0, 6.283),
      t: rand(0, 10),
      ph: rand(0, 6),
      lastActive: performance.now(),
      sleeping: false,
      bubble: "",
      bubbleUntil: 0,
      pulseAt: 0,
      waveUntil: 0,
      flipAt: 0,
    };
    for (let i = 0; i < (rec.drones || 0); i++) a.drones.push({ x: a.x, y: a.y });
    astros.set(id, a);
    sparkle(a.x, a.y, 10, "#bfefff");
    return a;
  }

  function saveAstro(a: Astro) {
    store[a.id] = {
      name: a.name,
      xp: Math.round(a.xp * 10) / 10,
      rank: a.rank,
      hue: a.hue,
      badge: a.badge,
      drones: a.drones.length,
    };
    dirty = true;
  }

  const touch = (a: Astro) => {
    a.lastActive = performance.now();
    a.sleeping = false;
  };

  function gainXP(a: Astro, n: number) {
    a.xp += n;
    const r = rankFor(a.xp);
    if (r > a.rank) {
      a.rank = r;
      sparkle(a.x, a.y, 24, "#ffe08a");
    }
    saveAstro(a);
  }

  const wave = (a: Astro) => {
    a.pulseAt = performance.now();
    a.waveUntil = performance.now() + 1800;
  };

  const flip = (a: Astro) => {
    a.flipAt = performance.now();
  };

  function emitThrust(a: Astro) {
    const sp = Math.hypot(a.vx, a.vy) || 1;
    sparks.push({
      x: a.x - (a.vx / sp) * 6,
      y: a.y - (a.vy / sp) * 6,
      vx: -(a.vx / sp) * rand(8, 18) + rand(-3, 3),
      vy: -(a.vy / sp) * rand(8, 18) + rand(-3, 3),
      life: 0.5,
      decay: 2.2,
      c: Math.random() < 0.5 ? "#ffb347" : "#fff3c4",
      s: 1,
    });
  }

  function updateAstro(a: Astro, dt: number, now: number) {
    a.sleeping = now - a.lastActive > cfg.sleepAfterMs;
    a.t += dt;
    let thrust = false;
    a.theta += (Math.random() - 0.5) * 1.6 * dt;
    let ax = Math.cos(a.theta) * 3.5;
    let ay = Math.sin(a.theta) * 3.5;

    if (!a.sleeping && crates.length) {
      let best: (typeof crates)[number] | null = null;
      let bd = 1e9;
      for (const c of crates) {
        const d = Math.hypot(c.x - a.x, c.y - a.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best && bd < 170) {
        const ang = Math.atan2(best.y - a.y, best.x - a.x);
        ax = Math.cos(ang) * 26;
        ay = Math.sin(ang) * 26;
        thrust = true;
        if (bd < 8) {
          crates.splice(crates.indexOf(best), 1);
          gainXP(a, 0.5);
          touch(a);
          wave(a);
          sparkle(a.x, a.y, 8, "#8ff0ff");
        }
      }
    }
    for (const ast of asteroids) {
      const d = Math.hypot(ast.x - a.x, ast.y - a.y);
      if (d < ast.r + 26) {
        const ang = Math.atan2(a.y - ast.y, ast.x - ast.x);
        ax = Math.cos(ang) * 70;
        ay = Math.sin(ang) * 70;
        thrust = true;
      }
    }
    const mx = 9;
    const my = 12;
    if (a.x < mx) ax += 18;
    if (a.x > LW - mx) ax -= 18;
    if (a.y < my + 4) ay += 18;
    if (a.y > LH - my - 4) ay -= 18;

    a.vx += ax * dt;
    a.vy += ay * dt;
    const maxV = thrust ? 36 : a.sleeping ? 1.5 : 7;
    const sp = Math.hypot(a.vx, a.vy);
    if (sp > maxV) {
      const k = 1 - Math.min(1, dt * 6) * (1 - maxV / sp);
      a.vx *= k;
      a.vy *= k;
    }
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.x = clamp(a.x, 7, LW - 7);
    a.y = clamp(a.y, 10, LH - 12);
    if (thrust && Math.random() < 0.7) emitThrust(a);

    a.drones.forEach((d, i) => {
      const tx = a.x + Math.cos(a.t * 1.3 + i * 3) * 14;
      const ty = a.y - 6 + Math.sin(a.t * 1.7 + i * 3) * 5;
      d.x += (tx - d.x) * Math.min(1, dt * 3);
      d.y += (ty - d.y) * Math.min(1, dt * 3);
    });
  }

  /* ------------------------------------------------------------- drawing */

  function drawAstro(a: Astro, now: number) {
    const wav = now < a.waveUntil;
    const wf = wav ? Math.floor(now / 160) % 2 : 0;
    const leg = Math.floor(a.t * 2.2 + a.ph) % 2;
    let hop = 0;
    if (a.pulseAt && now - a.pulseAt < 350) {
      hop = -2 * Math.sin(((now - a.pulseAt) / 350) * Math.PI);
    }
    let k = 0;
    if (a.flipAt && now - a.flipAt < 800) k = Math.floor((now - a.flipAt) / 200) % 4;
    const ox = R(a.x) - 6;
    const oy = R(a.y) - 8 + R(Math.sin(a.t * 1.5 + a.ph)) + R(hop);
    if (a.sleeping) ctx!.globalAlpha = 0.65;
    drawParts(astroParts(a, wf, leg, wav), ox, oy, k);
    ctx!.globalAlpha = 1;
  }

  function drawDrones(a: Astro, now: number) {
    a.drones.forEach((d) => {
      const on = Math.floor(now / 350) % 2;
      drawParts(
        [
          [0, 0, 5, 3, "#cfd6e6"],
          [2, 1, 1, 1, on ? "#ff5d73" : "#63ff9a", true],
          [-1, -2, 7, 1, "#8f98b0"],
        ],
        R(d.x) - 2,
        R(d.y) - 1,
        0,
      );
    });
  }

  function drawLabels(a: Astro, showLabel: boolean, isTop: boolean, now: number) {
    if (showLabel) {
      const nm = sanitize(a.name).slice(0, 10) || "VIEWER";
      label(
        `${nm} Lv${levelFor(a.xp)}`,
        R(a.x),
        R(a.y) + 12,
        isTop ? "#ffd23f" : a.sleeping ? "#a9a7d0" : "#ffffff",
        "rgba(10,8,34,.85)",
      );
    }
    if (a.sleeping) drawText("ZZ", a.x + 8, a.y - 12, "#cfd0ff");
    if (a.bubble && now < a.bubbleUntil) {
      const s = sanitize(a.bubble).slice(0, 22);
      if (s) {
        const w = textW(s);
        const cx = R(a.x);
        const y = R(a.y) - 24;
        plate(cx - w / 2 - 2, y - 2, w + 4, 9, "#f7f7ff");
        rect(cx - 1, y + 7, 3, 1, "#f7f7ff");
        rect(cx, y + 8, 1, 1, "#f7f7ff");
        drawText(s, cx - w / 2, y, "#15123a");
      }
    }
  }

  /* ------------------------------------------------------------ backdrop */

  const pxl = (b: CanvasRenderingContext2D, x: number, y: number, c: string) => {
    b.fillStyle = c;
    b.fillRect(x, y, 1, 1);
  };

  function buildBackground() {
    bg = document.createElement("canvas");
    bg.width = LW;
    bg.height = LH;
    const b = bg.getContext("2d")!;
    const bands = ["#06051a", "#0a0828", "#0e0c34", "#141046"];
    for (let y = 0; y < LH; y++) {
      const tt = (y / LH) * (bands.length - 1);
      const i = Math.min(bands.length - 2, Math.floor(tt));
      const f = tt - i;
      b.fillStyle = f < 0.66 ? bands[i] : bands[i + 1];
      b.fillRect(0, y, LW, 1);
      if (f >= 0.33 && f < 0.66) {
        b.fillStyle = bands[i + 1];
        for (let x = y % 2; x < LW; x += 2) b.fillRect(x, y, 1, 1);
      }
    }

    const mr = R(Math.min(LW, LH) * 0.07);
    const mcx = R(LW * 0.88);
    const mcy = R(LH * 0.14);
    for (let y = -mr; y <= mr; y++) {
      const half = R(Math.sqrt(mr * mr - y * y));
      for (let x = -half; x <= half; x++) {
        const lum = (-x * 0.6 - y * 0.6) / mr;
        const d = (x + y) % 2 === 0;
        pxl(
          b,
          mcx + x,
          mcy + y,
          lum > 0.35
            ? "#f0f0f0"
            : lum > 0
              ? d
                ? "#f0f0f0"
                : "#c6c6d0"
              : lum > -0.35
                ? "#c6c6d0"
                : d
                  ? "#c6c6d0"
                  : "#8b8b9a",
        );
      }
    }
    b.fillStyle = "#8b8b9a";
    (
      [
        [-0.3, -0.2, 0.2],
        [0.25, 0.15, 0.24],
        [-0.1, 0.45, 0.13],
      ] as [number, number, number][]
    ).forEach(([dx, dy, k]) => {
      const cr = Math.max(1, R(mr * k));
      b.fillRect(mcx + R(dx * mr) - cr, mcy + R(dy * mr) - 1, cr * 2, Math.max(2, cr));
    });

    const er = R(Math.min(LW, LH) * 0.5);
    const ecx = R(LW * 0.08);
    const ecy = LH + R(er * 0.15);
    const ocean = ["#0b2a5c", "#124a9a", "#2a7fd6", "#56b0ff"];
    const land = ["#1f6a3a", "#2f9a4a", "#5cc45a"];
    for (let y = Math.max(0, ecy - er); y < LH; y++) {
      const dy = y - ecy;
      const half = R(Math.sqrt(Math.max(0, er * er - dy * dy)));
      for (let x = Math.max(0, ecx - half); x <= Math.min(LW - 1, ecx + half); x++) {
        const nx = (x - ecx) / er;
        const ny = dy / er;
        const lum = clamp((nx * 0.55 - ny * 0.7 + 1) / 2, 0, 1) * 3.3;
        const d = (x + y) % 2 === 0 ? 0.5 : 0;
        const li = clamp(Math.floor(lum + d), 0, 3);
        const isLand =
          Math.sin(nx * 7 + 1.3) * Math.cos(ny * 6 + 0.5) + Math.sin(nx * 13 + ny * 9) * 0.5 > 0.55;
        const isCloud = Math.sin(nx * 11 + ny * 4) * Math.sin(ny * 9 + 1) > 0.62 && (x + y) % 2 === 0;
        const edge = Math.hypot(x - ecx, dy) > er - 2 && lum > 1.2;
        pxl(b, x, y, edge ? "#7fd0ff" : isCloud ? "#e8f2ff" : isLand ? land[Math.min(2, li)] : ocean[li]);
      }
    }

    nebula = document.createElement("canvas");
    nebula.width = LW;
    nebula.height = LH;
    const n = nebula.getContext("2d")!;
    for (let y = 0; y < LH; y++) {
      for (let x = 0; x < LW; x++) {
        const a1 = Math.sin(x * 0.045 + Math.sin(y * 0.03) * 2) + Math.cos(y * 0.06 + x * 0.02);
        const a2 = Math.sin(x * 0.03 - y * 0.05 + 2) + Math.cos(x * 0.05 + y * 0.03);
        if (a1 > 1.45) pxl(n, x, y, "#5a2a9a");
        else if (a1 > 1.05 && (x + y) % 2 === 0) pxl(n, x, y, "#5a2a9a");
        else if (a2 > 1.5) pxl(n, x, y, "#1f5fa8");
        else if (a2 > 1.15 && (x + y) % 2 === 0) pxl(n, x, y, "#1f5fa8");
      }
    }
  }

  function drawStars(t: number) {
    for (const s of stars) {
      const x = Math.floor((s.x * LW + t * s.d * 1.5) % LW);
      const y = Math.floor(s.y * LH);
      if (Math.sin(t * s.sp + s.ph) < -0.55) continue;
      rect(x, y, 1, 1, s.c === 2 ? "#9fb4ff" : "#ffffff");
      if (s.c === 2) {
        rect(x - 1, y, 1, 1, "#4a5aa8");
        rect(x + 1, y, 1, 1, "#4a5aa8");
        rect(x, y - 1, 1, 1, "#4a5aa8");
        rect(x, y + 1, 1, 1, "#4a5aa8");
      }
    }
  }

  function drawStation(t: number) {
    const ox = Math.floor((t * 3) % (LW + 90)) - 62;
    const oy = R(LH * 0.09);
    const PB = "#2f5db0";
    const PL = "#7fa6ee";
    drawParts(
      [
        [0, 0, 9, 12, PB],
        [10, 0, 9, 12, PB],
        [19, 5, 16, 3, "#8f98b0"],
        [22, 2, 10, 9, "#e6ebf5"],
        [35, 0, 9, 12, PB],
        [45, 0, 9, 12, PB],
        [4, 0, 1, 12, PL, true],
        [14, 0, 1, 12, PL, true],
        [39, 0, 1, 12, PL, true],
        [49, 0, 1, 12, PL, true],
        [25, 5, 4, 3, "#3a56b8", true],
      ],
      ox,
      oy,
      0,
    );
  }

  /* ------------------------------------------------------------- pickups */

  function dropCrates(n: number) {
    for (let i = 0; i < n; i++) {
      crates.push({
        x: rand(6, Math.max(7, LW - 6)),
        y: rand(-30, -4),
        vx: rand(-2, 2),
        vy: rand(7, 13),
        born: performance.now(),
      });
    }
  }

  function drawCrate(c: (typeof crates)[number], now: number) {
    const blink = Math.floor(now / 300) % 2;
    drawParts(
      [
        [0, 0, 5, 5, "#c8cfe6"],
        [2, 1, 1, 3, "#2fc4e6", true],
        [1, 2, 3, 1, "#2fc4e6", true],
      ],
      R(c.x) - 2,
      R(c.y) - 2,
      0,
    );
    if (blink) {
      rect(c.x - 4, c.y - 4, 1, 1, "#8ff0ff");
      rect(c.x + 4, c.y + 3, 1, 1, "#8ff0ff");
    }
  }

  function asteroidShower() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i < 5; i++) {
      const r = R(rand(6, 12));
      const rows: number[] = [];
      for (let dy = -r; dy <= r; dy++) rows.push(R(Math.sqrt(r * r - dy * dy) * rand(0.86, 1.12)));
      const cr: number[][] = [];
      for (let k = 0; k < 3; k++) cr.push([R(rand(-r * 0.5, r * 0.4)), R(rand(-r * 0.5, r * 0.4)), R(rand(1, 3))]);
      asteroids.push({
        x: dir > 0 ? -r - i * 40 : LW + r + i * 40,
        y: rand(LH * 0.12, LH * 0.85),
        vx: dir * rand(14, 26),
        vy: rand(-4, 4),
        r,
        rows,
        cr,
      });
    }
    for (let i = 0; i < 14; i++) {
      streaks.push({
        x: rand(LW * 0.2, LW * 1.2),
        y: rand(-50, -2),
        vx: -rand(80, 150),
        vy: rand(95, 175),
        delay: i * 0.12,
        len: R(rand(14, 30)),
      });
    }
  }

  function shootingStar() {
    const l = Math.random() < 0.5;
    streaks.push({
      x: l ? rand(-10, LW * 0.4) : rand(LW * 0.6, LW + 10),
      y: rand(-10, LH * 0.3),
      vx: (l ? 1 : -1) * rand(90, 160),
      vy: rand(60, 110),
      delay: 0,
      len: 18,
    });
  }

  function drawAsteroid(s: (typeof asteroids)[number]) {
    const cx = R(s.x);
    const cy = R(s.y);
    const r = s.r;
    ctx!.fillStyle = OUT;
    s.rows.forEach((h, i) => {
      ctx!.fillRect(cx - h - 1, cy - r + i, 2 * h + 2, 1);
    });
    ctx!.fillRect(cx - s.rows[0], cy - r - 1, 2 * s.rows[0], 1);
    ctx!.fillRect(cx - s.rows[s.rows.length - 1], cy + r + 1, 2 * s.rows[s.rows.length - 1], 1);
    s.rows.forEach((h, i) => {
      ctx!.fillStyle = "#8a7e72";
      ctx!.fillRect(cx - h, cy - r + i, 2 * h, 1);
      if (i < r) {
        ctx!.fillStyle = "#b3a698";
        ctx!.fillRect(cx - h, cy - r + i, Math.min(2, h), 1);
      }
      ctx!.fillStyle = "#5a5048";
      ctx!.fillRect(cx + h - 2, cy - r + i, Math.min(2, h), 1);
    });
    ctx!.fillStyle = "#5a5048";
    s.cr.forEach(([dx, dy, w]) => ctx!.fillRect(cx + dx, cy + dy, w, Math.max(1, w - 1)));
  }

  function launchRocket() {
    rocket = { x: rand(LW * 0.2, LW * 0.8), y: LH + 14, t: 0, dur: 5 };
    partyUntil = performance.now() + 8000;
    astros.forEach(flip);
  }

  function drawRocket(now: number) {
    if (!rocket) return;
    const f = Math.floor(now / 90) % 2;
    const ox = R(rocket.x) - 4;
    const oy = R(rocket.y) - 12;
    drawParts(
      [
        [0, 11, 2, 4, "#d9403a"],
        [7, 11, 2, 4, "#d9403a"],
        [2, 4, 5, 10, "#f4f4ff"],
        [2, 10, 5, 1, "#d9403a", true],
        [4, 0, 1, 1, "#d9403a"],
        [3, 1, 3, 1, "#d9403a"],
        [2, 2, 5, 2, "#d9403a"],
        [3, 6, 3, 3, "#3a56b8", true],
        [3, 6, 1, 1, "#8fb8ff", true],
        [3, 14, 3, 1, "#8f98b0"],
      ],
      ox,
      oy,
      0,
    );
    rect(ox + 3, oy + 15, 3, 2, "#ffe066");
    rect(ox + 4, oy + 17, 1, f ? 3 : 2, "#ff8a3d");
  }

  /* ----------------------------------------------------------- effects */

  function sparkle(x: number, y: number, n: number, c: string) {
    for (let i = 0; i < n; i++) {
      sparks.push({
        x,
        y,
        vx: rand(-30, 30),
        vy: rand(-30, 30),
        life: 1,
        decay: 1.1,
        c,
        s: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  function updateWorld(dt: number, now: number) {
    for (let i = crates.length - 1; i >= 0; i--) {
      const c = crates[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.y > LH + 10 || now - c.born > 16000) crates.splice(i, 1);
    }
    for (let i = asteroids.length - 1; i >= 0; i--) {
      const a = asteroids[i];
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if (a.x < -80 || a.x > LW + 80 || a.y < -40 || a.y > LH + 40) asteroids.splice(i, 1);
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const m = streaks[i];
      if (m.delay > 0) {
        m.delay -= dt;
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y > LH + 60 || m.x < -80 || m.x > LW + 80) streaks.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * s.decay;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    if (rocket) {
      rocket.t += dt;
      const k = rocket.t / rocket.dur;
      rocket.y = LH + 14 - (LH + 50) * k;
      rocket.x += Math.sin(rocket.t * 9) * 0.15;
      for (let i = 0; i < 2; i++) {
        sparks.push({
          x: rocket.x + rand(-2, 2),
          y: rocket.y + 8,
          vx: rand(-6, 6),
          vy: rand(10, 24),
          life: 0.8,
          decay: 1.3,
          c: Math.random() < 0.5 ? "#ffb347" : "#fff6d0",
          s: Math.random() < 0.4 ? 2 : 1,
        });
      }
      if (k >= 1) rocket = null;
    }
    if (now < partyUntil && Math.random() < dt * 5) {
      const x = rand(LW * 0.1, LW * 0.9);
      const y = rand(LH * 0.1, LH * 0.6);
      const hue = Math.floor(rand(0, 360));
      for (let i = 0; i < 24; i++) {
        const an = (i / 24) * 6.283;
        const sp = rand(14, 34);
        sparks.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 1, decay: 0.9, c: `hsl(${hue},90%,65%)`, s: 1 });
      }
      if (Math.random() < 0.5) dropCrates(1);
    }
  }

  function drawStreaks() {
    for (const m of streaks) {
      if (m.delay > 0) continue;
      const sp = Math.hypot(m.vx, m.vy);
      const ux = m.vx / sp;
      const uy = m.vy / sp;
      for (let i = 0; i < m.len; i++) {
        if (i > 3 && i % 2) continue;
        rect(m.x - ux * i, m.y - uy * i, 1, 1, i < 2 ? "#ffffff" : i < m.len * 0.5 ? "#ffd28a" : "#a06a3a");
      }
    }
  }

  function pushFeed(text: string) {
    feed.push({ text: clean(text), t: performance.now() });
    if (feed.length > 5) feed.shift();
  }

  function drawHUD(now: number) {
    if (cfg.showHud) {
      const head = `ASTRONOT ${astros.size}` + (totalDiamonds ? `  DIAMOND ${totalDiamonds}` : "");
      plate(3, 3, textW(head) + 6, 11, "rgba(10,8,34,.85)");
      drawText(head, 6, 6, "#ffffff");
    }
    if (cfg.mission) label(`MISI: ${clean(cfg.mission).slice(0, 24)}`, R(LW / 2), 5, "#ffe08a", "rgba(10,8,34,.85)");
    if (!cfg.showFeed) return;
    feed.forEach((e, i) => {
      const age = (now - e.t) / 1000;
      if (age > 9) return;
      // Blink for the last second and a half rather than cutting out.
      if (age > 7.5 && Math.floor(age * 8) % 2) return;
      const y = LH - 4 - (feed.length - i) * 11;
      plate(3, y - 2, textW(e.text) + 6, 9, "rgba(10,8,34,.85)");
      drawText(e.text, 6, y, "#f3f2ff");
    });
  }

  /* --------------------------------------------------------- feed input */

  /**
   * The one place an overlay event becomes a change in the world.
   *
   * `join` does create an astronaut, and it is admitted despite the batching: on
   * a live room join is the most frequent event by a wide margin, so a roster
   * built from chat alone showed one figure against five thousand viewers. The
   * cost is that joins arrive in bursts, so they spawn no bubble, no wave and no
   * XP — a joined viewer is simply present until the viewer count says otherwise.
   */
  function handle(entry: Entry) {
    const now = performance.now();
    const nick = clean(entry.user);

    switch (entry.kind) {
      case "viewers": {
        const n = Number(entry.meta.count) || 0;
        if (n > 0) {
          viewersNow = n;
          retireForDrop();
        }
        break;
      }
      case "join": {
        // Nothing but presence: a burst of joins would otherwise fill the scene
        // with speech bubbles and sparkle for people who have not said anything.
        ensureAstro(entry.userId, nick);
        break;
      }
      case "comment": {
        const a = ensureAstro(entry.userId, nick);
        touch(a);
        a.bubble = clean(entry.value).slice(0, 44);
        a.bubbleUntil = now + 4500;
        wave(a);
        gainXP(a, 1);
        break;
      }
      case "like": {
        const a = ensureAstro(entry.userId, nick);
        touch(a);
        const n = clamp(Number(entry.meta.count ?? 1), 1, 15);
        gainXP(a, n * 0.2);
        if (n >= 5 || Math.random() < 0.3) flip(a);
        sparkle(a.x, a.y, Math.min(n, 8), "#ffd0f0");
        break;
      }
      case "follow": {
        const a = ensureAstro(entry.userId, nick);
        touch(a);
        a.badge = true;
        gainXP(a, 5);
        wave(a);
        sparkle(a.x, a.y, 18, "#ffd23f");
        pushFeed(`${nick} follow: lencana!`);
        break;
      }
      case "share": {
        const a = ensureAstro(entry.userId, nick);
        touch(a);
        if (a.drones.length < 2) a.drones.push({ x: a.x, y: a.y });
        gainXP(a, 3);
        sparkle(a.x, a.y, 12, "#9fe8ff");
        pushFeed(`${nick} share: dapat drone`);
        break;
      }
      case "gift": {
        const a = ensureAstro(entry.userId, nick);
        touch(a);
        const d = Math.max(0, Number(entry.meta.diamonds) || 0);
        totalDiamonds += d;
        gainXP(a, Math.max(1, d * 0.5));
        wave(a);
        const count = Number(entry.meta.count) || 1;
        const giftName = clean(String(entry.meta.giftName ?? "gift"));
        pushFeed(`${nick} kirim ${giftName}${count > 1 ? ` x${count}` : ""}`);

        if (d < cfg.promoteGift) {
          dropCrates(clamp(2 + d, 2, 8));
          shootingStar();
        } else {
          flip(a);
          sparkle(a.x, a.y, 30, "#ffe08a");
          dropCrates(8);
          if (a.rank < 2) {
            a.rank++;
            a.xp = Math.max(a.xp, cfg.rankXP[a.rank] ?? a.xp);
            saveAstro(a);
            pushFeed(`${nick} naik jadi ${RANKS[a.rank]}`);
          }
        }
        if (d >= cfg.asteroidGift) asteroidShower();
        if (d >= cfg.rocketGift) launchRocket();
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- loop */

  let last = performance.now();
  let frame = 0;
  let running = false;

  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    updateWorld(dt, now);
    for (const [id, a] of astros) {
      updateAstro(a, dt, now);
      if (now - a.lastActive > cfg.despawnAfterMs) astros.delete(id);
    }

    ctx!.clearRect(0, 0, LW, LH);
    if (cfg.space) {
      if (bg) ctx!.drawImage(bg, 0, 0);
      drawStars(t);
      if (totalDiamonds >= cfg.decorNebula && nebula) {
        ctx!.globalAlpha = 0.45;
        ctx!.drawImage(nebula, 0, 0);
        ctx!.globalAlpha = 1;
      }
    }
    if (totalDiamonds >= cfg.decorStation) drawStation(t);

    crates.forEach((c) => drawCrate(c, now));
    asteroids.forEach(drawAsteroid);
    drawRocket(now);

    // Painter's order: anything further down the screen draws in front.
    const list = [...astros.values()].sort((p, q) => p.y - q.y);
    list.forEach((a) => {
      drawAstro(a, now);
      drawDrones(a, now);
    });
    drawStreaks();
    for (const s of sparks) {
      if (s.life < 0.25 && Math.floor(s.life * 40) % 2) continue;
      rect(s.x, s.y, s.s, s.s, s.c);
    }

    if (cfg.showLabels) {
      const topIds = new Set(
        [...list].sort((p, q) => q.xp - p.xp).slice(0, cfg.labelTop).map((a) => a.id),
      );
      list.forEach((a) => {
        const isTop = topIds.has(a.id);
        drawLabels(a, isTop || now - a.lastActive < cfg.labelActiveMs, isTop, now);
      });
    }
    drawHUD(now);

    frame = requestAnimationFrame(tick);
  };

  /**
   * The loop is started here rather than at construction because the first
   * frame before the canvas has been measured would run against the fallback
   * cell size and immediately paint a background at the wrong resolution.
   * `resize` is called again for every size change, so it owns both.
   */
  function ensureRunning() {
    if (running) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    PX = cfg.pixelSize > 0 ? cfg.pixelSize : Math.max(2, Math.round(Math.min(W, H) / 180));
    LW = Math.ceil(W / PX);
    LH = Math.ceil(H / PX);
    canvas.width = LW;
    canvas.height = LH;
    // The backing store is low-res; the CSS size restores the requested size, so
    // the browser scales it up with smoothing off. These two must not be equal
    // or the canvas would render at its fallback size and sit in a corner.
    canvas.style.width = `${LW * PX}px`;
    canvas.style.height = `${LH * PX}px`;
    ctx!.imageSmoothingEnabled = false;
    buildBackground();
    if (W > 0 && H > 0) ensureRunning();
  }

  /** Applied without a remount, so a slider drag does not restart the world. */
  function configure(next: AstroConfig) {
    const masksChanged = next.censors !== cfg.censors || next.badWords.join() !== cfg.badWords.join();
    // The background is redrawn from scratch on resize — a moon, a dithered
    // earth and a nebula over LW x LH cells — so it may only be rebuilt when
    // something that would actually look different changed.
    const rescale = next.pixelSize !== cfg.pixelSize;
    cfg = next;
    if (masksChanged) buildMasks();
    if (rescale && W > 0) resize(W, H);
  }

  const flush = () => {
    if (!dirty) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(store));
      dirty = false;
    } catch {
      /* nothing to do */
    }
  };

  return {
    handle,
    resize,
    configure,
    reset() {
      store = {};
      dirty = true;
      astros.clear();
      crates.length = 0;
      asteroids.length = 0;
      streaks.length = 0;
      sparks.length = 0;
      feed.length = 0;
      totalDiamonds = 0;
      partyUntil = 0;
      rocket = null;
      flush();
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frame);
      flush();
    },
  };
}
