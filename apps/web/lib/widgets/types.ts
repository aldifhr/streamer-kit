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
import type { GlobalStyle, StyleMap } from "@/lib/css";

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
}

export interface WidgetType {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  /** Only one instance of a unique type may exist in a scene. */
  unique?: boolean;
  defaults: StyleMap;
  /** Kinds this widget subscribes to. A widget with none is a static display. */
  kinds: EventKind[];
  groups: ControlGroup[];
  Component: ComponentType<WidgetProps>;
}

let seq = 0;
/** Monotonic, collision-free, and valid as a DOM id. */
export function newWidgetId(type: string): string {
  seq += 1;
  return `${type}-${seq.toString(36)}`;
}
