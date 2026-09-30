"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, wsUrl } from "@/lib/api";
import { normaliseScene, sceneLifetime, type SceneConfig } from "@/lib/scene";
import type { Entry, EventKind } from "@/lib/widgets/types";

/**
 * How the wire payload for each kind is read.
 *
 * The verb is deliberately absent: "kei sent Rose x1" is assembled at render
 * time from VERB below, so a join cannot come out doubled.
 */
const FROM_WIRE: Record<
  string,
  (d: Record<string, unknown>) => {
    kind: EventKind;
    user: string;
    userId: string;
    value: string;
    meta: Record<string, unknown>;
  }
> = {
  comment: (d) => ({ kind: "comment", user: String(d.user), userId: id(d), value: String(d.text), meta: {} }),
  like: (d) => ({ kind: "like", user: String(d.user), userId: id(d), value: `x${d.count}`, meta: { totalLikes: d.totalLikes } }),
  gift: (d) => ({
    kind: "gift",
    user: String(d.user),
    userId: id(d),
    value: `${d.giftName} x${d.count}`,
    meta: { diamonds: d.value },
  }),
  join: (d) => ({ kind: "join", user: String(d.user), userId: id(d), value: "", meta: { viewers: d.viewers } }),
  follow: (d) => ({ kind: "follow", user: String(d.user), userId: id(d), value: "", meta: {} }),
  share: (d) => ({ kind: "share", user: String(d.user), userId: id(d), value: d.count ? `+${d.count}` : "", meta: {} }),
  alert: (d) => ({
    kind: "alert",
    user: String(d.user ?? ""),
    userId: id(d),
    value: String(d.text ?? ""),
    meta: { title: d.title ?? "", icon: d.icon ?? "★" },
  }),
};

/**
 * The backend sends a stable handle as `userId` and already falls back to the
 * nickname server-side, so the only case left to cover here is a payload that
 * carries neither.
 */
const id = (d: Record<string, unknown>): string => {
  const stable = d.userId;
  if (typeof stable === "string" && stable) return stable;
  return typeof d.user === "string" ? d.user : "anon";
};

/**
 * Upper bound on the shared buffer.
 *
 * One buffer for the whole scene rather than one per widget: two chat widgets
 * would otherwise each hold their own copy of every comment, and a widget that
 * mounts later would start with a gap in its history. The cap is the scene's
 * ceiling; each widget then keeps only the kinds it subscribes to and applies
 * its own limits on top.
 */
const BUFFER_MAX = 200;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface Feed {
  config: SceneConfig | null;
  entries: Entry[];
  viewers: number | null;
  status: ConnectionStatus;
  error: string | null;
  /** Replay a config the caller changed locally, without a round trip. */
  setConfig: (c: SceneConfig) => void;
}

/**
 * Owns the socket, the shared entry buffer, the viewer count and the connection
 * status. Every widget reads from this one instance, so a scene with five
 * widgets still has a single WebSocket and a single copy of each message.
 */
