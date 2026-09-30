"use client";

import { WIDGET_LIST } from "@/lib/widgets/registry";

/**
 * The widget list, straight from the registry.
 *
 * This is a client component and not markup in the server-rendered page, and the
 * reason is not tidiness. Every widget module is "use client", so when a server
 * component imports WIDGET_LIST, Next hands it client-reference proxies instead
 * of the real objects — the array still has thirteen entries, but every one of
 * them is a stub whose only property is $$typeof. Reading `w.label` there gives
 * undefined, so the grid rendered thirteen empty cards: no icon, no name, no
 * description, and no "full frame" badge even for the widget that sets it.
 *
 * `WIDGET_LIST.length` was the one thing that survived, which is why the heading
 * still said 13 above thirteen blank cards. Nothing threw and nothing warned.
 *
 * Reading it here means reading the real objects, so a widget that gains a blurb
 * shows it and one that loses its icon loses it in the same place the registry
 * says it should.
 */
export function WidgetGrid() {
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {WIDGET_LIST.map((w) => (
        <div
          key={w.id}
          className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/25"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{w.icon}</span>
            <h3 className="text-base font-semibold">{w.label}</h3>
            {w.fill ? (
              <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-neutral-500">
                full frame
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">{w.blurb}</p>
        </div>
      ))}
    </div>
  );
}
