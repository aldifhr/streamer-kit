/**
 * API origin resolution.
 *
 * Next.js `rewrites()` in next.config.ts only apply to plain HTTP requests —
 * they do NOT proxy WebSocket upgrades. So `/ws/*` has to talk to the FastAPI
 * server directly instead of going through the dev server on :3000.
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
