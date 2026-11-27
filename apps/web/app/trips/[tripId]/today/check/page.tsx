import type { Metadata } from "next";
import Link from "next/link";
import { MORNING_CHECK_LABELS, type MorningCheckName } from "@atps/core";
import { loadToday } from "../../../../../lib/server/today";
import { MorningCheckForm } from "../morning-check-form";
import "../../../../today.css";
import "../now.css";

// T36：完整的 Morning Check（由「現在」的一行摘要開啟）。十項檢查與執行按鈕

export const metadata: Metadata = { title: "Morning Check" };
export const dynamic = "force-dynamic";

const CHECK_STATUS: Record<string, string> = { ok: "正常", attention: "留意", no_data: "無資料" };
const DAY_STATUS: Record<string, string> = { approved: "已批准", day_ready: "Day Ready", in_progress: "進行中", completed: "已完成" };

export default async function MorningCheckPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadToday(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="screen">
        <h1>Morning Check</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  const day = view.pack?.date ?? null;
  const canRun = view.canEdit && day !== null && (view.dayStatus === "approved" || view.dayStatus === "day_ready");
  return (
    <main className="screen today-check">
      <header className="screen-head">
        <Link className="back-link" href={`/trips/${tripId}/today${day ? `?date=${day}` : ""}`} aria-label="返回現在">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          現在
        </Link>
        <h1>Morning Check</h1>
        <p>
          {view.tripName}
          {day ? `，${day.slice(5).replace("-", "/")}，${DAY_STATUS[view.dayStatus ?? ""] ?? "尚未批准"}` : ""}
        </p>
      </header>
      <section aria-label="Morning Check" className="screen-body morning">
        {!day ? <p className="muted">還沒有已批准的每日行程。</p> : null}
        {day && view.morning ? (
          <ul className="morning-checks">
            {view.morning.checks.map((c) => (
              <li key={c.check} className={c.status}>
                <span className="morning-name">{MORNING_CHECK_LABELS[c.check as MorningCheckName] ?? c.check}</span>
                <span className="morning-status">{CHECK_STATUS[c.status] ?? c.status}</span>
                <span className="morning-detail">{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {day && !view.morning ? (
          <p className="muted">今天還沒有執行 Morning Check。檢查天氣、警報、交通、固定活動、預約、營業、第一段交通、行李、同行者與 Backup。</p>
        ) : null}
      </section>
      {canRun && day ? (
        <div className="screen-actions">
          <MorningCheckForm tripId={tripId} date={day} label={view.morning ? "再次執行 Morning Check" : "執行 Morning Check"} />
        </div>
      ) : null}
    </main>
  );
}
