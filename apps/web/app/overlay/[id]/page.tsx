"use client";

import { useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import { API_ORIGIN, wsUrl } from "@/lib/api";
import {
  DEFAULT_CONFIG,
  EVENT_VERB,
  ICONS,
  isEvent,
  normalise,
  toCssVars,
  userColor,
  type EventKind,
  type MsgType,
  type OverlayConfig,
} from "@/lib/config";

interface ChatLine {
  kind: MsgType;
  user: string;
  value: string;
}

/**
 * The backend only ever sends these; anything else is ignored. `value` is the
 * bare payload — the verb is added at render time from EVENT_VERB, otherwise
 * joins come out doubled ("joined joined").
 */
const FROM_WIRE: Record<string, (d: Record<string, unknown>) => Omit<Entry, "id" | "seq"> | null> = {
  comment: (d) => ({ kind: "comment", user: String(d.user), value: String(d.text) }),
  like: (d) => ({ kind: "like", user: String(d.user), value: `x${d.count}` }),
  gift: (d) => ({ kind: "gift", user: String(d.user), value: `${d.giftName} x${d.count}` }),
  join: (d) => ({ kind: "join", user: String(d.user), value: "" }),
};

interface Entry extends Omit<ChatLine, "id"> {
  id: string;
  /** Monotonic counter so the two buffers can be merged back into one
   *  newest-first stream without relying on array order. */
  seq: number;
}

const EMPTY_CONFIG = DEFAULT_CONFIG;

export default function RawOverlay({ params }: { params: Promise<{ id: string }> }) {
  const { id: overlayId } = use(params);

  const [config, setConfig] = useState<OverlayConfig | null>(null);
  // Chat and events are budgeted separately. Sharing one 40-slot buffer meant a
  // run of joins (which arrive far faster than comments) evicted every comment
  // from the overlay entirely.
  const [chat, setChat] = useState<Entry[]>([]);
  const [events, setEvents] = useState<Entry[]>([]);

  const configRef = useRef<OverlayConfig | null>(null);
  const timers = useRef<number[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    fetch(`/api/overlays/${overlayId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        setConfig(normalise(data.config));
        if (!data.username) return;

        // This page is what OBS loads, so it owns the connection. The endpoint
        // is idempotent per (overlay, username), so the editor can call it too.
        fetch(`${API_ORIGIN}/api/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: data.username, overlay_id: overlayId }),
        }).catch(() => {});
      })
      .catch(() => setConfig(null));
  }, [overlayId]);

  const push = useCallback((partial: Omit<Entry, "id" | "seq">) => {
    const c = configRef.current ?? EMPTY_CONFIG;
    const id = `${++seq.current}`;
    const entry: Entry = { ...partial, id, seq: seq.current };

    const setter = partial.kind === "comment" ? setChat : setEvents;
    setter((prev) => [entry, ...prev].slice(0, partial.kind === "comment" ? c.maxMessages : c.maxEvents));

    const handle = window.setTimeout(() => {
      setter((prev) => prev.filter((e) => e.id !== id));
    }, c.messageTimeout);
    timers.current.push(handle);
  }, []);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const open = () => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl(`/ws/overlay/${overlayId}`));

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (data.type === "config") {
          setConfig(normalise(data.config));
          return;
        }
        const build = FROM_WIRE[String(data.type)];
        if (!build) return;
        const entry = build(data);
        if (entry) push(entry);
      };

      ws.onclose = () => {
        if (disposed) return;
        attempt += 1;
        retry = setTimeout(open, Math.min(1000 * attempt, 10000));
      };

      ws.onerror = () => ws.close();
    };

    open();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [overlayId, push]);

  // Merge both budgets back into one newest-first stream for display. This has
  // to sit above the `!config` bail-out: a hook after an early return is not
  // called on the first render, which changes hook order between renders.
  const entries = useMemo(
    () => [...chat, ...events].sort((a, b) => b.seq - a.seq),
    [chat, events],
  );

  if (!config) return null;

  const nameColor = (user: string, kind: MsgType) => {
    const c = config;
    if (c.usernameColorMode === "perUser") return userColor(user);
    if (c.usernameColorMode === "solid") return c.usernameColors.comment;
    return c.usernameColors[kind];
  };

  return (
    <div className="sk-root">
      <style>{`:root{${toCssVars(config)}}`}</style>
      {config.customCSS ? <style dangerouslySetInnerHTML={{ __html: config.customCSS }} /> : null}

      <div className="sk-list">
        {entries.map((e) =>
          isEvent(e.kind) ? (
            <div
              key={e.id}
              className="sk-event"
              data-kind={e.kind}
              style={{ ["--sk-accent-color" as string]: config.usernameColors[e.kind] }}
            >
              {config.showIcons ? (
                <span className="sk-event-icon">{ICONS[e.kind as EventKind]}</span>
              ) : null}
              <span className="sk-event-title" style={{ color: nameColor(e.user, e.kind) }}>
                {e.user}
              </span>
              <span className="sk-event-value">
                {EVENT_VERB[e.kind]}
                {e.value ? ` ${e.value}` : ""}
              </span>
            </div>
          ) : (
            <div key={e.id} className="sk-chat" data-kind="comment">
              <span className="sk-username" style={{ color: nameColor(e.user, e.kind) }}>
                {e.user}
              </span>
              <span className="sk-text"> {e.value}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
