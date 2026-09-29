/**
 * Scene configuration.
 *
 * Version 2 replaced a single flat `OverlayConfig` with a scene holding a list
 * of widgets. The flat schema was fine while the overlay was only a chat: every
 * new key landed in the same object, the same CSS serialiser and the same
 * editor page. A scene is what makes "not just a chat" addable — a widget
 * brings its own style keys and its own controls, and nothing above it changes.
 *
 * Configs written by the flat schema are migrated on read, so an overlay saved
 * before this change keeps its settings instead of reverting to defaults.
 */

import { DEFAULT_GLOBAL, type GlobalStyle, type StyleMap } from "@/lib/css";
import { num } from "@/lib/widgets/style";
import { WIDGET_TYPES, widgetType } from "@/lib/widgets/registry";
import { newWidgetId, type WidgetInstance } from "@/lib/widgets/types";

export const SCENE_VERSION = 2;

// The shape lives in the widget contract so customiser props can name it
// without importing this module. Re-exported here because the scene is what
// callers think in terms of.
export type { WidgetInstance };

export interface SceneConfig {
  version: number;
  theme: string;
  /** Inset from the scene edge, in scene pixels. */
  padding: number;
  customCSS: string;
  global: GlobalStyle;
  widgets: WidgetInstance[];
}

/* -------------------------------------------------------------------------
 * defaults
 * ---------------------------------------------------------------------- */

/**
 * A widget's defaults live in its own registry entry and nowhere else, so the
 * editor, the renderer and the migration can never disagree about them.
 */
export function defaultStyle(type: string): StyleMap {
  return { ...(WIDGET_TYPES[type]?.defaults ?? {}) };
}

/** Where a widget of each type sits before the user moves it. Fractions of the scene. */
const DEFAULT_POSITION: Record<string, { x: number; y: number }> = {
  chat: { x: 0, y: 1 },
  alerts: { x: 0.5, y: 0.5 },
  viewers: { x: 1, y: 0 },
  goal: { x: 0.5, y: 1 },
  text: { x: 0, y: 0 },
};

export function makeWidget(type: string, style: StyleMap = {}): WidgetInstance {
  const home = DEFAULT_POSITION[type] ?? { x: 0, y: 0 };
  return {
    id: newWidgetId(type),
    type,
    enabled: true,
    x: home.x,
    y: home.y,
    scale: 1,
    style,
  };
}

/**
 * A fresh scene is a single chat widget, which is exactly what the flat schema
 * rendered. Starting here rather than with a full layout means a new overlay
 * looks like the old ones on first load.
 */
export function defaultScene(): SceneConfig {
  return {
    version: SCENE_VERSION,
    theme: "streamline",
    padding: 12,
    customCSS: "",
    global: { ...DEFAULT_GLOBAL },
    widgets: [makeWidget("chat")],
  };
}

export const DEFAULT_SCENE: SceneConfig = defaultScene();

/* -------------------------------------------------------------------------
 * themes
 * ---------------------------------------------------------------------- */

export interface Theme {
  id: string;
  name: string;
  global: Partial<GlobalStyle>;
  /** Per widget type. A theme only states what it changes. */
  widgets: Record<string, StyleMap>;
}

/**
 * The surface keys every chrome-ish widget shares, so a theme can be written
 * once and applied to the chat, the alert cards, the viewer chip, the goal bar
 * and the caption strip together.
 *
 * Earlier versions of this only carried `chat`, which meant picking a theme
 * visibly did nothing to every other widget in the scene — the exact feeling
 * of "the theme is broken" when you only wanted the space scene restyled.
 *
 * The astronaut widget is deliberately absent: it draws its own artwork and has
 * no surface to tint.
 */
type Surface = Partial<
  Pick<
    StyleMap,
    "bg" | "bg-opacity" | "radius" | "pad-x" | "pad-y" | "border-w" | "border-color" | "accent"
  >
>;

const SURFACED = ["chat", "alerts", "viewers", "goal", "text"] as const;

function theme(id: string, name: string, global: Partial<GlobalStyle>, surface: Surface, extra: Record<string, StyleMap> = {}): Theme {
  const widgets: Record<string, StyleMap> = {};
  for (const type of SURFACED) widgets[type] = { ...surface };
  // Per-widget values win, so a theme can still set chat-only or alert-only
  // knobs after the shared surface has been laid down.
  for (const [type, style] of Object.entries(extra)) {
    widgets[type] = { ...(widgets[type] ?? {}), ...style };
  }
  return { id, name, global, widgets };
}

