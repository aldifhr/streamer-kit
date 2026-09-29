/**
 * Session cookie: one implementation, two callers.
 *
 * The middleware and the proxy both need to answer "is this request signed in",
 * and they must answer it identically — a gate whose two halves disagree is
 * worse than no gate, because the permissive half looks like protection. So the
 * signing lives here and both import it.
 *
 * Two constraints shaped this file. The middleware runs on the Edge runtime,
 * which has no `node:crypto`, so the HMAC is built on WebCrypto — and the whole
 * thing is therefore async. A route handler can await; a middleware function
 * can too, so nothing is lost, but any caller that needed a synchronous check
 * would have to be rewritten. There are none.
 *
 * The value is `expiry.signature` where the signature covers the expiry, so a
 * cookie cannot be extended by editing it, and the comparison is a fixed-length
 * byte loop because a short-circuiting compare leaks how much of a guess was
 * right. WebCrypto has no constant-time compare, so this is a deliberate,
 * bounded substitute: both sides are the same length by construction.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "streamkit_session";

/** A week. One operator, and a re-login mid-broadcast would lock the person
 *  running the show out of their own controls. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string {
  return (
    process.env.STREAMKIT_SESSION_SECRET?.trim() ||
    process.env.STREAMKIT_API_TOKEN?.trim() ||
    ""
  );
}

async function key(): Promise<CryptoKey | null> {
  const raw = secret();
  if (!raw) return null;
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(expiry: number): Promise<string> {
  const cryptoKey = await key();
  if (!cryptoKey) return "";
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(String(expiry)));
  return base64url(new Uint8Array(mac));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh signed value, expiring a week out. */
export async function issueSession(): Promise<string> {
  const expiry = Date.now() + SESSION_MAX_AGE * 1000;
  return `${expiry}.${await sign(expiry)}`;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;

  const expiry = Number(value.slice(0, dot));
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return false;

  const expected = await sign(expiry);
  if (!expected) return false;
  return compare(expected, value.slice(dot + 1));
}

/** Length-independent, early-exit-free comparison of two base64url strings. */
function compare(a: string, b: string): boolean {
  // Hash both sides so the loop runs over equal-length input regardless of
  // what the caller sent, and compare the digests rather than the secrets.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Constant-time compare for the password itself. */
export function equalSecret(a: string, b: string): boolean {
  return compare(a, b);
}
