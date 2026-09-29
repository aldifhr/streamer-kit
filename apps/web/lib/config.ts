export type MsgType = "comment" | "like" | "gift" | "join";

/** Comments are the scrolling chat list; everything else is an alert card. */
export type ChatKind = "comment";
export type EventKind = Exclude<MsgType, "comment">;
export const isEvent = (k: MsgType): k is EventKind => k !== "comment";

export type UsernameColorMode = "perUser" | "type" | "solid";

export interface OverlayConfig {
  theme: string;

  // --- typography: body -------------------------------------------------
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  // --- typography: username (independent, like all-chat) ----------------
  usernameFontFamily: string;
  usernameFontSize: number;
  usernameFontWeight: number;
  uppercaseName: boolean;
  outline: boolean;

  // --- chat surface -----------------------------------------------------
  chatBg: string;
  chatBgOpacity: number;
  chatRadius: number;
  chatPadX: number;
  chatPadY: number;
  chatGap: number;
  chatMaxWidth: number;
  chatLayout: "inline" | "bubble";

  // --- event cards ------------------------------------------------------
  eventBg: string;
  eventBgOpacity: number;
  eventRadius: number;
  eventPadX: number;
  eventPadY: number;
  eventGap: number;
  eventAccentWidth: number;
  eventBorderWidth: number;
  eventBorderColor: string;
  eventIconSize: number;
  eventTitleWeight: number;
  eventValueWeight: number;
  eventGlow: boolean;
  eventIndent: number;

  // --- colour -----------------------------------------------------------
  textColor: string;
  usernameColorMode: UsernameColorMode;
  usernameColors: Record<MsgType, string>;

  // --- visibility (applied as display:var(--sk-show-*)) ------------------
  showComments: boolean;
  showLikes: boolean;
  showGifts: boolean;
  showJoins: boolean;
  showUsername: boolean;
  showIcons: boolean;

  // --- limits (chat and events are budgeted separately) ------------------
  maxMessages: number;
  maxEvents: number;
  messageTimeout: number;

  customCSS: string;
}

export const DEFAULT_CONFIG: OverlayConfig = {
  theme: "streamline",

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

  chatBg: "#000000",
  chatBgOpacity: 0,
  chatRadius: 5,
  chatPadX: 6,
  chatPadY: 2,
  chatGap: 4,
  chatMaxWidth: 460,
  chatLayout: "inline",

  eventBg: "#0b0b0f",
  eventBgOpacity: 55,
  eventRadius: 8,
  eventPadX: 10,
  eventPadY: 5,
  eventGap: 4,
  eventAccentWidth: 2,
  eventBorderWidth: 0,
  eventBorderColor: "#ffffff",
  eventIconSize: 14,
  eventTitleWeight: 600,
  eventValueWeight: 600,
  eventGlow: false,
  eventIndent: 0,

  textColor: "#ffffff",
  usernameColorMode: "perUser",
  usernameColors: {
    comment: "#ffffff",
    like: "#ff8a8a",
    gift: "#ffe066",
    join: "#7cc4ff",
  },

  showComments: true,
  showLikes: true,
  showGifts: true,
  showJoins: true,
  showUsername: true,
  showIcons: true,

  maxMessages: 40,
  maxEvents: 12,
  messageTimeout: 12000,
  customCSS: "",
};

export interface Theme {
  id: string;
  name: string;
  base: Partial<OverlayConfig>;
}

/** Compact-and-clean presets: tight chat, quiet cards. */
export const THEMES: Theme[] = [
  {
    id: "streamline",
    name: "Streamline",
    base: {
      chatBgOpacity: 0,
      chatPadX: 6,
      chatPadY: 2,
      chatGap: 3,
      eventBgOpacity: 48,
      eventAccentWidth: 2,
    },
  },
  {
    id: "quiet",
    name: "Quiet",
    base: {
      chatBgOpacity: 34,
      chatRadius: 8,
      chatPadX: 12,
      chatPadY: 6,
      chatGap: 6,
      eventBgOpacity: 40,
      eventAccentWidth: 0,
    },
  },
  {
    id: "rail",
    name: "Rail",
    base: {
      chatBgOpacity: 58,
      eventAccentWidth: 3,
      eventBgOpacity: 62,
    },
  },
  {
    id: "cards",
    name: "Cards",
    base: {
      chatLayout: "bubble",
      chatBgOpacity: 40,
      chatRadius: 12,
      chatPadX: 14,
      chatPadY: 8,
      chatGap: 6,
      eventRadius: 12,
      eventPadX: 14,
      eventPadY: 9,
      eventBgOpacity: 70,
    },
  },
  {
    id: "outline",
    name: "Outline",
    base: {
      chatBgOpacity: 0,
      chatPadX: 4,
      chatPadY: 1,
      chatGap: 2,
      fontSize: 16,
      lineHeight: 1.3,
      eventBgOpacity: 0,
      eventBorderWidth: 1,
      eventBorderColor: "#ffffff",
    },
  },
  {
    id: "contrast",
    name: "High Contrast",
    base: {
      fontSize: 16,
      chatBgOpacity: 78,
      eventBgOpacity: 85,
      eventBorderWidth: 1,
    },
  },
];

