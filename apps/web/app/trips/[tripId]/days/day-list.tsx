import Link from "next/link";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import type { DayDraftView, DayView } from "../../../../lib/server/day-draft";

// 行程分頁的當日清單：日期切換與每項一行（手機與 1024px 以上的左欄共用）

type OkView = Extract<DayDraftView, { state: "ok" }>;

const STATUS_LABELS: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
  user_confirmed: "使用者確認",
};

export const DAY_STATUS_LABELS: Record<DayView["status"], string> = {
  draft: "草案",
  approved: "已批准",
  day_ready: "Day Ready",
  in_progress: "進行中",
  completed: "已完成",
};

export const weekday = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "UTC", month: "numeric", day: "numeric", weekday: "narrow" }).format(new Date(`${date}T00:00:00Z`));

// ?date= 指定的日期；否則今天（目的地時區）；規劃中為第一個草案日；最後為第一天
export function pickDay(view: OkView, requested: string | undefined): DayView | undefined {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: view.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return (
    view.days.find((d) => d.date === requested) ??
    view.days.find((d) => d.date === today) ??
    (view.tripStatus === "planning" ? view.days.find((d) => d.status === "draft") : undefined) ??
    view.days[0]
  );
}

export function DayChips({ tripId, view, day }: { tripId: string; view: OkView; day: DayView }) {
  return (
    <nav aria-label="日期" className="chips">
      {view.days.map((d) => (
        <Link key={d.date} href={`/trips/${tripId}/days?date=${d.date}`} aria-current={d.date === day.date ? "page" : undefined}>
          {shortDate(d.date)}
        </Link>
      ))}
    </nav>
  );
}

export function DayList({ tripId, view, day, currentItem }: { tripId: string; view: OkView; day: DayView; currentItem: string | null }) {
  return (
    <>
      <DayChips tripId={tripId} view={view} day={day} />
      <div className="day-head">
        <h2>{weekday(day.date)}</h2>
        <span className="tag">{DAY_STATUS_LABELS[day.status]}</span>
      </div>
      {day.entries.length === 0 ? <p className="muted">這天還沒有可排入的項目。</p> : null}
      <ScrollKeeper scrollKey={`days:${tripId}:${day.date}`}>
      <ol aria-label="項目" className="rows day-rows">
        {day.entries.map((entry) => {
          if (entry.kind === "fixed") {
            return (
              <li key={`${entry.name}-${entry.start}`}>
                <div className="row">
                  <span className="row-time">{entry.start}</span>
                  <span className="row-name">{entry.name}</span>
                  <span className="row-meta">固定活動</span>
                </div>
              </li>
            );
          }
          const item = view.items[entry.item_id];
          if (!item) return null;
          return (
            <li key={entry.item_id}>
              <Link href={`/trips/${tripId}/items/${entry.item_id}?date=${day.date}`} aria-current={currentItem === entry.item_id ? "page" : undefined}>
                <span className="row-time">{entry.start}</span>
                <span className="row-name">{item.nameZh}</span>
                <span className={item.atRisk ? "row-meta risk" : "row-meta"}>{item.atRisk ? "At Risk" : STATUS_LABELS[item.verificationStatus]}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      </ScrollKeeper>
    </>
  );
}
