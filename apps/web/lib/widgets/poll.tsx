"use client";

import { useEffect, useRef, useState } from "react";
import { bool, num, str } from "./style";
import { apiFetch } from "@/lib/api";
import type { WidgetProps, WidgetType } from "./types";

/**
 * Live poll, with voting.
 *
 * The only widget here that sends anything. What makes it possible is that the
 * vote path is a *read* — a GET carrying the choice — so it stays open the way
 * the overlay and the socket are. That is deliberate and it is also the sharp
 * edge: anyone who can load the overlay can vote, including a bot. The
 * alternative is a session, which OBS cannot present, so the trade is made
 * knowingly rather than by omission.
 *
 * Creating a poll is not here. That is a write, it goes through the editor like
 * everything else, and the poll is a widget that the dashboard configures.
 */

interface Option {
  label: string;
  votes: number;
}

interface Poll {
  id: string;
  question: string;
  options: Option[];
  closed: boolean;
  /** null until the local vote is recorded, so the bar is not re-shown twice. */
  mine: string | null;
}

function Polls({ style, overlayId }: WidgetProps) {
  const showResults = bool(style, "show-results", true);
  const showBar = bool(style, "show-bar", true);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    setPoll(null);
    loaded.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayId]);

  async function load() {
    try {
      const res = await apiFetch(`/api/polls/${overlayId}`);
      if (!res.ok) return;
      const body = (await res.json()) as Poll;
      if (!body || !Array.isArray(body.options)) return;
      setPoll(body);
    } catch {
      /* no poll configured, or the API is down: nothing to draw */
    }
  }

  async function vote(index: number) {
    // One vote per poll, enforced by disabling the buttons rather than by
    // refusing server-side: a stray second click is not worth a round trip and
    // the local state is what the viewer sees anyway.
    if (!poll || poll.mine !== null || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/polls/${overlayId}/vote?choice=${index}`);
      if (res.ok) {
        const body = (await res.json()) as Poll;
        setPoll(body);
      }
    } catch {
      /* the choice is not worth an error state on a stream */
    } finally {
      setBusy(false);
    }
  }

  // Re-read every few seconds rather than subscribing: a poll changes when the
  // dashboard changes it, which is rare, and a socket per widget to learn about
  // an event a minute would be a lot of machinery for a slow number.
  useEffect(() => {
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayId]);

  if (!poll || !poll.options?.length) return null;

  const totalVotes = poll.options.reduce((sum, o) => sum + (o.votes || 0), 0);
  const reveal = showResults && (poll.closed || poll.mine !== null);

  return (
    <div className="sk-poll">
      <div className="sk-poll-question">{poll.question || str(style, "question", "Vote")}</div>
      <div className="sk-poll-options">
        {poll.options.map((o, i) => {
          const pct = totalVotes > 0 ? Math.round(((o.votes || 0) / totalVotes) * 100) : 0;
          const chosen = poll.mine === String(i) || poll.mine === String(o.label);
          return (
            <button
              type="button"
              key={`${o.label}-${i}`}
              className={`sk-poll-option${chosen ? " is-chosen" : ""}`}
              disabled={poll.mine !== null || busy}
              onClick={() => void vote(i)}
            >
              {showBar && reveal ? (
                <span className="sk-poll-bar" style={{ width: `${pct}%` }} />
              ) : null}
              <span className="sk-poll-label">{o.label}</span>
              {showResults && reveal ? <span className="sk-poll-pct">{pct}%</span> : null}
            </button>
          );
        })}
      </div>
      {reveal ? (
        <div className="sk-poll-total">
          {totalVotes} vote{totalVotes === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

export const pollWidget: WidgetType = {
  id: "poll",
  label: "Poll",
  icon: "📊",
  blurb: "A question with vote buttons, and the result.",
  unique: true,
  defaults: {
    bg: "#0b0b0f",
    "bg-opacity": 70,
    radius: 18,
    pad: 12,
    gap: 8,
    size: 15,
    "question-size": 17,
    weight: 700,
    accent: "#f9c74f",
    question: "What next?",
    "show-results": true,
    "show-bar": true,
  },
  kinds: [],
  groups: [
    {
      title: "Poll",
      controls: [
        { kind: "text", key: "question", label: "Question", placeholder: "What next?" },
        { kind: "toggle", key: "show-results", label: "Show percentages" },
        { kind: "toggle", key: "show-bar", label: "Show bars" },
      ],
    },
    {
      title: "Surface",
      controls: [
        { kind: "color", key: "bg", label: "Background", opacityKey: "bg-opacity" },
        { kind: "color", key: "accent", label: "Accent" },
        { kind: "range", key: "size", label: "Option size", min: 9, max: 32, suffix: "px" },
        { kind: "range", key: "question-size", label: "Question size", min: 10, max: 44, suffix: "px" },
        { kind: "range", key: "radius", label: "Corner radius", min: 0, max: 40, suffix: "px" },
        { kind: "range", key: "pad", label: "Padding", min: 0, max: 32, suffix: "px" },
        { kind: "range", key: "gap", label: "Gap", min: 0, max: 24, suffix: "px" },
      ],
    },
  ],
  Component: Polls,
};
