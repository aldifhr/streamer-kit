/**
 * Styling primitives.
 *
 * Two layers of custom property, and the split matters:
 *
 *   --sk-*   scene-global. Typography, text colour, per-user name colour.
 *            Read by every widget, owned by the theme, and the layer the
 *            README documents as the custom-CSS API.
 *   --w-*    per-widget instance. Emitted as an inline style on that widget's
 *            own element, so two widgets of the same type can be styled
 *            differently in one scene without a name collision.
 *
 * The per-widget layer is inline rather than a generated stylesheet on purpose:
 * the variable name is then always `--w-<key>`, with no per-instance id baked
 * into the selector, so globals.css stays static and a theme switch is a plain
 * re-render.
 */

export type StyleValue = string | number | boolean;
export type StyleMap = Record<string, StyleValue>;

/**
 * Mutes hues that stay readable on a dark scene. Returned as a hex so callers
 * can assign it to --sk-username-color and let CSS do the rest.
 */
const USER_PALETTE = [
  "#ff8a8a", "#ffb86b", "#ffe066", "#a9e34b", "#7ce8a4",
  "#66d9e8", "#7cc4ff", "#b197fc", "#f783ac",
];

export function userColor(name: string): string {
  // FNV-1a: the naive `h*31 + c` variant clusters short or similar names into
  // the same bucket, which made short usernames collide visibly.
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return USER_PALETTE[(h >>> 0) % USER_PALETTE.length];
}

export function withAlpha(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

/**
 * CSS value syntax allows almost nothing unquoted, so any string that could
 * contain a quote, an ampersand or an angle bracket is JSON-quoted. This is
 * what makes a font stack safe to round-trip through a custom property.
 */
function token(value: string): string {
  return /[ "'&<>]/.test(value) ? JSON.stringify(value) : value;
}

/** `scale` shrinks every length so a theme swatch is a true miniature. */
function px(value: number, scale: number): string {
  return `${Math.round(value * scale * 100) / 100}px`;
}

function vars(pairs: [string, string][]): string[] {
  return pairs.map(([k, v]) => `--${k}:${v}`);
}

/* -------------------------------------------------------------------------
 * scene-global layer
 * ---------------------------------------------------------------------- */

export type UsernameColorMode = "perUser" | "type" | "solid";

/**
 * Scene-global style. Deliberately a typed object rather than an open bag: its
 * keys are the documented `--sk-*` API, and `globalVars` is the only place
 * that decides how each one reaches CSS.
 */
export interface GlobalStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  usernameFontFamily: string;
  usernameFontSize: number;
  usernameFontWeight: number;
  uppercaseName: boolean;
  outline: boolean;
  textColor: string;
  /**
   * How a username is coloured. Per-kind colours live here rather than on each
   * widget because a scene's chat and its alert stack almost always want the
   * same name palette, and duplicating it per widget is how the two drift.
   */
  usernameColorMode: UsernameColorMode;
  usernameColors: Record<string, string>;
  showUsername: boolean;
  showIcons: boolean;
}

export const DEFAULT_GLOBAL: GlobalStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1.4,
  letterSpacing: 0,

  usernameFontFamily: "'Inter', system-ui, sans-serif",
  usernameFontSize: 15,
  usernameFontWeight: 600,
  uppercaseName: false,
  outline: true,

  textColor: "#ffffff",
  usernameColorMode: "perUser",
  usernameColors: {
    comment: "#ffffff",
    like: "#ff8a8a",
    gift: "#ffe066",
    join: "#7cc4ff",
    follow: "#a9e34b",
    share: "#7cc4ff",
    alert: "#ffffff",
  },
  showUsername: true,
  showIcons: true,
};

/**
 * Serialise the global layer to custom properties. Colours and lengths are
 * pre-composed here rather than in CSS so a widget never has to know whether
 * a value is a hex or a percentage.
 */
