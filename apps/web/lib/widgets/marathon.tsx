"use client";

import { useEffect, useRef, useState } from "react";
import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Milestone counter.
 *
 * A viewer count that only goes up is a number. A count that goes "400… 450…
 * 500 🎉" is an event, and the moment somebody in the chat notices is the point.
 * The same trick works for anything countable — messages this stream, follows,
 * gifts — so the metric is a setting rather than being hardwired to viewers.
 *
 * The counter is cumulative for the scene and deliberately not persisted: a
 * fresh stream should start at zero, and a board claiming 4,000 messages on a
 * stream with forty is worse than no board.
 */

type Metric = "viewers" | "comment" | "follow" | "gift" | "like" | "join";

const nf = new Intl.NumberFormat("en-US");

function Marathon({ style, entries, viewers, sceneId }: WidgetProps) {
  const metric = (str(style, "metric", "comment") || "comment") as Metric;
  const step = Math.max(1, num(style, "step", 50));
  const max = num(style, "max", 999999);
  const label = str(style, "label", "");

  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);
  const total = useRef(0);
  const lastSeq = useRef(0);
  const lastViewers = useRef<number | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    total.current = 0;
    lastSeq.current = 0;
    lastViewers.current = null;
    loaded.current = true;
    setCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  // Flash the row when a threshold is crossed, and hold it briefly after. The
  // threshold is a round number so the "500" on screen is the actual milestone
  // rather than an off-by-one that makes the banner lie.
  const crossed = (n: number) => n > 0 && n % step === 0;

  useEffect(() => {
    if (!loaded.current) return;
    if (metric === "viewers") {
      if (viewers === null || viewers === lastViewers.current) return;
      lastViewers.current = viewers;
      // The peak, not the current value: a room that hit 5,000 and dropped to
      // 900 has still hosted 5,000, and resetting to 900 on every dip would
      // make the milestone unreachable.
      total.current = Math.max(total.current, viewers);
      setCount(Math.min(total.current, max));
      if (crossed(total.current)) {
        setPulse(true);
        setTimeout(() => setPulse(false), num(style, "hold", 2500));
      }
      return;
    }

    const fresh = entries.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = entries[entries.length - 1].seq;

    const before = total.current;
    for (const e of fresh) {
      if (e.kind !== metric) continue;
      // A like event reports how many were sent, not one, so it is worth more
      // than a single tick — otherwise the counter crawls for the most common
      // event on the platform. A gift is the same: a storm of roses should move
      // the bar, not add one.
      const n =
        metric === "like" || metric === "gift"
          ? Number(e.meta.count ?? 1) || 1
          : 1;
      total.current += n;
    }
    if (total.current === before) return;
    setCount(Math.min(total.current, max));
    if (crossed(total.current)) {
      setPulse(true);
      setTimeout(() => setPulse(false), num(style, "hold", 2500));
    }
  });

  if (!count) return null;

  const toNext = step - (count % step);
  const remaining = count % step === 0 ? 0 : toNext;

  return (
    <div className={`sk-marathon${pulse ? " is-pulsing" : ""}`}>
      <span className="sk-marathon-count">{nf.format(count)}</span>
      {label ? <span className="sk-marathon-label">{label}</span> : null}
      {bool(style, "show-progress", true) && remaining > 0 ? (
        <span className="sk-marathon-next">
          {nf.format(remaining)} to {nf.format(Math.ceil(count / step) * step)}
        </span>
      ) : null}
    </div>
  );
}

export const marathonWidget: WidgetType = {
  id: "marathon",
  label: "Milestone counter",
  icon: "🎯",
  blurb: "A tally that celebrates every N — messages, viewers, follows.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 55,
    radius: 20,
    pad: 10,
    gap: 8,
    size: 26,
    "label-size": 13,
    weight: 800,
    accent: "#4ecdc4",
    metric: "comment",
    label: "messages",
    step: 50,
    max: 999999,
    hold: 2500,
    "show-progress": true,
  },
  kinds: ["comment", "like", "gift", "follow", "join"],
  groups: [
    {
      title: "What to count",
      controls: [
        {
          kind: "select",
          key: "metric",
          label: "Metric",
          options: [
            { value: "comment", label: "Messages" },
            { value: "viewers", label: "Viewer peak" },
            { value: "follow", label: "Follows" },
            { value: "gift", label: "Gifts" },
            { value: "like", label: "Likes" },
            { value: "join", label: "Joins" },
          ],
        },
        { kind: "text", key: "label", label: "Label", placeholder: "messages" },
      ],
    },
    {
      title: "Milestones",
      controls: [
        { kind: "number", key: "step", label: "Celebrate every", min: 1, max: 100000 },
        { kind: "number", key: "max", label: "Stop counting at", min: 1, max: 10000000 },
        { kind: "toggle", key: "show-progress", label: "Show progress to next" },
        { kind: "range", key: "hold", label: "Flash for", min: 500, max: 10000, step: 100, suffix: "ms" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "color", key: "accent", label: "Accent" },
        { kind: "range", key: "size", label: "Number size", min: 12, max: 80, suffix: "px" },
        { kind: "range", key: "label-size", label: "Label size", min: 8, max: 28, suffix: "px" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad", label: "Padding", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "gap", label: "Gap", min: 0, max: 24, suffix: "px" },
      ],
    },
  ],
  Component: Marathon,
};
