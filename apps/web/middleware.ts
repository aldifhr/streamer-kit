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

/**
 * Prefixes an operator must be able to reach without a session.
 *
 * `/api/session` is here for clarity even though the matcher below already
 * excludes everything under `/api`: the login POST has to reach its own route
 * handler, and this is the list that says so.
 */
const PUBLIC = ["/login", "/api/session", "/overlay", "/_next", "/favicon"];

/**
 * Whether a path is one of the public ones.
 *
 * On whole path segments, not with `startsWith`. `/overlay` is the OBS route and
 * `/overlays/<id>` is the editor, and a prefix test cannot tell them apart:
 * `"/overlays/abc".startsWith("/overlay")` is true, so the editor was being
 * served to anyone who asked. It looked harmless because the editor's own fetches
 * still got 401s from the proxy, so an anonymous visitor saw an error rather than
 * anyone's overlays — but the page should not have been reachable at all, and the
 * same trap applies to `/login`, which quietly also covered `/logins`.
 *
 * The trailing-slash form is compared explicitly because the segment below can
 * never be empty, so `/overlay` and `/overlay/` differ only by that slash.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some(
    (prefix) => pathname === prefix || pathname === `${prefix}/` || pathname.startsWith(`${prefix}/`),
  );
}

// Async: the HMAC is WebCrypto, because the Edge runtime this file runs on has
// no `node:crypto`. Next supports an async middleware function.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
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
  // Pages only. `/api/*` is deliberately absent so the proxy route is the one
  // that answers, with a 401 and a JSON body: a fetch from the editor can act on
  // that, whereas a redirect hands it an HTML login page it cannot use. The
  // middleware would still be a redirect if it saw these — a browser following
  // a 307 to `/login` renders fine, an XHR does not. It is a convenience here,
  // never the lock; the proxy holds that, and it holds it for direct callers
  // that never pass through this file.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
