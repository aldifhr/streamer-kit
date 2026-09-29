"use client";

import { nameColor, type StyleMap } from "@/lib/css";
import { selectKinds } from "@/lib/feed";
import { num } from "./style";
import type { EventKind, WidgetProps, WidgetType } from "./types";

/** Verb shown between the name and the value on a card. */
const VERB: Partial<Record<EventKind, string>> = {
  like: "liked",
  gift: "sent",
  join: "joined",
  follow: "followed",
  share: "shared",
};

const ICON: Partial<Record<EventKind, string>> = {
  like: "❤️",
  gift: "🎁",
  join: "👋",
  follow: "💚",
  share: "🔗",
};

const COMMENTS: EventKind[] = ["comment"];
const CARDS: EventKind[] = ["like", "gift", "join", "follow", "share"];

/**
 * The scrolling message column: comments as lines, everything else as cards.
 *
 * This is the widget the old flat config described in full — same markup, same
 * knobs — so a migrated overlay is visually unchanged. Comments and cards keep
 * separate budgets: sharing one buffer meant a run of joins, which arrive far
 * faster than comments, evicted every comment from the overlay entirely.
 */
function Chat({ style, global, entries }: WidgetProps) {
  const comments = selectKinds(entries, COMMENTS).slice(0, num(style, "max", 40));
  const cards = selectKinds(entries, CARDS).slice(0, num(style, "max-events", 12));

  // Both budgets feed one newest-first stream. Sorting on arrival rather than
  // trusting array order is what makes merging two buffers correct.
  const merged = [...comments, ...cards].sort((a, b) => b.seq - a.seq);

  const accent = (kind: EventKind): React.CSSProperties => ({
    ["--sk-accent-color" as string]: global.usernameColors[kind] ?? global.usernameColors.comment,
  });

  return (
    <div className="sk-list">
      {merged.map((e) =>
        e.kind === "comment" ? (
          <div key={e.id} className="sk-chat" data-kind="comment" style={accent("comment")}>
            <span className="sk-username" style={{ color: nameColor(global, "comment", e.user) }}>
              {e.user}
            </span>
            <span className="sk-text"> {e.value}</span>
          </div>
        ) : (
          <div key={e.id} className="sk-event" data-kind={e.kind} style={accent(e.kind)}>
            {global.showIcons && ICON[e.kind] ? <span className="sk-event-icon">{ICON[e.kind]}</span> : null}
            <span className="sk-event-title" style={{ color: nameColor(global, e.kind, e.user) }}>
              {e.user}
            </span>
            <span className="sk-event-value">
              {VERB[e.kind] ?? e.kind}
              {e.value ? ` ${e.value}` : ""}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

const cardSurface = { kind: "color", key: "card-bg", label: "Background", opacityKey: "card-bg-opacity" } as const;

export const chatWidget: WidgetType = {
  id: "chat",
  label: "Chat",
  icon: "💬",
  blurb: "Comments and event cards in one scrolling column.",
  defaults: {
    bg: "#000000",
    "bg-opacity": 0,
    radius: 5,
    "pad-x": 6,
    "pad-y": 2,
    gap: 4,
    "max-w": 460,
    align: "flex-start",

    "card-bg": "#0b0b0f",
    "card-bg-opacity": 55,
    "card-radius": 8,
    "card-pad-x": 10,
    "card-pad-y": 5,
    "card-gap": 4,
    accent: 2,
    "border-w": 0,
    "border-color": "#ffffff",
    "icon-size": 14,
    "title-weight": 600,
    "value-weight": 600,
    glow: false,
    indent: 0,

    "show-comment": true,
    "show-like": true,
    "show-gift": true,
    "show-join": true,
    "show-follow": true,
    "show-share": true,

    max: 40,
    "max-events": 12,
    lifetime: 12000,
  },
  kinds: [...COMMENTS, ...CARDS],
  groups: [
    {
      controls: [
        {
          kind: "segmented",
          key: "align",
          label: "Layout",
          options: [
            { value: "flex-start", label: "Inline" },
            { value: "stretch", label: "Bubble" },
          ],
        },
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "pad-x", label: "Horizontal padding", min: 0, max: 28, suffix: "px" },
        { kind: "range", key: "pad-y", label: "Vertical padding", min: 0, max: 20, suffix: "px" },
        { kind: "range", key: "gap", label: "Line gap", min: 0, max: 20, suffix: "px" },
        { kind: "range", key: "max-w", label: "Max width", min: 240, max: 900, step: 10, suffix: "px" },
      ],
    },
    {
      title: "Event cards",
      controls: [
        cardSurface,
        { kind: "range", key: "accent", label: "Accent bar", min: 0, max: 8, suffix: "px" },
        { kind: "range", key: "card-radius", label: "Corner radius", min: 0, max: 28, suffix: "px" },
        { kind: "range", key: "card-pad-x", label: "Horizontal padding", min: 0, max: 28, suffix: "px" },
        { kind: "range", key: "card-pad-y", label: "Vertical padding", min: 0, max: 20, suffix: "px" },
        { kind: "range", key: "card-gap", label: "Card gap", min: 0, max: 20, suffix: "px" },
        { kind: "range", key: "icon-size", label: "Icon size", min: 10, max: 32, suffix: "px" },
        { kind: "range", key: "indent", label: "Indent", min: 0, max: 120, step: 4, suffix: "px" },
        {
          kind: "segmented",
          key: "title-weight",
          label: "Title weight",
          options: [
            { value: "400", label: "Reg" },
            { value: "600", label: "Semi" },
            { value: "700", label: "Bold" },
          ],
        },
        {
          kind: "segmented",
          key: "value-weight",
          label: "Value weight",
          options: [
            { value: "400", label: "Reg" },
            { value: "600", label: "Semi" },
            { value: "700", label: "Bold" },
          ],
        },
        { kind: "toggle", key: "glow", label: "Glow" },
        { kind: "numericToggle", key: "border-w", label: "Border", on: 1, off: 0 },
      ],
    },
    {
      title: "Visibility",
      controls: [
        { kind: "toggle", key: "show-comment", label: "Comments" },
        { kind: "toggle", key: "show-like", label: "Likes" },
        { kind: "toggle", key: "show-gift", label: "Gifts" },
        { kind: "toggle", key: "show-join", label: "Joins" },
        { kind: "toggle", key: "show-follow", label: "Follows" },
        { kind: "toggle", key: "show-share", label: "Shares" },
      ],
    },
    {
      title: "Messages",
      controls: [
        { kind: "range", key: "max", label: "Max comments", min: 5, max: 100 },
        { kind: "range", key: "max-events", label: "Max cards", min: 1, max: 50 },
        { kind: "range", key: "lifetime", label: "Lifetime", min: 3000, max: 60000, step: 1000, suffix: "ms" },
      ],
    },
  ],
  Component: Chat,
};
