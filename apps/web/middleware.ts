/**
 * Send signed-out visitors to the login page.
 *
 * The authoritative check is in the proxy route — it is the one that decides
 * whether the stream token gets attached, and this cannot be allowed to be the
 * only check. Middleware is a redirect, not a lock: someone can call
 * `/api/overlays` directly and will get the proxy's 401 regardless of what this
 * file does.
 *
 * The overlay route is exempt, and has to be. It is loaded by OBS, which runs
 * on the streamer's own machine, has no password, and would be stuck on a login
 * screen forever. The overlay only ever reads and receives events over the
 * WebSocket, so there is nothing here to protect: the writes all go through
 * `/api/*`.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/session";

/** Prefixes an operator must be able to reach without a session. */
const PUBLIC = ["/login", "/api/session", "/overlay", "/_next", "/favicon"];

// Async: the HMAC is WebCrypto, because the Edge runtime this file runs on has
// no `node:crypto`. Next supports an async middleware function.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // An expired cookie is worth clearing on the way past, so the browser stops
  // presenting it and stops paying for the check on every request.
  const response = NextResponse.redirect(new URL("/login", request.url));
  if (request.cookies.has(SESSION_COOKIE)) {
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return response;
}

export const config = {
  // Everything except Next's own assets and the public routes above, which are
  // excluded here so a signed-out visitor never pays for a middleware hop on
  // a page that does not need the check.
  matcher: ["/((?!api/session|_next/static|_next/image|favicon.ico).*)"],
};
