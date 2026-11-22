import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security-headers";

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
  async headers() {
    return [{ source: "/:path*", headers: [...staticSecurityHeaders] }];
  },
};

export default nextConfig;
