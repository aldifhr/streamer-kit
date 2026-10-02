/**
 * The pixel city — weather.
 *
 * The cheapest thing on this list and the one that changes the scene most. A
 * rainy night with the lamps reflected in the puddles is a different picture
 * from a dry one, and it costs a few hundred fillRects and one dithered overlay.
 *
 * The chain is a fixed one: rain, then lightning while it rains, then a rainbow
 * after it stops, then dry again. Randomising it into other orders produced a
 * rainbow during a downpour, which nobody asked for and everybody noticed.
 *
 * The reflection is the part that earns its keep. At night a puddle that is only
 * a darker patch of road reads as a hole; a puddle with the streetlights in it
 * reads as water, and that is the whole difference at this size.
 */

import { BAY, R, clamp, lerp, rand } from "./sprites";
import type { Ctx } from "./scenery";

export type Weather = "dry" | "rain" | "after" | "rainbow";

export interface WeatherState {
  kind: Weather;
  /** 0 at the start of a phase, 1 at the end. */
  phase: number;
  /** Countdown for a lightning strike, or 0 when none is pending. */
  strikeIn: number;
}

export interface Drop {
  x: number;
  y: number;
  vy: number;
  len: number;
}

export interface WeatherOptions {
  LW: () => number;
  LH: () => number;
  SY1: () => number;
  ROAD0: () => number;
  /** Lamp positions on the ground, for the puddles to reflect. */
  lamps: () => { x: number; y: number }[];
  onLightning?: () => void;
  onEnter?: (kind: Weather) => void;
}

/** Rain duration, in ms, for one shower. */
const RAIN_MS = 26e3;
/** How long the rainbow is up after the rain stops. */
const RAINBOW_MS = 14e3;

export function createWeather(opts: WeatherOptions) {
  let state: WeatherState = { kind: "dry", phase: 1, strikeIn: 0 };
  let entered = 0;
  let drops: Drop[] = [];
  let lightningUntil = 0;

  /** Reflections, built once per shower and reused while it lasts. */
  let puddles: { x: number; y: number; w: number; h: number }[] = [];

  const setKind = (kind: Weather) => {
    if (state.kind === kind) return;
    state = { kind, phase: 0, strikeIn: 0 };
    entered = performance.now();
    if (kind === "rain") {
      const LW = opts.LW();
      // One drop per nine pixels of width, which is dense enough to read as rain
      // and thin enough that a heavy shower is not a grey wall.
      const n = Math.max(40, Math.round(LW / 9));
      drops = Array.from({ length: n }, () => ({
        x: rand(0, LW),
        y: rand(0, opts.LH()),
        vy: rand(150, 260),
        len: rand(2, 5),
      }));
      puddles = buildPuddles(opts);
    } else {
      drops = [];
    }
    opts.onEnter?.(kind);
  };

  return {
    state: () => state.kind,
    /** The whole state, for the draw helpers that need the phase as well. */
    full: () => state,
    /** 1 while the weather is doing something worth dressing up for. */
    isWet: () => state.kind === "rain",
    drops: () => drops,
    puddles: () => puddles,

    update(dt: number, now: number) {
      const t = now - entered;
      if (state.kind === "dry") {
        // The sky is not always clear, but a shower is a treat, not a
        // condition. One every couple of minutes at most.
        if (rand(0, 1) < dt / 150) setKind("rain");
        state.phase = 1;
        return;
      }
      state.phase = clamp(t / (state.kind === "rain" ? RAIN_MS : RAINBOW_MS), 0, 1);
      if (state.kind === "rain") {
        const LH = opts.LH();
        for (const d of drops) {
          d.y += d.vy * dt;
          d.x += d.vy * dt * 0.18;
          if (d.y > LH) {
            d.y = -4;
            d.x = rand(0, opts.LW());
          }
        }
        // Lightning comes on its own timer, not every frame, and a shower with no
        // lightning at all is just rain.
        state.strikeIn -= dt;
        if (state.strikeIn <= 0) {
          lightningUntil = now + 180;
          state.strikeIn = rand(3, 11);
          opts.onLightning?.();
        }
        if (t >= RAIN_MS) setKind("rainbow");
      } else if (state.kind === "rainbow") {
        if (t >= RAINBOW_MS) setKind("dry");
      }
    },

    /** How bright the lightning flash is right now, 0 to 1. */
    flash: (now: number) => (now < lightningUntil ? clamp((lightningUntil - now) / 180, 0, 1) : 0),

    /** Forces a shower, for the editor's test buttons. */
    force(kind: Weather) {
      setKind(kind);
    },
  };
}

function buildPuddles(opts: WeatherOptions) {
  const LW = opts.LW();
  const ground = opts.ROAD0();
  const out: { x: number; y: number; w: number; h: number }[] = [];
  // Puddles live on the road and the pavement, never on the buildings, and are
  // wider than they are deep so they read as lying flat on the ground.
  for (let i = 0; i < 10; i++) {
    out.push({
      x: rand(4, Math.max(8, LW - 30)),
      y: ground - rand(0, 10),
      w: rand(14, 40),
      h: rand(2, 4),
    });
  }
  void opts.SY1;
  return out;
}

/**
 * The puddles, with the streetlights in them.
 *
 * `night` decides whether there is anything to reflect: a lamp in a daytime
 * puddle is a pale smudge and reads as dirt, so the reflections are only drawn
 * after dark, and the puddle itself is only a dark dither.
 */
