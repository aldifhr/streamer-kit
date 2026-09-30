import path from "node:path";
import type { NextConfig } from "next";

/** The npm workspace root, two levels above apps/web. */
const repoRoot = path.resolve(__dirname, "../..");

/**
 * No rewrites here on purpose.
 *
 * `/api/*` is served by the route handler in `app/api/[...path]/route.ts`,
 * which exists because the API's write token has to be attached to the outgoing
 * request server-side. A rewrite cannot do that: Next only allows `source`,
 * `destination`, `has`, `missing`, `locale` and `basePath` on a rewrite, and a
 * config carrying a `headers` property fails the build outright.
 *
 * The WebSocket is also not proxied, and never was — Next does not proxy WS
 * upgrades, so a socket sent to the FE host would hang. The overlay builds its
 * socket URL against `NEXT_PUBLIC_API_URL` directly; see `lib/api.ts`.
 *
 * That value stays a NEXT_PUBLIC_ one on purpose: the browser needs the origin
 * to open the socket, and a hostname is not a credential. The token does not
 * come this way — see STREAMKIT_API_TOKEN in `.env.example`.
 */
const nextConfig: NextConfig = {
  // This is an npm workspaces monorepo, so the app sits below the package root.
  // Left to itself Turbopack resolves pages from the workspace root and then
  // cannot find the app's own routes — the build compiles, then fails page
  // collection with "Cannot find module for page", including for built-in
  // routes like /_not-found. Naming the root fixes it.
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
  // The dev server is reached at 127.0.0.1 locally and over the LAN address when
  // checking a real browser, and Next blocks its own HMR and font resources for
  // any origin it does not recognise. The symptom is a dev server that serves
  // pages but silently never hot-reloads, which is worse than not running one.
  //
  // This list is exact, and the first entry is the one that decides: Next takes
  // the dev origin from the FIRST allowed origin, not from the incoming Host
  // header, and `request.url` is built from it. So a dev origin of "localhost"
  // makes every redirect on the site hand out `http://localhost:3100/...` — and
  // a streamer checking the dashboard over the LAN gets bounced to a hostname
  // that resolves to their own machine. Put the address that is actually being
  // typed here.
  // Next matches these as origins without the port, and warns about the exact
  // form when it rejects a host — asking for '43.133.32.206', not ':3100'.
  allowedDevOrigins: ["43.133.32.206", "127.0.0.1", "localhost"],
  // tests/api-gate.cjs builds and starts its own copy of the app, because
  // `NEXT_PUBLIC_*` is inlined at build time: a suite that reused `.next` would
  // proxy to whatever API hostname that build had compiled in, and read a live
  // server's answers as though they were the gate's. Pointing the build at its
  // own directory is what makes the gate's own behaviour observable.
  distDir: process.env.STREAMKIT_DIST_DIR || ".next",
};

export default nextConfig;
