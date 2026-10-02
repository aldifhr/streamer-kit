/**
 * The pixel city — what a viewer's gifts buy them.
 *
 * A gift tier is a hat, a bag and an umbrella, kept on that viewer's record
 * across reloads, so the same person walks past the same shop in the same hat
 * tomorrow. Tiers are deliberately coarse: three of them is a wardrobe, and
 * every tier is visible from across the street, which is the point.
 *
 * The umbrella is also the rain responder. A tier-three viewer carries theirs
 * whatever the weather, because they paid for it; everyone else opens one when it
 * starts raining. That is the difference between a gift and a status, and it is
 * the same eight pixels either way.
 */

import type { Part, Pose } from "./sprites";
import { shade } from "./sprites";

/** How much a viewer's gifts are worth, as a wardrobe tier. */
export interface Cos {
  /** 0 none, 1 cap, 2 toyo, 3 crown. */
  hat: number;
  bag: boolean;
  /** Carried regardless of the weather, because they paid for it. */
  umbrella: boolean;
}

export const NO_COS: Cos = { hat: 0, bag: false, umbrella: false };

/**
 * The tier a diamond total buys.
 *
 * Thresholds are on the same scale as the scene's own gift thresholds, so the
 * wardrobe changes at the moment something visibly happens on screen: the banner
 * plane at 100 and the city party at 500 line up with the hat and the crown.
 */
export function tierFor(diamonds: number): number {
  if (diamonds >= 1000) return 3;
  if (diamonds >= 200) return 2;
  if (diamonds >= 50) return 1;
  return 0;
}

export function cosFor(diamonds: number): Cos {
  const tier = tierFor(diamonds);
  return { hat: tier, bag: tier >= 2, umbrella: tier >= 3 };
}

export function isCos(c: unknown): c is Cos {
  return !!c && typeof c === "object" && typeof (c as Cos).hat === "number";
}

/** Headwear, drawn above the head and not mirrored, so it reads the same both ways. */
function hatParts(cos: Cos): Part[] {
  if (cos.hat === 1) {
    // A flat cap, brim forward.
    return [[2, -1, 5, 1, "#2a4a8a"], [3, -2, 4, 1, "#2a4a8a"]];
  }
  if (cos.hat === 2) {
    // A toyo, the conical hat. Reads as Indonesian at four pixels tall.
    return [[4, -3, 1, 2, "#e0c060"], [3, -2, 3, 1, "#e0c060"], [2, -1, 5, 1, "#c8a848"]];
  }
  if (cos.hat === 3) {
    return [[1, -2, 7, 1, "#ffcd3c"], [2, -3, 5, 1, "#ffcd3c"], [4, -4, 1, 1, "#ffcd3c"]];
  }
  return [];
}

/**
 * The umbrella.
 *
 * Drawn as a canopy plus a shaft, held in the near hand. When the holder is
 * walking the canopy sits still while the body bobs, which is what an umbrella
 * does and is also the cheapest way to make rain read at 1x.
 */
export function umbrellaParts(pose: Pose, fabric: string): Part[] {
  const lift = pose.kind === "sit" ? 0 : 1;
  const wf = pose.wf;
  return [
    [2 + wf, -6, 5, 1, shade(fabric, 0.7)],
    [1 + wf, -5, 7, 1, fabric],
    [1 + wf, -4, 7, 1, shade(fabric, 0.85)],
    [4 + wf, -3, 1, 3 + lift, "#5a3a22"],
  ];
}

/** A phone, held up and looked at. Only drawn for the phone activity. */
export function phoneParts(): Part[] {
  return [[6, 3, 2, 3, "#20242e", true], [6, 3, 2, 1, "#8fd0ff", true]];
}

/**
 * Appends the wardrobe to a body.
 *
 * Kept separate from `personParts` so the body itself stays the same eleven
 * pixels it always was, and a gift never changes how someone is built — only
 * what they are carrying.
 */
export function decorate(parts: Part[], cos: Cos, pose: Pose, raining: boolean): Part[] {
  const out = parts.slice();
  if (cos.bag) out.push([0, 7, 2, 4, "#3a4a6a", true]);
  if (cos.hat > 0) out.push(...hatParts(cos));
  if (cos.umbrella || (raining && pose.kind !== "sit")) {
    const fabric = cos.umbrella ? "#e04a4a" : "#4a8ae0";
    for (const p of umbrellaParts(pose, fabric)) out.push(p);
  }
  if (pose.kind === "phone") for (const p of phoneParts()) out.push(p);
  return out;
}
