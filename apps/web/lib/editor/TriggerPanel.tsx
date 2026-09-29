"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { inputCls } from "./controls";

const PRESETS: { kind: string; icon: string; label: string; text: string; title: string }[] = [
  { kind: "follow", icon: "💚", label: "Follow", text: "", title: "" },
  { kind: "share", icon: "🔗", label: "Share", text: "", title: "" },
  { kind: "comment", icon: "💬", label: "Comment", text: "halo kak!", title: "" },
  { kind: "alert", icon: "★", label: "Custom", text: "", title: "Heads up" },
];

const NAMES = ["budi", "sari", "dimas", "rina", "andi", "putri"];

/**
 * Gift sizes chosen to straddle the reward thresholds a widget may key on, so
 * every tier can be reached from here without waiting for a real one.
 */
const GIFTS: { label: string; name: string; diamonds: number }[] = [
  { label: "Small — 1💎", name: "Rose", diamonds: 1 },
  { label: "Mid — 30💎", name: "Finger Heart", diamonds: 30 },
  { label: "Big — 200💎", name: "Galaxy", diamonds: 200 },
  { label: "Huge — 999💎", name: "Lion", diamonds: 999 },
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
  const [user, setUser] = useState(NAMES[0]);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fire = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
        const res = await apiFetch(`/api/overlays/${overlayId}/trigger`, {
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

  /**
   * user and user_id are both sent, and separately. user_id is the stable key
   * the astronaut widget keeps per-viewer state against, so sending a nickname
   * alone would merge every test into one astronaut.
   */
  const who = () => ({ user, user_id: user });

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-neutral-600">
        Push an event into this overlay without a live event behind it. The same
        endpoint is what an external webhook posts to.
      </p>

      <div>
        <label className="mb-1.5 block text-xs text-neutral-500">Viewer</label>
        <select value={user} onChange={(e) => setUser(e.target.value)} className={inputCls}>
          {NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.kind}
            disabled={busy}
            onClick={() => void fire({ kind: p.kind, ...who(), title: p.title, text: p.text, icon: p.icon })}
            className="rounded-lg border border-white/15 px-3 py-2 text-left text-xs transition hover:bg-white/5 disabled:opacity-40"
          >
            <span className="mr-1.5">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1.5 block text-xs text-neutral-500">Gift</label>
        <div className="grid grid-cols-2 gap-2">
          {GIFTS.map((g) => (
            <button
              key={g.diamonds}
              disabled={busy}
              onClick={() =>
                void fire({
                  kind: "gift",
                  ...who(),
                  text: g.name,
                  icon: "🎁",
                  diamonds: g.diamonds,
                  count: 1,
                })
              }
              className="rounded-lg border border-white/15 px-3 py-2 text-left text-[11px] transition hover:bg-white/5 disabled:opacity-40"
            >
              <span className="mr-1.5">🎁</span>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs text-neutral-500">Custom message</label>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                void fire({ kind: "comment", ...who(), text: text.trim() });
              }
            }}
            placeholder="Say something…"
            className={`${inputCls} placeholder:text-neutral-600`}
          />
          <button
            disabled={!text.trim() || busy}
            onClick={() => void fire({ kind: "comment", ...who(), text: text.trim() })}
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
