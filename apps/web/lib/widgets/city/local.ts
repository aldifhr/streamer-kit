/**
 * The pixel city — local vehicles.
 *
 * A street of sedans and buses reads as anywhere. These read as somewhere
 * specific, which is the difference between a traffic simulation and a place.
 * Each one is a `Car`-shaped record: a sprite, a length, a height, and whether it
 * sheds confetti, so the engine's traffic code does not know or care which is
 * which.
 *
 * The ojek is the one that matters most, so it is drawn with the rider rather
 * than a riderless bike: a green jacket, which is what the jacket is for.
 */

import { mk } from "./scenery";
import { OUT, R, shade } from "./sprites";
import type { Part } from "./sprites";

export type Ctx2 = CanvasRenderingContext2D;

export interface LocalSpec {
  w: number;
  h: number;
  parts: Part[];
  /** Height of the body above the road, for placing it on the lane. */
  carH: number;
}

const GLASS = "#bfe6f5";
const DK = "#1a1a22";

/**
 * Builds one of the local vehicles.
 *
 * The mirroring is done here rather than by the caller so a sprite is always
 * facing right, and the same cache serves both directions by storing the
 * flipped copy under its own key — the same trick the sedan uses.
 */
export function buildLocal(doc: Document, type: string, dir: number): HTMLCanvasElement {
  const spec = specFor(type);
  let c = mk(spec.w + 2, spec.h + 2, doc);
  {
    const g = c.getContext("2d")!;
    g.fillStyle = OUT;
    for (const p of spec.parts) if (!p[5]) g.fillRect(1 + p[0] - 1, 1 + p[1] - 1, p[2] + 2, p[3] + 2);
    for (const p of spec.parts) {
      g.fillStyle = p[4];
      g.fillRect(1 + p[0], 1 + p[1], p[2], p[3]);
    }
  }
  const out = c as HTMLCanvasElement & { carH?: number };
  out.carH = spec.carH;
  if (dir < 0) {
    const f = mk(c.width, c.height, doc);
    const fg = f.getContext("2d")!;
    fg.translate(c.width, 0);
    fg.scale(-1, 1);
    fg.drawImage(c, 0, 0);
    return f as HTMLCanvasElement & { carH?: number };
  }
  return out;
}

