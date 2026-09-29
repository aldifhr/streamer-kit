import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // NOTE: `/ws/*` is intentionally NOT proxied here. Next.js rewrites only
    // apply to plain HTTP requests, never to a WebSocket upgrade, so the socket
    // would hang on :3000 and never reach FastAPI. The overlay builds its socket
    // URL against the API origin directly — see `lib/api.ts`.
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
