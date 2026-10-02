"use client";

import { DEFAULT_GLOBAL, globalVars, nameColor, resolveSurface, styleVars } from "@/lib/css";
import type { GlobalStyle, StyleMap } from "@/lib/css";
import { chatWidget } from "@/lib/widgets/chat";
import { selectKinds } from "@/lib/widgets/select";
import type { Entry, EventKind } from "@/lib/widgets/types";
import type { Theme } from "@/lib/scene";
import { WIDGET_TYPES } from "@/lib/widgets/registry";

/**
 * A theme, drawn by the widget it will be applied to.
 *
 * The swatch used to be a hard-coded chat mock on every widget, which put six
 * copies of a live chat on an alien overlay's theme tab and said nothing about
 * the thing being themed. It now renders the overlay's own widget with the real
 * renderer against the theme's real values, so the card answers the only question
 * a picker can answer: what does this look like here.
 *
 * `sceneId` is namespaced per theme and is not the overlay's. The widgets that
 * keep state — the astronaut roster, the streaks table — key it by scene id, and
 * six live engines writing the viewer's real roster from a settings page would
 * corrupt it.
 */
const SWATCH_SCALE = 0.78;

const SAMPLE: { kind: EventKind; user: string; value: string }[] = [
  { kind: "comment", user: "mira", value: "this is so clean" },
  { kind: "gift", user: "kei", value: "Rose x1" },
  { kind: "like", user: "juno", value: "x2" },
];

const asEntries = (): Entry[] =>
  SAMPLE.map((s, i) => ({ ...s, id: String(i), seq: i, ts: 0, userId: s.user, meta: {} }));

/**
 * The chat mock, kept for the one widget a theme actually restyles.
 *
 * A theme carries the chat widget's own style on top of the shared typography,
 * and the real chat component needs a live feed to look right; this is the same
 * rows against the same `--w-*` values, which is enough to show the effect.
 */
function ChatSwatch({ global, style }: { global: GlobalStyle; style: StyleMap }) {
  const entries = asEntries();
  const comments = selectKinds(entries, ["comment"]);
  const cards = selectKinds(entries, ["like", "gift", "join"]);

  const accent = (kind: EventKind) =>
    ({ ["--sk-accent-color" as string]: global.usernameColors[kind] ?? "#ffffff" }) as React.CSSProperties;

  return (
    <div className="sk-list">
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
  );
}

/** Every other widget: the real component, on a sample feed. */
function WidgetSwatch({
  type,
  global,
  theme,
  fill,
}: {
  type: string;
  global: GlobalStyle;
  theme: Theme;
  fill: boolean;
}) {
  const def = WIDGET_TYPES[type];
  if (!def) return null;
  const { Component } = def;
  const style = resolveSurface({ ...def.defaults, ...(theme.widgets[type] ?? {}) });

  return (
    // `sk-fill` is what gives a full-frame widget its size; without it the box is
    // absolutely positioned with no inset and the canvas measures zero.
    <div className={`sk-widget${fill ? " sk-fill" : ""}`} style={fill ? undefined : { position: "relative" }}>
      <Component
        style={style}
        global={global}
        entries={asEntries()}
        viewers={1284}
        sceneId={`swatch:${theme.id}`}
        overlayId="swatch"
        preview
      />
    </div>
  );
}

export function ThemeSwatch({ theme, type = "chat" }: { theme: Theme; type?: string }) {
  const global: GlobalStyle = { ...DEFAULT_GLOBAL, ...theme.global };
  const style: StyleMap = resolveSurface({ ...chatWidget.defaults, ...(theme.widgets.chat ?? {}) });

  // Scoped to the swatch so six themes on one page cannot clobber each other's
  // variables, unlike the :root the overlay injects.
  //
  // No separator between the two layers: globalVars() and styleVars() each end
  // their list with a `;`, so the last global declaration and the first widget
  // declaration cannot fuse into one. They used to, and the browser read
  // `--sk-user-alert:#ffffff--w-bg:...` as a single declaration — the widget
  // background was never declared at all, which is most of what the six themes
  // disagree about.
  const vars = `.sk-swatch{${globalVars(global, SWATCH_SCALE)}${styleVars(style, SWATCH_SCALE)}}`;

  const fill = (WIDGET_TYPES[type]?.fill ?? false) && type !== "chat";
  // A full-frame widget needs a frame to fill, or its canvas measures zero.
  const frame = fill ? "h-[86px] w-full overflow-hidden" : "";

  return (
    <div className="bg-[#0d0d10] px-4 py-3.5">
      <style>{vars}</style>
      <div className={`sk-swatch ${frame}`}>
        {type === "chat" ? (
          <ChatSwatch global={global} style={style} />
        ) : (
          <WidgetSwatch type={type} global={global} theme={theme} fill={fill} />
        )}
      </div>
    </div>
  );
}