/**
 * Mutes hues that stay readable on a dark scene. Returned as a hex so callers
 * can assign it to --sk-row-user-bg and let CSS do the rest.
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

export const ICONS: Record<MsgType, string> = {
  comment: "",
  like: "❤️",
  gift: "🎁",
  join: "👋",
};

/** Verb shown between the name and the value on an event card. */
export const EVENT_VERB: Record<EventKind, string> = {
  like: "liked",
  gift: "sent",
  join: "joined",
};

/**
 * Serialise config to the CSS custom properties the overlay renders against.
 * This is the theming API: themes are just var values, and user CSS can
 * override any of them by name.
 *
 * `scale` multiplies every length (not colours, not display keywords) so the
 * theme picker can render a true miniature. Without it a swatch would pair a
 * 9px font with the theme's real 10px padding and read as cramped.
 */
export function toCssVars(c: OverlayConfig, scale = 1): string {
  const px = (n: number) => `${Math.round(n * scale * 100) / 100}px`;
  const show = (on: boolean) => (on ? "flex" : "none");
  const text = (s: string) => (/[ "'&<>]/.test(s) ? JSON.stringify(s) : s);

  return [
    `--sk-font-family:${text(c.fontFamily)}`,
    `--sk-font-size:${px(c.fontSize)}`,
    `--sk-font-weight:${c.fontWeight}`,
    `--sk-line-height:${c.lineHeight}`,
    `--sk-letter-spacing:${px(c.letterSpacing)}`,
    `--sk-username-font-family:${text(c.usernameFontFamily)}`,
    `--sk-username-font-size:${px(c.usernameFontSize)}`,
    `--sk-username-font-weight:${c.usernameFontWeight}`,
    `--sk-username-transform:${c.uppercaseName ? "uppercase" : "none"}`,
    `--sk-text-shadow:${c.outline ? "0 1px 2px rgba(0,0,0,.92), 0 0 1px rgba(0,0,0,.9)" : "none"}`,
    `--sk-text-color:${c.textColor}`,
    `--sk-chat-bg:${withAlpha(c.chatBg, c.chatBgOpacity)}`,
    `--sk-chat-radius:${px(c.chatRadius)}`,
    `--sk-chat-pad-x:${px(c.chatPadX)}`,
    `--sk-chat-pad-y:${px(c.chatPadY)}`,
    `--sk-chat-gap:${px(c.chatGap)}`,
    `--sk-chat-max-width:${px(c.chatMaxWidth)}`,
    `--sk-chat-align:${c.chatLayout === "bubble" ? "stretch" : "flex-start"}`,
    `--sk-event-bg:${withAlpha(c.eventBg, c.eventBgOpacity)}`,
    `--sk-event-radius:${px(c.eventRadius)}`,
    `--sk-event-pad-x:${px(c.eventPadX)}`,
    `--sk-event-pad-y:${px(c.eventPadY)}`,
    `--sk-event-gap:${px(c.eventGap)}`,
    `--sk-event-accent:${px(c.eventAccentWidth)}`,
    `--sk-event-border-width:${px(c.eventBorderWidth)}`,
    `--sk-event-border-color:${withAlpha(c.eventBorderColor, 30)}`,
    `--sk-event-icon-size:${px(c.eventIconSize)}`,
    `--sk-event-title-weight:${c.eventTitleWeight}`,
    `--sk-event-value-weight:${c.eventValueWeight}`,
    `--sk-event-glow:${c.eventGlow ? "0 0 18px rgba(255,255,255,.18)" : "none"}`,
    `--sk-event-indent:${px(c.eventIndent)}`,
    `--sk-show-comments:${show(c.showComments)}`,
    `--sk-show-likes:${show(c.showLikes)}`,
    `--sk-show-gifts:${show(c.showGifts)}`,
    `--sk-show-joins:${show(c.showJoins)}`,
    `--sk-show-username:${show(c.showUsername)}`,
    `--sk-show-icons:${c.showIcons ? "inline" : "none"}`,
  ].join(";");
}

const LEGACY_KEYS: Record<string, keyof OverlayConfig> = {
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

/**
 * Accept configs written by earlier schema versions so saved overlays keep
 * their settings instead of silently reverting to defaults.
 */
export function normalise(raw: unknown): OverlayConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  const c = { ...DEFAULT_CONFIG, ...source } as unknown as OverlayConfig;
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    if (source[oldKey] !== undefined && source[newKey] === undefined) {
      (c as unknown as Record<string, unknown>)[newKey] = source[oldKey];
    }
  }
  c.usernameColors = { ...DEFAULT_CONFIG.usernameColors, ...(c.usernameColors ?? {}) };
  if (source.accentBar === true && !source.eventAccentWidth) c.eventAccentWidth = 2;
  return c;
}
