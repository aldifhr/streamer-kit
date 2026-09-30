/**
 * A small ring buffer of what the overlay's socket is actually saying.
 *
 * The editor already opens a WebSocket to the overlay and throws almost all of
 * it away: it keeps `status` and `error` and drops the rest. That is why a silent
 * overlay was hard to explain — the one place that could have shown what was
 * arriving was discarding it, so the panel could only ever say "Live", and it
 * said that whether or not anything had been received in minutes.
 *
 * This is deliberately not a second connection. The events in this log are the
 * same frames the overlay renders from, so what the operator reads here is
 * exactly what the stream is getting. A second socket would be a second source
 * of truth, and would disagree at precisely the moment the two mattered: the
 * reconnect.
 *
 * Bounded, because a busy room sends a comment every second or two and an
 * unbounded list in the editor is a slow leak on a long shift.
 */

export interface LogLine {
  /** Monotonic, so React keys stay stable when old lines are dropped. */
  id: number;
  at: number;
  kind: "status" | "error" | "event" | "system";
  text: string;
}

export const MAX_LINES = 200;

/** Summary per event kind, so a chatty room does not crowd out the errors. */
export function summariseEvent(data: Record<string, unknown>, counts: Record<string, number>): string {
  const type = typeof data.type === "string" ? data.type : "?";
  counts[type] = (counts[type] ?? 0) + 1;
  const n = counts[type];
  const user = typeof data.user === "string" && data.user ? `${data.user}: ` : "";
  const text = typeof data.text === "string" ? data.text : "";
  return `${type} #${n}${text ? ` — ${user}${text}` : user ? ` — ${user.trim()}` : ""}`;
}

/** Append, keeping the newest MAX_LINES. */
export function append(lines: LogLine[], line: LogLine): LogLine[] {
  const next = [...lines, line];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

export function clock(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
