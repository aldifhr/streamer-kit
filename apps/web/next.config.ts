import type { NextConfig } from "next";

/**
 * Where the API lives.
 *
 * One source of truth, because the frontend reaches the backend two different
 * ways and they have to agree: relative `/api/*` calls are proxied by the
 * rewrite below, while the WebSocket and the connect calls bypass it entirely
 * (Next does not proxy WS upgrades). Pointing the rewrite at a hardcoded
 * localhost while the socket goes to a deployed host is how you end up with a
 * dashboard that lists nothing and an overlay that still works.
 *
 * Read at build time. NEXT_PUBLIC_* values are inlined into the client bundle,
 * so changing this requires a rebuild, not just a restart.
 */
const backend = (
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:8000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    // NOTE: `/ws/*` is intentionally NOT proxied here. Next.js rewrites only
    // apply to plain HTTP requests, never to a WebSocket upgrade, so the socket
    // would hang on the FE host and never reach the API. The overlay builds its
    // socket URL against the API origin directly — see `lib/api.ts`.
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