/** Compact-and-clean presets: tight chat, quiet cards. */
export const THEMES: Theme[] = [
  theme("streamline", "Streamline", {}, { "pad-x": 6, "pad-y": 2, radius: 5, "bg-opacity": 0, accent: 2 }, {
    chat: { gap: 3, "card-bg-opacity": 48, "card-radius": 8 },
    alerts: { gap: 8, "card-pad-y": 10, "card-pad-x": 16 },
  }),
  theme("quiet", "Quiet", {}, { "bg-opacity": 34, radius: 8, "pad-x": 12, "pad-y": 6, accent: 0 }, {
    chat: { gap: 6, "card-bg-opacity": 40, "card-radius": 8 },
    alerts: { gap: 10 },
  }),
  theme("rail", "Rail", {}, { "bg-opacity": 58, radius: 6, accent: 3 }, {
    chat: { "card-bg-opacity": 62 },
  }),
  theme("cards", "Cards", {}, { "bg-opacity": 40, radius: 12, "pad-x": 14, "pad-y": 8 }, {
    chat: { align: "stretch", gap: 6, "card-bg-opacity": 70, "card-radius": 12, "card-pad-x": 14, "card-pad-y": 9 },
  }),
  theme("outline", "Outline", { fontSize: 16, lineHeight: 1.3 }, { "bg-opacity": 0, radius: 4, "pad-x": 4, "pad-y": 1, "border-w": 1, "border-color": "#ffffff" }, {
    chat: { gap: 2, "card-bg-opacity": 0 },
    goal: { "bg-opacity": 0 },
  }),
  theme("contrast", "High Contrast", { fontSize: 16 }, { "bg-opacity": 78, radius: 8, "border-w": 1, "border-color": "#ffffff" }, {
    chat: { "card-bg-opacity": 85 },
  }),
];

/* -------------------------------------------------------------------------
 * migration from the flat schema
 * ---------------------------------------------------------------------- */

/** The flat schema's own rename table, replayed so two-generations-old configs survive. */
const V1_ALIASES: Record<string, string> = {
  bgColor: "chatBg",
  bgOpacity: "chatBgOpacity",
  borderRadius: "chatRadius",
  paddingX: "chatPadX",
  paddingY: "chatPadY",
  gap: "chatGap",
  maxWidth: "chatMaxWidth",
  layout: "chatLayout",
  borderColor: "eventBorderColor",
  borderWidth: "eventBorderWidth",
  accentBar: "eventAccentWidth",
};

const V1_GLOBAL: [string, string][] = [
  ["fontFamily", "fontFamily"],
  ["fontSize", "fontSize"],
  ["fontWeight", "fontWeight"],
  ["lineHeight", "lineHeight"],
  ["letterSpacing", "letterSpacing"],
  ["usernameFontFamily", "usernameFontFamily"],
  ["usernameFontSize", "usernameFontSize"],
  ["usernameFontWeight", "usernameFontWeight"],
  ["uppercaseName", "uppercaseName"],
  ["outline", "outline"],
  ["textColor", "textColor"],
  ["usernameColorMode", "usernameColorMode"],
  ["usernameColors", "usernameColors"],
  ["showUsername", "showUsername"],
  ["showIcons", "showIcons"],
];

const V1_CHAT: [string, string][] = [
  ["chatBg", "bg"],
  ["chatBgOpacity", "bg-opacity"],
  ["chatRadius", "radius"],
  ["chatPadX", "pad-x"],
  ["chatPadY", "pad-y"],
  ["chatGap", "gap"],
  ["chatMaxWidth", "max-w"],
  ["chatLayout", "align"],
  ["eventBg", "card-bg"],
  ["eventBgOpacity", "card-bg-opacity"],
  ["eventRadius", "card-radius"],
  ["eventPadX", "card-pad-x"],
  ["eventPadY", "card-pad-y"],
  ["eventGap", "card-gap"],
  ["eventAccentWidth", "accent"],
  ["eventBorderWidth", "border-w"],
  ["eventBorderColor", "border-color"],
  ["eventIconSize", "icon-size"],
  ["eventTitleWeight", "title-weight"],
  ["eventValueWeight", "value-weight"],
  ["eventGlow", "glow"],
  ["eventIndent", "indent"],
  ["showComments", "show-comment"],
  ["showLikes", "show-like"],
  ["showGifts", "show-gift"],
  ["showJoins", "show-join"],
  ["maxMessages", "max"],
  ["maxEvents", "max-events"],
  ["messageTimeout", "lifetime"],
];

