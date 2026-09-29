"use client";

import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

const nf = new Intl.NumberFormat("en-US");

/**
 * Live viewer count.
 *
 * Subscribes to nothing: the count arrives as scene state rather than as an
 * entry, because it is a value that replaces the previous one, not a message
 * that accumulates. Renders nothing until the first count lands, so an overlay
 * that is loaded but not yet live does not sit there claiming zero viewers.
 */
function Viewers({ style, viewers }: WidgetProps) {
  if (viewers === null) return null;

  const decimals = num(style, "decimals", 0);
  const count = decimals > 0 ? viewers.toFixed(decimals) : nf.format(Math.round(viewers));
  const label = str(style, "label", "viewers");

  return (
    <div className="sk-chip">
      {bool(style, "show-icon", true) ? <span className="sk-chip-icon">👁</span> : null}
      <span className="sk-chip-value">{count}</span>
      {label ? <span className="sk-chip-label">{label}</span> : null}
    </div>
  );
}

export const viewersWidget: WidgetType = {
  id: "viewers",
  label: "Viewer count",
  icon: "👁",
  blurb: "A live count of people in the room.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 60,
    radius: 20,
    "pad-x": 14,
    "pad-y": 7,
    gap: 8,
    size: 20,
    "label-size": 13,
    weight: 700,
    "show-icon": true,
    label: "viewers",
    decimals: 0,
  },
  kinds: [],
  groups: [
    {
      controls: [
        { kind: "text", key: "label", label: "Label", placeholder: "viewers" },
        { kind: "toggle", key: "show-icon", label: "Show icon" },
        { kind: "number", key: "decimals", label: "Decimals", min: 0, max: 1 },
        { kind: "range", key: "size", label: "Number size", min: 10, max: 64, suffix: "px" },
        { kind: "range", key: "label-size", label: "Label size", min: 8, max: 32, suffix: "px" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad-x", label: "Horizontal padding", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad-y", label: "Vertical padding", min: 0, max: 28, suffix: "px" },
        { kind: "range", key: "gap", label: "Gap", min: 0, max: 24, suffix: "px" },
      ],
    },
  ],
  Component: Viewers,
};
