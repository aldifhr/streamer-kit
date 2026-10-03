"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_CHANNEL_LABEL, SOURCE_LABELS, loadedIdentity } from "./scene-load";
import type { SourceKind } from "./scene-load";
import Link from "next/link";
import { apiFetch, wsUrl } from "@/lib/api";
import { append, clock, summariseEvent, type LogLine } from "@/lib/socket-log";
import { DEFAULT_GLOBAL, type StyleMap, type StyleValue } from "@/lib/css";
import {
  THEMES,
  defaultScene,
  makeWidget,
  normaliseScene,
  resolve,
  themedStyle,
  widgetFromScene,
  type SceneConfig,
  type WidgetInstance,
} from "@/lib/scene";
import { widgetType } from "@/lib/widgets/registry";
import type { ConnectionStatus } from "@/lib/feed";
import { WidgetForm } from "./ControlForm";
import { customiserFor } from "./customisers/registry";
import { ThemeSwatch } from "./ThemeSwatch";
import { TriggerPanel } from "./TriggerPanel";
import { Field, Range, Segmented, Toggle, inputCls } from "./controls";

/**
 * Reduce a scene to the one widget an overlay is allowed to have.
 *
 * Records written before the split are whole scenes and can hold several widgets
 * — the live "ajoy" overlay holds an alien scene and a goal bar. There is nowhere
 * to put the extras now that a record is one widget, so the first is kept and the
 * rest are named in a notice rather than dropped in silence. The user then makes
 * one overlay per leftover widget, which is the whole point of the split.
 */
function oneWidget(scene: SceneConfig, notice: (message: string) => void): SceneConfig {
  if (scene.widgets.length <= 1) return scene;
  const [first, ...rest] = scene.widgets;
  const names = rest.map((w) => widgetType(w.type)?.label ?? w.type).join(", ");
  notice(
    `This overlay used to hold ${scene.widgets.length} widgets. It now holds only ${
      widgetType(first.type)?.label ?? first.type
    } — create another overlay for: ${names}.`,
  );
  return { ...scene, widgets: [first] };
}

const VIEWPORTS = {
  "1920x1080": { label: "1080p", w: 1920, h: 1080 },
  "1280x720": { label: "720p", w: 1280, h: 720 },
  "1080x1920": { label: "Vertical", w: 1080, h: 1920 },
} as const;
type ViewportKey = keyof typeof VIEWPORTS;

/** "fit" scales the true-pixel canvas into the panel; numbers are 1:1 zoom. */
type Zoom = "fit" | 0.5 | 1;
const ZOOMS: { value: Zoom; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: 0.5, label: "50%" },
  { value: 1, label: "100%" },
];

type SectionId = "widget" | "channel" | "theme" | "typography" | "colours" | "canvas" | "trigger" | "css";

const NAV: { group: string; items: { id: SectionId; label: string; keys: string[] }[] }[] = [
  {
    group: "Setup",
    items: [
      { id: "widget", label: "Widget", keys: ["widget", "style", "size", "layout", "roster", "reward"] },
      { id: "channel", label: "Channel", keys: ["username", "channel", "tiktok", "connect", "live"] },
      { id: "theme", label: "Theme", keys: ["theme", "preset", "style"] },
    ],
  },
  {
    group: "Look",
    items: [
      { id: "typography", label: "Typography", keys: ["font", "type", "size", "weight", "line", "letter", "uppercase", "outline"] },
      { id: "colours", label: "Colours", keys: ["colour", "color", "text", "username", "accent"] },
      { id: "canvas", label: "Canvas", keys: ["padding", "canvas", "scene", "size"] },
    ],
  },
  {
    group: "Tools",
    items: [
      { id: "trigger", label: "Test alert", keys: ["trigger", "test", "webhook", "fire", "manual"] },
      { id: "css", label: "Custom CSS", keys: ["css", "custom", "style"] },
    ],
  },
];

const SECTION_META: Record<SectionId, { title: string; blurb: string }> = {
  widget: {
    // Replaced with the widget's own name once it is known; this is the
    // fallback for a record whose type no longer exists in this build.
    title: "Widget",
    blurb: "This overlay's widget and all of its settings.",
  },
  channel: { title: "Channel", blurb: "Point this overlay at a TikTok Live room. It connects on its own." },
  theme: {
    title: "Theme",
    blurb: "Restyles the chat widget and the overlay's shared typography. Other widgets keep their own look.",
  },
  typography: { title: "Typography", blurb: "Shared across the overlay. Per-widget sizes live under the widget." },
  colours: { title: "Colours", blurb: "Text and username colours, shared across the overlay." },
  canvas: { title: "Canvas", blurb: "The frame itself, and how much padding sits inside it." },
  trigger: { title: "Test alert", blurb: "Push an event by hand, without waiting for a live one." },
  css: { title: "Custom CSS", blurb: "Every --sk-* and --w-* custom property is a target." },
};

