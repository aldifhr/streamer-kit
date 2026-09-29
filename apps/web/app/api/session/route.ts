/**
 * Password gate for the dashboard.
 *
 * The proxy in `/api/[...path]` attaches `STREAMKIT_API_TOKEN` to every request
 * that reaches it, which means that route is a privileged path: anyone who can
 * reach it writes with the stream's authority. Hiding the token keeps it out of
 * the client bundle, but it is not authorisation — a token the server supplies
 * on demand authenticates nobody.
 *
 * So the gate is here, ahead of the proxy. The browser proves it knows a
 * password, and only then does the server hand out a session the proxy will
 * honour. The password never reaches the client and the stream token never
 * leaves the server.
 *
 * There is one user and no account table, which is what this app is. The
 * comparison is constant-time: a byte-at-a-time compare leaks the length of the
 * matching prefix, and the cost of `timing` here is one line.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  equalSecret,
  isValidSession,
  issueSession,
  sessionCookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Whether a request already carries a valid session, for the proxy to consult.
 *
 * Async because the HMAC is WebCrypto: the middleware runs on the Edge runtime,
 * which has no `node:crypto`, so the signature is verified with `crypto.subtle`
 * and the result cannot be had synchronously. The proxy route lives on Node and
 * could use `node:crypto` instead, but then the two would be separate
 * implementations of the same check, which is the failure mode this file
 * exists to prevent.
 */
export async function hasSession(req: NextRequest): Promise<boolean> {
  return isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function POST(request: NextRequest): Promise<Response> {
  const password = process.env.STREAMKIT_PASSWORD?.trim();
  if (!password) {
    // No password configured means no gate, which would silently reopen the
    // proxy. Say so instead of failing open.
    return NextResponse.json(
      { error: "STREAMKIT_PASSWORD is not set on the server" },
      { status: 503 },
    );
  }

  // The login form is a plain HTML form post, so this arrives as
  // form-urlencoded; a fetch from the editor arrives as JSON. Accept both
  // rather than forcing the login page to carry a script just to submit.
  const type = request.headers.get("content-type") ?? "";
  const isJson = type.includes("application/json");
  let supplied = "";
  let next: FormDataEntryValue | null = null;

  if (isJson) {
    try {
      const body = (await request.json()) as { password?: unknown };
      supplied = typeof body.password === "string" ? body.password : "";
    } catch {
      return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
    }
  } else {
    // The body is readable exactly once, so the redirect target is taken from
    // this same parse rather than re-reading it below.
    const form = await request.formData();
    const value = form.get("password");
    supplied = typeof value === "string" ? value : "";
    next = form.get("next");
  }

  if (!supplied || !equalSecret(supplied, password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const cookie = sessionCookieOptions();
  const session = await issueSession();

  // A form post wants a redirect back into the app; a fetch wants the JSON.
  if (!isJson) {
    const target =
      typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/dashboard";
    const response = NextResponse.redirect(new URL(target, request.url), 303);
    response.cookies.set(SESSION_COOKIE, session, cookie);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session, cookie);
  return response;
}

export async function DELETE(): Promise<Response> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
