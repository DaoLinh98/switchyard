import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local-only app: never expose source maps or telemetry-style headers.
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/messages", destination: "/v1/messages" },
      { source: "/v1/v1/messages", destination: "/v1/messages" },
    ];
  },
};

export default nextConfig;
