"use client";

import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Static text, or a lower third whose caption rotates through recent events.
 *
 * The rotating mode is the reason this widget exists beyond a plain label: a
 * streamer who wants a "new follower" strip without committing screen space to
 * a full alert stack can bind the caption to the same feed the alerts read.
 */
function Text({ style, entries }: WidgetProps) {
  const rotate = bool(style, "rotate", false);
  const kind = str(style, "kind", "");
  const template = str(style, "template", "{user}");

  const relevant = kind ? entries.filter((e) => e.kind === kind) : entries;
  const latest = relevant[0];

  // In rotate mode an empty feed shows the placeholder rather than nothing, so
  // the strip does not blink in and out between events.
  const body = rotate
    ? latest
      ? template
          .replace("{user}", latest.user)
          .replace("{value}", latest.value)
          .replace("{kind}", latest.kind)
      : str(style, "placeholder", "waiting…")
    : str(style, "text", "");

  if (!body && !rotate) return null;

  return (
    <div className="sk-text-strip">
      <span className="sk-strip-text">{body}</span>
    </div>
  );
}

export const textWidget: WidgetType = {
  id: "text",
  label: "Text strip",
  icon: "🏷",
  blurb: "A caption, or a strip that cycles the latest event.",
  defaults: {
    text: "Live now",
    rotate: false,
    kind: "follow",
    template: "New follower: {user}",
    placeholder: "waiting…",
    size: 20,
    weight: 600,
    "letter": 0,
    align: "flex-start",
    bg: "#0b0b0f",
    "bg-opacity": 70,
    radius: 6,
    "pad-x": 12,
    "pad-y": 6,
    "max-w": 520,
  },
  kinds: [],
  groups: [
    {
      controls: [
        { kind: "toggle", key: "rotate", label: "Rotate through events" },
        { kind: "text", key: "text", label: "Static text" },
        {
          kind: "segmented",
          key: "kind",
          label: "Event",
          options: [
            { value: "", label: "Any" },
            { value: "follow", label: "Follow" },
            { value: "gift", label: "Gift" },
            { value: "like", label: "Like" },
            { value: "comment", label: "Comment" },
          ],
        },
        { kind: "text", key: "template", label: "Template", placeholder: "{user} {value}" },
        { kind: "text", key: "placeholder", label: "Empty text" },
      ],
    },
    {
      title: "Type",
      controls: [
        { kind: "range", key: "size", label: "Size", min: 10, max: 64, suffix: "px" },
        {
          kind: "segmented",
          key: "weight",
          label: "Weight",
          options: [
            { value: "400", label: "Reg" },
            { value: "600", label: "Semi" },
            { value: "700", label: "Bold" },
          ],
        },
        { kind: "range", key: "letter", label: "Letter spacing", min: -2, max: 12, suffix: "px" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 30, suffix: "px" },
        { kind: "range", key: "pad-x", label: "Horizontal padding", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad-y", label: "Vertical padding", min: 0, max: 28, suffix: "px" },
        { kind: "range", key: "max-w", label: "Max width", min: 160, max: 1000, step: 10, suffix: "px" },
      ],
    },
  ],
  Component: Text,
};