export function useFeed(overlayId: string): Feed {
  const [config, setConfig] = useState<SceneConfig | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [viewers, setViewers] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Derived from the config the feed itself delivered, which is why lifetime is
  // not a parameter: the caller cannot know it until the scene has loaded.
  const lifetime = useMemo(() => (config ? sceneLifetime(config) : 0), [config]);

  const seq = useRef(0);

  useEffect(() => {
    let disposed = false;
    const url = wsUrl(`/ws/overlay/${overlayId}`);

    fetch(`/api/overlays/${overlayId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        if (disposed) return;
        setConfig(normaliseScene(data.config));
        if (!data.username) return;

        // This page is what OBS loads, so it owns the connection. The endpoint
        // is idempotent per (overlay, username), so the editor can call it too.
        //
        // A rejected connect used to be swallowed, which produced a permanently
        // blank browser source with nothing in the console: the most common
        // cause is the API having STREAMKIT_TOKEN set while this build has no
        // matching STREAMKIT_API_TOKEN to attach at the proxy. That is worth
        // saying out loud rather than failing quietly on stream.
        // The overlay-connect path, not /api/connect. This runs on the overlay
        // page, which OBS loads with no session, so the session-gated connect is
        // a 401 here and the scene stays the sample scene forever — which is
        // what the red "token mismatch" notice was actually reporting. The
        // scoped endpoint takes no body: the backend reads the username from
        // this overlay's own saved config, so it can only ever connect the room
        // this overlay already names.
        apiFetch(`/api/overlay-connect/${overlayId}`, { method: "POST" })
          .then((res) => {
            if (res.status === 401) {
              setError("API rejected the request — token mismatch");
            } else if (!res.ok) {
              setError(`Connect failed (${res.status})`);
            }
          })
          .catch(() => setError("Could not reach the API"));
      })
      .catch(() => !disposed && setError("Overlay not found"));

    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let ws: WebSocket | null = null;

    const open = () => {
      if (disposed) return;
      // Held in a local as well as the outer `ws`, so the handlers below cannot
      // be tripped up by cleanup nulling it out from under them.
      const sock = new WebSocket(url);
      ws = sock;

      sock.onopen = () => {
        attempt = 0;
      };

      sock.onmessage = (event) => {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        const type = String(data.type);

        if (type === "config") {
          setConfig(normaliseScene(data.config));
          return;
        }
        if (type === "status") {
          if (data.connected) {
            setStatus("connected");
            setError(null);
          } else {
            // A snapshot mid-handshake says "connecting"; a genuine drop does not.
            setStatus(data.connecting ? "connecting" : "idle");
          }
          return;
        }
        if (type === "error") {
          setStatus("error");
          setError(String(data.message));
          return;
        }
        if (type === "viewers") {
          setViewers(Number(data.count) || 0);
          return;
        }

        const build = FROM_WIRE[type];
        if (!build) return;
        const parsed = build(data);

        // The id and the sequence have to be read here, not inside the
        // updater. React defers updater functions to the render phase, so a ref
        // read there would see whatever value the ref has by then — which meant
        // two messages batched into one render both produced the same id, and
        // the same seq. Duplicate keys, and a merge sort with nothing to sort
        // by.
        seq.current += 1;
        const n = seq.current;
        const entry: Entry = { ...parsed, id: `${n}`, seq: n, ts: Date.now() };

        setEntries((prev) => [entry, ...prev].slice(0, BUFFER_MAX));
      };

      sock.onclose = () => {
        if (disposed) return;
        // Back off so a backend that is down does not get hammered, and so a
        // restart is picked up without the user touching anything.
        attempt += 1;
        retry = setTimeout(open, Math.min(1000 * attempt, 10000));
      };

      sock.onerror = () => sock.close();
    };

    open();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      // The socket has to be closed, not just flagged. Leaving it open keeps
      // its onmessage attached to this component's setState, so a remount —
      // which StrictMode does deliberately on every mount in development —
      // leaves two live sockets both pushing into the same buffer, and every
      // message lands twice.
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.close();
        ws = null;
      }
    };
  }, [overlayId]);

  // One interval for the whole scene rather than a timer per entry. The
  // previous implementation allocated a timeout per message and never released
  // the handles, so a busy room leaked thousands of them.
  useEffect(() => {
    if (lifetime <= 0) return;
    const sweep = () => {
      const cutoff = Date.now() - lifetime;
      setEntries((prev) => {
        const kept = prev.filter((e) => e.ts > cutoff);
        // A no-op re-render on every tick is wasteful on a busy room, since
        // most ticks expire nothing.
        return kept.length === prev.length ? prev : kept;
      });
    };
    const id = setInterval(sweep, Math.max(250, Math.min(lifetime, 2000)));
    return () => clearInterval(id);
  }, [lifetime]);

  return useMemo(
    () => ({ config, entries, viewers, status, error, setConfig }),
    [config, entries, viewers, status, error],
  );
}

/**
 * The subset of a widget's kinds present in the buffer lives in
 * `widgets/select`, not here: a widget importing it from feed.ts closes the
 * registry -> chat -> feed -> scene -> registry cycle and the registry's
 * WIDGET_TYPES is read before it is initialised. Re-exported so existing
 * callers keep working, but new widget code should import from the leaf.
 */
export { selectKinds } from "@/lib/widgets/select";
