/**
 * Proxy for `/api/*`, behind a password gate.
 *
 * The API rejects unauthenticated writes, and the browser must not be the thing
 * holding that token: anything in the client bundle is readable by anyone who
 * loads the page. So writes are proxied through here, and the token is attached
 * to the outgoing request on the server, where it never reaches the client.
 *
 * That arrangement has a consequence worth stating plainly, because it is the
 * bug this gate exists to fix. A token the server attaches *on demand*
 * authenticates nobody — it makes every anonymous caller privileged. Verified
 * against the deployed app: with no gate, an unauthenticated POST to this route
 * created overlays, rewrote configs and pointed a live stream at a different
 * room, all with the stream's authority. The token was safe and the door was
 * open, which is the worst of both.
 *
 * So the session is checked *here*, before the token is ever attached. A caller
 * that has not logged in gets a 401 and no upstream request is made. Reading a
 * session cookie is not the strong part of this; the strong part is that
 * attaching the token is conditional on it.
 *
 * This exists instead of a `rewrites()` entry with a `headers` property because
 * Next does not accept one — `headers` is not in the allowed key set for a
 * rewrite, and a config carrying it fails the build. A route handler is the
 * supported place to add a header to a proxied request.
 *
 * The WebSocket deliberately does not come through here: `next.config.ts` notes
 * that Next does not proxy WS upgrades, so the socket is built against the API
 * origin directly. That is fine for auth, because the socket only ever carries
 * reads, and the API leaves read and WS access open for OBS.
 */

import { NextRequest } from "next/server";
import { hasSession } from "../session/route";

export const dynamic = "force-dynamic";

const backend = (
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:8000"
).replace(/\/+$/, "");

const token = process.env.STREAMKIT_API_TOKEN?.trim();

type Params = { params: Promise<{ path: string[] }> };

/**
 * The API paths a signed-out caller may reach.
 *
 * Two of them, and the reason is the same: the overlay page is loaded by OBS on
 * the streamer's own machine and cannot log in, so anything that page needs has
 * to work without a session.
 *
 * `GET /api/overlays/<id>` is how the overlay fetches its own config. Excluding it
 * broke the product outright — the page 401'd, had no config, and fell back to the
 * sample scene, so the stream showed a stranger's goal bar reading 66969/100 and a
 * red "Overlay not found". The backend has always allowed that read; the proxy is
 * what stopped it.
 *
 * The poll read and vote are here for the same reason, and voting is a GET on
 * purpose: the browser source cannot present a session, so a POST vote could
 * never be cast from a stream at all.
 *
 * Narrow on purpose: GET only, and only these two paths. Every write stays behind
 * the session — creating and closing a poll included — and the method check is
 * what stops a POST from riding in on the back of this.
 */
function isPublicOverlayRead(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  const path = request.nextUrl.pathname;
  if (/^\/api\/overlays\/[^/]+$/.test(path)) return true;
  return /^\/api\/polls\/[^/]+(?:\/vote)?$/.test(path);
}

async function proxy(request: NextRequest, { params }: Params): Promise<Response> {
  // Fail closed. A deployment with no password set would otherwise be as open as
  // it was before the gate, and it would look like it was protected.
  if (!process.env.STREAMKIT_PASSWORD?.trim()) {
    return new Response(JSON.stringify({ detail: "STREAMKIT_PASSWORD is not set" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  if (!(await hasSession(request)) && !isPublicOverlayRead(request)) {
    return new Response(JSON.stringify({ detail: "Not signed in" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const { path } = await params;
  const target = new URL(`${backend}/api/${path.join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  // Content-Type only: forwarding the browser's whole header set would send
  // hop-by-hop headers upstream and make the request harder to reason about.
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (token) headers.set("x-streamkit-token", token);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      redirect: "manual",
      cache: "no-store",
    });

    // Status and body are passed through verbatim: the editor branches on 401
    // to tell a token mismatch apart from a real failure, so flattening the
    // response here would destroy the one diagnostic this frontend has.
    const body = await upstream.text();
    const response = new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });
    const upstreamType = upstream.headers.get("content-type");
    if (upstreamType) response.headers.set("content-type", upstreamType);
    return response;
  } catch {
    // A dead backend is the normal failure here (the API sleeps when the
    // machine does). Say so in the shape the caller expects rather than
    // surfacing an opaque 500 with a stack trace.
    return new Response(
      JSON.stringify({ detail: "API unreachable" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
