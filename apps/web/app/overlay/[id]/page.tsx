"use client";

import { use, useEffect, useMemo } from "react";
import { anchorTo } from "@/lib/alignment";
import { globalVars, resolveSurface, styleProps } from "@/lib/css";
import { useFeed } from "@/lib/feed";
import { OfflineNotice } from "./OfflineNotice";
import { resolve, type SceneConfig, type WidgetInstance } from "@/lib/scene";
import { safeCustomCSS } from "@/lib/safe-css";
import { widgetType } from "@/lib/widgets/registry";
import type { Entry } from "@/lib/widgets/types";

/**
 * One overlay, one widget.
 *
 * There is no scene to arrange any more: each record is a single widget and OBS
 * positions and sizes each browser source, so this page draws that widget filling
 * the frame it is given. The stored `x`/`y` survive only as the corner the
 * widget hugs — see anchorTo, and the trap it replaced.
 */

function Widget({
  widget,
  config,
  entries,
  viewers,
  overlayId,
}: {
  widget: WidgetInstance;
  config: SceneConfig;
  entries: Entry[];
  viewers: number | null;
  overlayId: string;
}) {
  const type = widgetType(widget.type);
  const style = useMemo(() => resolveSurface(resolve(widget)), [widget]);
  if (!type) return null;

  const { Component } = type;

  return (
    <div
      // `sk-fill` is what gives a full-frame widget its size: the box is
      // `position: absolute` with no inset of its own, so without it the canvas
      // falls back to the 300x150 default and the scene draws in the corner of
      // the frame instead of filling it.
      className={`sk-widget${type.fill ? " sk-fill" : ""}`}
      data-glow={style.glow === true ? "on" : undefined}
      style={{ ...styleProps(style), ...anchorTo(widget.x, widget.y, type.fill === true) }}
    >
      <Component
        style={style}
        global={config.global}
        entries={entries}
        viewers={viewers}
        // The overlay's own id rather than the widget's, so the saved state that
        // lives under this key in localStorage survives the config being rewritten
        // — which it does on every save, and did once already when the storage key
        // was renamed.
        sceneId={overlayId}
        overlayId={overlayId}
      />
    </div>
  );
}

export default function Scene({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: overlayId } = use(params);
  const feed = useFeed(overlayId);
  const { config } = feed;
  const widget = config?.widgets[0] ?? null;

  // A blank browser source is the hardest failure to diagnose, because OBS shows
  // nothing to look at. So a hard error renders a notice rather than staying
  // silent — quietly saying why beats a void.
  //
  // What it says is split in two. The picture gets a short line about the
  // situation; the raw socket string stays in the document title, which is where
  // the person fixing it actually looks. Putting
  // "Connection failed: TikTokLive v7.0.1 -> UserOfflineError" on the stream told
  // the audience nothing and told whoever was watching it fail everything, in a
  // box that looked like an overlay bug rather than a stream that is not running.
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
      {widget ? (
        <Widget
          widget={widget}
          config={config!}
          entries={feed.entries}
          viewers={feed.viewers}
          overlayId={overlayId}
        />
      ) : null}

      {feed.error ? (
        <OfflineNotice error={feed.error} />
      ) : null}
    </div>
  );
}