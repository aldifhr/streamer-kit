"use client";

import { useState } from "react";

const PRESETS: { kind: string; icon: string; label: string; user: string; title: string }[] = [
  { kind: "follow", icon: "💚", label: "Follow", user: "someone", title: "" },
  { kind: "share", icon: "🔗", label: "Share", user: "someone", title: "" },
  { kind: "gift", icon: "🎁", label: "Gift", user: "someone", title: "" },
  { kind: "alert", icon: "★", label: "Custom", user: "", title: "Heads up" },
];

/**
 * Fire an overlay event by hand.
 *
 * The point of the normalised event layer: anything that can POST to
 * `/api/overlays/{id}/trigger` shows up on the stream, so a donation webhook or
 * a Stream Deck button needs no backend change. The same endpoint is what a
 * webhook posts to, which makes this button a test for that path rather than a
 * separate mechanism.
 */
export function TriggerPanel({ overlayId }: { overlayId: string }) {
  const [text, setText] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fire = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/overlays/${overlayId}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setLast(res.ok ? "Sent" : `Failed (${res.status})`);
      setTimeout(() => setLast(null), 2000);
    } catch {
      setLast("Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-600">
        Push an event into this overlay without a live event behind it. The same
        endpoint is what an external webhook posts to.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.kind}
            disabled={busy}
            onClick={() =>
              void fire({
                kind: p.kind,
                user: p.user,
                title: p.title,
                text: p.kind === "gift" ? "Rose x1" : "",
                icon: p.icon,
              })
            }
            className="rounded-lg border border-white/15 px-3 py-2 text-left text-xs transition hover:bg-white/5 disabled:opacity-40"
          >
            <span className="mr-1.5">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1.5 block text-xs text-neutral-500">Custom message</label>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) void fire({ kind: "alert", title: "Heads up", text: text.trim() });
            }}
            placeholder="Say something…"
            className="w-full rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm outline-none transition placeholder:text-neutral-600 focus:border-white/40"
          />
          <button
            disabled={!text.trim() || busy}
            onClick={() => void fire({ kind: "alert", title: "Heads up", text: text.trim() })}
            className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-30"
          >
            Fire
          </button>
        </div>
        {last ? <p className="mt-2 text-xs text-neutral-500">{last}</p> : null}
      </div>
    </div>
  );
}
