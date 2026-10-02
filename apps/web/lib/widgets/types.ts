/**
 * Widget contract.
 *
 * A widget is a self-contained unit of the scene: it declares the event kinds
 * it subscribes to, the style keys it owns, and the controls the editor should
 * draw for it. Adding one is a new file plus a line in `registry.ts` — the
 * scene renderer and the editor both read this shape, so neither has to learn
 * about the new widget.
 */

import type { ComponentType } from "react";
import type { GlobalStyle, StyleMap, StyleValue } from "@/lib/css";

/** Every kind the backend can emit. Mirrors apps/api/events.py. */
export type EventKind =
  | "comment"
  | "like"
  | "gift"
  | "join"
  | "follow"
  | "share"
  | "viewers"
  | "alert";

/** An inbound message, normalised once at the socket rather than per widget. */
export interface Entry {
  id: string;
  seq: number;
  /** Wall-clock arrival, used by the shared expiry sweep. */
  ts: number;
  kind: EventKind;
  user: string;
  /**
   * Stable per-viewer key. Falls back to the nickname when the backend has no
   * better handle, so a widget that keeps state per viewer always has a key —
   * a less durable one, but never an empty one that would merge every
   * anonymous viewer into a single entry.
   */
  userId: string;
  /** Bare payload. The verb belongs to the renderer, not the wire. */
  value: string;
  meta: Record<string, unknown>;
}

/* -------------------------------------------------------------------------
 * editor controls
 *
 * Declarative on purpose. The editor builds a form from these, so a new widget
 * brings its own settings UI as data and the editor stays unchanged.
 * ---------------------------------------------------------------------- */

export interface ControlOption {
  value: string;
  label: string;
}

export type Control =
  | { kind: "range"; key: string; label: string; min: number; max: number; step?: number; suffix?: string }
  | { kind: "color"; key: string; label: string; opacityKey?: string }
  | { kind: "segmented"; key: string; label: string; options: ControlOption[] }
  | { kind: "select"; key: string; label: string; options: ControlOption[] }
  | { kind: "toggle"; key: string; label: string }
  /**
   * A toggle over a numeric style, for knobs like border width where "off" is
   * a real value (0px) rather than a boolean. A plain `toggle` would have to
   * write `true` into a slot the stylesheet reads as a length.
   */
  | { kind: "numericToggle"; key: string; label: string; on: number; off: number }
  | { kind: "text"; key: string; label: string; placeholder?: string }
  | { kind: "number"; key: string; label: string; min?: number; max?: number };

export interface ControlGroup {
  title?: string;
  controls: Control[];
}

/* -------------------------------------------------------------------------
 * widget
 * ---------------------------------------------------------------------- */

export interface WidgetProps {
  /** The widget's own style with `defaults` already merged in. */
  style: StyleMap;
  global: GlobalStyle;
  entries: Entry[];
  viewers: number | null;
  /** Scene-level identity, for widgets that need a stable id (goal progress). */
  sceneId: string;
  /**
   * The overlay's own id, which is not the widget's. The poll needs it: the
   * backend keys polls by overlay so one question survives a scene edit, and a
   * poll fetched by widget id could never match the one the editor created.
   */
  overlayId: string;
  /**
   * True when the widget is drawn as a sample rather than as an overlay.
   *
   * The landing page mounts every widget to show what it puts on screen, and it
   * has no overlay to speak of. A widget that addresses the API by overlay id
   * must not go looking: the poll would request `/api/polls/preview-poll`, which
   * asks for an overlay that does not exist, on every visit to a public page.
   * The response is handled — a 404 is not a crash — but a console full of
   * failures for something that was never going to succeed is noise about a real
   * problem, and it is exactly the kind that hides the next one.
   */
  preview?: boolean;
}

export interface WidgetType {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  /** Only one instance of a unique type may exist in a scene. */
  unique?: boolean;
  /**
   * The widget covers the whole scene rather than sitting in a positioned box.
   * For anything that draws its own background or owns the whole frame — the
   * astronaut canvas, for one — where x/y and scale have no meaning.
   */
  fill?: boolean;
  defaults: StyleMap;
  /** Kinds this widget subscribes to. A widget with none is a static display. */
  kinds: EventKind[];
  /**
   * The generated settings form, built from the control descriptors. A widget
   * that ships with no bespoke customiser gets this for free, so a simple
   * widget needs no editor code at all.
   *
   * A widget that needs more than a grid of sliders supplies a customiser
   * instead — see lib/editor/customisers. Those live on the editor side of the
   * boundary deliberately: a widget that imported its own customiser would pull
   * the whole editor into the bundle that OBS loads, where none of it runs.
   */
  groups: ControlGroup[];
  Component: ComponentType<WidgetProps>;
}

/**
 * A widget placed in a scene.
 *
 * Declared here rather than in scene.ts so the widget contract — including the
 * customiser props above — can name it without importing the scene module,
 * which imports the registry, which imports every widget.
 */
export interface WidgetInstance {
  id: string;
  type: string;
  enabled: boolean;
  /** Top-left of the widget as a fraction of the scene, 0..1. */
  x: number;
  y: number;
  scale: number;
  /** Only the keys the user has actually changed, over the widget's defaults. */
  style: StyleMap;
}

/**
 * What a bespoke customiser gets.
 *
 * Deliberately no live event buffer: the editor's iframe already holds the
 * same subscription the overlay uses, so a customiser's job is to change
 * config and to fire test events, and the preview reacts on its own. Handing
 * every customiser the buffer too would mean two subscriptions per scene and
 * no way for a customiser to disagree with what is actually on screen.
 */
export interface CustomiserProps {
  widget: WidgetInstance;
  /** This widget's style with its defaults already merged in. */
  style: StyleMap;
  /**
   * The scene's shared style. A customiser needs it whenever its own settings
   * are only meaningful relative to something global — how many chat lines fit
   * depends on the scene's font size, not on anything the chat widget owns.
   */
  global: GlobalStyle;
  /** Needed to fire a test event at this overlay. */
  overlayId: string;
  onChange: (key: string, value: StyleValue) => void;
  onPatch: (patch: Partial<WidgetInstance>) => void;
}

let seq = 0;
/**
 * An id that stays unique across reloads.
 *
 * A module counter alone is not enough, and the previous version claimed to be
 * collision-free when it was not: `seq` restarts at zero on every page load, so
 * the first widget added in a new session gets the same id as the first one
 * added in the last. Two widgets of the same type in one scene could then share
 * an id, and because `sceneId` is what the counter widgets reset on and what the
 * streaks table is keyed by, a duplicate means a shared key and a shared total.
 *
 * The random suffix is what makes it safe past reloads; the counter is kept so
 * two widgets added in the same breath still differ and stay readable.
 */
export function newWidgetId(type: string): string {
  seq += 1;
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${type}-${seq.toString(36)}-${unique}`;
}
