"use client";

import { useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { API_ORIGIN, wsUrl } from "@/lib/api";
import {
  DEFAULT_CONFIG,
  EVENT_VERB,
  ICONS,
  THEMES,
  isEvent,
  normalise,
  toCssVars,
  userColor,
  type MsgType,
  type OverlayConfig,
} from "@/lib/config";

type Status = "idle" | "connecting" | "connected" | "error";

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

type SectionId =
  | "theme"
  | "channel"
  | "typography"
  | "chat"
  | "events"
  | "colours"
  | "visibility"
  | "limits"
  | "css";

const NAV: { group: string; items: { id: SectionId; label: string; keys: string[] }[] }[] = [
  {
    group: "Setup",
    items: [
      { id: "theme", label: "Theme", keys: ["theme", "preset"] },
      { id: "channel", label: "Channel", keys: ["username", "channel", "tiktok", "connect", "live"] },
    ],
  },
  {
    group: "Appearance",
    items: [
      {
        id: "typography",
        label: "Typography",
        keys: ["font", "type", "size", "weight", "line height", "letter", "uppercase", "outline", "typograph"],
      },
      {
        id: "chat",
        label: "Chat",
        keys: ["chat", "comment", "bubble", "radius", "padding", "gap", "width", "surface"],
      },
      {
        id: "events",
        label: "Events",
        keys: ["event", "like", "gift", "join", "accent", "glow", "card", "alert"],
      },
      {
        id: "colours",
        label: "Colours",
        keys: ["colour", "color", "text", "username", "accent"],
      },
    ],
  },
  {
    group: "Messages",
    items: [
      {
        id: "visibility",
        label: "Visibility",
        keys: ["show", "visibility", "comment", "like", "gift", "join", "icon", "username"],
      },
      { id: "limits", label: "Messages", keys: ["max", "lifetime", "limit", "count", "timeout"] },
    ],
  },
  { group: "Advanced", items: [{ id: "css", label: "Custom CSS", keys: ["css", "custom", "style"] }] },
];

const SECTION_META: Record<SectionId, { title: string; blurb: string }> = {
  theme: { title: "Theme", blurb: "Start from a preset, then adjust anything below." },
  channel: { title: "Channel", blurb: "Point this overlay at a TikTok Live room. It connects on its own." },
  typography: { title: "Typography", blurb: "Names and messages are styled independently." },
  chat: { title: "Chat", blurb: "The surface comments sit on." },
  events: { title: "Events", blurb: "Cards for likes, gifts and joins." },
  colours: { title: "Colours", blurb: "Text and username colours." },
  visibility: { title: "Visibility", blurb: "Show or hide parts of every message." },
  limits: { title: "Messages", blurb: "How much stays on screen." },
  css: { title: "Custom CSS", blurb: "Every --sk-* custom property is a target." },
};

const WEIGHTS = [
  { value: 400, label: "Reg" },
  { value: 500, label: "Med" },
  { value: 600, label: "Semi" },
  { value: 700, label: "Bold" },
];

export default function OverlayEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id: overlayId } = use(params);

  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_CONFIG);
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("theme");
  const [loading, setLoading] = useState(true);
  const [viewport, setViewport] = useState<ViewportKey>("1920x1080");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<OverlayConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);
  const isDefault = useMemo(
    () => JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG),
    [config],
  );

  // A pending reset prompt should not survive a save or an edit elsewhere.
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const overlayPath = `/overlay/${overlayId}`;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setStage({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch(`/api/overlays/${overlayId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        if (data.config) {
          setConfig(normalise(data.config));
          setSaved(normalise(data.config));
        }
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
    setConfig({ ...DEFAULT_CONFIG });
    setConfirmReset(false);
  }, []);

  // Ctrl/Cmd+S saves, matching every other editor.
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

  const update = useCallback(
    <K extends keyof OverlayConfig>(key: K, value: OverlayConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const applyTheme = (theme: (typeof THEMES)[number]) => {
    setConfig({ ...config, ...theme.base, theme: theme.id });
  };

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

  const autoConnected = useRef(false);

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

  // Connect on load — the preview iframe already does this and the endpoint is
  // idempotent, so this only keeps the editor's own status honest. The ref
  // guard stops it re-firing when `username` or `connect` identity changes.
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
    await fetch(`${API_ORIGIN}/api/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overlay_id: overlayId }),
    }).catch(() => {});
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-black text-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dashboard" className="text-neutral-500 transition hover:text-white">
            Dashboard
          </Link>
          <span className="text-neutral-700">/</span>
          <span className="font-medium">{username ? `@${username}` : "Unnamed channel"}</span>
        </div>

        <div className="flex items-center gap-3">
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
        {/* Left: settings */}
        <aside className="flex w-full shrink-0 flex-col border-b border-white/10 lg:w-[440px] lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-white/10 p-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              className="w-full rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm outline-none transition placeholder:text-neutral-600 focus:border-white/40"
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
                  {NAV.flatMap((g) => g.items).find((i) => i.id === section) &&
                    NAV.find((g) => g.items.some((i) => i.id === section))?.group}
                </p>
                <h2 className="mt-0.5 text-base font-semibold">{SECTION_META[section].title}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">{SECTION_META[section].blurb}</p>
              </header>

              <div className="space-y-4 pb-4">
                {section === "theme" && (
                  <div className="grid gap-2.5">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTheme(t)}
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
                )}

                {section === "channel" && (
                  <>
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
                  </>
                )}

                {section === "typography" && (
                  <>
                    <Field label="Font family">
                      <select
                        value={config.fontFamily}
                        onChange={(e) => update("fontFamily", e.target.value)}
                        className={inputCls}
                      >
                        {[
                          "Inter", "Roboto", "Montserrat", "Poppins", "Segoe UI",
                          "Arial", "Helvetica", "Georgia", "Verdana", "Tahoma", "Courier New",
                        ].map((f) => (
                          <option key={f} value={`'${f}', sans-serif`}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label={`Font size — ${config.fontSize}px`}>
                      <Range
                        min={11}
                        max={40}
                        value={config.fontSize}
                        onChange={(v) => update("fontSize", v)}
                      />
                    </Field>

                    <Field label="Weight">
                      <Segmented
                        options={WEIGHTS.map((w) => ({
                          value: w.value,
                          label: w.label,
                          style: { fontWeight: w.value },
                        }))}
                        value={config.fontWeight}
                        onChange={(v) => update("fontWeight", v)}
                      />
                    </Field>

                    <div className="space-y-4 border-t border-white/10 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                        Username
                      </p>

                      <Field label="Username font">
                        <select
                          value={config.usernameFontFamily}
                          onChange={(e) => update("usernameFontFamily", e.target.value)}
                          className={inputCls}
                        >
                          {[
                            "Inter", "Roboto", "Montserrat", "Poppins", "Segoe UI",
                            "Arial", "Helvetica", "Georgia", "Verdana", "Tahoma", "Courier New",
                          ].map((f) => (
                            <option key={f} value={`'${f}', sans-serif`}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label={`Username size — ${config.usernameFontSize}px`}>
                        <Range
                          min={11}
                          max={40}
                          value={config.usernameFontSize}
                          onChange={(v) => update("usernameFontSize", v)}
                        />
                      </Field>

                      <Field label="Username weight">
                        <Segmented
                          options={WEIGHTS.map((w) => ({
                            value: w.value,
                            label: w.label,
                            style: { fontWeight: w.value },
                          }))}
                          value={config.usernameFontWeight}
                          onChange={(v) => update("usernameFontWeight", v)}
                        />
                      </Field>
                    </div>

                    <Field label={`Line height — ${config.lineHeight.toFixed(2)}`}>
                      <Range
                        min={100}
                        max={200}
                        step={5}
                        value={Math.round(config.lineHeight * 100)}
                        onChange={(v) => update("lineHeight", v / 100)}
                      />
                    </Field>

                    <Field
                      label={`Letter spacing — ${config.letterSpacing > 0 ? "+" : ""}${config.letterSpacing}px`}
                    >
                      <Range
                        min={-10}
                        max={30}
                        value={config.letterSpacing}
                        onChange={(v) => update("letterSpacing", v)}
                      />
                    </Field>

                    <Toggle
                      label="Uppercase usernames"
                      checked={config.uppercaseName}
                      onChange={(v) => update("uppercaseName", v)}
                    />
                  </>
                )}

                {section === "chat" && (
                  <>
                    <Field label="Layout">
                      <Segmented
                        options={[
                          { value: "inline" as const, label: "Inline" },
                          { value: "bubble" as const, label: "Bubble" },
                        ]}
                        value={config.chatLayout}
                        onChange={(v) => update("chatLayout", v)}
                      />
                    </Field>

                    <Field label={`Background opacity — ${config.chatBgOpacity}%`}>
                      <div className="flex items-center gap-3">
                        <ColorInput value={config.chatBg} onChange={(v) => update("chatBg", v)} />
                        <Range
                          min={0}
                          max={100}
                          value={config.chatBgOpacity}
                          onChange={(v) => update("chatBgOpacity", v)}
                        />
                      </div>
                    </Field>

                    <Field label={`Corner radius — ${config.chatRadius}px`}>
                      <Range
                        min={0}
                        max={32}
                        value={config.chatRadius}
                        onChange={(v) => update("chatRadius", v)}
                      />
                    </Field>

                    <Field label={`Horizontal padding — ${config.chatPadX}px`}>
                      <Range
                        min={0}
                        max={28}
                        value={config.chatPadX}
                        onChange={(v) => update("chatPadX", v)}
                      />
                    </Field>

                    <Field label={`Vertical padding — ${config.chatPadY}px`}>
                      <Range
                        min={0}
                        max={20}
                        value={config.chatPadY}
                        onChange={(v) => update("chatPadY", v)}
                      />
                    </Field>

                    <Field label={`Line gap — ${config.chatGap}px`}>
                      <Range
                        min={0}
                        max={20}
                        value={config.chatGap}
                        onChange={(v) => update("chatGap", v)}
                      />
                    </Field>

                    <Field label={`Max width — ${config.chatMaxWidth}px`}>
                      <Range
                        min={240}
                        max={900}
                        step={10}
                        value={config.chatMaxWidth}
                        onChange={(v) => update("chatMaxWidth", v)}
                      />
                    </Field>
                  </>
                )}

                {section === "events" && (
                  <>
                    <Field label={`Background opacity — ${config.eventBgOpacity}%`}>
                      <div className="flex items-center gap-3">
                        <ColorInput
                          value={config.eventBg}
                          onChange={(v) => update("eventBg", v)}
                        />
                        <Range
                          min={0}
                          max={100}
                          value={config.eventBgOpacity}
                          onChange={(v) => update("eventBgOpacity", v)}
                        />
                      </div>
                    </Field>

                    <Field label={`Accent bar — ${config.eventAccentWidth}px`}>
                      <Range
                        min={0}
                        max={8}
                        value={config.eventAccentWidth}
                        onChange={(v) => update("eventAccentWidth", v)}
                      />
                    </Field>

                    <Field label={`Corner radius — ${config.eventRadius}px`}>
                      <Range
                        min={0}
                        max={28}
                        value={config.eventRadius}
                        onChange={(v) => update("eventRadius", v)}
                      />
                    </Field>

                    <Field label={`Horizontal padding — ${config.eventPadX}px`}>
                      <Range
                        min={0}
                        max={28}
                        value={config.eventPadX}
                        onChange={(v) => update("eventPadX", v)}
                      />
                    </Field>

                    <Field label={`Vertical padding — ${config.eventPadY}px`}>
                      <Range
                        min={0}
                        max={20}
                        value={config.eventPadY}
                        onChange={(v) => update("eventPadY", v)}
                      />
                    </Field>

                    <Field label={`Card gap — ${config.eventGap}px`}>
                      <Range
                        min={0}
                        max={20}
                        value={config.eventGap}
                        onChange={(v) => update("eventGap", v)}
                      />
                    </Field>

                    <Field label={`Icon size — ${config.eventIconSize}px`}>
                      <Range
                        min={10}
                        max={32}
                        value={config.eventIconSize}
                        onChange={(v) => update("eventIconSize", v)}
                      />
                    </Field>

                    <Field label={`Indent — ${config.eventIndent}px`}>
                      <Range
                        min={0}
                        max={120}
                        step={4}
                        value={config.eventIndent}
                        onChange={(v) => update("eventIndent", v)}
                      />
                    </Field>

                    <Field label="Title weight">
                      <Segmented
                        options={WEIGHTS.map((w) => ({ value: w.value, label: w.label }))}
                        value={config.eventTitleWeight}
                        onChange={(v) => update("eventTitleWeight", v)}
                      />
                    </Field>

                    <Field label="Value weight">
                      <Segmented
                        options={WEIGHTS.map((w) => ({ value: w.value, label: w.label }))}
                        value={config.eventValueWeight}
                        onChange={(v) => update("eventValueWeight", v)}
                      />
                    </Field>

                    <div className="space-y-3 border-t border-white/10 pt-4">
                      <Toggle
                        label="Glow"
                        checked={config.eventGlow}
                        onChange={(v) => update("eventGlow", v)}
                      />
                      <Toggle
                        label="Border"
                        checked={config.eventBorderWidth > 0}
                        onChange={(v) => update("eventBorderWidth", v ? 1 : 0)}
                      />
                    </div>
                  </>
                )}

                {section === "colours" && (
                  <>
                    <Field label="Text colour">
                      <div className="flex items-center gap-3">
                        <ColorInput
                          value={config.textColor}
                          onChange={(v) => update("textColor", v)}
                        />
                        <span className="font-mono text-xs text-neutral-500">{config.textColor}</span>
                      </div>
                    </Field>

                    <Field label="Username colours">
                      <Segmented
                        options={[
                          { value: "perUser" as const, label: "Per user" },
                          { value: "type" as const, label: "By type" },
                          { value: "solid" as const, label: "Solid" },
                        ]}
                        value={config.usernameColorMode}
                        onChange={(v) => update("usernameColorMode", v)}
                      />
                    </Field>

                    {config.usernameColorMode !== "perUser" ? (
                      <div className="space-y-2 border-t border-white/10 pt-4">
                        {(["comment", "like", "gift", "join"] as MsgType[]).map((t) => (
                          <div key={t} className="flex items-center justify-between gap-3">
                            <span className="text-sm text-neutral-400">
                              {ICONS[t]} {t === "comment" ? "Username" : EVENT_VERB[t]}
                            </span>
                            <ColorInput
                              value={config.usernameColors[t]}
                              onChange={(v) =>
                                update("usernameColors", { ...config.usernameColors, [t]: v })
                              }
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
                      checked={config.outline}
                      onChange={(v) => update("outline", v)}
                    />
                  </>
                )}

                {section === "visibility" && (
                  <>
                    <div className="space-y-3">
                      {(
                        [
                          ["showComments", "Comments"],
                          ["showLikes", "Likes"],
                          ["showGifts", "Gifts"],
                          ["showJoins", "Joins"],
                          ["showUsername", "Usernames"],
                          ["showIcons", "Type icons"],
                        ] as const
                      ).map(([key, label]) => (
                        <Toggle
                          key={key}
                          label={label}
                          checked={config[key]}
                          onChange={(v) => update(key, v)}
                        />
                      ))}
                    </div>
                    <p className="border-t border-white/10 pt-4 text-xs leading-relaxed text-neutral-600">
                      Hidden types are removed with <code className="text-neutral-500">display</code>,
                      so they still stream in and cost nothing to re-enable.
                    </p>
                  </>
                )}

                {section === "limits" && (
                  <>
                    <Field label={`Max messages — ${config.maxMessages}`}>
                      <Range
                        min={5}
                        max={100}
                        value={config.maxMessages}
                        onChange={(v) => update("maxMessages", v)}
                      />
                    </Field>
                    <Field label={`Max events — ${config.maxEvents}`}>
                      <Range
                        min={1}
                        max={50}
                        value={config.maxEvents}
                        onChange={(v) => update("maxEvents", v)}
                      />
                    </Field>
                    <Field label={`Lifetime — ${config.messageTimeout / 1000}s`}>
                      <Range
                        min={3000}
                        max={60000}
                        step={1000}
                        value={config.messageTimeout}
                        onChange={(v) => update("messageTimeout", v)}
                      />
                    </Field>
                  </>
                )}

                {section === "css" && (
                  <Field label="Custom CSS">
                    <textarea
                      rows={10}
                      value={config.customCSS}
                      onChange={(e) => update("customCSS", e.target.value)}
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
              Add as a Browser Source in OBS. Set the size to match your canvas.
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
              <span className="font-mono text-[10px] text-neutral-600">
                {Math.round(scale * 100)}%
              </span>
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
            <div
              className="relative overflow-hidden"
              style={{ width: w * scale, height: h * scale }}
            >
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

const inputCls =
  "w-full rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-sm outline-none transition focus:border-white/40";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-neutral-500">{label}</label>
      {children}
    </div>
  );
}

function Range({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full"
    />
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; style?: React.CSSProperties }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-white/15 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          style={o.style}
          className={`flex-1 rounded-md py-1.5 text-[11px] transition ${
            value === o.value ? "bg-white text-black" : "text-neutral-400 hover:bg-white/5"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-400">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${
          checked ? "bg-white" : "bg-neutral-800"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-4 bg-black" : "translate-x-0 bg-white"
          }`}
        />
      </button>
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-11 shrink-0 cursor-pointer rounded border border-white/15 bg-neutral-950"
    />
  );
}

/**
 * Renders the theme with its real renderer and real metrics, scaled to a
 * miniature. Uses `.sk-*` classes and a scaled set of custom properties, so a
 * swatch cannot drift from what the overlay actually looks like.
 */
const SWATCH_SCALE = 0.78;

function ThemeSwatch({ theme }: { theme: (typeof THEMES)[number] }) {
  const c: OverlayConfig = { ...DEFAULT_CONFIG, ...theme.base };

  const sample: { kind: MsgType; user: string; value: string }[] = [
    { kind: "comment", user: "mira", value: "this is so clean" },
    { kind: "gift", user: "kei", value: "Rose x1" },
    { kind: "like", user: "juno", value: "x2" },
  ];

  return (
    <div className="bg-[#0d0d10] px-4 py-3.5">
      {/* Scoped to the swatch so six themes on one page cannot clobber each
          other's variables, unlike the :root the overlay injects. */}
      <style>{`.sk-swatch{${toCssVars(c, SWATCH_SCALE)}}`}</style>
      <div
        className="sk-swatch sk-list"
        style={{
          fontFamily: "var(--sk-font-family)",
          fontSize: "var(--sk-font-size)",
          fontWeight: "var(--sk-font-weight)",
          lineHeight: "var(--sk-line-height)",
        }}
      >
        {sample.map((s) =>
          isEvent(s.kind) ? (
            <div
              key={s.user}
              className="sk-event"
              data-kind={s.kind}
              style={{ ["--sk-accent-color" as string]: c.usernameColors[s.kind] }}
            >
              <span className="sk-event-icon">{ICONS[s.kind]}</span>
              <span className="sk-event-title" style={{ color: userColor(s.user) }}>
                {s.user}
              </span>
              <span className="sk-event-value">
                {EVENT_VERB[s.kind]}
                {s.value ? ` ${s.value}` : ""}
              </span>
            </div>
          ) : (
            <div key={s.user} className="sk-chat" data-kind="comment">
              <span className="sk-username" style={{ color: userColor(s.user) }}>
                {s.user}
              </span>
              <span className="sk-text"> {s.value}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
