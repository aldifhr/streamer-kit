"use client";

import { useMemo } from "react";
import { selectKinds } from "./select";
import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * A progress bar that fills as gifts arrive.
 *
 * Progress is session state on purpose. It is derived from the gift events the
 * overlay already receives, so there is no round trip and nothing to keep in
 * sync, and it resets when the browser source reloads — which is the correct
 * behaviour for a per-stream goal, and is documented as such.
 */
function Goal({ style, entries }: WidgetProps) {
  const target = Math.max(1, num(style, "target", 100));
  const mode = str(style, "mode", "diamonds");

  const earned = useMemo(() => {
    if (mode === "gifts") {
      return selectKinds(entries, ["gift"]).reduce((sum, e) => sum + num(e.meta, "diamonds", 0), 0);
    }
    if (mode === "follows") {
      return selectKinds(entries, ["follow"]).length;
    }
    return selectKinds(entries, ["like"]).reduce((sum, e) => sum + num(e.meta, "totalLikes", 0), 0);
  }, [entries, mode]);

  const pct = Math.max(0, Math.min(100, (earned / target) * 100));
  const done = pct >= 100;

  return (
    <div className="sk-goal" data-done={done ? "true" : undefined}>
      {bool(style, "show-label", true) ? (
        <div className="sk-goal-head">
          <span className="sk-goal-label">{str(style, "label", "Goal")}</span>
          <span className="sk-goal-count">
            {Math.round(earned)} / {target}
          </span>
        </div>
      ) : null}
      <div className="sk-goal-track">
        <div className="sk-goal-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export const goalWidget: WidgetType = {
  id: "goal",
  label: "Goal bar",
  icon: "🎯",
  blurb: "A bar that fills as gifts, follows or likes come in.",
  unique: true,
  defaults: {
    label: "Stream goal",
    target: 100,
    mode: "diamonds",
    "show-label": true,
    "bar-height": 16,
    radius: 8,
    "track-gap": 8,
    "label-size": 14,
    "max-w": 420,
    bg: "#000000",
    "bg-opacity": 55,
    fill: "#7ce8a4",
  },
  kinds: ["gift", "follow", "like"],
  groups: [
    {
      controls: [
        { kind: "text", key: "label", label: "Label", placeholder: "Stream goal" },
        {
          kind: "segmented",
          key: "mode",
          label: "Counts",
          options: [
            { value: "diamonds", label: "Diamonds" },
            { value: "gifts", label: "Gifts" },
            { value: "follows", label: "Follows" },
            { value: "likes", label: "Likes" },
          ],
        },
        { kind: "number", key: "target", label: "Target", min: 1 },
        { kind: "toggle", key: "show-label", label: "Show label" },
      ],
    },
    {
      title: "Bar",
      controls: [
        { kind: "range", key: "bar-height", label: "Height", min: 4, max: 48, suffix: "px" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 30, suffix: "px" },
        { kind: "range", key: "track-gap", label: "Label gap", min: 0, max: 24, suffix: "px" },
        { kind: "range", key: "label-size", label: "Label size", min: 9, max: 30, suffix: "px" },
        { kind: "range", key: "max-w", label: "Max width", min: 200, max: 900, step: 10, suffix: "px" },
      ],
    },
    {
      title: "Colours",
      controls: [
        { kind: "color", key: "fill", label: "Fill" },
        { kind: "color", key: "bg", label: "Track", opacityKey: "bg-opacity" },
      ],
    },
  ],
  Component: Goal,
};
