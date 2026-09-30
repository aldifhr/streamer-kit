"use client";

import { useState } from "react";
import { bool, num, str } from "./style";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Static social links.
 *
 * The one widget with no data source at all: it subscribes to nothing and never
 * changes, which is exactly why it is useful. Every other widget on a stream is
 * a readout of something happening right now, and the thing a new viewer looks
 * for — where else this person exists — is not a readout of anything.
 *
 * Rows come from two places. Each platform has its own style key, which is how
 * almost everyone fills this in — you know your Instagram, you do not "know your
 * row 2" — and there is still a free-text list behind it for anything the list
 * does not cover. The two are merged at render time, platforms first in a fixed
 * order so the overlay never reshuffles itself as things are typed.
 */

/**
 * The platforms, in the order they are drawn.
 *
 * Exported so the editor's customiser and the widget cannot disagree about which
 * key holds which platform — a mismatch here would silently swallow a handle
 * rather than fail visibly.
 */
export const SOCIAL_PLATFORMS = [
  { key: "instagram", label: "Instagram", icon: "📷", placeholder: "instagram.com/username" },
  { key: "tiktok", label: "TikTok", icon: "🎵", placeholder: "tiktok.com/@username" },
  { key: "youtube", label: "YouTube", icon: "▶", placeholder: "youtube.com/@channel" },
  { key: "x", label: "X", icon: "𝕏", placeholder: "x.com/username" },
  { key: "twitch", label: "Twitch", icon: "🎮", placeholder: "twitch.tv/channel" },
  { key: "discord", label: "Discord", icon: "💬", placeholder: "discord.gg/code" },
  { key: "github", label: "GitHub", icon: "⌨", placeholder: "github.com/user" },
  { key: "telegram", label: "Telegram", icon: "✈", placeholder: "t.me/channel" },
] as const;

/** Guesses the icon from the handle, which is how people write them anyway. */
function iconFor(handle: string): string {
  const h = handle.toLowerCase();
  if (h.startsWith("http") || h.includes("instagram.com") || h.includes("tiktok.com")) return "🔗";
  if (h.includes("youtube") || h.includes("youtu.be")) return "▶";
  if (h.includes("twitter") || h.includes("x.com")) return "𝕏";
  if (h.includes("twitch")) return "🎮";
  if (h.includes("discord") || h.includes("gg/")) return "💬";
  if (h.includes("t.me") || h.includes("telegram")) return "✈";
  if (h.includes("github")) return "⌨";
  return "•";
}

function displayHandle(raw: string): string {
  let h = raw.trim();
  if (!h) return "";
  if (!/^https?:\/\//i.test(h)) h = `https://${h}`;
  try {
    const url = new URL(h);
    return url.pathname.replace(/^\/+|\/+$/g, "") || url.hostname;
  } catch {
    return raw.trim();
  }
}

function Social({ style }: WidgetProps) {
  const [hover, setHover] = useState<number | null>(null);

  const raw = str(style, "rows", "");
  const extra = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // `Label | Handle` puts the readable text first, which is the form people
      // reach for when a handle alone is cryptic.
      const [maybeLabel, maybeHandle] = line.split("|").map((s) => s.trim());
      if (maybeHandle) {
        return { label: maybeLabel, href: maybeHandle, icon: iconFor(maybeHandle) };
      }
      return { label: "", href: maybeLabel, icon: iconFor(maybeLabel) };
    });

  // Platforms first, in the declared order, then the free-text rows. Deduplicated
  // on the resolved host+path so a handle typed into the old "one per line" field
  // before it moved to its own input does not appear twice.
  const seen = new Set<string>();
  const links = [
    ...SOCIAL_PLATFORMS.filter((p) => str(style, p.key, "").trim()).map((p) => ({
      label: "",
      href: str(style, p.key, "").trim(),
      icon: p.icon,
    })),
    ...extra,
  ].filter((l) => {
    const key = displayHandle(l.href).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const capped = links.slice(0, num(style, "max", 6));

  if (!capped.length) return null;

  return (
    <div className="sk-social">
      {bool(style, "show-title", true) && str(style, "title", "find me here") ? (
        <div className="sk-social-title">{str(style, "title", "find me here")}</div>
      ) : null}
      <div className="sk-social-links">
        {capped.map((l, i) => {
          const handle = displayHandle(l.href);
          const href = /^https?:\/\//i.test(l.href.trim()) ? l.href.trim() : `https://${l.href.trim()}`;
          return (
            <a
              key={`${href}-${i}`}
              className="sk-social-link"
              href={href}
              target="_blank"
              rel="noreferrer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              data-dim={hover !== null && hover !== i ? "true" : undefined}
            >
              {bool(style, "show-icon", true) ? (
                <span className="sk-social-icon">{str(style, "icon", "") || l.icon}</span>
              ) : null}
              <span className="sk-social-handle">{l.label || handle}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export const socialWidget: WidgetType = {
  id: "social",
  label: "Social links",
  icon: "🔗",
  blurb: "Static handles for wherever else you are.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 55,
    radius: 16,
    pad: 10,
    gap: 6,
    size: 14,
    "title-size": 11,
    weight: 700,
    accent: "#7cc4fa",
    "show-title": true,
    title: "find me here",
    "show-icon": true,
    max: 6,
    // Placeholder content so the widget is visible before it has been filled in
    // — an empty box teaches nothing about what it is for.
    instagram: "instagram.com/username",
    tiktok: "tiktok.com/@username",
    youtube: "youtube.com/@channel",
  },
  kinds: [],
  groups: [
    {
      title: "Other links",
      controls: [
        {
          kind: "text",
          key: "rows",
          label: "Anything else (one per line)",
          placeholder: "Label | example.com/me",
        },
        { kind: "number", key: "max", label: "How many", min: 1, max: 12 },
      ],
    },
    {
      title: "Rows",
      controls: [
        { kind: "toggle", key: "show-title", label: "Show title" },
        { kind: "text", key: "title", label: "Title", placeholder: "find me here" },
        { kind: "toggle", key: "show-icon", label: "Show icons" },
        { kind: "text", key: "icon", label: "Force one icon", placeholder: "auto" },
        { kind: "range", key: "size", label: "Handle size", min: 9, max: 32, suffix: "px" },
        { kind: "range", key: "title-size", label: "Title size", min: 8, max: 24, suffix: "px" },
        { kind: "range", key: "gap", label: "Row gap", min: 0, max: 20, suffix: "px" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "color", key: "accent", label: "Accent" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad", label: "Padding", min: 0, max: 32, suffix: "px" },
      ],
    },
  ],
  Component: Social,
};
