/**
 * The pixel city — what a cleared mission leaves behind.
 *
 * Drawn every frame rather than baked into the layers, because these are the
 * one part of the city that has to twinkle, and because a room that clears four
 * missions should not need four rebakes to show it.
 */

import type { Decoration } from "./missions";
import type { Ctx } from "./scenery";
import { clamp } from "./sprites";

/**
 * The festival bulbs, strung from roof to roof.
 *
 * The wire is drawn first and always, and the bulbs on top of it are never
 * fully off. Twinkling by drawing and not drawing makes the strand itself
 * disappear between pulses, and a reward the room cannot see is not a reward:
 * the first version had this as a bare wire with a bulb on it half the time,
 * which measured as thirty-odd pixels across the whole canvas and read as
 * nothing at all.
 */
function lights(g: Ctx, LW: number, y: number, t: number, phase: number) {
  const bulbs = Math.max(6, Math.floor(LW / 26));
  for (let i = 0; i < bulbs; i++) {
    const x = (i + 0.5) * (LW / bulbs);
    const sag = i % 2;
    // The wire spans the whole gap, so the strand is one continuous line.
    g.fillStyle = "#1a1a24";
    g.fillRect(x - LW / bulbs / 2, y + sag, Math.ceil(LW / bulbs) + 1, 1);
    const pulse = Math.sin(t * 1.6 + i * 0.9 + phase);
    const dim = pulse < -0.15;
    const c = i % 3 === 0 ? "#ffd95d" : i % 3 === 1 ? "#ff7ac8" : "#5dffd8";
    // Off bulbs stay as the bulb's own glass, so the strand is always a strand.
    g.fillStyle = dim ? "#4a4a58" : c;
    g.fillRect(x - 2, y + sag + 1, 4, 3);
    if (!dim) {
      g.fillStyle = "#ffffff";
      g.fillRect(x - 1, y + sag + 2, 2, 1);
      // A short flare on the brightest beats, which is what sells it as light.
      if (pulse > 0.85) {
        g.fillStyle = c;
        g.fillRect(x - 3, y + sag, 1, 1);
        g.fillRect(x + 3, y + sag + 3, 1, 1);
      }
    }
  }
}

/** Banners strung across the street, with a little movement in the cloth. */
function banners(g: Ctx, LW: number, y: number, t: number) {
  const n = Math.max(3, Math.floor(LW / 60));
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (LW / n);
    const lift = Math.sin(t * 2 + i) > 0.6 ? 1 : 0;
    g.fillStyle = "#20202c";
    g.fillRect(x - 18, y, 36, 1);
    g.fillStyle = i % 2 ? "#d0403a" : "#f0c030";
    g.fillRect(x - 16, y + 1, 32, 4 + lift);
    g.fillStyle = "#ffffff";
    g.fillRect(x - 8, y + 2, 16, 2);
  }
}

/** Flags on poles along the pavement. */
function flags(g: Ctx, LW: number, y: number, t: number) {
  const n = Math.max(4, Math.floor(LW / 40));
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (LW / n);
    const wave = Math.sin(t * 3 + i * 1.3) > 0 ? 1 : 0;
    g.fillStyle = "#c8c8d0";
    g.fillRect(x, y - 8, 1, 8);
    g.fillStyle = ["#e06040", "#40a060", "#4060c0"][i % 3];
    g.fillRect(x + 1, y - 8 + wave, 6, 4);
  }
}

/**
 * Draws everything the room has lit up.
 *
 * `lit` is the set of rewards cleared so far rather than a per-mission flag:
 * two missions can hand out the same decoration, and lit twice is still lit
 * once.
 */
export function drawDecorations(
  g: Ctx,
  lit: Decoration[],
  LW: number,
  skyY: number,
  groundY: number,
  t: number,
  night: number,
) {
  if (!lit.length) return;
  const n = clamp(lit.length, 0, 3);
  for (let i = 0; i < n; i++) {
    // Each decoration gets its own band of the sky, so four of them do not
    // stack into one stripe across the top of the picture.
    const y = skyY + 8 + i * 9;
    const phase = i * 2.1;
    if (lit[i] === "lights") lights(g, LW, y, t, phase);
    else if (lit[i] === "banners") banners(g, LW, y, t);
    else flags(g, LW, groundY - 6, t);
  }
  // At night the decorations are the point, so they get a wash of their own.
  if (night > 0.4 && lit.length) {
    g.globalAlpha = (night - 0.4) * 0.10;
    g.fillStyle = "#ffd95d";
    g.fillRect(0, skyY, LW, groundY - skyY);
    g.globalAlpha = 1;
  }
}