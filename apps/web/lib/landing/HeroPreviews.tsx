"use client";

import { HERO_SCENES } from "@/lib/landing/scenes";
import { WIDGET_TYPES } from "@/lib/widgets/registry";
import { ScenePreview } from "./ScenePreview";

/**
 * The hero: four overlays, drawn by the real widgets.
 *
 * A client component for the same reason WidgetGrid is one. The captions come
 * from the registry, and a server component reading the registry gets
 * client-reference proxies rather than the real objects — so the labels would be
 * blank in exactly the way the widget grid's were.
 *
 * The four share one global layer, which is why they can be pictured together
 * without disagreeing about type. Each still renders at a true 1920x1080 and
 * scales down inside its own tile, exactly as the editor's canvas does, because a
 * widget laid out at thumbnail size puts its own padding and anchoring in the
 * wrong place.
 */
export function HeroPreviews() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {HERO_SCENES.map(({ type, scene }) => (
        <div
          key={type}
          className="overflow-hidden rounded-lg border border-white/10 bg-[#08080a] shadow-xl shadow-black/60"
        >
          <div className="flex items-center gap-1.5 border-b border-white/10 bg-neutral-950 px-2.5 py-1.5">
            <span className="h-2 w-2 rounded-full border border-white/20" />
            <span className="h-2 w-2 rounded-full border border-white/20" />
            <span className="h-2 w-2 rounded-full border border-white/20" />
            <span className="ml-1.5 truncate font-mono text-[9px] text-neutral-600">
              {WIDGET_TYPES[type]?.label ?? type}
            </span>
          </div>
          <ScenePreview scene={scene} />
        </div>
      ))}
    </div>
  );
}
