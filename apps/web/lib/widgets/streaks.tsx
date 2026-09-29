"use client";

import { useEffect, useRef, useState } from "react";
import { num, str, bool } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Chat streaks.
 *
 * The gap this fills: XP is cumulative and quiet. Someone who has typed ten
 * messages in a row and someone who has typed ten across an hour look identical
 * in every other widget, because a comment widget shows the message and then
 * forgets it. On a live stream the person who keeps talking back is part of the
 * show, and there was no way to show that.
 *
 * State is per-user and survives a reload, in the same localStorage key the
 * astronaut engine uses, so the two agree about who has been around. Kept in
 * memory for the session and written on a timer: the overlay lives for hours,
 * and writing on every comment would be a write per keystroke of traffic.
 */

interface Streak {
  count: number;
  last: number;
}

const nf = new Intl.NumberFormat("en-US");

function load(key: string): Record<string, Streak> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

function Streaks({ style, entries, sceneId }: WidgetProps) {
  // Per scene, and it has to be: the streak table is persisted, so a global key
  // would carry the last room's top talkers onto this room's board. `topgifts`
  // scopes its key the same way.
  const storageKey = str(style, "storage", "") || `streamkit:streaks:${sceneId}`;
  const gapMs = num(style, "reset-after", 90) * 1000;
  const max = num(style, "max", 8);
  const minStreak = num(style, "min", 2);
  const decay = num(style, "decay", 30) * 1000;

  const [rows, setRows] = useState<{ name: string; count: number }[]>([]);
  const table = useRef<Record<string, Streak>>({});
  // Nickname for a key, kept beside the streak table because the event that
  // carries it may be far older than the row it is needed for.
  const names = useRef<Record<string, string>>({});
  const lastSeq = useRef(0);
  const loaded = useRef(false);
  const dirty = useRef(false);

  // Ranked by streak, and only the ones actually on a run — a viewer with one
  // message is not on a streak and listing them would dilute the board.
  function rank() {
    return Object.entries(table.current)
      .filter(([, s]) => s.count >= minStreak)
      .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
      .slice(0, max)
      .map(([id, s]) => ({ name: names.current[id] || id, count: s.count }));
  }

  // Read the store once. Doing it during render would be a localStorage hit on
  // every frame of a canvas scene, which is where this widget may well live.
  useEffect(() => {
    table.current = load(storageKey);
    loaded.current = true;
    setRows(rank());
    // Re-reading on a key change is deliberate: a different overlay id is a
    // different crowd, and carrying one room's streaks into the next is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!loaded.current) return;
    const fresh = entries.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = entries[entries.length - 1].seq;

    const now = Date.now();
    let changed = false;
    for (const e of fresh) {
      // Only chat counts towards a streak. A like storm from one person is not
      // a conversation, and counting it would hand the top spot to someone who
      // has never said a word.
      if (e.kind !== "comment") continue;
      const prev = table.current[e.userId];
      const count = !prev || now - prev.last > gapMs ? 1 : prev.count + 1;
      table.current[e.userId] = { count, last: now };
      if (e.user) names.current[e.userId] = e.user;
      changed = true;
    }
    if (changed) {
      setRows(rank());
      dirty.current = true;
    }
  });

  // One write per interval rather than one per comment, and a decaying display
  // so a row that has gone quiet fades instead of claiming an active streak.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      // A streak that has not been extended in a while is over; dropping it
      // here is what keeps the board honest rather than a lifetime record.
      for (const [id, s] of Object.entries(table.current)) {
        if (now - s.last > decay) delete table.current[id];
      }
      if (dirty.current) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(table.current));
          dirty.current = false;
        } catch {
          /* quota or private mode: the board is a nicety */
        }
      }
      setRows(rank());
    }, 1000);
    return () => clearInterval(timer);
  }, [decay, storageKey]);

  if (!rows.length) return null;

  return (
    <div className="sk-streaks">
      {bool(style, "show-title", true) && str(style, "title", "on a run") ? (
        <div className="sk-streaks-title">{str(style, "title", "on a run")}</div>
      ) : null}
      {rows.map((r, i) => (
        <div className="sk-streak" key={`${r.name}-${i}`}>
          <span className="sk-streak-flame">🔥</span>
          <span className="sk-streak-name">{r.name}</span>
          <span className="sk-streak-count">{nf.format(r.count)}</span>
        </div>
      ))}
    </div>
  );
}

export const streaksWidget: WidgetType = {
  id: "streaks",
  label: "Chat streaks",
  icon: "🔥",
  blurb: "Who is on a run of consecutive messages.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 55,
    radius: 16,
    pad: 10,
    // Gap between rows, and separately how long a gap in messages breaks a
    // streak. Two settings, two meanings — a 6px row gap that is also a 90s
    // timeout would have made the layout untunable.
    gap: 6,
    "reset-after": 90,
    size: 14,
    "title-size": 11,
    weight: 700,
    accent: "#ff9f43",
    "show-title": true,
    title: "on a run",
    decay: 300,
    min: 2,
    max: 8,
  },
  kinds: ["comment"],
  groups: [
    {
      title: "Board",
      controls: [
        { kind: "toggle", key: "show-title", label: "Show title" },
        { kind: "text", key: "title", label: "Title", placeholder: "on a run" },
        { kind: "number", key: "max", label: "How many", min: 1, max: 20 },
        { kind: "number", key: "min", label: "Minimum streak", min: 1, max: 50 },
      ],
    },
    {
      title: "Timing",
      controls: [
        {
          kind: "range",
          key: "gap",
          label: "Gap that ends a streak",
          min: 20,
          max: 300,
          step: 5,
          suffix: "s",
        },
        {
          kind: "range",
          key: "decay",
          label: "Drop a streak after",
          min: 30,
          max: 1800,
          step: 30,
          suffix: "s",
        },
      ],
    },
    {
      title: "Text",
      controls: [
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
  Component: Streaks,
};
