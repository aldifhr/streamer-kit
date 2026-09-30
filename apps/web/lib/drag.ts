/**
 * Drag-to-place, for the editor preview only.
 *
 * The editor renders the real overlay page in an iframe, which is what makes the
 * preview trustworthy: the same code, the same canvas, the same pixels. The cost
 * is that the pointer lands inside the iframe and the editor cannot see it, so a
 * widget cannot be moved without the overlay asking for help.
 *
 * Hence the postMessage. The overlay measures the drag itself and reports the
 * result as fractions of its own box; the editor turns those back into `x`/`y`.
 * The maths lives here, on one side, rather than being split between an iframe
 * that cannot know its own scale and a parent that cannot see the pointer.
 *
 * Every message is checked before it is acted on. The overlay is a public page:
 * anything with the URL can embed it, and an iframe's `contentWindow` is
 * something a hostile parent controls. An unvalidated `postMessage` here would
 * let a parent push arbitrary positions, or delete a widget, into a live overlay.
 */

export const DRAG_ENABLED_PARAM = "edit";

/** From the overlay to the editor, during a drag. */
export interface WidgetMovedMessage {
  kind: "streamkit:widget-moved";
  id: string;
  x: number;
  y: number;
}

/** From the overlay to the editor, when a widget is selected. */
export interface WidgetSelectedMessage {
  kind: "streamkit:widget-selected";
  id: string | null;
}

/** From the editor to the overlay, asking it to remove a widget. */
export interface WidgetRemoveMessage {
  kind: "streamkit:widget-remove";
  id: string;
}

export type EditorMessage = WidgetMovedMessage | WidgetSelectedMessage | WidgetRemoveMessage;

/** A source of messages, so the editor can listen to an iframe window. */
export type MessageSource = { postMessage(message: unknown, targetOrigin: string): void } | null;

const NAMESPACE = "streamkit:";

/**
 * Fractions as they are stored.
 *
 * A drag emits a message per pointer move and each one becomes a config write,
 * so the raw double would leave a long tail of digits in the saved scene. At four
 * places that is a hundredth of a pixel on a 1080p frame, well under anything a
 * viewer could see, and the value stays readable in the JSON.
 */
export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10_000) / 10_000;
}

/** Where the overlay reports to. Locked to the site itself. */
const PARENT_ORIGIN = typeof window === "undefined" ? "" : window.location.origin;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Whether a message is one of ours, and if so what it says.
 *
 * Returns null for anything else rather than throwing: a page can receive
 * messages from browser extensions, devtools, and the embedder itself, and none
 * of those are errors.
 */
export function parseEditorMessage(data: unknown): EditorMessage | null {
  if (!isPlainObject(data)) return null;
  const kind = data.kind;
  if (typeof kind !== "string" || !kind.startsWith(NAMESPACE)) return null;

  if (kind === "streamkit:widget-moved") {
    const { id, x, y } = data;
    if (typeof id !== "string" || typeof x !== "number" || typeof y !== "number") return null;
    // A fraction outside 0..1 would place the widget off-frame with no way back,
    // and NaN would poison the saved config permanently.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      kind,
      id,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  if (kind === "streamkit:widget-selected") {
    const { id } = data;
    // Explicit rather than `id !== null && typeof id !== "string"`: that form
    // also lets `undefined` past the guard, and TypeScript cannot narrow through
    // it, so `id` stays `unknown` at the return.
    if (id === null) return { kind, id: null };
    if (typeof id !== "string") return null;
    return { kind, id };
  }

  if (kind === "streamkit:widget-remove") {
    const { id } = data;
    if (typeof id !== "string") return null;
    return { kind, id };
  }

  return null;
}

export function isRemoveMessage(m: EditorMessage): m is WidgetRemoveMessage {
  return m.kind === "streamkit:widget-remove";
}

/**
 * Is this overlay being viewed inside the editor?
 *
 * Takes the `edit` parameter's value, not the query string: the page already has
 * the parsed value from `searchParams`, and running it back through
 * `URLSearchParams` would parse "1" as a key with no value and never match.
 */
export function isEditMode(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Turn a pointer position into the widget's new anchor.
 *
 * `placement()` in the overlay grows a widget from a corner, so the anchor is not
 * the widget's centre. Grabbing the middle of a widget and dropping it in the
 * middle of the frame would otherwise put its corner at the pointer, which reads
 * as the widget jumping away from the cursor.
 */
export function anchorFromPointer(
  pointer: { x: number; y: number },
  widgetOrigin: { x: number; y: number },
  frame: { width: number; height: number },
): { x: number; y: number } | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const x = (pointer.x - widgetOrigin.x) / frame.width;
  const y = (pointer.y - widgetOrigin.y) / frame.height;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

export function report(parent: MessageSource, message: EditorMessage): void {
  // Only ever to our own origin. `*` would hand a free channel to any embedder.
  parent?.postMessage(message, PARENT_ORIGIN);
}
