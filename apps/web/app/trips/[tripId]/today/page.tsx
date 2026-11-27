import type { Metadata } from "next";
import { tripPhase } from "../../../../lib/now-view";
import { loadTripHeader } from "../../../../lib/server/trip-nav";
import { NowPlanning } from "./now-planning";
import { NowPost } from "./now-post";
import { NowTripScreen } from "./now-trip-screen";
import "./now.css";

// 「現在」分頁（docs/verification/ux-logic-2026-11-27.md 第 5、6 節）：打開就到現在該做的事。
// 規劃中顯示步驟與目前步驟的主要按鈕；旅行中顯示下一站與今天；旅後一次標記一個項目。
// 離線時 service worker 以 /offline-today 回應這個網址（T35）

export const metadata: Metadata = { title: "現在" };
export const dynamic = "force-dynamic";

export default async function NowPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const header = await loadTripHeader(tripId);
  if (header.state !== "ok") {
    return (
      <main className="screen now">
        <h1>現在</h1>
        <p>{header.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const phase = tripPhase(header.tripStatus);
  if (phase === "planning") return <NowPlanning tripId={tripId} header={header} />;
  if (phase === "post") return <NowPost tripId={tripId} />;
  return <NowTripScreen tripId={tripId} date={date} />;
}
