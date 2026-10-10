import path from "node:path";
import type { NextConfig } from "next";

// The CSP is not here: it needs a per-request nonce and is set by proxy.ts.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const SITEMAP_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=300";

const nextConfig: NextConfig = {
  output: "standalone",
  // npm workspaces hoist node_modules to the repo root; trace from there or the standalone build misses them.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  experimental: { globalNotFound: true },
  deploymentId: process.env.DEPLOYMENT_VERSION,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The sitemap is read from the database at every request that reaches the server; the CDN in front of the web host
      // answers a crawler that polls it, so a new vacancy is listed within s-maxage seconds (D75).
      { source: "/sitemap.xml", headers: [{ key: "Cache-Control", value: SITEMAP_CACHE_CONTROL }] },
    ];
  },
};

export default nextConfig;
