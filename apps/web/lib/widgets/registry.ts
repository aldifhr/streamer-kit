/**
 * The widget registry.
 *
 * The one list that has to change when a widget is added. The scene renderer
 * and the editor both read this and nothing else, so neither grows a branch per
 * feature — which was the failure mode of the flat config this replaced.
 */

import { alertsWidget } from "./alerts";
import { astroWidget } from "./astro/widget";
import { chatWidget } from "./chat";
import { donationJarWidget } from "./donationjar";
import { goalWidget } from "./goal";
import { marathonWidget } from "./marathon";
import { pollWidget } from "./poll";
import { sessionStatsWidget } from "./sessionstats";
import { socialWidget } from "./social";
import { streaksWidget } from "./streaks";
import { textWidget } from "./text";
import { topGiftsWidget } from "./topgifts";
import { viewersWidget } from "./viewers";
import type { WidgetType } from "./types";

export const WIDGET_TYPES: Record<string, WidgetType> = {
  chat: chatWidget,
  alerts: alertsWidget,
  viewers: viewersWidget,
  goal: goalWidget,
  text: textWidget,
  astro: astroWidget,
  streaks: streaksWidget,
  "top-gifts": topGiftsWidget,
  marathon: marathonWidget,
  "session-stats": sessionStatsWidget,
  poll: pollWidget,
  "donation-jar": donationJarWidget,
  social: socialWidget,
};

/** Registration order, which is also the order the "add widget" menu lists. */
export const WIDGET_LIST: WidgetType[] = [
  chatWidget,
  alertsWidget,
  astroWidget,
  viewersWidget,
  goalWidget,
  textWidget,
  streaksWidget,
  topGiftsWidget,
  marathonWidget,
  sessionStatsWidget,
  pollWidget,
  donationJarWidget,
  socialWidget,
];

export function widgetType(id: string): WidgetType | undefined {
  return WIDGET_TYPES[id];
}

/** Kinds any widget in the scene can receive, for the dashboard trigger picker. */
export function allKinds(): string[] {
  return [...new Set(WIDGET_LIST.flatMap((w) => w.kinds))];
}

export type { WidgetType } from "./types";
