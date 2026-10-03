"use client";

/**
 * The pixel station — the widget surface.
 *
 * A thin shell over the engine. Everything visible is drawn on the canvas, so
 * this exists to size it, subscribe to the entries the station cares about, and
 * hand the editor its controls.
 */

import { useEffect, useMemo, useRef } from "react";
import type { WidgetProps, WidgetType } from "../types";
import { createStationEngine } from "./engine";
import { toStationConfig } from "./config";

function Station({ style, entries }: WidgetProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const boot = useRef(false);
  const engineRef = useRef<ReturnType<typeof createStationEngine> | null>(null);
  const cfg = useMemo(() => toStationConfig(style as Record<string, string | number | boolean | undefined>), [style]);

  useEffect(() => {
    const cv = ref.current;
    // OBS sometimes reports a zero-sized source for a frame or two after the
    // browser source is created, and a canvas laid out at 0x0 stays 0x0 once the
    // engine has sized itself from it.
    if (!cv || boot.current) return;
    if (cv.clientWidth < 8 || cv.clientHeight < 8) return;
    boot.current = true;

    const engine = createStationEngine(document, cv, cfg);
    engine.resize(cv.clientWidth, cv.clientHeight);
    engineRef.current = engine;

    const ro = new ResizeObserver(() => engine.resize(cv.clientWidth, cv.clientHeight));
    ro.observe(cv);
    engine.start();
    return () => {
      ro.disconnect();
      engineRef.current = null;
      boot.current = false;
    };
    // Config is read once on mount: rebuilding the station to apply a new dwell
    // would empty the platform and lose everybody standing on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Entries are replayed by id, not consumed.
   *
   * `entries` is a rolling buffer that the feed rewrites in place and trims, so
   * indexing into it by position would replay the same comment every time the
   * buffer shifted. Keyed on the entry's own id, which is what the buffer
   * guarantees to be stable.
   */
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const e of entries) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      engine.handle(e);
    }
    // Bounded on purpose: the buffer is trimmed upstream, and a set that grows
    // for the life of the page is a slow leak dressed up as a cache.
    if (seen.current.size > 4000) seen.current.clear();
  }, [entries]);

  return (
    <canvas
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        imageRendering: "pixelated",
      }}
    />
  );
}

export const stationWidget: WidgetType = {
  Component: Station,
  id: "station",
  label: "Station",
  icon: "🚉",
  blurb: "A pixel train station. Longer trains and busier platforms as the room fills, and gifts run expresses past.",
  unique: true,
  fill: true,
  // `viewers` is what sizes the station: how long the train is, how often it
  // comes, and how many background passengers are waiting. Left out of this list
  // the scene never learns how many people are watching, which is the one
  // number it exists to reflect.
  kinds: ["viewers", "comment", "like", "gift", "join", "follow", "share"],
  defaults: {
    "max-people": 30,
    "leave-after": 300,
    "dwell": 14,
    "train-gap": 22,
    "day-len": 300,
    "pinned-hour": 0.3,
    "express-gift": 100,
    "party-gift": 500,
    "label-top": 5,
    "label-active": 10,
    "pixel-size": 0,
    "bad-words": "",
    "station-name": "STASIUN KOTA",
    destinations: "PURWOKERTO, BANDUNG, JAKARTA, YOGYAKARTA, SURABAYA, CIREBON, SEMARANG",
  },
  groups: [
    {
      title: "Passengers",
      controls: [
        { kind: "number", key: "max-people", label: "Max passengers", min: 8, max: 45 },
        { kind: "range", key: "leave-after", label: "Leave after", min: 30, max: 900, step: 30, suffix: "s" },
      ],
    },
    {
      title: "Trains",
      controls: [
        { kind: "range", key: "dwell", label: "Doors open for", min: 4, max: 60, suffix: "s" },
        { kind: "range", key: "train-gap", label: "Gap between trains", min: 5, max: 300, step: 5, suffix: "s" },
      ],
    },
    {
      title: "Time",
      controls: [
        { kind: "range", key: "day-len", label: "Day length", min: 30, max: 1800, step: 30, suffix: "s" },
        { kind: "toggle", key: "freeze-clock", label: "Freeze the clock" },
        { kind: "range", key: "pinned-hour", label: "Pinned hour", min: 0, max: 0.99, step: 0.01 },
      ],
    },
    {
      title: "Gifts",
      controls: [
        { kind: "range", key: "express-gift", label: "Express at", min: 10, max: 2000, step: 10, suffix: "💎" },
        { kind: "range", key: "party-gift", label: "Gold train at", min: 50, max: 5000, step: 10, suffix: "💎" },
      ],
    },
    {
      title: "This station",
      controls: [
        { kind: "text", key: "station-name", label: "Station name" },
        { kind: "text", key: "destinations", label: "Destinations" },
      ],
    },
    {
      title: "Look",
      controls: [
        { kind: "number", key: "pixel-size", label: "Pixel size", min: 0, max: 12 },
        { kind: "number", key: "label-top", label: "Top labels", min: 0, max: 20 },
        { kind: "range", key: "label-active", label: "Label for", min: 1, max: 60, suffix: "s" },
      ],
    },
    {
      title: "Content",
      controls: [{ kind: "text", key: "bad-words", label: "Blocklist" }],
    },
  ],
};
