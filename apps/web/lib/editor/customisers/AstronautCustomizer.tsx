"use client";

import { useState } from "react";
import type { CustomiserProps } from "@/lib/widgets/types";
import { num, str } from "@/lib/widgets/style";
import { Field, Range, Toggle, inputCls } from "@/lib/editor/controls";
import { Group, Note, pill, useFire } from "./shared";

/**
 * What each diamond threshold unlocks, in the order the engine checks them.
 * Kept next to the editor rather than only in the engine because this is the
 * one thing a streamer cannot infer from the numbers alone: that a gift below
 * `promote` does something entirely different from one above it.
 */
const TIERS = [
  { key: "promote-gift", label: "Promotion", blurb: "Above this a gift promotes the sender and drops 8 crates instead of a few." },
  { key: "asteroid-gift", label: "Asteroids", blurb: "An asteroid shower crosses the scene." },
  { key: "rocket-gift", label: "Rocket", blurb: "A rocket launches and the scene throws a pixel party for 8 seconds." },
  { key: "decor-station", label: "Station", blurb: "A space station drifts across permanently." },
  { key: "decor-nebula", label: "Nebula", blurb: "A nebula fades in behind the scene, for good." },
] as const;

/** Gift sizes that straddle the thresholds, so each tier can be reached. */
const SAMPLES = [1, 30, 200, 999];

const NAMES = ["budi", "sari", "dimas", "rina", "andi", "putri"];

/**
 * The astronaut customiser.
 *
 * A generated form would have been six sliders and a word list, which is worse
 * than useless here: the interesting decisions are "which gift should trigger
 * the rocket" and "does the scene look right", and neither survives being
 * expressed as a number. So the thresholds are shown as a ladder, and every
 * gift size that matters can be fired straight at the live preview beside it.
 */
export function AstronautCustomizer({ style, overlayId, onChange }: CustomiserProps) {
  const { fire, last } = useFire(overlayId);
  const [user, setUser] = useState(NAMES[0]);
  const [word, setWord] = useState("");

  const who = { user, user_id: user };
  const words = str(style, "bad-words", "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  const addWord = () => {
    const next = word.trim();
    if (!next || words.includes(next.toLowerCase())) return;
    onChange("bad-words", [...words, next].join(", "));
    setWord("");
  };

  return (
    <div className="space-y-4">
      <Group title="Reward ladder">
        <p className="text-[11px] leading-relaxed text-neutral-600">
          Every threshold is in diamonds, and they are checked in this order — so a gift worth more
          than the rocket line also triggers the asteroid line.
        </p>
        {TIERS.map((t) => {
          const value = num(style, t.key, 0);
          return (
            <div key={t.key} className="rounded-lg border border-white/10 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{t.label}</span>
                <span className="font-mono text-xs text-neutral-400">{value}💎</span>
              </div>
              <Range
                min={0}
                max={1000}
                step={5}
                value={value}
                onChange={(v) => onChange(t.key, v)}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">{t.blurb}</p>
            </div>
          );
        })}
      </Group>

      <Group title="Fire a test gift">
        <p className="text-[11px] leading-relaxed text-neutral-600">
          Goes through the same endpoint a donation webhook would, so the preview reacts exactly as it
          will on a real gift.
        </p>
        <div className="flex items-center gap-2">
          <select value={user} onChange={(e) => setUser(e.target.value)} className={inputCls}>
            {NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {SAMPLES.map((d) => (
            <button
              key={d}
              className={pill}
              onClick={() => void fire({ kind: "gift", ...who, text: "Rose", icon: "🎁", diamonds: d, count: 1 })}
            >
              {d}💎
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button className={pill} onClick={() => void fire({ kind: "follow", ...who, icon: "💚" })}>
            Follow
          </button>
          <button className={pill} onClick={() => void fire({ kind: "share", ...who, icon: "🔗" })}>
            Share
          </button>
          <button
            className={pill}
            onClick={() => void fire({ kind: "comment", ...who, text: "halo kak!", icon: "💬" })}
          >
            Comment
          </button>
        </div>
        {last ? <p className="text-[11px] text-red-400">{last}</p> : null}
      </Group>

      <Group title="Scene">
        <Toggle
          label="Space background"
          checked={style.space === true}
          onChange={(v) => onChange("space", v)}
        />
        <Field label="Pixel size — 0 fits the canvas">
          <Range
            min={0}
            max={12}
            value={num(style, "pixel-size", 0)}
            onChange={(v) => onChange("pixel-size", v)}
          />
        </Field>
        <Field label="Mission title">
          <input
            value={str(style, "mission", "")}
            placeholder="MISI: ..."
            onChange={(e) => onChange("mission", e.target.value)}
            className={inputCls}
          />
        </Field>
        <Toggle
          label="Counter"
          checked={style["show-hud"] === true}
          onChange={(v) => onChange("show-hud", v)}
        />
        <Toggle
          label="Event feed"
          checked={style["show-feed"] === true}
          onChange={(v) => onChange("show-feed", v)}
        />
        <Toggle
          label="Names"
          checked={style["show-labels"] === true}
          onChange={(v) => onChange("show-labels", v)}
        />
        <Field label={`Always-named top — ${num(style, "label-top", 8)}`}>
          <Range
            min={0}
            max={45}
            value={num(style, "label-top", 8)}
            onChange={(v) => onChange("label-top", v)}
          />
        </Field>
        <Field label={`Name the recent for — ${num(style, "label-active", 60)}s`}>
          <Range
            min={5}
            max={300}
            step={5}
            value={num(style, "label-active", 60)}
            onChange={(v) => onChange("label-active", v)}
          />
        </Field>
      </Group>

      <Group title="Roster">
        <Field label={`Max on screen — ${num(style, "max-astro", 45)}`}>
          <Range
            min={5}
            max={45}
            value={num(style, "max-astro", 45)}
            onChange={(v) => onChange("max-astro", v)}
          />
        </Field>
        <Field label={`Sleep after — ${num(style, "sleep-after", 180)}s`}>
          <Range
            min={30}
            max={600}
            step={30}
            value={num(style, "sleep-after", 180)}
            onChange={(v) => onChange("sleep-after", v)}
          />
        </Field>
        <Field label={`Leave after — ${num(style, "despawn-after", 600)}s`}>
          <Range
            min={60}
            max={1800}
            step={60}
            value={num(style, "despawn-after", 600)}
            onChange={(v) => onChange("despawn-after", v)}
          />
        </Field>
        <Note>
          A viewer falls asleep after going quiet and leaves the scene entirely once the despawn time
          passes. Ranks and XP persist between browser-source reloads.
        </Note>
      </Group>

      <Group title="Moderation">
        <Toggle
          label="Mask profanity"
          checked={style.censors === true}
          onChange={(v) => onChange("censors", v)}
        />
        {style.censors === false ? null : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {words.map((w) => (
                <button
                  key={w}
                  className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-neutral-300 transition hover:bg-red-500/20 hover:text-white"
                  title="Remove"
                  onClick={() => onChange("bad-words", words.filter((x) => x !== w).join(", "))}
                >
                  {w} ✕
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addWord();
                }}
                placeholder="Add a word"
                className={inputCls}
              />
              <button className="shrink-0 rounded-lg border border-white/15 px-3 text-xs" onClick={addWord}>
                Add
              </button>
            </div>
            <Note>
              Matched case-insensitively and replaced with one asterisk per letter, so the length of
              the word is not readable from the overlay.
            </Note>
          </>
        )}
      </Group>
    </div>
  );
}
