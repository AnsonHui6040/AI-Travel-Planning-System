import type { Metadata } from "next";
import Link from "next/link";
import { FEASIBILITY_LABELS, isDayBlocked } from "@atps/core";
import { loadDayDraft } from "../../../../lib/server/day-draft";
import { ApproveDayForm } from "./approve-day-form";
import { DayList, pickDay, weekday } from "./day-list";
import "./days.css";

// 行程分頁（T29、T30）：日期切換，該日項目每項一行，點進去看項目詳情。
// 規劃中的草案在這裡批准（一天一個主要按鈕）；草案在批准前不會改動行程

export const metadata: Metadata = { title: "行程" };
export const dynamic = "force-dynamic";

const TRIP_STATUS_LABELS: Record<string, string> = {
  planning: "規劃中",
  locked: "已鎖定",
  in_progress: "進行中",
  ended: "已結束",
  archived: "已封存",
};

export default async function DaysPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadDayDraft(tripId);
  if (view.state === "signed_out" || view.state === "not_found") {
    return (
      <main className="screen days">
        <h1>行程</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  if (view.state === "no_baseline") {
    return (
      <main className="screen days">
        <header className="screen-head">
          <h1>行程</h1>
          <p className="trip-line">{view.tripName}</p>
        </header>
        <p>確認 Trip Baseline v1 後才能產生每日草案。</p>
      </main>
    );
  }
  const day = pickDay(view, date);
  if (!day) {
    return (
      <main className="screen days">
        <h1>行程</h1>
        <p className="muted">基線沒有旅行日期。</p>
      </main>
    );
  }
  const nameOf = (id: string | null) => (id ? (view.items[id]?.nameZh ?? "") : "");
  const placed = day.entries.some((e) => e.kind === "item");
  return (
    <main className="screen wide days">
      <header className="screen-head">
        <h1>行程</h1>
        <p className="trip-line">
          {view.tripName}（{TRIP_STATUS_LABELS[view.tripStatus] ?? view.tripStatus}）
        </p>
      </header>
      <div className="split" data-detail="none">
        <section aria-label={day.date} className="split-list">
          <DayList tripId={tripId} view={view} day={day} currentItem={null} />
          <div className="day-notes">
            {day.backups.length > 0 ? <p className="muted">Backup：{day.backups.map((id) => nameOf(id)).join("、")}</p> : null}
            {day.issues.length > 0 ? (
              <ul className="day-issues" aria-label={`${day.date} 提醒`}>
                {day.issues.map((issue) => (
                  <li key={`${issue.check}-${issue.item_id ?? ""}`}>
                    {issue.item_id ? `${nameOf(issue.item_id)}：` : ""}
                    {FEASIBILITY_LABELS[issue.check]}
                  </li>
                ))}
              </ul>
            ) : null}
            {day.returned.length > 0 ? (
              <details className="day-returned">
                <summary>{day.returned.length} 個項目留在 Candidate List</summary>
                <p className="muted">
                  {day.returned
                    .map((r) => `${nameOf(r.item_id)}${r.checks.length > 0 ? `（${r.checks.map((c) => FEASIBILITY_LABELS[c]).join("、")}）` : "（當天放不下）"}`)
                    .join("、")}
                </p>
              </details>
            ) : null}
          </div>
          {view.canEdit ? (
            <div className="screen-actions">
              {view.tripStatus !== "ended" && view.tripStatus !== "archived" ? (
                <Link className="secondary" href={`/trips/${tripId}/items/new`}>
                  新增地點
                </Link>
              ) : null}
              {placed ? (
              <ApproveDayForm
                tripId={tripId}
                date={day.date}
                baseVersion={view.baseVersion}
                label={weekday(day.date)}
                mode={!view.canApprove || day.status !== "draft" ? "hidden" : isDayBlocked(day.issues, day.date) ? "blocked" : "ready"}
              />
              ) : null}
            </div>
          ) : null}
        </section>
        <div className="split-detail">
          <p className="empty-detail">選擇一個項目查看時間、交通、可移動範圍與照片。</p>
        </div>
      </div>
    </main>
  );
}
