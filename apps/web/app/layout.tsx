import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "旅行規劃",
  description: "多 AI 協作的旅行規劃與現場調整",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // S-08：nonce 只能在請求時套用，所有頁面須動態渲染
  await connection();
  return (
    <html lang="zh-Hant-TW">
      <body>{children}</body>
    </html>
  );
}
