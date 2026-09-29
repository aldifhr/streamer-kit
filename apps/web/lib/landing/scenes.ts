import { DEFAULT_GLOBAL, type GlobalStyle } from "@/lib/css";
import type { SceneConfig, WidgetInstance } from "@/lib/scene";

/**
 * Scenes used by the landing page.
 *
 * Kept out of the preview component deliberately: that file is a client module
 * because the widget components use hooks, and a server component cannot call an
 * exported function from a client module. The data itself has no reason to be
 * client-side.
 */

/** What a fresh overlay usually gets: chat in the corner, alerts centre-stage. */
export function heroScene(): SceneConfig {
  const widget = (type: string, x: number, y: number): WidgetInstance => ({
    id: type,
    type,
    enabled: true,
    x,
    y,
    scale: 1,
    style: {},
  });

  const global: GlobalStyle = {
    ...DEFAULT_GLOBAL,
    usernameColors: {
      comment: "#ffffff",
      like: "#ff8a8a",
      gift: "#ffe066",
      join: "#7cc4ff",
      follow: "#a9e34b",
      share: "#7cc4ff",
      alert: "#ffffff",
    },
  };

  return {
    version: 2,
    theme: "streamline",
    padding: 12,
    customCSS: "",
    global,
    widgets: [
      widget("viewers", 1, 0),
      widget("alerts", 0.5, 0.42),
      widget("goal", 0.02, 1),
      widget("chat", 0, 1),
    ],
  };
}
