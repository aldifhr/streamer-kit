"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bool, num, str } from "./style";
import { takeNew } from "./astro/consume";
import type { Entry, WidgetProps, WidgetType } from "./types";

/**
 * Donation jar: one total, fed by whatever the room does.
 *
 * The goal bar counts one source at a time — diamonds or follows or likes, never
 * more than one. That is the wrong shape for a jar. A jar is a single pot that
 * any kind of support tips into, because the thing it is showing is "how far to
 * the goal", not "which metric is closest". A room that follows and gifts and
 * shares is one room that helped, and splitting that into three bars splits the
 * credit too.
 *
 * External money arrives through `POST /api/hooks/{id}` with an `amount`, which
 * until now was formatted into the text and thrown away, so a webhook donation
 * rendered as the word "50000" and the jar had nothing to add. That is fixed on
 * the wire: `amount` is carried as a number now.
 *
 * Each source has a weight because the events are not comparable. A share is one
 * tap; a gift can be five thousand diamonds; a like arrives in storms. Equal
 * weights would let a room clear the goal on likes alone and make the diamonds
 * irrelevant, so the defaults are deliberately lopsided and adjustable.
 */

type Source = "gift" | "like" | "follow" | "share" | "donation";

const nf = new Intl.NumberFormat("en-US");

/** What one of each event is worth by default, in jar units. */
const DEFAULT_WEIGHTS: Record<Source, number> = {
  gift: 1,
  like: 0.05,
  follow: 25,
  share: 15,
  donation: 1,
};

function valueOf(e: Entry, source: Source): number {
  switch (source) {
    case "gift": {
      // A gift's worth is its diamonds. A rosace is 1 and a lion is 1000, and
      // treating them as one event each would make a single big gift look
      // like a small one.
      const diamonds = num(e.meta, "diamonds", 0);
      const count = Math.max(1, num(e.meta, "count", 1));
      return diamonds * count;
    }
    case "like":
      return Math.max(1, num(e.meta, "count", 1));
    case "follow":
    case "share":
      return 1;
    case "donation":
      return num(e.meta, "amount", 0);
    default:
      return 0;
  }
}

