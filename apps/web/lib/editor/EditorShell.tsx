"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { API_ORIGIN, wsUrl } from "@/lib/api";
import { DEFAULT_GLOBAL, type StyleMap, type StyleValue } from "@/lib/css";
import {
  THEMES,
  defaultScene,
  makeWidget,
  normaliseScene,
  resolve,
  themedStyle,
  type SceneConfig,
  type WidgetInstance,
} from "@/lib/scene";
import { WIDGET_LIST, widgetType } from "@/lib/widgets/registry";
import type { ConnectionStatus } from "@/lib/feed";
import { WidgetForm } from "./ControlForm";
import { ThemeSwatch } from "./ThemeSwatch";
import { TriggerPanel } from "./TriggerPanel";
import { Field, Range, Segmented, Toggle, inputCls } from "./controls";

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

type SectionId = "theme" | "channel" | "widgets" | "typography" | "colours" | "canvas" | "trigger" | "css";

const NAV: { group: string; items: { id: SectionId; label: string; keys: string[] }[] }[] = [
  {
    group: "Setup",
    items: [
      { id: "theme", label: "Theme", keys: ["theme", "preset", "style"] },
      { id: "channel", label: "Channel", keys: ["username", "channel", "tiktok", "connect", "live"] },
      { id: "widgets", label: "Widgets", keys: ["widget", "add", "layer", "position", "scene"] },
    ],
  },
  {
    group: "Scene",
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
  theme: {
    title: "Theme",
    blurb: "Restyles the chat widget and the scene's shared typography. Each widget keeps its own controls.",
  },
  channel: { title: "Channel", blurb: "Point this overlay at a TikTok Live room. It connects on its own." },
  widgets: { title: "Widgets", blurb: "What this overlay is made of, and where each piece sits." },
  typography: { title: "Typography", blurb: "Shared by every widget. Per-widget sizes live under the widget." },
  colours: { title: "Colours", blurb: "Text and username colours, shared across the scene." },
  canvas: { title: "Canvas", blurb: "The scene itself." },
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

export function EditorShell({ overlayId }: { overlayId: string }) {
  const [config, setConfig] = useState<SceneConfig>(() => defaultScene());
  const [saved, setSaved] = useState<SceneConfig>(() => defaultScene());
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("theme");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState<ViewportKey>("1920x1080");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

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

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch(`/api/overlays/${overlayId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        const scene = normaliseScene(data.config);
        setConfig(scene);
        setSaved(scene);
        setSelected(scene.widgets[0]?.id ?? null);
        if (data.username) setUsername(data.username);
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
      const res = await fetch(`/api/overlays/${overlayId}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
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
   */
  const resetToDefaults = useCallback(() => {
    const fresh = defaultScene();
    setConfig(fresh);
    setSelected(fresh.widgets[0]?.id ?? null);
    setConfirmReset(false);
  }, []);

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

  const addWidget = useCallback(
    (type: string) => {
      const def = widgetType(type);
      if (!def) return;
      // A unique widget is one that cannot be sensibly stacked on itself: two
      // astronaut scenes would both be full-canvas and would draw over each
      // other, and two viewer counts in the same corner is a layout mistake
      // rather than a choice. The second one is refused, and the button is
      // disabled below so the refusal is visible before the click.
      if (def.unique && config.widgets.some((w) => w.type === type)) return;
      const widget = makeWidget(type);
      setConfig((prev) => ({ ...prev, widgets: [...prev.widgets, widget] }));
      setSelected(widget.id);
      setSection("widgets");
    },
    [config.widgets],
  );

  const removeWidget = useCallback((id: string) => {
    setConfig((prev) => {
      const widgets = prev.widgets.filter((w) => w.id !== id);
      return { ...prev, widgets: widgets.length > 0 ? widgets : prev.widgets };
    });
    setSelected((prev) => (prev === id ? null : prev));
  }, []);

  /* ----------------------------------------------------------- connection */

  const saveUsername = useCallback(
    async (next: string) => {
      const trimmed = next.trim().replace(/^@/, "");
      setUsername(trimmed);
      await fetch(`/api/overlays/${overlayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      }).catch(() => {});
    },
    [overlayId],
  );

  const connect = useCallback(async () => {
    if (!username.trim()) return;
    setStatus("connecting");
    setError(null);
    try {
      await saveUsername(username);
      const res = await fetch(`${API_ORIGIN}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), overlay_id: overlayId }),
      });
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
    const res = await fetch(`${API_ORIGIN}/api/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overlay_id: overlayId }),
    }).catch(() => null);
    if (res && !res.ok) setError(`disconnect failed (${res.status})`);
    setStatus("idle");
  }, [overlayId]);

  // Real connection state from the same broadcast the overlay sees; trusting
  // /api/connect's 200 would always show "Live" even for a dead username.
  useEffect(() => {
    if (loading) return;
    const ws = new WebSocket(wsUrl(`/ws/overlay/${overlayId}`));
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "status") {
        if (data.connected) {
          setStatus("connected");
          setError(null);
        } else {
          // A snapshot mid-handshake says "connecting"; a genuine drop does not.
          setStatus(data.connecting ? "connecting" : "idle");
        }
      } else if (data.type === "error") {
        setStatus("error");
        setError(data.message);
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

  const activeWidget = config.widgets.find((w2) => w2.id === selected) ?? null;
  const activeType = activeWidget ? widgetType(activeWidget.type) : null;

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
          <Link href="/dashboard" className="shrink-0 text-neutral-500 transition hover:text-white">
            Dashboard
          </Link>
          <span className="shrink-0 text-neutral-700">/</span>
          <span className="shrink-0 font-medium">{username ? `@${username}` : "Unnamed channel"}</span>

          {/* What this scene is actually made of, on every tab.
              Without this the editor opens on Theme — whose previews are always
              chat — so an astronaut or goal scene looks like a chat overlay
              until you go looking for the Widgets section. */}
          <span className="hidden min-w-0 items-center gap-1.5 border-l border-white/10 pl-3 lg:flex">
            {config.widgets.map((w) => {
              const t = widgetType(w.type);
              if (!t) return null;
              return (
                <span
                  key={w.id}
                  title={`${t.label} — ${t.blurb}`}
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${
                    w.enabled ? "bg-white/5 text-neutral-400" : "bg-white/[0.02] text-neutral-700 line-through"
                  }`}
                >
                  <span className="mr-1">{t.icon}</span>
                  {t.label}
                </span>
              );
            })}
          </span>
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
        <aside className="flex w-full shrink-0 flex-col border-b border-white/10 lg:w-[440px] lg:border-b-0 lg:border-r">
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
                <h2 className="mt-0.5 text-base font-semibold">{SECTION_META[section].title}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">{SECTION_META[section].blurb}</p>
              </header>

              <div className="space-y-4 pb-4">
                {section === "theme" && (
                  <>
                    <div className="grid gap-2.5">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => applyTheme(t.id)}
                          className={`overflow-hidden rounded-lg border text-left transition ${
                            config.theme === t.id ? "border-white/60" : "border-white/10 hover:border-white/30"
                          }`}
                        >
                          <ThemeSwatch theme={t} />
                          <span className="flex items-center justify-between border-t border-white/5 px-4 py-2.5">
                            <span className="text-xs font-medium">{t.name}</span>
                            {config.theme === t.id ? (
                              <span className="text-[10px] text-neutral-500">Active</span>
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* The preview is the chat widget because that is what a theme
                        carries. Saying so beats letting a user conclude their
                        astronaut or goal scene ignored the theme. */}
                    <p className="border-t border-white/10 pt-4 text-xs leading-relaxed text-neutral-600">
                      The preview above is the chat widget, which is what a theme restyles. Widgets
                      that draw their own artwork keep it — pick a theme for the mood, then adjust
                      each widget under <span className="text-neutral-500">Widgets</span>.
                    </p>
                  </>
                )}

                {section === "channel" && (
                  <div>
                    <label className="mb-1.5 block text-xs text-neutral-500">TikTok username</label>
                    <div className="flex gap-2">
                      <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onBlur={(e) => void onUsernameCommit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        placeholder="channel"
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
                  </div>
                )}

                {section === "widgets" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-1.5">
                      {WIDGET_LIST.map((t) => {
                        // Already in the scene, and this type allows only one.
                        const taken = t.unique && config.widgets.some((w) => w.type === t.id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => addWidget(t.id)}
                            disabled={taken}
                            title={taken ? `${t.label} is already in this scene` : t.blurb}
                            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-neutral-300 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-neutral-700"
                          >
                            <span className="mr-1">{t.icon}</span>
                            {t.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-1.5 border-t border-white/10 pt-4">
                      {config.widgets.map((w) => {
                        const t = widgetType(w.type);
                        const isActive = w.id === selected;
                        return (
                          <div
                            key={w.id}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition ${
                              isActive ? "border-white/40 bg-white/5" : "border-white/10"
                            }`}
                          >
                            <button
                              onClick={() => setSelected(w.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                            >
                              <span>{t?.icon}</span>
                              <span className={`truncate ${w.enabled ? "" : "text-neutral-600 line-through"}`}>
                                {t?.label ?? w.type}
                              </span>
                            </button>
                            <Toggle
                              label={`Show ${t?.label ?? w.type}`}
                              checked={w.enabled}
                              onChange={(v) => patchWidget(w.id, { enabled: v })}
                            />
                            {config.widgets.length > 1 ? (
                              <button
                                onClick={() => removeWidget(w.id)}
                                aria-label={`Remove ${t?.label ?? w.type}`}
                                className="shrink-0 rounded px-1.5 text-neutral-600 transition hover:text-white"
                              >
                                ✕
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {activeWidget && activeType ? (
                      <div className="space-y-4 border-t border-white/10 pt-4">
                        <div>
                          <p className="mb-1 text-sm font-medium">
                            {activeType.icon} {activeType.label}
                          </p>
                          <p className="text-xs text-neutral-500">{activeType.blurb}</p>
                        </div>

                        {/* A fill widget owns the whole frame, so placement has
                            no meaning for it and offering the sliders would
                            only produce settings that do nothing. */}
                        {activeType.fill ? null : (
                          <div className="space-y-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                              Position
                            </p>
                            <Field label={`Horizontal — ${Math.round(activeWidget.x * 100)}%`}>
                              <Range
                                min={0}
                                max={100}
                                value={Math.round(activeWidget.x * 100)}
                                onChange={(v) => patchWidget(activeWidget.id, { x: v / 100 })}
                              />
                            </Field>
                            <Field label={`Vertical — ${Math.round(activeWidget.y * 100)}%`}>
                              <Range
                                min={0}
                                max={100}
                                value={Math.round(activeWidget.y * 100)}
                                onChange={(v) => patchWidget(activeWidget.id, { y: v / 100 })}
                              />
                            </Field>
                            <Field label={`Scale — ${activeWidget.scale.toFixed(2)}x`}>
                              <Range
                                min={30}
                                max={300}
                                value={Math.round(activeWidget.scale * 100)}
                                onChange={(v) => patchWidget(activeWidget.id, { scale: v / 100 })}
                              />
                            </Field>
                          </div>
                        )}

                        <WidgetForm
                          groups={activeType.groups}
                          style={resolve(activeWidget)}
                          onChange={(key, value) => patchStyle(activeWidget.id, key, value)}
                        />
                      </div>
                    ) : null}
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
