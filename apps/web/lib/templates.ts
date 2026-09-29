/**
 * Scene templates.
 *
 * A blank editor with six available widgets is intimidating, and a first-time
 * user has no idea which combination makes a usable stream. These are the
 * starting points offered when creating an overlay — they are a *creation*
 * affordance, not a place in the navigation, because after creation everything
 * is adjustable and the template stops mattering.
 *
 * A template is just the widget list plus a starting theme, so it stays valid
 * as widgets are added or removed.
 */

import { defaultScene, makeWidget, type SceneConfig } from "@/lib/scene";
import type { WidgetType } from "@/lib/widgets/types";

export interface Template {
  id: string;
  label: string;
  blurb: string;
  theme: string;
  /** Widget types, in the order they should appear. */
  widgets: string[];
  icon: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "chat",
    label: "Chat only",
    blurb: "Just the scrolling chat. Nothing else on screen.",
    theme: "streamline",
    widgets: ["chat"],
    icon: "💬",
  },
  {
    id: "chat-alerts",
    label: "Chat + alerts",
    blurb: "Chat in the corner, big centred cards for follows and gifts.",
    theme: "streamline",
    widgets: ["chat", "alerts"],
    icon: "🔔",
  },
  {
    id: "full-kit",
    label: "Full kit",
    blurb: "Chat, alerts, a live viewer count and a goal bar.",
    theme: "cards",
    widgets: ["chat", "alerts", "viewers", "goal"],
    icon: "🧰",
  },
  {
    id: "space",
    label: "Space",
    blurb: "Viewers become pixel astronauts. Comments show up as speech bubbles, so there is no chat column.",
    theme: "outline",
    widgets: ["astro"],
    icon: "🧑‍🚀",
  },
  {
    id: "space-chat",
    label: "Space + chat",
    blurb: "The astronaut scene, with a scrolling chat column alongside it.",
    theme: "outline",
    widgets: ["astro", "chat"],
    icon: "🛰",
  },
  {
    id: "blank",
    label: "Blank",
    blurb: "Start from nothing and add widgets yourself.",
    theme: "streamline",
    widgets: [],
    icon: "⬜",
  },
];

/**
 * Builds a scene from a template.
 *
 * A blank template still gets one widget: a scene with no widgets renders as an
 * empty screen in OBS, which is indistinguishable from a broken overlay and much
 * harder to diagnose than a chat box the user can delete.
 */
export function sceneFromTemplate(templateId: string): SceneConfig {
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const scene = defaultScene();
  scene.theme = template.theme;

  const widgets = template.widgets
    .map((type) => makeWidget(type))
    .filter((w) => w.type);
  scene.widgets = widgets.length > 0 ? widgets : [makeWidget("chat")];
  return scene;
}

/** Widget type ids in the registry, used to validate a template. */
export function templateIsValid(template: Template, known: (id: string) => WidgetType | undefined): boolean {
  return template.widgets.every((t) => known(t));
}
