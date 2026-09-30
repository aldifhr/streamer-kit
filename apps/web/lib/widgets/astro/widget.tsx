"use client";

import { useEffect, useRef } from "react";
import { bool, num, str } from "@/lib/widgets/style";
import type { WidgetProps, WidgetType } from "@/lib/widgets/types";
import { takeNew } from "@/lib/widgets/astro/consume";
import { createAstroEngine, DEFAULT_ASTRO_CONFIG, type AstroConfig, type AstroEngine } from "./engine";
/** Reads the widget's style bag into the engine's own config shape. */
function toConfig(style: Record<string, unknown>): AstroConfig {
  const list = str(style, "bad-words", "");
  return {
    ...DEFAULT_ASTRO_CONFIG,
    maxAstro: num(style, "max-astro", DEFAULT_ASTRO_CONFIG.maxAstro),
    sleepAfterMs: num(style, "sleep-after", DEFAULT_ASTRO_CONFIG.sleepAfterMs) * 1000,
    despawnAfterMs: num(style, "despawn-after", DEFAULT_ASTRO_CONFIG.despawnAfterMs) * 1000,
    promoteGift: num(style, "promote-gift", DEFAULT_ASTRO_CONFIG.promoteGift),
    asteroidGift: num(style, "asteroid-gift", DEFAULT_ASTRO_CONFIG.asteroidGift),
    rocketGift: num(style, "rocket-gift", DEFAULT_ASTRO_CONFIG.rocketGift),
    labelTop: num(style, "label-top", DEFAULT_ASTRO_CONFIG.labelTop),
    labelActiveMs: num(style, "label-active", DEFAULT_ASTRO_CONFIG.labelActiveMs) * 1000,
    decorStation: num(style, "decor-station", DEFAULT_ASTRO_CONFIG.decorStation),
    decorNebula: num(style, "decor-nebula", DEFAULT_ASTRO_CONFIG.decorNebula),
    badWords: list.split(",").map((w) => w.trim()).filter(Boolean),
    pixelSize: num(style, "pixel-size", 0),
    space: bool(style, "space", true),
    mission: str(style, "mission", ""),
    showHud: bool(style, "show-hud", true),
    showLabels: bool(style, "show-labels", true),
    showFeed: bool(style, "show-feed", true),
    censors: bool(style, "censors", true),
  };
}

/**
 * The astronaut scene.
 *
 * React's job here is narrow on purpose: mount a canvas, size it, and hand new
 * events to the engine. The engine owns its own animation loop, so this
 * component deliberately does not re-render per frame — the only re-renders it
 * causes are the ones new events and config changes already force, which is
 * about one per message rather than sixty per second.
 */
function Astro({ style, entries, sceneId }: WidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AstroEngine | null>(null);
  // Entries already handed over, so a re-render caused by anything other than a
  // new message does not replay the whole buffer into the world.
  const consumedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = createAstroEngine({
      canvas,
      // Namespaced per scene: two overlays sharing a browser profile would
      // otherwise share one roster, and astronauts would appear in the wrong
      // stream.
      storageKey: `astro_pixel_v1:${sceneId}`,
      config: toConfig(style),
    });
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
    // The engine is created once per scene id. Config and events are pushed in
    // by the effects below rather than by remounting, because a remount would
    // throw away every astronaut on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.configure(toConfig(style));
  }, [style]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    // The marker is the highest seq handled, and it is maintained by takeNew
    // rather than here: advancing it on `entries[0].seq` — the oldest entry the
    // ring buffer still holds — left it trailing a long way behind, so every
    // re-render replayed the buffer and `handle()` awarded the XP again. On a
    // busy room the same comment was paid out several times over. The arithmetic
    // and its regression are in tests/astro-consume.cjs.
    const { fresh, consumed } = takeNew(entries, consumedRef.current);
    if (fresh.length === 0) return;
    consumedRef.current = consumed;
    for (const entry of fresh) engine.handle(entry);
  }, [entries]);

  return <canvas ref={canvasRef} className="sk-astro-canvas" />;
}

export const astroWidget: WidgetType = {
  id: "astro",
  label: "Astronauts",
  icon: "🧑‍🚀",
  blurb: "Viewers drift around as pixel astronauts, earning XP and collecting crates.",
  unique: true,
  fill: true,
  defaults: {
    "max-astro": 45,
    "sleep-after": 180,
    "despawn-after": 600,
    "promote-gift": 10,
    "asteroid-gift": 100,
    "rocket-gift": 500,
    "decor-station": 100,
    "decor-nebula": 300,
    "label-top": 8,
    "label-active": 60,
    "bad-words": "anjing, bangsat, kontol, memek, asu, fuck, shit",
    "pixel-size": 0,
    space: true,
    mission: "",
    "show-hud": true,
    "show-labels": true,
    "show-feed": true,
    censors: true,
  },
  // join is in, so the roster reflects who is actually in the room rather than
  // only the handful who have typed something; viewers is in because it is the
  // only leave signal TikTok sends, and it is what retires astronauts.
  kinds: ["comment", "like", "follow", "share", "gift", "join", "viewers"],
  groups: [
    {
      title: "Roster",
      controls: [
        { kind: "number", key: "max-astro", label: "Max on screen", min: 5 },
        { kind: "range", key: "sleep-after", label: "Sleep after", min: 30, max: 600, step: 30, suffix: "s" },
        { kind: "range", key: "despawn-after", label: "Leave after", min: 60, max: 3600, step: 60, suffix: "s" },
      ],
    },
    {
      title: "Rewards",
      controls: [
        { kind: "range", key: "promote-gift", label: "Promote at", min: 1, max: 100, suffix: "💎" },
        { kind: "range", key: "asteroid-gift", label: "Asteroids at", min: 10, max: 2000, step: 10, suffix: "💎" },
        { kind: "range", key: "rocket-gift", label: "Rocket at", min: 10, max: 5000, step: 10, suffix: "💎" },
        { kind: "range", key: "decor-station", label: "Station at", min: 0, max: 2000, step: 10, suffix: "💎" },
        { kind: "range", key: "decor-nebula", label: "Nebula at", min: 0, max: 5000, step: 10, suffix: "💎" },
      ],
    },
    {
      title: "Display",
      controls: [
        { kind: "toggle", key: "space", label: "Space background" },
        { kind: "range", key: "pixel-size", label: "Pixel size", min: 0, max: 12, suffix: "px" },
        { kind: "text", key: "mission", label: "Mission title", placeholder: "MISI: ..." },
        { kind: "toggle", key: "show-hud", label: "Counter" },
        { kind: "toggle", key: "show-feed", label: "Event feed" },
        { kind: "toggle", key: "show-labels", label: "Names" },
        { kind: "range", key: "label-top", label: "Always-named top", min: 0, max: 45 },
        { kind: "range", key: "label-active", label: "Name recent for", min: 5, max: 300, step: 5, suffix: "s" },
      ],
    },
    {
      title: "Moderation",
      controls: [
        { kind: "toggle", key: "censors", label: "Mask profanity" },
        { kind: "text", key: "bad-words", label: "Word list", placeholder: "comma, separated" },
      ],
    },
  ],
  Component: Astro,
};
