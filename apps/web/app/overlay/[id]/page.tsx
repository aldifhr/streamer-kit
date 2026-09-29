"use client";

import { use, useMemo, type CSSProperties } from "react";
import { globalVars, resolveSurface, styleProps } from "@/lib/css";
import { useFeed, type Feed } from "@/lib/feed";
import { resolve, type SceneConfig, type WidgetInstance } from "@/lib/scene";
import { widgetType } from "@/lib/widgets/registry";

/** Where a widget sits before the user moves it. Fractions, not pixels. */
function placement(x: number, y: number): string {
  // The anchor decides which corner the widget grows from, so a scaled alert
  // stays visually centred instead of drifting down and to the right.
  const dx = x > 0.4 && x < 0.6 ? "-50%" : x >= 0.6 ? "-100%" : "0%";
  const dy = y > 0.4 && y < 0.6 ? "-50%" : y >= 0.6 ? "-100%" : "0%";
  return `${dx}, ${dy}`;
}

function Widget({ widget, config, feed }: { widget: WidgetInstance; config: SceneConfig; feed: Feed }) {
  const type = widgetType(widget.type);
  const style = useMemo(() => resolveSurface(resolve(widget)), [widget]);
  if (!type) return null;

  const { x, y } = widget;
  const { Component } = type;

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
    >
      <Component
        style={style}
        global={config.global}
        entries={feed.entries}
        viewers={feed.viewers}
        sceneId={widget.id}
      />
    </div>
  );
}

export default function Scene({ params }: { params: Promise<{ id: string }> }) {
  const { id: overlayId } = use(params);
  const feed = useFeed(overlayId);
  const { config } = feed;

  // The scene renders nothing until its config has arrived, rather than
  // flashing a default layout that OBS would capture.
  if (!config) return null;

  return (
    <div className="sk-root" style={{ padding: config.padding }}>
      <style>{`:root{${globalVars(config.global)}}`}</style>
      {config.customCSS ? <style dangerouslySetInnerHTML={{ __html: config.customCSS }} /> : null}

      {config.widgets
        .filter((w) => w.enabled)
        .map((w) => (
          <Widget key={w.id} widget={w} config={config} feed={feed} />
        ))}
    </div>
  );
}
