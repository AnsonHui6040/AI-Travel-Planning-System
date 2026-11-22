import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@atps/schemas",
    "@atps/core",
    "@atps/ai",
    "@atps/data-sources",
    "@atps/regions",
    "@atps/security",
    "@atps/memory",
    "@atps/offline",
    "@atps/db",
  ],
};

export default nextConfig;
