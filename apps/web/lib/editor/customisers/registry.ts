"use client";

import type { ComponentType } from "react";
import type { CustomiserProps } from "@/lib/widgets/types";
import { AstronautCustomizer } from "./AstronautCustomizer";
import { LiveChatCustomizer } from "./LiveChatCustomizer";

/**
 * Widgets that replace the generated form with a bespoke one.
 *
 * Kept here rather than on the widget's own registry entry so that the
 * dependency runs editor → widget and never the other way. A widget importing
 * its customiser would pull the editor's form primitives into the bundle OBS
 * loads, where they can never render.
 *
 * A widget absent from this map gets the form generated from its `groups`, so
 * adding a simple widget still costs one file and no editor code.
 */
const CUSTOMISERS: Record<string, ComponentType<CustomiserProps>> = {
  astro: AstronautCustomizer,
  chat: LiveChatCustomizer,
};

export function customiserFor(type: string): ComponentType<CustomiserProps> | undefined {
  return CUSTOMISERS[type];
}
