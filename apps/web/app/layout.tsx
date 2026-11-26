import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "../components/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: "旅行規劃",
  description: "多 AI 協作的旅行規劃與現場調整",
  // T35：加入主畫面後以獨立 App 模式開啟（R1）
  appleWebApp: { capable: true, title: "旅行規劃", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 與 globals.css 的 --bg 一致，深淺色跟隨系統
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf3e8" },
    { media: "(prefers-color-scheme: dark)", color: "#100904" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // S-08：nonce 只能在請求時套用，所有頁面須動態渲染
  await connection();
  return (
    <html lang="zh-Hant-TW">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
