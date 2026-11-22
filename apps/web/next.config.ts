import path from "node:path";
import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // T04：Docker 自架使用 standalone 輸出；outputFileTracingRoot 指向 monorepo 根目錄以納入 workspace 套件
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
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
