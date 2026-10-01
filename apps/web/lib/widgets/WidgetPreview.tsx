"use client";

/**
 * One card per widget, showing that widget actually running.
 *
 * The landing page used to render six theme swatches, and every one of them was
 * the chat widget in a different colour — so a section headed "Themes" made the
 * same point six times and demonstrated nothing about the other twelve
 * widgets. After one-overlay-one-widget, the useful thing to show is what each
 * widget puts on screen, which is a question only the widget itself can answer.
 *
 * So each card mounts the real `Component` with the defaults the editor starts
 * from, and seeds it with entries chosen for that widget: a goal widget shown a
 * chat message has nothing to render, and a viewer looking at this would be
 * looking at an empty box next to a list of things that do work.
 *
 * The entries are static and pre-dated. A widget that animates will therefore be
 * caught mid-motion or at rest depending on when it mounts, which is the honest
 * outcome — a scripted animation would be a mockup, and this section is titled
 * "not mockups".
 */

import { DEFAULT_GLOBAL } from "@/lib/css";
import type { StyleMap } from "@/lib/css";
import type { Entry, EventKind, WidgetType } from "./types";
import { WIDGET_LIST } from "./registry";

/** A short sample per event kind, shared by every widget that subscribes to it. */
const SAMPLE: Record<string, { user: string; text: string; value?: string; meta?: Record<string, unknown> }> = {
  comment: { user: "mira", text: "this is so clean" },
  like: { user: "juno", text: "liked", value: "x2" },
  gift: { user: "kei", text: "sent", value: "Rose x1" },
  follow: { user: "d1d", text: "followed" },
  share: { user: "lukas", text: "shared" },
  join: { user: "Tyo~101", text: "joined" },
};

/**
 * Which entries to show a given widget.
 *
 * The kinds a widget subscribes to are declared on the widget itself, so the
 * list is derived rather than hand-written per widget. That means a new widget
 * is covered the moment it is registered, with no second list to forget to
 * update — which is how a widget ends up previewing nothing at all.
 */
function entriesFor(widget: WidgetType): Entry[] {
  const kinds = (widget.kinds ?? []) as EventKind[];
  const now = Date.now();
  const out: Entry[] = [];
  let seq = 1;

  // Newest last, so the order in the preview matches the order on stream.
  for (const kind of kinds.length ? kinds : ["comment" as EventKind]) {
    const s = SAMPLE[kind];
    if (!s) continue;
    out.push({
      id: `${widget.id}-preview-${seq}`,
      seq: seq++,
      // Old enough that nothing is treated as brand new, new enough to be on
      // screen: a widget that expires its entries immediately renders blank.
      ts: now - 4000,
      kind,
      user: s.user,
      userId: `preview-${s.user}`,
      value: s.value ?? s.text,
      meta: s.meta ?? {},
    } as Entry);
  }
  return out;
}

export function WidgetPreview({ widget: w }: { widget: WidgetType }) {
  const Component = w.Component;
  // A widget that arrives without a component would take the whole page down, and
  // the page is the one place a broken widget is cheapest to notice. Skipping it
  // keeps the landing page up and leaves an empty card where the widget goes.
  if (!Component) return null;
  // Defaults are the editor's starting point, so the card shows the widget as it
  // looks on a fresh overlay rather than in whatever state a theme happens to
  // leave it in.
  const style = (w.defaults ?? {}) as StyleMap;
  const entries = entriesFor(w);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 transition hover:border-white/30">
      <div className="relative min-h-[124px] bg-[#0d0d10] px-4 py-3.5">
        {/* `isolation` because several widgets use absolute offsets inside their
            own box, and without it a widget that draws outside its bounds would
            escape into the grid and overlap the neighbouring card. */}
        <div className="sk-root pointer-events-none" style={{ isolation: "isolate" }}>
          <Component
            style={style}
            global={DEFAULT_GLOBAL}
            entries={entries}
            viewers={142}
            sceneId={`preview-${w.id}`}
            overlayId={`preview-${w.id}`}
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-3 bg-neutral-950 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>{w.icon}</span>
            {w.label}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{w.blurb}</p>
        </div>
        <span className="shrink-0 pt-0.5 text-[10px] text-neutral-600">{w.id}</span>
      </div>
    </div>
  );
}

/**
 * The whole preview grid.
 *
 * `WIDGET_LIST` is read inside this file rather than passed down from the page,
 * because the page is a server component: importing the registry there pulls the
 * whole widget module graph into the server bundle, and any widget that reaches
 * back for the registry — which is how most of them resolve each other's ids —
 * arrives half-initialised. Reading it here, past the "use client" boundary,
 * means the graph is assembled once in the browser where every module has
 * finished evaluating.
 */
export function WidgetPreviewGrid() {
  return (
    <section id="preview" className="scroll-mt-20 border-t border-white/10 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Every widget, rendering itself
          </h2>
          <p className="mt-4 text-neutral-500">
            Not mockups. Each card below is the actual widget the overlay runs, given the same
            defaults your editor starts from and a handful of events to react to. What you see
            here is what appears on stream, and every one of them keeps its own controls.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WIDGET_LIST.map((w) => (
            <WidgetPreview key={w.id} widget={w} />
          ))}
        </div>
      </div>
    </section>
  );
}
