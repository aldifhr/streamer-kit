"use client";

import { useEffect, useRef, useState } from "react";
import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Session stats: how long this stream has been up, and how big it has been.
 *
 * The viewer widget shows the count right now, which is the wrong number for
 * anyone who arrives late — a stream that peaked at twelve thousand and settled
 * at nine hundred looks like nine hundred. The peak is the thing worth telling a
 * newcomer, and the elapsed time is what tells them they are watching something
 * with a history rather than a dead overlay.
 *
 * Both are session state on the client, not on the server: the backend would
 * have to keep a start time per overlay, and the overlay page is the only thing
 * that is guaranteed to be running for the whole stream anyway.
 */

const nf = new Intl.NumberFormat("en-US");

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function SessionStats({ style, viewers, sceneId }: WidgetProps) {
  const [peak, setPeak] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(0);
  const high = useRef(0);
  const loaded = useRef(false);

  useEffect(() => {
    started.current = Date.now();
    high.current = 0;
    loaded.current = true;
    setPeak(0);
    setElapsed(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  // A peak is only interesting if it does not fall when the room thins out, so
  // this tracks the high-water mark rather than the live value.
  useEffect(() => {
    if (!loaded.current || viewers === null) return;
    if (viewers > high.current) {
      high.current = viewers;
      setPeak(viewers);
    }
  }, [viewers]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (started.current) setElapsed((Date.now() - started.current) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Nothing to say until the stream is actually live: an overlay loaded but not
  // connected would otherwise advertise a peak of zero and a timer counting a
  // room that is not there.
  if (!peak && !elapsed) return null;

  return (
    <div className="sk-stats">
      {bool(style, "show-time", true) ? (
        <div className="sk-stat">
          <span className="sk-stat-icon">⏱</span>
          <span className="sk-stat-value">{clock(elapsed)}</span>
          {str(style, "time-label", "live") ? (
            <span className="sk-stat-label">{str(style, "time-label", "live")}</span>
          ) : null}
        </div>
      ) : null}
      {bool(style, "show-peak", true) && peak > 0 ? (
        <div className="sk-stat">
          <span className="sk-stat-icon">📈</span>
          <span className="sk-stat-value">{nf.format(peak)}</span>
          {str(style, "peak-label", "peak") ? (
            <span className="sk-stat-label">{str(style, "peak-label", "peak")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const sessionStatsWidget: WidgetType = {
  id: "session-stats",
  label: "Session stats",
  icon: "📈",
  blurb: "How long the stream has run and its high-water mark.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 55,
    radius: 18,
    pad: 10,
    gap: 12,
    size: 18,
    "label-size": 12,
    weight: 700,
    accent: "#a78bfa",
    "show-time": true,
    "time-label": "live",
    "show-peak": true,
    "peak-label": "peak",
  },
  kinds: [],
  groups: [
    {
      title: "Rows",
      controls: [
        { kind: "toggle", key: "show-time", label: "Show elapsed time" },
        { kind: "toggle", key: "show-peak", label: "Show peak viewers" },
        { kind: "text", key: "time-label", label: "Time label", placeholder: "live" },
        { kind: "text", key: "peak-label", label: "Peak label", placeholder: "peak" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "color", key: "accent", label: "Accent" },
        { kind: "range", key: "size", label: "Value size", min: 10, max: 48, suffix: "px" },
        { kind: "range", key: "label-size", label: "Label size", min: 8, max: 24, suffix: "px" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad", label: "Padding", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "gap", label: "Gap", min: 0, max: 40, suffix: "px" },
      ],
    },
  ],
  Component: SessionStats,
};
