"use client";

import { useEffect } from "react";
import { parseEditorMessage, type WidgetMovedMessage } from "./drag";

interface Options {
  /** The preview iframe's window, or null before it mounts. */
  frame: Window | null;
  onMove: (m: WidgetMovedMessage) => void;
  onSelect: (id: string | null) => void;
}

/**
 * Listen for drag reports coming out of the preview iframe.
 *
 * The listener is attached to `window` rather than to the iframe, and the
 * `source` is checked against the frame that was passed in. Without that check any
 * page in any frame could drive the editor's config, and a hostile overlay embed
 * would be able to place widgets anywhere.
 */
export function usePreviewMessages({ frame, onMove, onSelect }: Options) {
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Same origin, and from the preview and nothing else. Both checks matter:
      // origin alone would accept a sibling frame, and source alone would accept
      // any window the page happens to hold.
      if (event.origin !== window.location.origin) return;
      if (!frame || event.source !== frame) return;

      const message = parseEditorMessage(event.data);
      if (!message) return;

      if (message.kind === "streamkit:widget-moved") onMove(message);
      else if (message.kind === "streamkit:widget-selected") onSelect(message.id);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, onMove, onSelect]);
}
