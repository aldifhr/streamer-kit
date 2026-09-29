"use client";

import { use, useEffect, useMemo, type CSSProperties } from "react";
import { globalVars, resolveSurface, styleProps } from "@/lib/css";
import { useFeed, type Feed } from "@/lib/feed";
import { resolve, type SceneConfig, type WidgetInstance } from "@/lib/scene";
import { safeCustomCSS } from "@/lib/safe-css";
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

  const { Component } = type;

  // A fill widget owns the whole frame, so placement and scale are meaningless
  // for it and only its own size knobs apply.
  if (type.fill) {
    return (
      <div className="sk-widget sk-widget-fill" data-glow={style.glow === true ? "on" : undefined}>
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
            .map((w) => <Widget key={w.id} widget={w} config={config} feed={feed} />)
        : null}

      {feed.error ? (
        <div className="sk-notice" role="status">
          {feed.error}
        </div>
      ) : null}
    </div>
  );
}
