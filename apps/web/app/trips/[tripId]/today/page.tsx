import type { Metadata } from "next";
import Link from "next/link";
import { TodayBody } from "../../../../components/today-body";
import { loadToday } from "../../../../lib/server/today";
import { MORNING_CHECK_LABELS, type MorningCheckName } from "@atps/core";
import { MorningCheckForm } from "./morning-check-form";
import { SavePack } from "./save-pack";
import "../../../settings/settings.css";
import "../../../today.css";

// T35：當日行程（D11）。線上開啟時存入 IndexedDB；離線時由 service worker 改提供 /offline-today，從 IndexedDB 讀取

export const metadata: Metadata = { title: "當日行程" };
export const dynamic = "force-dynamic";

const CHECK_STATUS: Record<string, string> = { ok: "正常", attention: "留意", no_data: "無資料" };
const DAY_STATUS: Record<string, string> = { approved: "已批准", day_ready: "Day Ready", in_progress: "進行中", completed: "已完成" };

export default async function TodayPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadToday(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="settings today">
        <h1>當日行程</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  return (
    <main className="settings today">
      <h1>當日行程</h1>
      <p className="trip-line">
        {view.tripName}
        {view.pack ? `，${view.pack.date}` : ""}
      </p>
      {view.dates.length > 1 ? (
        <nav aria-label="日期" className="today-dates">
          {view.dates.map((d) => (
            <Link key={d} href={`/trips/${tripId}/today?date=${d}`} aria-current={d === view.pack?.date ? "page" : undefined}>
              {d.slice(5)}
            </Link>
          ))}
        </nav>
      ) : null}
      {view.pack ? (
        <>
          <section aria-label="Morning Check" className="morning">
            <h2>
              Morning Check
              <span className="day-status">{DAY_STATUS[view.dayStatus ?? ""] ?? "尚未批准"}</span>
            </h2>
            {view.morning ? (
              <ul className="morning-checks">
                {view.morning.checks.map((c) => (
                  <li key={c.check} className={c.status}>
                    <span className="morning-name">{MORNING_CHECK_LABELS[c.check as MorningCheckName] ?? c.check}</span>
                    <span className="morning-status">{CHECK_STATUS[c.status] ?? c.status}</span>
                    <span className="morning-detail">{c.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">今天還沒有執行 Morning Check。檢查天氣、警報、交通、固定活動、預約、營業、第一段交通、行李、同行者與 Backup。</p>
            )}
            {view.canEdit && (view.dayStatus === "approved" || view.dayStatus === "day_ready") ? (
              <MorningCheckForm tripId={tripId} date={view.pack.date} label={view.morning ? "再次執行 Morning Check" : "執行 Morning Check"} />
            ) : null}
          </section>
          <SavePack pack={view.pack} />
          <TodayBody pack={view.pack} canEdit={view.canEdit} offline={false} />
        </>
      ) : (
        <p className="muted">還沒有已批准的每日行程。</p>
      )}
    </main>
  );
}