export function globalVars(g: GlobalStyle, scale = 1): string {
  const show = (on: boolean) => (on ? "flex" : "none");
  const out = vars([
    ["sk-font-family", token(g.fontFamily)],
    ["sk-font-size", px(g.fontSize, scale)],
    ["sk-font-weight", String(g.fontWeight)],
    ["sk-line-height", String(g.lineHeight)],
    ["sk-letter-spacing", px(g.letterSpacing, scale)],
    ["sk-username-font-family", token(g.usernameFontFamily)],
    ["sk-username-font-size", px(g.usernameFontSize, scale)],
    ["sk-username-font-weight", String(g.usernameFontWeight)],
    ["sk-username-transform", g.uppercaseName ? "uppercase" : "none"],
    [
      "sk-text-shadow",
      g.outline ? "0 1px 2px rgba(0,0,0,.92), 0 0 1px rgba(0,0,0,.9)" : "none",
    ],
    ["sk-text-color", token(g.textColor)],
    ["sk-show-username", show(g.showUsername)],
    ["sk-show-icons", g.showIcons ? "inline" : "none"],
  ]);

  // Per-kind name colours are emitted one var per kind so a stylesheet rule
  // can address a single kind. The mode is not a CSS concern, so it is not
  // emitted — the renderer decides which of these to use.
  for (const [kind, colour] of Object.entries(g.usernameColors)) {
    out.push(`--sk-user-${kind}:${token(colour)}`);
  }
  return out.join(";");
}

/** The colour a username is painted in, for a given message kind. */
export function nameColor(
  g: GlobalStyle,
  kind: string,
  user: string,
): string {
  if (g.usernameColorMode === "perUser") return userColor(user);
  if (g.usernameColorMode === "solid") return g.usernameColors.comment ?? "#ffffff";
  return g.usernameColors[kind] ?? g.usernameColors.comment ?? "#ffffff";
}

/* -------------------------------------------------------------------------
 * per-widget layer
 * ---------------------------------------------------------------------- */

/**
 * Style keys that hold a pixel length, so the editor's raw number becomes a
 * length and the swatch can scale the whole set at once.
 *
 * An explicit list rather than a naming convention: `max-w` is a length but
 * `max` is a count, and a suffix rule would get that backwards.
 */
const LENGTH_KEYS = new Set([
  "size", "label-size", "radius", "pad-x", "pad-y", "gap", "max-w", "indent",
  "icon-size", "bar-height", "track-gap", "letter", "width", "height",
  "accent", "border-w", "stroke", "card-radius", "card-pad-x", "card-pad-y",
  "card-gap", "offset",
]);

export function styleValue(key: string, value: StyleValue, scale: number): string {
  if (LENGTH_KEYS.has(key) && typeof value === "number") return px(value, scale);
  return token(String(value));
}

/**
 * Serialise a widget's resolved style to the `--w-*` layer.
 *
 * Booleans are skipped: they drive conditional rendering in the component, not
 * CSS. Visibility is the one exception — a `show-*` key becomes a `display`
 * value so the stylesheet can switch a kind off without the component
 * re-rendering its children.
 */
export function styleVars(style: StyleMap, scale = 1): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(style)) {
    if (typeof v === "boolean") {
      if (k.startsWith("show-")) out.push(`--w-${k}:${v ? "flex" : "none"}`);
      continue;
    }
    out.push(`--w-${k}:${styleValue(k, v, scale)}`);
  }
  return out.join(";");
}

/** The same layer as an inline style object, for a real widget in the scene. */
export function styleProps(style: StyleMap, scale = 1): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) {
    if (typeof v === "boolean") {
      if (k.startsWith("show-")) out[`--w-${k}`] = v ? "flex" : "none";
      continue;
    }
    out[`--w-${k}`] = styleValue(k, v, scale);
  }
  return out as React.CSSProperties;
}

/**
 * Colour/alpha pairs, as `colourKey` + `opacityKey` in the style bag.
 *
 * The editor exposes a swatch and an opacity slider as two controls because
 * that is how people think about it, but CSS has no way to apply an alpha to
 * a variable that holds a hex — `color-mix()` and the relative colour syntax
 * are not safe to rely on across the browser versions OBS ships against. So the
 * pair is folded into one `rgba()` here, and the opacity keys are dropped.
 */
const ALPHA_PAIRS: [string, string][] = [
  ["bg", "bg-opacity"],
  ["card-bg", "card-bg-opacity"],
  ["fill", "fill-opacity"],
];

/** A widget's style with alpha pairs folded in, ready for `styleProps`. */
export function resolveSurface(style: StyleMap): StyleMap {
  const out: StyleMap = { ...style };
  for (const [colourKey, opacityKey] of ALPHA_PAIRS) {
    const colour = out[colourKey];
    const opacity = out[opacityKey];
    if (typeof colour === "string" && typeof opacity === "number") {
      out[colourKey] = withAlpha(colour, opacity);
    }
    delete out[opacityKey];
  }
  if (typeof out["border-color"] === "string" && typeof out["border-w"] === "number") {
    out["border-color"] = withAlpha(out["border-color"], 30);
  }
  return out;
}
