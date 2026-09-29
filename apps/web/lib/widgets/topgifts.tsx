"use client";

import { useEffect, useRef, useState } from "react";
import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Gift leaderboard.
 *
 * A big gift currently plays a rocket animation and then disappears. Whoever
 * spent a thousand diamonds is gone from the screen a few seconds later, and
 * with them any reason for anyone else to send one — the person who just spent
 * the most is exactly the person the room should be able to see.
 *
 * Totals accumulate for the whole session, in the same per-scene storage key the
 * streaks board uses. Deliberately not persisted: a leaderboard that outlives
 * the stream would show yesterday's top gifters during today's stream, and a
 * fresh scene should start clean.
 */

interface Row {
  user: string;
  diamonds: number;
  count: number;
}

const nf = new Intl.NumberFormat("en-US");

function TopGifts({ style, entries, sceneId }: WidgetProps) {
  const key = `streamkit:gifts:${sceneId}`;
  const max = num(style, "max", 5);
  const min = num(style, "min", 1);
  const showDiamonds = bool(style, "show-diamonds", true);
  const showCount = bool(style, "show-count", false);

  const [rows, setRows] = useState<Row[]>([]);
  const totals = useRef<Record<string, Row>>({});
  const lastSeq = useRef(0);
  const loaded = useRef(false);

  useEffect(() => {
    totals.current = {};
    loaded.current = true;
    setRows(rank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    const fresh = entries.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = entries[entries.length - 1].seq;

    let changed = false;
    for (const e of fresh) {
      if (e.kind !== "gift") continue;
      // The wire carries the value under `value`; `diamonds` is what a
      // triggered gift uses, so both are read rather than assuming one.
      const value = Number(e.meta.diamonds ?? e.value ?? 0);
      if (!(value > 0)) continue;
      const prev = totals.current[e.userId];
      const count = Number(e.meta.count ?? 1) || 1;
      totals.current[e.userId] = {
        user: e.user || prev?.user || e.userId,
        diamonds: (prev?.diamonds ?? 0) + value * Math.max(1, count),
        count: (prev?.count ?? 0) + Math.max(1, count),
      };
      changed = true;
    }
    if (changed) setRows(rank());
  });

  function rank(): Row[] {
    return Object.values(totals.current)
      .filter((r) => r.diamonds >= min)
      .sort((a, b) => b.diamonds - a.diamonds)
      .slice(0, max);
  }

  if (!rows.length) return null;

  return (
    <div className="sk-gifts">
      {bool(style, "show-title", true) && str(style, "title", "top gifter") ? (
        <div className="sk-gifts-title">{str(style, "title", "top gifter")}</div>
      ) : null}
      {rows.map((r, i) => (
        <div className={`sk-gift-row${i === 0 ? " is-first" : ""}`} key={`${r.user}-${i}`}>
          <span className="sk-gift-rank">{i + 1}</span>
          <span className="sk-gift-user">{r.user}</span>
          {showDiamonds ? (
            <span className="sk-gift-diamonds">
              💎 {nf.format(r.diamonds)}
            </span>
          ) : null}
          {showCount ? <span className="sk-gift-count">×{nf.format(r.count)}</span> : null}
        </div>
      ))}
    </div>
  );
}

export const topGiftsWidget: WidgetType = {
  id: "top-gifts",
  label: "Top gifter",
  icon: "🎁",
  blurb: "Who has spent the most this session.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 55,
    radius: 16,
    pad: 10,
    gap: 6,
    size: 14,
    "title-size": 11,
    weight: 700,
    accent: "#ff5c8a",
    "show-title": true,
    title: "top gifter",
    "show-diamonds": true,
    "show-count": false,
    max: 5,
    min: 1,
  },
  kinds: ["gift"],
  groups: [
    {
      title: "Board",
      controls: [
        { kind: "toggle", key: "show-title", label: "Show title" },
        { kind: "text", key: "title", label: "Title", placeholder: "top gifter" },
        { kind: "number", key: "max", label: "How many", min: 1, max: 20 },
        { kind: "number", key: "min", label: "Minimum diamonds", min: 0, max: 10000 },
      ],
    },
    {
      title: "Rows",
      controls: [
        { kind: "toggle", key: "show-diamonds", label: "Show diamonds" },
        { kind: "toggle", key: "show-count", label: "Show gift count" },
        { kind: "range", key: "size", label: "Row size", min: 9, max: 32, suffix: "px" },
        { kind: "range", key: "title-size", label: "Title size", min: 8, max: 24, suffix: "px" },
        { kind: "range", key: "gap", label: "Row gap", min: 0, max: 20, suffix: "px" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "color", key: "accent", label: "Accent" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad", label: "Padding", min: 0, max: 32, suffix: "px" },
      ],
    },
  ],
  Component: TopGifts,
};