export function drawPuddles(
  g: Ctx,
  state: WeatherState,
  puddles: { x: number; y: number; w: number; h: number }[],
  now: number,
  lamps: { x: number; y: number }[],
  night: number,
) {
  if (state.kind === "dry") return;
  const fade = state.kind === "rainbow" ? 1 - state.phase : 1;
  if (fade <= 0) return;

  // The water: a dark dither, not a flat block. A filled rectangle reads as a
  // hole in the road; a Bayer-dithered one reads as a wet patch, because the
  // road's own colour still shows through the gaps.
  g.globalAlpha = 0.5 * fade;
  g.fillStyle = "#3a4258";
  for (const p of puddles) {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        // Taper the ends so a puddle is not a rectangle.
        const edge = Math.min(x, p.w - 1 - x) / (p.w / 2);
        if (edge < 0.3 && BAY[(x & 3) + ((y & 3) << 2)] > 6) continue;
        if (BAY[((p.x + x) & 3) + (((p.y + y) & 3) << 2)] / 16 > 0.55) continue;
        g.fillRect(R(p.x + x), R(p.y + y), 1, 1);
      }
    }
  }
  g.globalAlpha = 1;

  // The lamps in them. This is what makes it water rather than a stain, and it
  // is only drawn after dark: a pale smudge in a daytime puddle reads as dirt.
  if (night <= 0.15) return;
  for (const lamp of lamps) {
    // Each lamp is mirrored into the nearest puddle to it, and the reflection
    // stretches away from the lamp rather than sitting under it.
    let best: { x: number; y: number; w: number; h: number } | null = null;
    let bestD = 1e9;
    for (const p of puddles) {
      const d = Math.abs(p.x + p.w / 2 - lamp.x);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best || bestD > best.w / 2 + 14) continue;
    const cx = R(lamp.x);
    const top = R(best.y);
    // The surface is disturbed, so the streak wobbles rather than being a
    // clean line down.
    const wobble = Math.sin(now / 180 + lamp.x) > 0 ? 0 : 1;
    g.globalAlpha = clamp(night, 0, 1) * 0.55 * fade;
    g.fillStyle = "#ffd98a";
    g.fillRect(cx, top + wobble, 1, 1);
    g.fillStyle = "#ffe9a0";
    g.fillRect(cx - 1, top + 1 + wobble, 3, 1);
    g.globalAlpha = clamp(night, 0, 1) * 0.28 * fade;
    g.fillRect(cx, top + 2 + wobble, 1, 1);
    g.fillRect(cx - 2, top + 3 + wobble, 5, 1);
  }
  g.globalAlpha = 1;
}

/** The rain itself, as slanted lines. */
export function drawRain(g: Ctx, drops: Drop[], phase: number) {
  const a = phase < 0.15 ? phase / 0.15 : phase > 0.85 ? (1 - phase) / 0.15 : 1;
  if (a <= 0) return;
  g.globalAlpha = 0.42 * clamp(a, 0, 1);
  g.fillStyle = "#b8c8e8";
  for (const d of drops) {
    g.fillRect(R(d.x), R(d.y), 1, d.len);
  }
  g.globalAlpha = 1;
}

/**
 * The rainbow, drawn as a dithered arc.
 *
 * Seven bands is more than the picture can carry at this size, so the colours are
 * spaced across the arc and each band is two pixels — the whole thing reads as a
 * rainbow from across a room and costs one loop over the arc.
 */
export function drawRainbow(g: Ctx, state: WeatherState, LW: number, SY0: number) {
  if (state.kind !== "rainbow") return;
  const a = state.phase < 0.2 ? state.phase / 0.2 : state.phase > 0.8 ? (1 - state.phase) / 0.2 : 1;
  if (a <= 0) return;
  const bands = ["#d03030", "#e08030", "#e0d040", "#40a040", "#4080d0", "#8050c0"];
  const cx = LW / 2;
  const rOuter = LW * 0.42;
  const thickness = 2;
  g.globalAlpha = 0.75 * clamp(a, 0, 1);
  for (let b = 0; b < bands.length; b++) {
    g.fillStyle = bands[b];
    const r = rOuter - b * thickness;
    // One step every three degrees is enough at this size and is a third of the
    // fillRects of a finer sweep.
    for (let deg = 200; deg <= 340; deg += 3) {
      const t = (deg * Math.PI) / 180;
      g.fillRect(R(cx + Math.cos(t) * r), R(SY0 + Math.sin(t) * r * 0.55), 2, 2);
    }
  }
  g.globalAlpha = 1;
}

/** A dark wash over the whole scene while it rains, so the lights read warmer. */
export function drawRainWash(g: Ctx, state: WeatherState, LW: number, LH: number) {
  if (state.kind === "dry") return;
  const a = state.kind === "rain" ? 0.16 : 0.06 * (1 - state.phase);
  g.fillStyle = `rgba(20,26,48,${a.toFixed(3)})`;
  g.fillRect(0, 0, LW, LH);
  // A dither rather than a flat wash, or the scene goes flat behind it.
  g.fillStyle = `rgba(30,40,70,${(a * 0.6).toFixed(3)})`;
  for (let y = 0; y < LH; y += 2) {
    for (let x = (y & 1) * 2; x < LW; x += 4) g.fillRect(x, y, 1, 1);
  }
}

export { lerp, BAY, clamp };
