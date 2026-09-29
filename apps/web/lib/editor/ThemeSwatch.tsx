"use client";

import { nameColor, type GlobalStyle, type StyleMap } from "@/lib/css";
import { DEFAULT_GLOBAL, globalVars, resolveSurface, styleVars } from "@/lib/css";
import { chatWidget } from "@/lib/widgets/chat";
import { selectKinds } from "@/lib/widgets/select";
import type { Entry, EventKind } from "@/lib/widgets/types";
import type { Theme } from "@/lib/scene";

/**
 * Renders a theme with the real renderer and real metrics, scaled to a
 * miniature. Uses `.sk-*` classes and a scaled set of custom properties, so a
 * swatch cannot drift from what the overlay actually looks like.
 */
const SWATCH_SCALE = 0.78;

const SAMPLE: { kind: EventKind; user: string; value: string }[] = [
  { kind: "comment", user: "mira", value: "this is so clean" },
  { kind: "gift", user: "kei", value: "Rose x1" },
  { kind: "like", user: "juno", value: "x2" },
];

const asEntries = (): Entry[] =>
  SAMPLE.map((s, i) => ({ ...s, id: String(i), seq: i, ts: 0, userId: s.user, meta: {} }));

export function ThemeSwatch({ theme }: { theme: Theme }) {
  const global: GlobalStyle = { ...DEFAULT_GLOBAL, ...theme.global };
  const style: StyleMap = resolveSurface({ ...chatWidget.defaults, ...(theme.widgets.chat ?? {}) });

  // Scoped to the swatch so six themes on one page cannot clobber each other's
  // variables, unlike the :root the overlay injects.
  const vars = `.sk-swatch{${globalVars(global, SWATCH_SCALE)}${styleVars(style, SWATCH_SCALE)}}`;

  const entries = asEntries();
  const comments = selectKinds(entries, ["comment"]);
  const cards = selectKinds(entries, ["like", "gift", "join"]);

  const accent = (kind: EventKind) =>
    ({ ["--sk-accent-color" as string]: global.usernameColors[kind] ?? "#ffffff" }) as React.CSSProperties;

  return (
    <div className="bg-[#0d0d10] px-4 py-3.5">
      <style>{vars}</style>
      <div className="sk-swatch sk-list">
        {[...comments, ...cards]
          .sort((a, b) => a.seq - b.seq)
          .map((e) =>
            e.kind === "comment" ? (
              <div key={e.user} className="sk-chat" data-kind="comment" style={accent("comment")}>
                <span className="sk-username" style={{ color: nameColor(global, "comment", e.user) }}>
                  {e.user}
                </span>
                <span className="sk-text"> {e.value}</span>
              </div>
            ) : (
              <div key={e.user} className="sk-event" data-kind={e.kind} style={accent(e.kind)}>
                <span className="sk-event-icon">{e.kind === "gift" ? "🎁" : "❤️"}</span>
                <span className="sk-event-title" style={{ color: nameColor(global, e.kind, e.user) }}>
                  {e.user}
                </span>
                <span className="sk-event-value">
                  {e.kind === "gift" ? "sent" : "liked"} {e.value}
                </span>
              </div>
            ),
          )}
      </div>
    </div>
  );
}
