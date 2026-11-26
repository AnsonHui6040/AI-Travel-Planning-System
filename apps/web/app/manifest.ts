import type { MetadataRoute } from "next";

// T35：PWA（D11）。加入主畫面後以獨立 App 模式開啟

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "旅行規劃",
    short_name: "旅行規劃",
    lang: "zh-Hant-TW",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#100904",
    theme_color: "#100904",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