function specFor(type: string): LocalSpec {
  switch (type) {
    case "ojek":
      return {
        w: 16,
        h: 12,
        carH: 9,
        parts: [
          [1, 6, 12, 2, "#20242e"],
          [2, 5, 5, 2, "#e04a4a"],
          [3, 4, 3, 1, "#20242e", true],
          // Wheels.
          [1, 8, 3, 3, "#15161c"], [11, 8, 3, 3, "#15161c"],
          [2, 8, 1, 1, "#8a8a96", true], [12, 8, 1, 1, "#8a8a96", true],
          // Handlebars and mirror.
          [4, 5, 1, 2, "#3a3a44"], [2, 4, 1, 1, "#3a3a44", true],
          // The rider. The green jacket is the whole point of the vehicle.
          [5, 2, 4, 3, "#1a9a4a"],
          [5, 2, 4, 1, "#158040", true],
          [5, 0, 3, 2, "#e8b48a"],
          [4, 0, 4, 1, "#1a1a1a"],
          [6, 3, 3, 1, "#e8b48a"],
        ],
      };

    case "angkot":
      return {
        w: 34,
        h: 14,
        carH: 12,
        parts: [
          [0, 2, 34, 9, "#2a6ac0"],
          [0, 2, 34, 1, "#4a8ae0", true],
          [0, 10, 34, 1, shade("#2a6ac0", 0.7), true],
          // Windscreen and the side windows of a minibus.
          [28, 3, 5, 5, GLASS],
          [4, 3, 4, 3, GLASS, true], [11, 3, 4, 3, GLASS, true], [18, 3, 4, 3, GLASS, true],
          // The route board, because an angkot that does not say where it is
          // going is just a van.
          [13, 0, 8, 2, "#f0f0e8"],
          [14, 0, 2, 2, "#d04030", true], [17, 0, 2, 2, "#2a6ac0", true],
          [3, 11, 5, 3, DK], [26, 11, 5, 3, DK],
          [1, 5, 1, 2, "#ffe9a0", true], [33, 5, 1, 2, "#ff4a4a", true],
        ],
      };

    case "becak":
      return {
        w: 20,
        h: 15,
        carH: 11,
        parts: [
          // The hood, and the seat under the canopy.
          [0, 6, 20, 3, "#2a8a4a"],
          [0, 5, 20, 1, "#1a6a3a", true],
          [3, 3, 14, 3, "#1a5a34"],
          [4, 2, 12, 1, "#c8a848"],
          // Canopy frame.
          [2, 2, 1, 5, "#3a3a44"], [17, 2, 1, 5, "#3a3a44"],
          [2, 1, 16, 1, "#3a3a44"],
          // One big wheel at the back, two small at the front.
          [0, 9, 4, 5, "#15161c"], [1, 10, 1, 1, "#8a8a96", true],
          [6, 10, 3, 3, "#15161c"], [15, 10, 3, 3, "#15161c"],
          [7, 10, 1, 1, "#8a8a96", true], [16, 10, 1, 1, "#8a8a96", true],
          // A passenger.
          [8, 3, 4, 3, "#e0b030"],
          [8, 0, 3, 2, "#f6d0b0"],
          [8, 0, 3, 1, "#2a1a12"],
        ],
      };

    case "bakso":
      return {
        w: 22,
        h: 14,
        carH: 10,
        parts: [
          // Cart, wheels, and the pot.
          [2, 7, 18, 4, "#8a5a2a"],
          [2, 7, 18, 1, "#a06a32", true],
          [3, 11, 3, 3, "#15161c"], [16, 11, 3, 3, "#15161c"],
          [8, 4, 7, 3, "#6a6a74"],
          [8, 4, 7, 1, "#c8c8d0", true],
          [7, 3, 9, 1, "#a0a0ac"],
          // Steam.
          [9, 1, 1, 2, "#e8e8f0", true], [12, 0, 1, 3, "#e8e8f0", true],
          // Vendor, pushing it.
          [0, 3, 3, 2, "#e8b48a"], [0, 1, 3, 2, "#f0f0f0"],
          [0, 5, 3, 2, "#d0403a"],
          [3, 6, 1, 1, "#3a3a44"],
        ],
      };

    case "firetruck":
      return {
        w: 30,
        h: 14,
        carH: 11,
        parts: [
          [0, 3, 30, 7, "#d03028"],
          [0, 3, 30, 1, "#f05048", true],
          [0, 9, 30, 1, shade("#d03028", 0.7), true],
          // Cab.
          [22, 0, 8, 6, "#d03028"],
          [24, 1, 5, 3, GLASS],
          // Ladder on the back, which is the silhouette everyone recognises.
          [2, 0, 18, 1, "#d8d8e0"],
          [3, 0, 1, 2, "#d8d8e0", true], [8, 0, 1, 2, "#d8d8e0", true],
          [13, 0, 1, 2, "#d8d8e0", true], [18, 0, 1, 2, "#d8d8e0", true],
          [3, 11, 5, 3, DK], [22, 11, 5, 3, DK],
          // The light bar, which the engine strobes during a fire.
          [24, 6, 2, 1, "#ffe9a0", true], [27, 6, 2, 1, "#ffe9a0", true],
          [0, 5, 1, 2, "#ff4a4a", true],
        ],
      };

    default:
      return { w: 20, h: 10, carH: 8, parts: [[0, 3, 20, 5, "#8a8a96"]] };
  }
}

/**
 * The traffic mix.
 *
 * Weighted rather than uniform because these are not interchangeable: an angkot
 * at the same rate as a becak turns the street into a car park, and an ojek is
 * the one that should always be there.
 */
export const LOCAL_MIX: { type: string; weight: number }[] = [
  { type: "ojek", weight: 34 },
  { type: "angkot", weight: 12 },
  { type: "becak", weight: 10 },
  { type: "bakso", weight: 8 },
  { type: "sedan", weight: 14 },
  { type: "taxi", weight: 8 },
  { type: "van", weight: 6 },
  { type: "bus", weight: 5 },
  // No limo here, and that is the whole point of the list being traffic rather
  // than vehicles. The limo trails confetti, so one in ordinary traffic sprays
  // confetti for as long as the city is running — a parade car that never stops
  // parading. Parade-only vehicles are spawned by the staged effect that is
  // about to be a parade, and nowhere else.
];

export function pickLocalType(rand: () => number): string {
  const total = LOCAL_MIX.reduce((s, e) => s + e.weight, 0);
  let t = rand() * total;
  for (const e of LOCAL_MIX) {
    t -= e.weight;
    if (t <= 0) return e.type;
  }
  return "ojek";
}

/** Local traffic is slower than the sedans it shares the road with. */
export function speedFor(type: string, base: number): number {
  if (type === "ojek") return base * 1.35;
  if (type === "becak" || type === "bakso") return base * 0.8;
  if (type === "angkot") return base * 0.9;
  if (type === "firetruck") return base * 1.5;
  return base;
}

/**
 * Only the parade car trails confetti.
 *
 * The bakso cart was put here too, and because it is ordinary traffic rather
 * than part of a parade it sprayed confetti for as long as the city was running:
 * three pieces every 70ms, forever. A celebration on a vehicle that never stops
 * celebrating is not a celebration.
 */
export function trailsConfetti(type: string): boolean {
  return type === "limo";
}

export { R };
