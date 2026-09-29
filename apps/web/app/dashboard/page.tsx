"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { normaliseScene } from "@/lib/scene";
import { TEMPLATES, sceneFromTemplate } from "@/lib/templates";
import { WIDGET_LIST, widgetType } from "@/lib/widgets/registry";

interface Overlay {
  id: string;
  name: string;
  username: string;
  theme: string;
  config: unknown;
  createdAt: number;
}

interface Row extends Overlay {
  /** Widget types present, derived from the config rather than stored twice. */
  widgets: string[];
}

/**
 * Widget types offered as dashboard filters, in registry order so the chips
 * match the order the "add widget" menu uses.
 */
const FILTERS = WIDGET_LIST.map((w) => ({ id: w.id, label: w.label, icon: w.icon }));

export default function Dashboard() {
  const [overlays, setOverlays] = useState<Row[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Named rather than indexed, so reordering the list cannot silently change
  // what a new overlay starts as.
  const [template, setTemplate] = useState("chat-alerts");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/overlays")
      .then((r) => r.json())
      .then((data) => {
        // The list endpoint already returns each full config, so the widget
        // list is derived here rather than maintained as a second field that
        // could disagree with it.
        setOverlays(
          ((data.overlays || []) as Overlay[]).map((o) => ({
            ...o,
            widgets: normaliseScene(o.config).widgets.map((w) => w.type),
          })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    setName("");
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/overlays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The scene is resolved here and posted whole, so creating an overlay is
        // one request instead of create-then-save.
        body: JSON.stringify({ name: trimmed, config: sceneFromTemplate(template) }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setOverlays((prev) => [
        ...prev,
        { ...data.overlay, widgets: normaliseScene(data.overlay.config).widgets.map((w) => w.type) },
      ]);
      close();
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/overlays/${id}`, { method: "DELETE" }).catch(() => {});
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  };

  const copyObsUrl = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/overlay/${id}`);
    } catch {
      /* clipboard may be blocked; the editor still shows the URL */
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const visible = useMemo(
    () => (filter ? overlays.filter((o) => o.widgets.includes(filter)) : overlays),
    [overlays, filter],
  );

  // A chip that would show nothing is worse than no chip: only offer filters
  // that match at least one overlay.
  const available = useMemo(
    () => FILTERS.filter((f) => overlays.some((o) => o.widgets.includes(f.id))),
    [overlays],
  );

  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/25 text-[13px] font-bold">
              SK
            </span>
            <span className="text-[17px] font-semibold tracking-tight">StreamKit</span>
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <Link href="/" className="text-sm text-neutral-500 transition hover:text-white">
              Home
            </Link>
            <button
              onClick={() => setOpen(true)}
              className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-neutral-200"
            >
              New
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Overlays</h1>
          {overlays.length > 0 ? (
            <span className="text-sm text-neutral-600">
              {filter ? `${visible.length} of ${overlays.length}` : overlays.length}
            </span>
          ) : null}
        </div>

        {available.length > 1 ? (
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <FilterChip active={filter === null} onClick={() => setFilter(null)}>
              All
            </FilterChip>
            {available.map((f) => (
              <FilterChip
                key={f.id}
                active={filter === f.id}
                onClick={() => setFilter(filter === f.id ? null : f.id)}
              >
                <span className="mr-1">{f.icon}</span>
                {f.label}
              </FilterChip>
            ))}
          </div>
        ) : null}

        {overlays.length === 0 ? (
          <p className="mt-16 text-center text-sm text-neutral-600">
            No overlays yet — create one to start.
          </p>
        ) : visible.length === 0 ? (
          <p className="mt-16 text-center text-sm text-neutral-600">
            No overlay uses that widget yet.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((overlay) => (
              <div
                key={overlay.id}
                className="flex flex-col rounded-xl border border-white/10 p-4 transition hover:border-white/25"
              >
                <div className="min-w-0">
                  <Link
                    href={`/overlays/${overlay.id}`}
                    className="block truncate text-sm font-medium transition hover:text-neutral-400"
                  >
                    {overlay.name}
                  </Link>
                  <p
                    className={`mt-1 truncate text-xs ${
                      overlay.username ? "text-neutral-500" : "text-neutral-700"
                    }`}
                  >
                    {overlay.username ? `@${overlay.username}` : "No channel set"}
                  </p>
                </div>

                {/* What is actually on the stream, read from the scene. Doubles
                    as the answer to "which URL goes in OBS" — there is one per
                    overlay, and this card is it. */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {overlay.widgets.map((type) => {
                    const t = widgetType(type);
                    if (!t) return null;
                    return (
                      <span
                        key={type}
                        title={t.label}
                        className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-neutral-400"
                      >
                        <span className="mr-1">{t.icon}</span>
                        {t.label}
                      </span>
                    );
                  })}
                </div>

                <div className="mt-5 flex items-center gap-1.5">
                  <Link
                    href={`/overlays/${overlay.id}`}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-neutral-200"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => copyObsUrl(overlay.id)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-neutral-400 transition hover:bg-white/5"
                  >
                    {copied === overlay.id ? "Copied" : "Copy URL"}
                  </button>
                  <button
                    onClick={() => remove(overlay.id)}
                    className="ml-auto rounded-lg px-2 py-1.5 text-xs text-neutral-700 transition hover:text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New overlay"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-5"
          >
            <h2 className="text-sm font-semibold">New overlay</h2>
            <p className="mt-1 text-xs text-neutral-500">
              A starting point. Every widget stays adjustable afterwards.
            </p>

            <div className="mt-4 grid gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  aria-pressed={template === t.id}
                  className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                    template === t.id
                      ? "border-white/50 bg-white/5"
                      : "border-white/10 hover:border-white/25"
                  }`}
                >
                  <span className="mt-0.5 text-sm">{t.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{t.label}</span>
                    <span className="block text-[11px] leading-relaxed text-neutral-500">{t.blurb}</span>
                  </span>
                </button>
              ))}
            </div>

            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="Overlay name"
              className="mt-4 w-full rounded-lg border border-white/15 bg-black px-4 py-2.5 text-sm outline-none transition placeholder:text-neutral-600 focus:border-white/40"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={close}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-400 transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => void create()}
                disabled={!name.trim() || creating}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-30"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-white/60 bg-white text-black"
          : "border-white/15 text-neutral-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
