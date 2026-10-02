"use client";

/**
 * The pixel city, as a widget.
 *
 * The engine owns the loop and all the state; this file mounts a canvas, hands
 * it a scene id so two overlays in one browser do not share a city, and pushes
 * events and config in from effects. The effect that consumes entries is keyed
 * on the entries themselves, never on a remount: remounting would clear the
 * city and throw every resident off screen mid-stream.
 */

import { useEffect, useRef } from "react";
import { takeNew } from "../astro/consume";
import { createCityEngine } from "./engine";
import type { CityEngine } from "./config";
import { DEFAULT_CITY_CONFIG } from "./config";
import type { CityConfig } from "./config";
import type { WidgetProps, WidgetType } from "../types";
import { toConfig } from "./style";


function City({ style, entries, sceneId }: WidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CityEngine | null>(null);
  // The highest seq already handed to the engine, so a re-render caused by
  // anything but a new event does not replay the buffer. Without this, XP was
  // paid again for every event still in the ring on each render.
  const consumedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Namespaced per scene, like the alien scene: two overlays sharing a
    // browser profile would otherwise share one city and one set of residents.
    const engine = createCityEngine({ canvas, config: toConfig(style) });
    engineRef.current = engine;

    const measure = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) engine.resize(r.width, r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
      consumedRef.current = 0;
    };
    // Created once per scene id; config and events are pushed by the effects
    // below. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  useEffect(() => {
    engineRef.current?.configure(toConfig(style));
  }, [style]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { fresh, consumed } = takeNew(entries, consumedRef.current);
    if (fresh.length === 0) return;
    consumedRef.current = consumed;
    for (const entry of fresh) engine.handle(entry);
  }, [entries]);

  return (
    <canvas
      ref={canvasRef}
      className="sk-fill"
      // Not via a stylesheet class: this canvas is the entire scene, so its size
      // and the pixelated upscale are load-bearing, not decoration.
      style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
    />
  );
}

export const cityWidget: WidgetType = {
  Component: City,
  id: "city",
  label: "City",
  icon: "🏙️",
  blurb: "Your chat walks the streets of a pixel city, earning XP and rank as they go.",
  unique: true,
  fill: true,
  defaults: {
    "max-people": 45,
    "leave-after": 300,
    "day-len": 300,
    "pin-hour": false,
    "pinned-hour": 0.3,
    "label-top": 5,
    "label-active": 10,
    "bad-words": "anjing, bangsat, kontol, memek, asu, fuck, shit",
    "pixel-size": 0,
    transparent: false,
    "city-name": "",
    "party-gift": 500,
    "plane-gift": 100,
    "show-hud": true,
    "show-labels": true,
  },
  // `leave` is not an EventKind — there is no leave event on the wire. Residents
  // go home on the `leave-after` idle timer, and an explicit exit is not needed
  // for a re-render to be safe. `join` is in so someone can walk in before they
  // say anything.
  // `viewers` is what sizes the city. Left out of this list the scene never
  // receives a single audience update, which is not a degraded city — it is a
  // permanent "KAMPUNG 0" no matter how full the room is, because the entry is
  // filtered out before the engine is handed it.
  kinds: ["viewers", "comment", "like", "follow", "share", "gift", "join"],
  groups: [
    {
      title: "Roster",
      controls: [
        { kind: "number", key: "max-people", label: "Max residents", min: 16, max: 45 },
        { kind: "range", key: "leave-after", label: "Leave after", min: 30, max: 900, step: 30, suffix: "s" },
      ],
    },
    {
      title: "Day and night",
      controls: [
        { kind: "range", key: "day-len", label: "Day length", min: 30, max: 1800, step: 30, suffix: "s" },
        { kind: "toggle", key: "pin-hour", label: "Freeze the clock" },
        { kind: "range", key: "pinned-hour", label: "Pinned hour", min: 0, max: 0.99, step: 0.01 },
        { kind: "text", key: "city-name", label: "City name", placeholder: "e.g. Jakarta" },
      ],
    },
    {
      title: "Rewards",
      controls: [
        { kind: "range", key: "plane-gift", label: "Banner plane at", min: 10, max: 2000, step: 10, suffix: "💎" },
        { kind: "range", key: "party-gift", label: "City party at", min: 50, max: 5000, step: 10, suffix: "💎" },
      ],
    },
    {
      title: "Display",
      controls: [
        { kind: "number", key: "pixel-size", label: "Pixel size", min: 0, max: 12 },
        { kind: "number", key: "label-top", label: "Top labels", min: 0, max: 20 },
        { kind: "range", key: "label-active", label: "Label for", min: 1, max: 60, suffix: "s" },
        { kind: "toggle", key: "show-labels", label: "Name plates" },
        { kind: "toggle", key: "show-hud", label: "HUD" },
        { kind: "toggle", key: "transparent", label: "Residents only" },
      ],
    },
    {
      title: "Chat",
      controls: [{ kind: "text", key: "bad-words", label: "Blocklist" }],
    },
  ],
};
