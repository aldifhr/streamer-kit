import type { CSSProperties } from "react";

/**
 * Where an overlay's widget sits inside the frame it is given.
 *
 * An overlay is a single widget and OBS owns its position and size, so there is
 * no layout to compute. The widget's stored `x`/`y` are the one thing left over
 * from the scene format, kept for a single reason: a chat column that used to
 * sit in the bottom-left of a composed scene should not jump to the top-left
 * once the scene is gone.
 *
 * So this is edge anchoring — an inset from one edge plus a compensating
 * translate. It was `justify-content` and `align-items` first, which is inert
 * here and reads as though it should work: `.sk-widget` is `position: absolute`
 * with no inset and no width, so it shrink-wraps its own content and has no
 * free space for either property to distribute, and with every inset left auto
 * it sits at its static position. Every non-full-frame overlay rendered in the
 * top-left corner, `x`/`y` ignored, and the only place that shows is OBS.
 *
 * `fill` is a parameter rather than something the caller remembers: a
 * full-frame widget is pinned by the `.sk-fill` class, and an inline inset or
 * transform beats a class, so applying this to one would give the astronaut
 * canvas a corner to sit in.
 */
export function anchorTo(x: number, y: number, fill = false): CSSProperties {
  if (fill) return {};

  // The same 0.4/0.6 bands ScenePreview uses, so the landing page and a live
  // overlay agree on what "centred" means.
  const centreX = x > 0.4 && x < 0.6;
  const centreY = y > 0.4 && y < 0.6;
  const fromRight = x >= 0.6;
  const fromBottom = y >= 0.6;

  // Exactly one horizontal anchor and one vertical anchor, never two: setting
  // left and right together would stretch the box to the frame instead of
  // letting it hug its content in a corner.
  return {
    left: centreX ? "50%" : fromRight ? "auto" : "0",
    right: fromRight ? "0" : "auto",
    top: centreY ? "50%" : fromBottom ? "auto" : "0",
    bottom: fromBottom ? "0" : "auto",
    // The translate is what makes a corner mean anything: a bottom-right widget
    // has to grow leftwards and upwards as its content grows, or a long chat
    // column runs off the frame instead of off its own corner.
    transform: `translate(${
      centreX ? "-50%" : fromRight ? "-100%" : "0%"
    }, ${centreY ? "-50%" : fromBottom ? "-100%" : "0%"})`,
  };
}
