import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the database or the clock, so nothing here is static.
  // Being explicit stops Next from caching a run page at build time.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
  serverExternalPackages: ["pg"],
};

export default nextConfig;
