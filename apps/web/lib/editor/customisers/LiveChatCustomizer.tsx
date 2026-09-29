"use client";

import { useMemo, useState } from "react";
import type { CustomiserProps } from "@/lib/widgets/types";
import { num, str } from "@/lib/widgets/style";
import { Field, Range, Segmented, Toggle, inputCls } from "@/lib/editor/controls";
import { Group, Note, pill, useFire } from "./shared";

const KINDS = [
  { key: "show-comment", label: "Comments" },
  { key: "show-like", label: "Likes" },
  { key: "show-gift", label: "Gifts" },
  { key: "show-join", label: "Joins" },
  { key: "show-follow", label: "Follows" },
  { key: "show-share", label: "Shares" },
] as const;

const NAMES = ["budi", "sari", "dimas", "rina"];

/**
 * The chat customiser.
 *
 * The generic form would offer "max messages: 40" and "lifetime: 12000", which
 * are only meaningful together and relative to the canvas. This states the same
 * two settings as something a streamer can picture: how many lines fit at once,
 * and how long a full screen of them lasts.
 */

/**
 * A 1080p canvas, at the scene's font size. Used to turn "max messages" and
 * "lifetime" into the only two numbers a streamer actually cares about: how
 * many fit, and for how long.
 *
 * The font size is the scene's, not the chat widget's — the chat widget owns no
 * size of its own, so reading it from the style bag would have silently fallen
 * back to a default and reported a number that was not true of the scene.
 */
function fitsInScene(lifetimeSec: number, lineHeight: number, fontSize: number) {
  const rows = Math.floor(1080 / (fontSize * lineHeight));
  const untilEmpty = Math.floor((lifetimeSec * rows) / 60);
  return { rows, untilEmpty };
}

export function LiveChatCustomizer({ style, global, overlayId, onChange }: CustomiserProps) {
  const { fire, last } = useFire(overlayId);
  const [user, setUser] = useState(NAMES[0]);
  const [text, setText] = useState("");

  const max = num(style, "max", 40);
  const lifetimeMs = num(style, "lifetime", 12000);
  const { rows, untilEmpty } = useMemo(
    () => fitsInScene(lifetimeMs / 1000, global.lineHeight, global.fontSize),
    [lifetimeMs, global.lineHeight, global.fontSize],
  );

  const who = { user, user_id: user };

  return (
    <div className="space-y-4">
      <Group title="How much stays on screen">
        <div className="rounded-lg border border-white/10 p-3 text-[11px] leading-relaxed text-neutral-500">
          At this font size, about <span className="text-neutral-300">{rows}</span> lines fit a 1080p
          canvas. A full screen of them lasts roughly{" "}
          <span className="text-neutral-300">{untilEmpty}s</span> before the oldest expires.
        </div>

        <Field label={`Max comments — ${max}`}>
          <Range min={5} max={100} value={max} onChange={(v) => onChange("max", v)} />
        </Field>
        <Field label={`Lifetime — ${(lifetimeMs / 1000).toFixed(1)}s`}>
          <Range
            min={3000}
            max={60000}
            step={1000}
            value={lifetimeMs}
            onChange={(v) => onChange("lifetime", v)}
          />
        </Field>
        <Field label={`Max event cards — ${num(style, "max-events", 12)}`}>
          <Range
            min={1}
            max={50}
            value={num(style, "max-events", 12)}
            onChange={(v) => onChange("max-events", v)}
          />
        </Field>
        <Note>
          Comments and event cards are budgeted separately. TikTok batches join events, so a run of
          them is far faster than comments — sharing one budget used to evict every comment from the
          screen entirely.
        </Note>
      </Group>

      <Group title="What shows up">
        <div className="space-y-3">
          {KINDS.map((k) => (
            <Toggle
              key={k.key}
              label={k.label}
              checked={style[k.key] === true}
              onChange={(v) => onChange(k.key, v)}
            />
          ))}
        </div>
        <Note>
          Hidden types are removed with <code className="text-neutral-500">display</code>, so they keep
          streaming and cost nothing to turn back on.
        </Note>
      </Group>

      <Group title="Shape">
        <Field label="Layout">
          <Segmented
            options={[
              { value: "flex-start", label: "Inline" },
              { value: "stretch", label: "Bubble" },
            ]}
            value={str(style, "align", "flex-start")}
            onChange={(v) => onChange("align", v)}
          />
        </Field>
        <Field label={`Max width — ${num(style, "max-w", 460)}px`}>
          <Range
            min={240}
            max={900}
            step={10}
            value={num(style, "max-w", 460)}
            onChange={(v) => onChange("max-w", v)}
          />
        </Field>
        <Field label={`Line gap — ${num(style, "gap", 4)}px`}>
          <Range min={0} max={20} value={num(style, "gap", 4)} onChange={(v) => onChange("gap", v)} />
        </Field>
      </Group>

      <Group title="Try it">
        <div className="flex gap-2">
          <select value={user} onChange={(e) => setUser(e.target.value)} className={inputCls}>
            {NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              void fire({ kind: "comment", ...who, text: text.trim() });
              setText("");
            }
          }}
          placeholder="Type a comment and press enter"
          className={inputCls}
        />
        <div className="grid grid-cols-3 gap-1.5">
          <button
            className={pill}
            onClick={() => void fire({ kind: "like", ...who, icon: "❤️" })}
          >
            Like
          </button>
          <button
            className={pill}
            onClick={() => void fire({ kind: "gift", ...who, text: "Rose", icon: "🎁", diamonds: 1, count: 1 })}
          >
            Gift
          </button>
          <button
            className={pill}
            onClick={() => void fire({ kind: "join", ...who, icon: "👋" })}
          >
            Join
          </button>
        </div>
        {last ? <p className="text-[11px] text-red-400">{last}</p> : null}
      </Group>
    </div>
  );
}
