/**
 * API origin resolution.
 *
 * The frontend reaches the backend two ways, and they have to resolve to the
 * same host:
 *
 *   relative  fetch("/api/overlays")  -> proxied by the rewrite in
 *                                       next.config.ts, which points at
 *                                       NEXT_PUBLIC_API_URL.
 *   direct    wsUrl("/ws/...")         -> the API origin itself, because Next
 *                                       rewrites do not proxy WebSocket
 *                                       upgrades. A socket sent at the FE host
 *                                       would hang and never connect.
 *
 * Read at build time: NEXT_PUBLIC_* is inlined into the client bundle, so
 * changing it needs a rebuild.
 */

const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

export const API_ORIGIN =
  configured ?? (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");

function toWebSocketOrigin(origin: string): string {
  if (!origin) {
    return "";
  }
  return origin.replace(/^http/, "ws");
}

export function wsUrl(path: string): string {
  const fromApi = toWebSocketOrigin(API_ORIGIN);
  const base = fromApi || toWebSocketOrigin(window.location.origin);
  return `${base}${path}`;
}

/**
 * fetch against the API.
 *
 * Deliberately plain: the write token is attached by the rewrite in
 * next.config.ts, on the proxy hop, so it never reaches the browser. This
 * function used to read a NEXT_PUBLIC_API_TOKEN and set the header by hand,
 * which put the token in the client bundle where anyone could read it.
 *
 * Reads can use a bare relative fetch; this exists so every write goes through
 * one path and cannot forget to.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, init);
}
