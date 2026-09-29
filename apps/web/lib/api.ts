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

/** An absolute API URL. Use for calls made outside the Next origin's scope. */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

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
 * Shown to the browser, so it is not a secret — anything in the bundle can be
 * read. It stops drive-by deletions and casual scripted abuse, which is what a
 * publicly reachable API actually gets. Hard protection belongs at the reverse
 * proxy in front of it: basic auth, an IP allowlist, or a Cloudflare Access
 * policy.
 */
const TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? "";

/**
 * fetch against the API, with the token attached.
 *
 * Use this for anything that writes. Reads can use a plain relative fetch, which
 * goes through the rewrite.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (TOKEN) headers.set("x-streamkit-token", TOKEN);
  return fetch(`${API_ORIGIN}${path}`, { ...init, headers });
}
