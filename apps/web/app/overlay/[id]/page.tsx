"use client";

import { use, useEffect, useMemo, type CSSProperties } from "react";
import { globalVars, resolveSurface, styleProps } from "@/lib/css";
import { useFeed, type Feed } from "@/lib/feed";
import { resolve, type SceneConfig, type WidgetInstance } from "@/lib/scene";
import { safeCustomCSS } from "@/lib/safe-css";
import { widgetType } from "@/lib/widgets/registry";
import { useWidgetDrag } from "@/lib/drag-hook";
import { isEditMode } from "@/lib/drag";

/** Where a widget sits before the user moves it. Fractions, not pixels. */
function placement(x: number, y: number): string {
  // The anchor decides which corner the widget grows from, so a scaled alert
  // stays visually centred instead of drifting down and to the right.
  const dx = x > 0.4 && x < 0.6 ? "-50%" : x >= 0.6 ? "-100%" : "0%";
  const dy = y > 0.4 && y < 0.6 ? "-50%" : y >= 0.6 ? "-100%" : "0%";
  return `${dx}, ${dy}`;
}

function Widget({
  widget,
  config,
  feed,
  overlayId,
  editMode,
}: {
  widget: WidgetInstance;
  config: SceneConfig;
  feed: Feed;
  overlayId: string;
  editMode: boolean;
}) {
  const type = widgetType(widget.type);
  const style = useMemo(() => resolveSurface(resolve(widget)), [widget]);
  if (!type) return null;

  const { Component } = type;

  // Editor-only, and never for a fill widget: a fill widget owns the whole frame,
  // so its div is the frame and dragging it would move nothing a viewer could
  // see. The astronaut is full-frame by design; its internal HUD has its own
  // position settings in the editor instead.
  //
  // In OBS this is inert, so nothing on a live stream can be repositioned and a
  // stray pointer cannot move the scene.
  const draggable = editMode && !type.fill;
  const drag = useWidgetDrag({
    id: draggable ? widget.id : null,
    parent: typeof window === "undefined" ? null : window.parent,
    onMove: () => {},
    onSelect: () => {},
  });

  const grab = draggable
    ? {
        onPointerDown: drag.onPointerDown,
        onPointerMove: drag.onPointerMove,
        onPointerUp: drag.onPointerUp,
        onPointerCancel: drag.onPointerCancel,
        style: { cursor: drag.dragging ? "grabbing" : "grab" } as CSSProperties,
      }
    : {};

  // A fill widget owns the whole frame, so placement and scale are meaningless
  // for it and only its own size knobs apply.
  if (type.fill) {
    return (
      <div
        className="sk-widget sk-fill"
        data-glow={style.glow === true ? "on" : undefined}
        {...grab}
      >
        <Component
          style={style}
          global={config.global}
          entries={feed.entries}
          viewers={feed.viewers}
          sceneId={widget.id}
          overlayId={overlayId}
        />
      </div>
    );
  }

  const { x, y } = widget;
  return (
    <div
      className="sk-widget"
      data-glow={style.glow === true ? "on" : undefined}
      style={
        {
          ...styleProps(style),
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: `translate(${placement(x, y)}) scale(${widget.scale})`,
        } as CSSProperties
      }
      {...grab}
    >
      <Component
        style={style}
        global={config.global}
        entries={feed.entries}
        viewers={feed.viewers}
        sceneId={widget.id}
          overlayId={overlayId}
      />
    </div>
  );
}

export default function Scene({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id: overlayId } = use(params);
  // Drag is opt-in through the URL and only the editor adds `?edit=1`. Anyone
  // who can load the overlay can also load it with edit on, which is harmless:
  // the maths is local and the position is reported to a parent that has to be
  // the editor for anything to happen.
  const { edit } = use(searchParams);
  const editMode = isEditMode(edit ?? "");
  const feed = useFeed(overlayId);
  const { config } = feed;

  // A blank browser source is the hardest failure to diagnose, because OBS shows
  // nothing to look at. So a hard error renders a small notice rather than
  // staying silent — quietly saying why beats a void.
  useEffect(() => {
    if (feed.error) document.title = `StreamKit — ${feed.error}`;
  }, [feed.error]);

  return (
    <div className="sk-root" style={{ padding: config?.padding ?? 12 }}>
      <style>{config ? `:root{${globalVars(config.global)}}` : ""}</style>
      {config?.customCSS ? (
        <style dangerouslySetInnerHTML={{ __html: safeCustomCSS(config.customCSS) }} />
      ) : null}

      {/* The scene renders nothing until its config has arrived, rather than
          flashing a default layout that OBS would capture. */}
      {config
        ? config.widgets
            .filter((w) => w.enabled)
            .map(
              (w) => (
                <Widget
                  key={w.id}
                  widget={w}
                  config={config}
                  feed={feed}
                  overlayId={overlayId}
                  editMode={editMode}
                />
              ),
            )
        : null}

      {feed.error ? (
        <div className="sk-notice" role="status">
          {feed.error}
        </div>
      ) : null}
    </div>
  );
}