function DonationJar({ style, entries, sceneId }: WidgetProps) {
  const target = Math.max(1, num(style, "target", 1000));
  const currency = str(style, "currency", "Rp");
  const showRecent = bool(style, "show-recent", true);

  // A source is on unless it is explicitly switched off, so a newly added
  // weight is used without the operator having to visit the editor first.
  const weights = {
    gift: num(style, "w-gift", DEFAULT_WEIGHTS.gift),
    like: num(style, "w-like", DEFAULT_WEIGHTS.like),
    follow: num(style, "w-follow", DEFAULT_WEIGHTS.follow),
    share: num(style, "w-share", DEFAULT_WEIGHTS.share),
    donation: num(style, "w-donation", DEFAULT_WEIGHTS.donation),
  };
  const sources = useMemo(
    () =>
      (Object.keys(weights) as Source[]).filter((s) => {
        if (s === "donation") return bool(style, "use-donation", true);
        return bool(style, `use-${s}`, true);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style],
  );

  const [recent, setRecent] = useState<{ user: string; amount: number }[]>([]);
  const lastSeq = useRef(0);
  const total = useRef(0);
  const [earned, setEarned] = useState(0);
  const [pulse, setPulse] = useState(false);
  const loaded = useRef(false);

  // Session state, like the goal bar. A jar that survives a reload would show a
  // total from a stream that is not this one.
  useEffect(() => {
    total.current = 0;
    lastSeq.current = 0;
    loaded.current = true;
    setEarned(0);
    setRecent([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  // The marker is the highest sequence handled, and `takeNew` is what advances
  // it correctly. This used to read `entries[entries.length - 1].seq`, which is
  // the *oldest* entry retained, because the feed prepends: the marker trailed
  // behind everything already counted, so the next render counted it all again.
  // With no dependency array the effect ran on every render, so the total grew
  // without a single new event and the recent list filled with repeats. A total
  // that climbs on its own is worse than one that does not move, because it
  // still looks like progress.
  useEffect(() => {
    if (!loaded.current) return;
    const { fresh, consumed } = takeNew(entries, lastSeq.current);
    if (fresh.length === 0) return;
    lastSeq.current = consumed;

    const added: { user: string; amount: number }[] = [];
    for (const e of fresh) {
      let source: Source | null = null;
      if (e.kind === "gift") source = "gift";
      else if (e.kind === "like") source = "like";
      else if (e.kind === "follow") source = "follow";
      else if (e.kind === "share") source = "share";
      // A hook donation arrives as an alert carrying an amount. An alert with no
      // amount is a plain alert and must not count — otherwise every manual
      // test from the editor's trigger panel would tip the jar.
      else if (e.kind === "alert" && num(e.meta, "amount", 0) > 0) source = "donation";

      if (!source || !sources.includes(source)) continue;
      const raw = valueOf(e, source);
      if (!(raw > 0)) continue;
      const worth = raw * (weights[source] ?? 1);
      if (!(worth > 0)) continue;
      total.current += worth;
      added.push({ user: e.user || "anon", amount: worth });
    }

    if (!added.length) return;
    setEarned(total.current);
    setRecent((prev) => [...added, ...prev].slice(0, 3));
    setPulse(true);
    setTimeout(() => setPulse(false), 900);
    // Keyed on the buffer rather than on every render, so the arithmetic happens
    // once per batch of events and never on a re-render that brought none.
  }, [entries]);

  const pct = Math.max(0, Math.min(100, (earned / target) * 100));
  const done = earned >= target;
  const remaining = Math.max(0, target - earned);

  return (
    <div className={`sk-jar${done ? " is-done" : ""}${pulse ? " is-pulsing" : ""}`}>
      {bool(style, "show-label", true) ? (
        <div className="sk-jar-head">
          <span className="sk-jar-title">{str(style, "label", "Donation jar")}</span>
          <span className="sk-jar-numbers">
            {currency}
            {nf.format(Math.round(earned))} / {currency}
            {nf.format(target)}
          </span>
        </div>
      ) : null}

      <div className="sk-jar-track">
        <div className="sk-jar-fill" style={{ width: `${pct}%` }} />
      </div>

      {bool(style, "show-remaining", true) ? (
        <div className="sk-jar-remaining">
          {done
            ? str(style, "done-text", "Goal reached!")
            : `${currency}${nf.format(Math.round(remaining))} to go`}
        </div>
      ) : null}

      {showRecent && recent.length ? (
        <div className="sk-jar-recent">
          {recent.map((r, i) => (
            <div className="sk-jar-recent-row" key={`${r.user}-${i}`}>
              <span className="sk-jar-recent-user">{r.user}</span>
              <span className="sk-jar-recent-amount">
                {currency}
                {nf.format(Math.round(r.amount))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const donationJarWidget: WidgetType = {
  id: "donation-jar",
  label: "Donation jar",
  icon: "🫙",
  blurb: "One pot fed by gifts, follows, shares, likes and webhook donations.",
  unique: true,
  defaults: {
    label: "Donation jar",
    target: 1000,
    currency: "Rp",
    "bar-height": 22,
    radius: 12,
    "label-size": 14,
    "title-size": 14,
    "max-w": 460,
    gap: 8,
    bg: "#000000",
    "bg-opacity": 55,
    fill: "#ffb86b",
    accent: "#ffd166",
    "show-label": true,
    "show-remaining": true,
    "show-recent": true,
    "done-text": "Goal reached!",
    // Sources, all on by default.
    "use-gift": true,
    "use-like": true,
    "use-follow": true,
    "use-share": true,
    "use-donation": true,
    // Weights. A like is a fraction because likes arrive in storms and would
    // otherwise clear the jar on their own; a gift is weighted by its own
    // diamonds, so its weight is a multiplier on real money rather than a
    // separate scale.
    "w-gift": 1,
    "w-like": 0.05,
    "w-follow": 25,
    "w-share": 15,
    "w-donation": 1,
  },
  kinds: ["gift", "like", "follow", "share", "alert"],
  groups: [
    {
      title: "Jar",
      controls: [
        { kind: "text", key: "label", label: "Title", placeholder: "Donation jar" },
        { kind: "number", key: "target", label: "Target", min: 1 },
        { kind: "text", key: "currency", label: "Currency", placeholder: "Rp" },
        { kind: "toggle", key: "show-label", label: "Show label" },
        { kind: "toggle", key: "show-remaining", label: "Show amount to go" },
        { kind: "toggle", key: "show-recent", label: "Show recent tips" },
        { kind: "text", key: "done-text", label: "Text when full", placeholder: "Goal reached!" },
      ],
    },
    {
      title: "What fills it",
      controls: [
        { kind: "toggle", key: "use-gift", label: "Gifts" },
        { kind: "toggle", key: "use-like", label: "Likes" },
        { kind: "toggle", key: "use-follow", label: "Follows" },
        { kind: "toggle", key: "use-share", label: "Shares" },
        { kind: "toggle", key: "use-donation", label: "Webhook donations" },
      ],
    },
    {
      title: "Weights",
      controls: [
        { kind: "range", key: "w-like", label: "Per like", min: 0, max: 5, step: 0.05 },
        { kind: "range", key: "w-follow", label: "Per follow", min: 0, max: 200, step: 5 },
        { kind: "range", key: "w-share", label: "Per share", min: 0, max: 200, step: 5 },
        { kind: "range", key: "w-gift", label: "Per diamond", min: 0, max: 5, step: 0.1 },
        { kind: "range", key: "w-donation", label: "Per donation unit", min: 0, max: 5, step: 0.1 },
      ],
    },
    {
      title: "Bar",
      controls: [
        { kind: "range", key: "bar-height", label: "Height", min: 4, max: 60, suffix: "px" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 30, suffix: "px" },
        { kind: "range", key: "gap", label: "Row gap", min: 0, max: 24, suffix: "px" },
        { kind: "range", key: "label-size", label: "Numbers size", min: 9, max: 32, suffix: "px" },
        { kind: "range", key: "title-size", label: "Title size", min: 9, max: 32, suffix: "px" },
        { kind: "range", key: "max-w", label: "Max width", min: 200, max: 900, step: 10, suffix: "px" },
      ],
    },
    {
      title: "Colours",
      controls: [
        { kind: "color", key: "fill", label: "Fill" },
        { kind: "color", key: "accent", label: "Accent" },
        { kind: "color", key: "bg", label: "Track", opacityKey: "bg-opacity" },
      ],
    },
  ],
  Component: DonationJar,
};
