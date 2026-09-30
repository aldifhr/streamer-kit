import { DEFAULT_GLOBAL, type GlobalStyle } from "@/lib/css";
import type { SceneConfig, WidgetInstance } from "@/lib/scene";

/**
 * Scenes used by the landing page.
 *
 * Kept out of the preview component deliberately: that file is a client module
 * because the widget components use hooks, and a server component cannot call an
 * exported function from a client module. The data itself has no reason to be
 * client-side.
 *
 * One widget per scene, four scenes. The hero used to be a single scene holding
 * chat, alerts, a viewer count and a goal bar, captioned as one overlay and one
 * URL — but an overlay is a single widget now, so that composition is something
 * the editor cannot build. Advertising it as the product's centrepiece described
 * a version of StreamKit that no longer exists. Four separate scenes is what a
 * streamer's OBS actually ends up holding, one Browser Source per widget.
 */

/** Every hero scene shares one global layer, so the four previews agree on type. */
const GLOBAL: GlobalStyle = {
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

/**
 * One widget alone in its frame, anchored where it would sit on a stream.
 *
 * x/y are the widget's anchor as a fraction of the frame, which is what the
 * scene format still stores for a widget that has not been migrated. Each of
 * these is the position the widget would already be at in OBS: the count in the
 * corner, the alerts in the middle, the bar and the chat along the bottom.
 */
function heroScene(type: string, x: number, y: number): SceneConfig {
  const widget: WidgetInstance = { id: type, type, enabled: true, x, y, scale: 1, style: {} };

  return {
    version: 2,
    theme: "streamline",
    padding: 12,
    customCSS: "",
    global: GLOBAL,
    widgets: [widget],
  };
}

/** The four overlays pictured on the landing page, in the order they are shown. */
export const HERO_SCENES: { type: string; scene: SceneConfig }[] = [
  { type: "viewers", scene: heroScene("viewers", 1, 0) },
  { type: "alerts", scene: heroScene("alerts", 0.5, 0.5) },
  { type: "goal", scene: heroScene("goal", 0.02, 1) },
  { type: "chat", scene: heroScene("chat", 0, 1) },
];
