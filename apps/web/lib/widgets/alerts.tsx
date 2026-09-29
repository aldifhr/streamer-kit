"use client";

import { nameColor } from "@/lib/css";
import { selectKinds } from "./select";
import { num } from "./style";
import type { EventKind, WidgetProps, WidgetType } from "./types";

const KINDS: EventKind[] = ["follow", "share", "alert", "gift", "like"];

const ICON: Partial<Record<EventKind, string>> = {
  follow: "💚",
  share: "🔗",
  alert: "★",
  gift: "🎁",
  like: "❤️",
};

const VERB: Partial<Record<EventKind, string>> = {
  follow: "followed",
  share: "shared",
  gift: "sent",
  like: "liked",
  alert: "",
};

/**
 * A prominent stack for the things worth interrupting a stream for.
 *
 * Separate from chat on purpose: chat is dense, continuous and belongs in a
 * corner, while a follow or a big gift is a moment that wants the centre of the
 * frame and a much longer life on screen.
 */
function Alerts({ style, global, entries }: WidgetProps) {
  const shown = selectKinds(entries, KINDS).slice(0, num(style, "max", 5));

  return (
    <div className="sk-alerts">
      {shown.map((e) => {
        const icon = String(e.meta.icon ?? ICON[e.kind] ?? "★");
        const title = String(e.meta.title ?? "");
        return (
          <div
            key={e.id}
            className="sk-card"
            data-kind={e.kind}
            style={{
              ["--sk-accent-color" as string]:
                global.usernameColors[e.kind] ?? global.usernameColors.comment,
            }}
          >
            {global.showIcons ? <span className="sk-card-icon">{icon}</span> : null}
            <span className="sk-card-body">
              {title ? <span className="sk-card-title">{title}</span> : null}
              {e.user ? (
                <span className="sk-card-user" style={{ color: nameColor(global, e.kind, e.user) }}>
                  {e.user}
                </span>
              ) : null}
              <span className="sk-card-text">
                {[VERB[e.kind], e.value].filter(Boolean).join(" ")}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const alertsWidget: WidgetType = {
  id: "alerts",
  label: "Alerts",
  icon: "🔔",
  blurb: "Big centred cards for follows, shares and gifts.",
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 78,
    radius: 12,
    "pad-x": 18,
    "pad-y": 12,
    gap: 10,
    "max-w": 560,
    "icon-size": 34,
    "title-weight": 700,
    "accent": 4,
    "border-w": 0,
    "border-color": "#ffffff",
    glow: true,
    max: 5,
    lifetime: 8000,
  },
  kinds: KINDS,
  groups: [
    {
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "pad-x", label: "Horizontal padding", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad-y", label: "Vertical padding", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "gap", label: "Gap", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "max-w", label: "Max width", min: 260, max: 1000, step: 20, suffix: "px" },
        { kind: "range", key: "icon-size", label: "Icon size", min: 14, max: 64, suffix: "px" },
        { kind: "range", key: "accent", label: "Accent bar", min: 0, max: 10, suffix: "px" },
        { kind: "toggle", key: "glow", label: "Glow" },
        { kind: "numericToggle", key: "border-w", label: "Border", on: 1, off: 0 },
      ],
    },
    {
      title: "Messages",
      controls: [
        { kind: "range", key: "max", label: "Max cards", min: 1, max: 12 },
        { kind: "range", key: "lifetime", label: "Lifetime", min: 2000, max: 30000, step: 500, suffix: "ms" },
      ],
    },
  ],
  Component: Alerts,
};
