"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { globalVars, resolveSurface, styleProps, type StyleMap } from "@/lib/css";
import { resolve, type SceneConfig, type WidgetInstance } from "@/lib/scene";
import { WIDGET_TYPES } from "@/lib/widgets/registry";
import type { Entry } from "@/lib/widgets/types";

/**
 * A real scene, rendered by the real widgets, with no socket behind it.
 *
 * The landing page used to show a hand-written mock of three chat lines. That
 * drifts: it could not show a goal bar because nobody wrote a mock of one, and
 * the theme cards beside it listed themes that did not exist. Rendering actual
 * widget components against actual theme values means the marketing page cannot
 * describe a product that is not there.
 */

const SAMPLE: Entry[] = [
  { id: "1", seq: 1, ts: 0, kind: "comment", user: "mira", userId: "mira", value: "this is so clean", meta: {} },
  { id: "2", seq: 2, ts: 0, kind: "gift", user: "kei", userId: "kei", value: "Rose x1", meta: { diamonds: 30 } },
  { id: "3", seq: 3, ts: 0, kind: "like", user: "juno", userId: "juno", value: "x12", meta: {} },
  { id: "4", seq: 4, ts: 0, kind: "comment", user: "dimas", userId: "dimas", value: "gpp", meta: {} },
  { id: "5", seq: 5, ts: 0, kind: "follow", user: "rina", userId: "rina", value: "", meta: {} },
];

function placement(x: number, y: number): string {
  const dx = x > 0.4 && x < 0.6 ? "-50%" : x >= 0.6 ? "-100%" : "0%";
  const dy = y > 0.4 && y < 0.6 ? "-50%" : y >= 0.6 ? "-100%" : "0%";
  return `${dx}, ${dy}`;
}

function Widget({
  widget,
  scene,
  style,
  entries,
  viewers,
}: {
  widget: WidgetInstance;
  scene: SceneConfig;
  style: StyleMap;
  entries: Entry[];
  viewers: number | null;
}) {
  const type = WIDGET_TYPES[widget.type];
  if (!type) return null;
  const { Component } = type;
  return (
    <div
      className="sk-widget"
      data-glow={style.glow === true ? "on" : undefined}
      style={{
        ...styleProps(style),
        left: `${widget.x * 100}%`,
        top: `${widget.y * 100}%`,
        transform: `translate(${placement(widget.x, widget.y)}) scale(${widget.scale})`,
      }}
    >
      <Component style={style} global={scene.global} entries={entries} viewers={viewers} sceneId={widget.id} />
    </div>
  );
}

/** The scene is composed at this size and scaled down to fit. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

/**
 * Renders at true 1920x1080 and scales down, exactly as the editor's canvas
 * does. Laying the widgets out at the size they will actually be seen is the
 * whole point — a mock laid out at panel size would misplace everything.
 *
 * The scale is measured from the container rather than passed in, so the
 * preview is correct at any width instead of overflowing on a narrow screen.
 */
export function ScenePreview({
  scene,
  entries = SAMPLE,
  viewers = 1284,
  className = "",
}: {
  scene: SceneConfig;
  entries?: Entry[];
  viewers?: number | null;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widgets = useMemo(
    () =>
      scene.widgets
        .filter((w) => w.enabled)
        .map((w) => ({ widget: w, style: resolveSurface(resolve(w)) })),
    [scene],
  );

  const scale = width > 0 ? width / CANVAS_W : 0;

  return (
    <div ref={boxRef} className={`relative w-full overflow-hidden ${className}`}>
      <div style={{ height: CANVAS_H * scale }}>
        <div
          className="sk-root sk-root-embed"
          style={{ width: CANVAS_W, height: CANVAS_H, padding: scene.padding, transform: `scale(${scale})` }}
        >
          <style>{`:root{${globalVars(scene.global)}}`}</style>
          {widgets.map(({ widget, style }) => (
            <Widget
              key={widget.id}
              widget={widget}
              scene={scene}
              style={style}
              entries={entries}
              viewers={viewers}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