const CHAT_ALIAS: Record<string, string> = { inline: "flex-start", bubble: "stretch" };

function migrateV1(raw: Record<string, unknown>): SceneConfig {
  const source: Record<string, unknown> = { ...raw };
  for (const [oldKey, newKey] of Object.entries(V1_ALIASES)) {
    if (source[oldKey] !== undefined && source[newKey] === undefined) {
      source[newKey] = source[oldKey];
    }
  }
  // accentBar was a boolean in the oldest schema.
  if (source.accentBar === true && !source.eventAccentWidth) source.eventAccentWidth = 2;

  const scene = defaultScene();
  if (typeof source.theme === "string") scene.theme = source.theme;
  if (typeof source.customCSS === "string") scene.customCSS = source.customCSS;

  const bag = scene.global as unknown as Record<string, unknown>;
  for (const [from, to] of V1_GLOBAL) {
    if (source[from] !== undefined) {
      bag[to] = source[from];
    }
  }

  const chat = scene.widgets[0];
  for (const [from, to] of V1_CHAT) {
    if (source[from] === undefined) continue;
    const value = source[from];
    chat.style[to] = CHAT_ALIAS[String(value)] ?? (value as StyleMap[string]);
  }

  return scene;
}

/* -------------------------------------------------------------------------
 * normalisation
 * ---------------------------------------------------------------------- */

const clamp01 = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;

function normaliseWidget(raw: unknown): WidgetInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const type = String(w.type ?? "");
  if (!widgetType(type)) return null;

  return {
    id: typeof w.id === "string" && w.id ? w.id : newWidgetId(type),
    type,
    enabled: w.enabled !== false,
    x: clamp01(w.x, DEFAULT_POSITION[type]?.x ?? 0),
    y: clamp01(w.y, DEFAULT_POSITION[type]?.y ?? 1),
    scale: typeof w.scale === "number" && w.scale > 0 ? w.scale : 1,
    style: { ...defaultStyle(type), ...(w.style as StyleMap) },
  };
}

/**
 * Read any config, in any schema version, as a scene.
 *
 * Unknown widget types are dropped rather than rendered as an error box: a
 * config referencing a widget from a newer build should still show the rest of
 * the scene.
 */
export function normaliseScene(raw: unknown): SceneConfig {
  if (!raw || typeof raw !== "object") return defaultScene();
  const source = raw as Record<string, unknown>;

  if (source.version !== SCENE_VERSION || !Array.isArray(source.widgets)) {
    return migrateV1(source);
  }

  const scene = defaultScene();
  if (typeof source.theme === "string") scene.theme = source.theme;
  if (typeof source.customCSS === "string") scene.customCSS = source.customCSS;
  if (typeof source.padding === "number") scene.padding = source.padding;
  if (source.global && typeof source.global === "object") {
    scene.global = { ...DEFAULT_GLOBAL, ...(source.global as GlobalStyle) };
  }

  const widgets = source.widgets
    .map(normaliseWidget)
    .filter((w): w is WidgetInstance => w !== null);

  // A scene whose only widgets were of an unknown type would render as an empty
  // screen in OBS, which is much harder to diagnose than a fresh chat.
  scene.widgets = widgets.length > 0 ? widgets : [makeWidget("chat")];
  return scene;
}

/** Every widget of a type that is not already `exceptId`. */
export function countOf(scene: SceneConfig, type: string, exceptId?: string): number {
  return scene.widgets.filter((w) => w.type === type && w.id !== exceptId).length;
}

/** Reset one widget to the active theme's values for its type. */
export function themedStyle(type: string, themeId: string): StyleMap {
  const theme = THEMES.find((t) => t.id === themeId);
  return { ...defaultStyle(type), ...(theme?.widgets[type] ?? {}) };
}

/**
 * A widget's resolved style: its defaults, overlaid with what the user changed.
 *
 * Themes write into the same `style` bag as user edits, so a theme switch and a
 * slider drag are both just a new style object, and there is no separate
 * "themed but not overridden" state to keep consistent.
 */
export function resolve(widget: WidgetInstance): StyleMap {
  return { ...defaultStyle(widget.type), ...widget.style };
}

/**
 * The longest any widget in the scene wants its messages to live.
 *
 * The feed expires entries on one scene-wide interval, so this has to be the
 * max across widgets: a short-lived widget sharing the buffer with a
 * long-lived one would otherwise have its messages expire early.
 */
export function sceneLifetime(config: SceneConfig): number {
  return config.widgets.reduce((max, w) => Math.max(max, num(resolve(w), "lifetime", 0)), 0);
}
