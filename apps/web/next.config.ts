import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // npm workspaces hoist node_modules to the repo root; trace from there or the standalone build misses them.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Temporary: replaced by locale negotiation in proxy.ts (WP4).
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default nextConfig;
