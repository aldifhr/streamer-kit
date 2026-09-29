"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Overlay {
  id: string;
  name: string;
  username: string;
  theme: string;
  createdAt: number;
}

export default function Dashboard() {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/overlays")
      .then((r) => r.json())
      .then((data) => setOverlays(data.overlays || []))
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
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setOverlays((prev) => [...prev, data.overlay]);
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
            <span className="text-sm text-neutral-600">{overlays.length}</span>
          ) : null}
        </div>

        {overlays.length === 0 ? (
          <p className="mt-16 text-center text-sm text-neutral-600">
            No overlays yet — create one to start.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overlays.map((overlay) => (
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
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-950 p-5"
          >
            <h2 className="text-sm font-semibold">New overlay</h2>

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
