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
};

export default nextConfig;
