import type { Metadata } from "next";
import { timezoneOptions } from "../../../../lib/booking-format";
import { loadImportView } from "../../../../lib/server/import-view";
import { BackLink } from "../bookings/parts";
import { ImportFlow } from "./import-flow";
import "./import.css";

// 決策 0010 I：行程匯入。貼上與預覽是兩個畫面（同一個網址，預覽不保存）；每個畫面一個主要按鈕，390×844 與 1280×800 不用捲動。
// 由「行程」標題列與「更多」進入

export const metadata: Metadata = { title: "匯入" };
export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadImportView(tripId);
  if (view.state !== "ok") {
    return (
      <main className="screen import">
        <h1>匯入</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  if (!view.canEdit) {
    return (
      <main className="screen import">
        <header className="screen-head">
          <BackLink href={`/trips/${tripId}/more`} label="更多" />
          <h1>匯入</h1>
        </header>
        <p>只有 Owner 與 Companion 可以匯入。</p>
      </main>
    );
  }
  return <ImportFlow tripId={tripId} tripName={view.tripName} locked={view.locked} dates={view.dates} timezones={timezoneOptions(view.timezone, null)} />;
}