const FONT_STACKS = [
  "Inter", "Roboto", "Montserrat", "Poppins", "Segoe UI",
  "Arial", "Helvetica", "Georgia", "Verdana", "Tahoma", "Courier New",
];

const WEIGHT_OPTIONS = [
  { value: "400", label: "Reg" },
  { value: "500", label: "Med" },
  { value: "600", label: "Semi" },
  { value: "700", label: "Bold" },
];

export /**
 * Whether this build can connect to YouTube.
 *
 * The source needs `YOUTUBE_API_KEY` on the backend, and an operator who has not
 * added one yet would see a button that only ever fails. The warning below says
 * so plainly instead of letting the connect attempt explain it.
 */
const YOUTUBE_READY = true;

export function EditorShell({ overlayId }: { overlayId: string }) {
  const [config, setConfig] = useState<SceneConfig>(() => defaultScene());
  const [saved, setSaved] = useState<SceneConfig>(() => defaultScene());
  const [username, setUsername] = useState("");
  const [source, setSource] = useState<SourceKind>("tiktok");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Opens on Widgets, not Theme. The theme only restyles the chat widget and
  // the shared typography, so for a scene without one it is the least useful
  // first screen — and every per-widget setting lives under Widgets anyway.
  const [section, setSection] = useState<SectionId>("widget");
  /**
   * Said once, when a pre-split record is opened.
   *
   * Kept apart from `error` because it is not a failure: the overlay loads and
   * works, it just used to hold more than the one widget a record can hold now,
   * and the extras need overlays of their own. Putting it where errors go would
   * tell the streamer their overlay is broken when it is not.
   */
  const [splitNotice, setSplitNotice] = useState<string | null>(null);
  /** What the overlay socket is actually receiving, newest at the bottom. */
  const [log, setLog] = useState<LogLine[]>([]);
  const nextId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState<ViewportKey>("1920x1080");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  /**
   * Settings panel is collapsible because it competes with the preview for the
   * same width. A 1920px canvas fitted beside a 440px sidebar lands near 40% on
   * a 1280px screen, which turns 15px overlay text into ~6px — the preview stops
   * being usable for judging a scene. Collapsing gives the canvas the whole
   * window without giving up the settings, which stay one click away.
   */
  const [asideOpen, setAsideOpen] = useState(true);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);
  const isDefault = useMemo(() => JSON.stringify(config) === JSON.stringify(defaultScene()), [config]);
  const overlayPath = `/overlay/${overlayId}`;

  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  /*
   * Measured, not assumed.
   *
   * `loading` is in the deps because the stage does not exist while the spinner
   * is up: the effect ran once on mount, found `stageRef.current` null, and —
   * with an empty dep list — never ran again. Nothing ever resized the preview
   * from its 300x150 default, so "Fit" fell back to the hardcoded 0.35 and every
   * overlay was judged at a third of its size. Re-attaching after the load is the
   * whole fix.
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  useEffect(() => {
    // Everything belonging to the overlay being opened is cleared before the
    // fetch, so the previous one cannot show through while this one loads, and
    // so an overlay with no channel of its own ends up with no channel rather
    // than the last one's handle. The log is per-overlay too: it is a record of
    // what a particular stream sent, and carrying it over makes the new overlay
    // look like it is already receiving events.
    setUsername("");
    setStatus("idle");
    setError(null);
    setLog([]);
    setLoading(true);
    fetch(`/api/overlays/${overlayId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        const scene = oneWidget(normaliseScene(data.config), setSplitNotice);
        setConfig(scene);
        setSaved(scene);
        const identity = loadedIdentity(data);
        setUsername(identity.username);
        setSource(identity.source);
        setError(identity.error);
        setLoading(false);
      })
      .catch(() => {
        setError("Overlay not found");
        setLoading(false);
      });
  }, [overlayId]);

  // Explicit save rather than auto-save: dragging a slider fires a change per
  // pixel, which was a POST storm. Edits stay local until committed.
  const commit = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(`/api/overlays/${overlayId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Stored as one widget, not as a scene. The editor still thinks in scenes
        // internally, so this is the one place the two shapes meet.
        body: JSON.stringify({ config: widgetFromScene(config) }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setSaved(config);
      setConfirmReset(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [overlayId, config]);

  const revert = useCallback(() => {
    setConfig(saved);
    setConfirmReset(false);
  }, [saved]);

  /**
   * Back to library defaults, not to the last save — those are different
   * actions. Deliberately does not POST: it marks the overlay dirty so the
   * reset can still be backed out with Revert before it is committed.
   *
   * Defaults *for this widget*, not the old single-chat scene: resetting an alien
   * overlay to a chat widget would replace the thing being edited.
   */
  const resetToDefaults = useCallback(() => {
    const type = config.widgets[0]?.type ?? "chat";
    setConfig({ ...defaultScene(), widgets: [makeWidget(type)] });
    setConfirmReset(false);
  }, [config.widgets]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) void commit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, commit]);

  // Unsaved work should not vanish on a stray refresh.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* ---------------------------------------------------------------- scene */

  const patchWidget = useCallback((id: string, patch: Partial<WidgetInstance>) => {
    setConfig((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  }, []);

  const patchStyle = useCallback(
    (id: string, key: string, value: StyleValue) => {
      setConfig((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) =>
          w.id === id ? { ...w, style: { ...w.style, [key]: value } } : w,
        ),
      }));
    },
    [],
  );

  const patchGlobal = useCallback((patch: Partial<SceneConfig["global"]>) => {
    setConfig((prev) => ({ ...prev, global: { ...prev.global, ...patch } }));
  }, []);

  const applyTheme = useCallback((themeId: string) => {
    const theme = THEMES.find((t) => t.id === themeId);
    setConfig((prev) => ({
      ...prev,
      theme: themeId,
      global: { ...DEFAULT_GLOBAL, ...prev.global, ...(theme?.global ?? {}) },
      // A theme restates each widget's base values. User tweaks on top of a
      // theme are not preserved, which is the same contract the old editor had.
      widgets: prev.widgets.map((w) => ({ ...w, style: themedStyle(w.type, themeId) })),
    }));
  }, []);

  /* ----------------------------------------------------------- connection */

  const saveUsername = useCallback(
    async (next: string) => {
      const trimmed = next.trim().replace(/^@/, "");
      setUsername(trimmed);
      await apiFetch(`/api/overlays/${overlayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed, source }),
      }).catch(() => {});
    },
    [overlayId, source],
  );

  /**
   * Switching platform repoints the room, so the running source has to go.
   *
   * Left alone it would keep streaming the old platform's events into an
   * overlay that now says YouTube, which is the worst of both: a live-looking
   * feed that is pointed at the wrong room.
   */
  const onSourcePick = useCallback(
    async (next: SourceKind) => {
      if (next === source) return;
      setSource(next);
      await apiFetch(`/api/overlays/${overlayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: next }),
      }).catch(() => {});
      setStatus("idle");
      setError(null);
    },
    [source, overlayId],
  );

  const connect = useCallback(async () => {
    if (!username.trim()) return;
    setStatus("connecting");
    setError(null);
    try {
      await saveUsername(username);
      const res = await apiFetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), source, overlay_id: overlayId }),
      });
      // Named explicitly, because the generic message for a 401 is "connect
      // failed" and the actual cause is a build-time env mismatch that no
      // amount of retrying will fix.
      if (res.status === 401) {
        setError("API rejected the write — check the API's STREAMKIT_TOKEN matches this build's STREAMKIT_API_TOKEN, then rebuild the frontend");
        return;
      }
      if (!res.ok) throw new Error(`connect failed (${res.status})`);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Connection failed");
    }
  }, [username, overlayId, saveUsername]);

  const autoConnected = useRef(false);
  useEffect(() => {
    if (loading || autoConnected.current || !username.trim()) return;
    autoConnected.current = true;
    void connect();
  }, [loading, username, connect]);

  const onUsernameCommit = useCallback(
    async (next: string) => {
      const changed = next.trim().replace(/^@/, "") !== username;
      await saveUsername(next);
      if (changed && next.trim()) await connect();
    },
    [username, saveUsername, connect],
  );

  const disconnect = useCallback(async () => {
    const res = await apiFetch("/api/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overlay_id: overlayId }),
    }).catch(() => null);
    if (res && !res.ok) setError(`disconnect failed (${res.status})`);
    setStatus("idle");
  }, [overlayId]);

  // Real connection state from the same broadcast the overlay sees; trusting
  // /api/connect's 200 would always show "Live" even for a dead username.
  //
  // This socket also feeds the log in the Channel panel. It is the same frames
  // the overlay renders from, recorded rather than discarded: a panel that can
  // only say "Live" is indistinguishable from one where nothing is arriving.
  useEffect(() => {
    if (loading) return;
    const ws = new WebSocket(wsUrl(`/ws/overlay/${overlayId}`));
    const counts: Record<string, number> = {};
    const note = (kind: LogLine["kind"], text: string) =>
      setLog((prev) => append(prev, { id: nextId.current++, at: Date.now(), kind, text }));

    ws.onopen = () => note("system", "socket open");
    ws.onclose = () => note("system", "socket closed — retrying from the server's side");
    ws.onerror = () => note("error", "socket error");
    ws.onmessage = (e) => {
      // A parse failure here would throw out of the handler and silently kill
      // every later message, leaving the log frozen on the last good frame with
      // nothing to indicate why. One bad frame should cost one line.
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(e.data);
      } catch {
        note("error", "unparseable frame from the socket");
        return;
      }
      if (data.type === "status") {
        if (data.connected) {
          setStatus("connected");
          setError(null);
          note("status", data.message ? String(data.message) : "connected");
        } else {
          // A snapshot mid-handshake says "connecting"; a genuine drop does not.
          setStatus(data.connecting ? "connecting" : "idle");
          note("status", data.message ? String(data.message) : data.connecting ? "connecting" : "disconnected");
        }
      } else if (data.type === "error") {
        setStatus("error");
        const message = String(data.message ?? "error");
        setError(message);
        note("error", message);
      } else if (data.type !== "config") {
        // config is the scene being pushed in; the panel shows that already, and
        // one line per save would bury everything else.
        note("event", summariseEvent(data, counts));
      }
    };
    return () => ws.close();
  }, [overlayId, loading]);

  

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${overlayPath}`);
    } catch {
      /* clipboard blocked — the field below stays selectable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const q = query.trim().toLowerCase();
  const nav = useMemo(
    () =>
      NAV.map((g) => ({
        ...g,
        items: q ? g.items.filter((i) => i.keys.some((k) => k.includes(q))) : g.items,
      })).filter((g) => g.items.length > 0),
    [q],
  );

  const { w, h } = VIEWPORTS[viewport];
  // The canvas is always rendered at true pixel size so the preview matches
  // OBS exactly, then scaled down to fit. "Fit" is usually small — 15px text
  // on a 1920px canvas in a ~800px panel is ~6px on screen — so 50%/100% are
  // available for actually reading the detail.
  const fitScale = stage.width && stage.height ? Math.min(stage.width / w, stage.height / h) : 0.35;
  const scale = zoom === "fit" ? fitScale : zoom;

  // The one widget this overlay is. There is no selection to make: a record holds
// exactly one, so the editor shows its settings and nothing to choose between.
const activeWidget = config.widgets[0] ?? null;
  const activeType = activeWidget ? widgetType(activeWidget.type) : null;
  // Null when this widget has no bespoke customiser, which is the signal to
  // fall back to the generated form.
  const Customiser = activeWidget ? customiserFor(activeWidget.type) : undefined;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-black text-white">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <button
            onClick={() => setAsideOpen((v) => !v)}
            title={asideOpen ? "Hide settings" : "Show settings"}
            aria-label={asideOpen ? "Hide settings" : "Show settings"}
            className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[11px] text-neutral-500 transition hover:bg-white/5 hover:text-white"
          >
            {asideOpen ? "◀" : "▶"}
          </button>
          <Link href="/dashboard" className="shrink-0 text-neutral-500 transition hover:text-white">
            Dashboard
          </Link>
          <span className="shrink-0 text-neutral-700">/</span>
          <span className="shrink-0 font-medium">{username ? `@${username}` : "Unnamed channel"}</span>

          {/* What this overlay is. One widget per overlay now, so it is a label
              rather than a tab bar — but it still says which widget is on
              screen on every tab, which the Theme tab in particular used to
              get wrong by showing chat for an alien scene. */}
          {activeType ? (
            <span
              title={activeType.blurb}
              className="hidden shrink-0 items-center gap-1.5 border-l border-white/10 pl-3 text-[11px] text-neutral-400 lg:flex"
            >
              <span>{activeType.icon}</span>
              {activeType.label}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {dirty ? (
            <button
              onClick={() => void commit()}
              disabled={saving}
              className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          ) : null}
          <span className="flex items-center gap-2 text-xs text-neutral-500">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "connected" ? "bg-white" : status === "error" ? "bg-neutral-500" : "bg-neutral-800"
              }`}
            />
            {status === "connected"
              ? "Live"
              : status === "connecting"
                ? "Connecting"
                : status === "error"
                  ? "Error"
                  : "Offline"}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Collapsed on desktop it collapses to zero width rather than display:none so
            the row keeps its layout; below lg it is the stacked panel, and
            there display:none is what actually hands the screen to the preview. */}
        <aside
          className={`shrink-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r ${
            asideOpen
              ? "flex w-full lg:w-[440px]"
              : "hidden lg:flex lg:w-0 lg:overflow-hidden lg:border-r-0"
          }`}
        >
          <div className="shrink-0 border-b border-white/10 p-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              className={inputCls}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <nav
              aria-label="Overlay settings"
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 p-3 lg:w-[132px] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:pr-2"
            >
              {nav.map((group) => (
                <div key={group.group} className="contents lg:block">
                  <p className="hidden pb-1 pl-2.5 pt-4 text-[10px] font-medium uppercase tracking-widest text-neutral-600 lg:block lg:first-of-type:pt-0">
                    {group.group}
                  </p>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSection(item.id)}
                      aria-current={section === item.id ? "true" : undefined}
                      className={`block w-max shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm transition-colors lg:w-full ${
                        section === item.id
                          ? "bg-white/10 font-medium text-white"
                          : "text-neutral-500 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
              {nav.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-neutral-600">No matching settings</p>
              ) : null}
            </nav>

            {/* min-w-0: a flex item defaults to min-width:auto, so long
                selects/colour swatches would refuse to shrink and push the
                nav off-screen. */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
              <header className="mb-4">
                <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-600">
                  {NAV.find((g) => g.items.some((i) => i.id === section))?.group}
                </p>
                {/*
                  The Widget section is titled after the widget rather than
                  after the word "widget": one overlay is one widget now, so the
                  section *is* that widget, and "Aliens" says which thing is
                  being edited where "Widgets" used to suggest a list.
                */}
                <h2 className="mt-0.5 text-base font-semibold">
                  {section === "widget" && activeType
                    ? `${activeType.icon} ${activeType.label}`
                    : SECTION_META[section].title}
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {section === "widget" && activeType ? activeType.blurb : SECTION_META[section].blurb}
                </p>
              </header>

              <div className="space-y-4 pb-4">
                {section === "theme" && (
                  <>
                    {/* A theme restyles the chat widget's own style plus the shared
                        typography. Every other widget keeps its artwork and
                        takes only the typography, so the swatches below are
                        drawn by that widget rather than by a chat mock. */}
                    {activeType?.id === "chat" ? null : (
                      <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs leading-relaxed text-neutral-500">
                        Each swatch below is drawn by{" "}
                        <span className="text-neutral-400">{activeType?.label ?? "your widget"}</span>{" "}
                        itself. A theme changes the shared typography and colours around it, not its own
                        artwork — those settings are under{" "}
                        <span className="text-neutral-400">{SECTION_META.widget.title}</span>.
                      </p>
                    )}

                    <div className="grid gap-2.5">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => applyTheme(t.id)}
                          className={`overflow-hidden rounded-lg border text-left transition ${
                            config.theme === t.id ? "border-white/60" : "border-white/10 hover:border-white/30"
                          }`}
                        >
                          <ThemeSwatch theme={t} type={activeType?.id} />
                          <span className="flex items-center justify-between border-t border-white/5 px-4 py-2.5">
                            <span className="text-xs font-medium">{t.name}</span>
                            {config.theme === t.id ? (
                              <span className="text-[10px] text-neutral-500">Active</span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Only on a chat overlay. Elsewhere the note above already
                        said a theme has nothing to restyle, and saying it
                        twice would be saying nothing twice. */}
                    {activeType?.id === "chat" ? (
                      <p className="border-t border-white/10 pt-4 text-xs leading-relaxed text-neutral-600">
                        The preview above is the chat widget, which is what a theme restyles. Pick a
                        theme for the mood, then adjust the widget under{" "}
                        <span className="text-neutral-500">{SECTION_META.widget.title}</span>.
                      </p>
                    ) : null}
                  </>
                )}

                {section === "channel" && (
                  <div>
                    {/* Platform first, because it changes what the field below
                        it means. A TikTok handle and a YouTube channel are both
                        strings, so getting this wrong looks exactly like
                        choosing a channel that does not exist. */}
                    <label className="mb-1.5 block text-xs text-neutral-500">Platform</label>
                    <div className="mb-4 flex gap-1.5">
                      {(["tiktok", "youtube"] as SourceKind[]).map((k) => (
                        <button
                          key={k}
                          onClick={() => void onSourcePick(k)}
                          aria-pressed={source === k}
                          className={
                            "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition " +
                            (source === k
                              ? "border-white/40 bg-white/10 text-white"
                              : "border-white/20 text-neutral-400 hover:bg-white/5 hover:text-neutral-200")
                          }
                        >
                          {SOURCE_LABELS[k]}
                        </button>
                      ))}
                    </div>
                    {source === "youtube" && !YOUTUBE_READY && (
                      <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                        YouTube needs <code>YOUTUBE_API_KEY</code> on the backend. Without it the
                        source refuses to connect and says why — it will not quietly fall back to
                        TikTok.
                      </p>
                    )}
                    <label className="mb-1.5 block text-xs text-neutral-500">
                      {SOURCE_CHANNEL_LABEL[source]}
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onBlur={(e) => void onUsernameCommit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        placeholder={source === "youtube" ? "channel name" : "channel"}
                        className={inputCls}
                      />
                      {status === "connected" ? (
                        <button
                          onClick={disconnect}
                          className="shrink-0 rounded-lg border border-white/20 px-3 py-2 text-xs font-medium transition hover:bg-white/5"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => void connect()}
                          disabled={!username.trim() || status === "connecting"}
                          className="shrink-0 rounded-lg border border-white/20 px-3 py-2 text-xs font-medium transition hover:bg-white/5 disabled:opacity-40"
                        >
                          {status === "connecting" ? "Connecting…" : "Reconnect"}
                        </button>
                      )}
                    </div>
                    {error ? <p className="mt-2 text-xs text-neutral-500">{error}</p> : null}

                    {/*
                      A pre-split record said out loud, once.

                      Not an error: the overlay loads and works. But it used to
                      be a scene holding several widgets, and now a record holds
                      one, so the extras exist nowhere — and a streamer who does
                      not know that will assume the editor lost them.
                    */}
                    {splitNotice ? (
                      <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-relaxed text-amber-100/70">
                        {splitNotice}
                      </p>
                    ) : null}

                    {/*
                      What the socket is actually receiving.

                      The status chip above is derived from the same frames, so it
                      can only ever say connected or not — it cannot tell "live and
                      receiving" from "live and silent", which is the difference
                      that matters when a widget is not showing anything. These
                      lines are the events themselves, capped, so a room that is
                      working is visibly working.
                    */}
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-xs text-neutral-500">Socket log</span>
                        {log.length ? (
                          <button
                            onClick={() => setLog([])}
                            className="text-[10px] text-neutral-600 transition hover:text-neutral-400"
                          >
                            clear
                          </button>
                        ) : null}
                      </div>
                      {log.length === 0 ? (
                        <p className="text-[11px] leading-relaxed text-neutral-600">
                          Waiting for the first event. If the room is live and this stays empty,
                          the backend is not reaching the room.
                        </p>
                      ) : (
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-neutral-950 p-2 font-mono text-[10px] leading-relaxed">
                          {log.map((l) => (
                            <div key={l.id} className="flex gap-2">
                              <span className="shrink-0 text-neutral-600">{clock(l.at)}</span>
                              <span
                                className={
                                  l.kind === "error"
                                    ? "shrink-0 text-red-400/80"
                                    : l.kind === "status"
                                      ? "shrink-0 text-emerald-400/80"
                                      : "shrink-0 text-neutral-500"
                                }
                              >
                                {l.kind}
                              </span>
                              <span className="break-all text-neutral-400">{l.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section === "widget" && (
                  <div className="space-y-4">
                    {activeWidget && activeType ? (
                      <>
                        {/* A widget either brings its own customiser or is given
                            the form generated from its control descriptors. Both
                            read the same resolved style, so a bespoke customiser
                            can never drift from the defaults. */}
                        {Customiser ? (
                          <Customiser
                            widget={activeWidget}
                            style={resolve(activeWidget)}
                            global={config.global}
                            overlayId={overlayId}
                            onChange={(key, value) => patchStyle(activeWidget.id, key, value)}
                            onPatch={(patch) => patchWidget(activeWidget.id, patch)}
                          />
                        ) : (
                          <WidgetForm
                            groups={activeType.groups}
                            style={resolve(activeWidget)}
                            onChange={(key, value) => patchStyle(activeWidget.id, key, value)}
                          />
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-neutral-500">
                        This overlay has no widget. Create one from the dashboard, picking the
                        widget you want.
                      </p>
                    )}
                  </div>
                )}

                {section === "typography" && (
                  <>
                    <Field label="Font family">
                      <select
                        value={config.global.fontFamily}
                        onChange={(e) => patchGlobal({ fontFamily: e.target.value })}
                        className={inputCls}
                      >
                        {FONT_STACKS.map((f) => (
                          <option key={f} value={`'${f}', sans-serif`}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label={`Font size — ${config.global.fontSize}px`}>
                      <Range
                        min={11}
                        max={40}
                        value={config.global.fontSize}
                        onChange={(v) => patchGlobal({ fontSize: v })}
                      />
                    </Field>

                    <Field label="Weight">
                      <Segmented
                        options={WEIGHT_OPTIONS}
                        value={String(config.global.fontWeight)}
                        onChange={(v) => patchGlobal({ fontWeight: Number(v) })}
                      />
                    </Field>

                    <div className="space-y-4 border-t border-white/10 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                        Username
                      </p>

                      <Field label="Username font">
                        <select
                          value={config.global.usernameFontFamily}
                          onChange={(e) => patchGlobal({ usernameFontFamily: e.target.value })}
                          className={inputCls}
                        >
                          {FONT_STACKS.map((f) => (
                            <option key={f} value={`'${f}', sans-serif`}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label={`Username size — ${config.global.usernameFontSize}px`}>
                        <Range
                          min={11}
                          max={40}
                          value={config.global.usernameFontSize}
                          onChange={(v) => patchGlobal({ usernameFontSize: v })}
                        />
                      </Field>

                      <Field label="Username weight">
                        <Segmented
                          options={WEIGHT_OPTIONS}
                          value={String(config.global.usernameFontWeight)}
                          onChange={(v) => patchGlobal({ usernameFontWeight: Number(v) })}
                        />
                      </Field>
                    </div>

                    <Field label={`Line height — ${config.global.lineHeight.toFixed(2)}`}>
                      <Range
                        min={100}
                        max={200}
                        step={5}
                        value={Math.round(config.global.lineHeight * 100)}
                        onChange={(v) => patchGlobal({ lineHeight: v / 100 })}
                      />
                    </Field>

                    <Field
                      label={`Letter spacing — ${config.global.letterSpacing > 0 ? "+" : ""}${config.global.letterSpacing}px`}
                    >
                      <Range
                        min={-10}
                        max={30}
                        value={config.global.letterSpacing}
                        onChange={(v) => patchGlobal({ letterSpacing: v })}
                      />
                    </Field>

                    <Toggle
                      label="Uppercase usernames"
                      checked={config.global.uppercaseName}
                      onChange={(v) => patchGlobal({ uppercaseName: v })}
                    />
                    <Toggle
                      label="Type icons"
                      checked={config.global.showIcons}
                      onChange={(v) => patchGlobal({ showIcons: v })}
                    />
                    <Toggle
                      label="Usernames"
                      checked={config.global.showUsername}
                      onChange={(v) => patchGlobal({ showUsername: v })}
                    />
                  </>
                )}

                {section === "colours" && (
                  <>
                    <Field label="Text colour">
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={config.global.textColor}
                          onChange={(e) => patchGlobal({ textColor: e.target.value })}
                          className="h-8 w-11 shrink-0 cursor-pointer rounded border border-white/15 bg-neutral-950"
                        />
                        <span className="font-mono text-xs text-neutral-500">{config.global.textColor}</span>
                      </div>
                    </Field>

                    <Field label="Username colours">
                      <Segmented
                        options={[
                          { value: "perUser", label: "Per user" },
                          { value: "type", label: "By type" },
                          { value: "solid", label: "Solid" },
                        ]}
                        value={config.global.usernameColorMode}
                        onChange={(v) =>
                          patchGlobal({ usernameColorMode: v as SceneConfig["global"]["usernameColorMode"] })
                        }
                      />
                    </Field>

                    {config.global.usernameColorMode !== "perUser" ? (
                      <div className="space-y-2 border-t border-white/10 pt-4">
                        {Object.keys(config.global.usernameColors).map((kind) => (
                          <div key={kind} className="flex items-center justify-between gap-3">
                            <span className="text-sm text-neutral-400">{kind}</span>
                            <input
                              type="color"
                              value={config.global.usernameColors[kind]}
                              onChange={(e) =>
                                patchGlobal({
                                  usernameColors: { ...config.global.usernameColors, [kind]: e.target.value },
                                })
                              }
                              className="h-8 w-11 shrink-0 cursor-pointer rounded border border-white/15 bg-neutral-950"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="border-t border-white/10 pt-4 text-xs text-neutral-600">
                        Each username gets a stable colour hashed from their name.
                      </p>
                    )}

                    <Toggle
                      label="Text outline"
                      checked={config.global.outline}
                      onChange={(v) => patchGlobal({ outline: v })}
                    />
                  </>
                )}

                {section === "canvas" && (
                  <Field label={`Scene padding — ${config.padding}px`}>
                    <Range
                      min={0}
                      max={80}
                      value={config.padding}
                      onChange={(v) => setConfig((prev) => ({ ...prev, padding: v }))}
                    />
                  </Field>
                )}

                {section === "trigger" && <TriggerPanel overlayId={overlayId} />}

                {section === "css" && (
                  <Field label="Custom CSS">
                    <textarea
                      rows={12}
                      value={config.customCSS}
                      onChange={(e) => setConfig((prev) => ({ ...prev, customCSS: e.target.value }))}
                      placeholder="/* your styles */"
                      className={`${inputCls} resize-none font-mono text-xs`}
                    />
                  </Field>
                )}
              </div>
            </div>
          </div>

          {/* OBS link */}
          <div className="shrink-0 border-t border-white/10 p-4">
            <p className="mb-2 text-xs font-medium text-neutral-400">Overlay URL for OBS</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${typeof window === "undefined" ? "" : window.location.origin}${overlayPath}`}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 font-mono text-[11px] text-neutral-500 outline-none"
              />
              <button
                onClick={copyUrl}
                className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-neutral-200"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
              Add as a Browser Source in OBS. One source renders the whole scene.
            </p>
          </div>

          {/* Save bar — sticky so it stays reachable when the sidebar stacks
              vertically below the lg breakpoint. */}
          <div className="sticky bottom-0 z-20 flex shrink-0 items-center gap-2 border-t border-white/10 bg-neutral-950/95 px-4 py-3 backdrop-blur sm:gap-3">
            <span
              className={`hidden min-w-0 flex-1 truncate text-[11px] sm:block ${
                saveError
                  ? "text-red-400"
                  : dirty
                    ? "text-neutral-300"
                    : justSaved
                      ? "text-neutral-500"
                      : "text-neutral-600"
              }`}
            >
              {saveError
                ? saveError
                : dirty
                  ? "Unsaved changes"
                  : justSaved
                    ? "Saved"
                    : "All changes saved"}
            </span>

            <button
              onClick={() => (confirmReset ? resetToDefaults() : setConfirmReset(true))}
              disabled={isDefault || saving}
              className={`shrink-0 rounded-lg border px-2.5 py-2 text-xs transition disabled:opacity-40 ${
                confirmReset
                  ? "border-white bg-white font-semibold text-black"
                  : "border-white/20 text-neutral-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              {confirmReset ? "Confirm?" : "Reset"}
            </button>

            <button
              onClick={revert}
              disabled={!dirty || saving}
              className="shrink-0 rounded-lg border border-white/20 px-3 py-2 text-xs text-neutral-300 transition hover:bg-white/5 disabled:opacity-40"
            >
              Revert
            </button>
            <button
              onClick={() => void commit()}
              disabled={!dirty || saving}
              className="shrink-0 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-30"
            >
              {saving ? "Saving…" : justSaved ? "Saved" : "Save settings"}
            </button>
          </div>
        </aside>

        {/* Right: live preview */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5">
            <span className="flex items-center gap-2 text-xs font-medium text-neutral-400">
              Live preview
              <span className="font-mono text-[10px] text-neutral-600">{Math.round(scale * 100)}%</span>
            </span>

            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {ZOOMS.map((z) => (
                  <button
                    key={String(z.value)}
                    onClick={() => setZoom(z.value)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                      zoom === z.value ? "bg-white text-black" : "text-neutral-500 hover:bg-white/5"
                    }`}
                  >
                    {z.label}
                  </button>
                ))}
              </div>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex gap-1">
                {(Object.keys(VIEWPORTS) as ViewportKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setViewport(key)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                      viewport === key ? "bg-white text-black" : "text-neutral-500 hover:bg-white/5"
                    }`}
                  >
                    {VIEWPORTS[key].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            ref={stageRef}
            className={`grid min-h-0 flex-1 place-items-center bg-[#08080a] p-6 ${
              zoom === "fit" ? "overflow-hidden" : "overflow-auto"
            }`}
          >
            <div className="relative overflow-hidden" style={{ width: w * scale, height: h * scale }}>
              {/*
                The exact URL that goes into OBS. No `?edit=1` and no key:
                the editor does not touch the preview any more — there is no
                position to drag — so what is on screen is byte-for-byte what
                OBS will load. That was the whole argument for a real iframe,
                and dropping the parameter keeps it true.
              */}
              <iframe
                src={overlayPath}
                title="Overlay preview"
                className="origin-top-left border-0"
                style={{ width: w, height: h, transform: `scale(${scale})` }}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
