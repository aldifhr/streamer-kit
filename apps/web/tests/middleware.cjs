const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const OUT = path.resolve(__dirname, "../../../node_modules/.cache/stream-kit/mw");
// The compiled middleware requires `@/lib/session`, and CommonJS has no idea
// that `@` means this app. Node resolves bare specifiers through node_modules, and
// a directory there is not a package, so a symlink alone does not help. Hooking
// the resolver is the one place that can.
//
// It points into OUT, not into the source tree: pointing at `lib/session.ts`
// finds the file and then fails, because Node cannot require TypeScript. OUT is
// the same compiler output the middleware itself came from, so the two halves of
// the test agree about what session.ts means.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    request = path.join(OUT, request.slice(2));
  }
  return resolveFilename.call(this, request, ...rest);
};

const { isPublicPath } = require(path.join(OUT, "middleware.js"));

let passed = 0;
function check(label, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    process.exitCode = 1;
  }
}

console.log("the editor is not the overlay");
// This is the bug: `"/overlays/abc".startsWith("/overlay")` is true, so a prefix
// test served the editor to anyone who asked for it. Anonymous visitors saw an
// error page rather than anyone's overlays — the proxy still answered 401 — but
// the page should never have been reachable without a session.
check("the overlay editor needs a session", isPublicPath("/overlays/abc") === false);
check("the editor with a uuid needs a session", isPublicPath("/overlays/485613eb-fd58-4d75-80a6-ccff498b907e") === false);
check("nested editor paths need a session", isPublicPath("/overlays/abc/config") === false);
// The same trap applied to /login, which quietly covered /logins too.
check("a lookalike of /login needs a session", isPublicPath("/login-evil") === false);
check("/logins needs a session", isPublicPath("/logins") === false);
check("/loginhelper needs a session", isPublicPath("/loginhelper") === false);
check("/api/session-evil needs a session", isPublicPath("/api/session-evil") === false);
check("/faviconx needs a session", isPublicPath("/faviconx") === false);

console.log("the real public routes stay public");
// OBS has no password. If this ever closes, a streamer's browser source is stuck
// on a login screen forever and the overlay silently shows nothing.
check("/overlay/<id> is public", isPublicPath("/overlay/485613eb") === true);
check("/overlay alone is public", isPublicPath("/overlay") === true);
check("/overlay/ with a trailing slash is public", isPublicPath("/overlay/") === true);
check("/login is public", isPublicPath("/login") === true);
check("/login/ is public", isPublicPath("/login/") === true);
check("/api/session is public", isPublicPath("/api/session") === true);
check("/_next/static/chunk is public", isPublicPath("/_next/static/chunk.js") === true);
check("/favicon is public", isPublicPath("/favicon") === true);
check("/favicon/ is public", isPublicPath("/favicon/") === true);
// Not asserted: `/favicon.ico`. The matcher already excludes it outright, so it
// never reaches this function, and requiring a `favicon.ico` entry here would
// only add a prefix that could match something it should not.

console.log("the dashboard and everything else stays closed");
for (const p of ["/dashboard", "/", "/overlays", "/settings", "/api/overlays", "/about"]) {
  check(`${p} needs a session`, isPublicPath(p) === false);
}

console.log("an empty path does not match everything");
check("an empty path is closed", isPublicPath("") === false);
check("a bare slash is closed", isPublicPath("/") === false);

/**
 * The part that actually caught this bug.
 *
 * Asserting on `isPublicPath` alone would not have: the helper was right while
 * `middleware` still called `PUBLIC.some(p => pathname.startsWith(p))`, and every
 * assertion below would have kept passing against code that let anyone in. So
 * these call the real middleware and read the real redirect.
 */
const { middleware } = require(path.join(OUT, "middleware.js"));

async function redirectFor(pathname) {
  // A real URL, because middleware ends with `new URL("/login", request.url)` and
  // a plain string there throws. nextUrl only needs `pathname`, but passing a
  // genuine URL keeps the stub honest about what Next hands it.
  const origin = "https://streamkit.aldifhr.my.id";
  const request = {
    nextUrl: { pathname, url: `${origin}${pathname}` },
    url: `${origin}${pathname}`,
    cookies: { get: () => undefined, has: () => false },
  };
  const response = await middleware(request);
  const status = response?.status ?? 200;
  return { status, redirected: status >= 300 && status < 400 };
}

// A redirect means the gate held. No redirect means the request was let through.
(async () => {
console.log("middleware itself redirects the editor");
await check("/overlays/<id> is redirected to login", (await redirectFor("/overlays/485613eb")).redirected);
await check("/logins is redirected to login", (await redirectFor("/logins")).redirected);
await check("/dashboard is redirected to login", (await redirectFor("/dashboard")).redirected);
await check("/login-evil is redirected to login", (await redirectFor("/login-evil")).redirected);
await check("/overlays is redirected to login", (await redirectFor("/overlays")).redirected);

console.log("middleware itself lets the overlay through");
await check("/overlay/<id> passes", !(await redirectFor("/overlay/485613eb")).redirected);
await check("/login passes", !(await redirectFor("/login")).redirected);
await check("/overlay/ passes", !(await redirectFor("/overlay/")).redirected);
// `/` is not public. Confirmed against production, which answers it with a 307
// to /login: the whole app is behind the password, landing page included. Listed
// here so that stays a decision rather than an accident.
await check("/ is behind the password", (await redirectFor("/")).redirected);

console.log();
  console.log(process.exitCode ? "FAILED" : `all passed (${passed} assertions)`);
})();
