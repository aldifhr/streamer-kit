/**
 * Typed reads out of a bag of loosely-typed values.
 *
 * Accepts `Record<string, unknown>` rather than `StyleMap` so the same helpers
 * work on a widget's style and on an event's `meta`, which is untyped by the
 * time it has been through JSON.
 */

export function num(bag: Record<string, unknown>, key: string, fallback: number): number {
  const v = bag[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function bool(bag: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = bag[key];
  return typeof v === "boolean" ? v : fallback;
}

export function str(bag: Record<string, unknown>, key: string, fallback: string): string {
  const v = bag[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Segment controls store their choice as a string, so weights do too. */
export const WEIGHTS = [
  { value: "400", label: "Reg" },
  { value: "500", label: "Med" },
  { value: "600", label: "Semi" },
  { value: "700", label: "Bold" },
];

/** Where a widget sits in the scene. Values are read by scene layout, not CSS. */
export const ANCHORS = [
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "top-center", label: "Top centre" },
  { value: "center", label: "Centre" },
];
