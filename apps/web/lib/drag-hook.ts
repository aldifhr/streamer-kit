"use client";

import { useCallback, useRef, useState } from "react";
import { anchorFromPointer, report, type MessageSource } from "./drag";

interface Options {
  /** The widget being dragged, or null when the pointer is not down. */
  id: string | null;
  parent: MessageSource;
  /** Called on release so the editor can persist, and on every move for the live position. */
  onMove: (id: string, x: number, y: number) => void;
  onSelect: (id: string) => void;
}

/**
 * Pointer handling for one widget.
 *
 * The grab is captured on the element itself, but the move and release are bound
 * to `window` — a drag that leaves the element, or the iframe, would otherwise be
 * cut short the moment the pointer outran the box. `setPointerCapture` on the
 * element would do this too, but it does not survive the pointer crossing into a
 * parent frame, which is exactly where it goes when the widget is near an edge.
 *
 * The widget's own offset at grab time is kept, because `placement()` grows it
 * from a corner: without the offset, dropping a widget would snap its corner to
 * the pointer and it would appear to jump.
 */
export function useWidgetDrag({ id, parent, onMove, onSelect }: Options) {
  const frame = useRef<HTMLElement | null>(null);
  const grabOffset = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      onSelect(id ?? "");
      if (!id) return;

      const el = event.currentTarget;
      const root = el.closest(".sk-root") as HTMLElement | null;
      if (!root) return;
      frame.current = root;

      const box = el.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      // Where inside the widget the pointer grabbed it, in frame fractions.
      grabOffset.current = {
        x: (box.x - rootBox.x) / rootBox.width,
        y: (box.y - rootBox.y) / rootBox.height,
      };

      setDragging(true);
      event.preventDefault();
    },
    [id, onSelect],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging || !id) return;
      const root = frame.current;
      if (!root) return;
      const box = root.getBoundingClientRect();
      const next = anchorFromPointer(
        { x: event.clientX - grabOffset.current.x * box.width, y: event.clientY - grabOffset.current.y * box.height },
        { x: 0, y: 0 },
        { width: box.width, height: box.height },
      );
      if (!next) return;
      onMove(id, next.x, next.y);
      report(parent, { kind: "streamkit:widget-moved", id, x: next.x, y: next.y });
    },
    [dragging, id, onMove, parent],
  );

  const end = useCallback(() => {
    setDragging(false);
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, dragging };
}
