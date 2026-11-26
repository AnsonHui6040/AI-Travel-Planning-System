import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TIMELINE_OUTCOME_LABELS, type TimelineRow } from "@atps/core";
import { loadTimeline } from "../../../../lib/server/timeline";
import { ProduceForm, RecordForm } from "./timeline-forms";
import "../../../settings/settings.css";
import "./timeline.css";

// T39：Actual Timeline（第 2.8、2.9 節）。每日結束產生 Planned vs Actual，只記錄實際發生的事：
// 只有完成的項目標為已去過，部分完成、略過與沒有紀錄的項目不算

export const metadata: Metadata = { title: "Actual Timeline" };
export const dynamic = "force-dynamic";

const span = (a: string | null | undefined, b: string | null | undefined) => (a || b ? `${a ?? "未記錄"}–${b ?? "未記錄"}` : "未記錄");

function delta(minutes: number | null): string | null {
  if (minutes === null || minutes === 0) return minutes === 0 ? "準時" : null;
  return minutes > 0 ? `晚 ${minutes} 分鐘` : `早 ${-minutes} 分鐘`;
}

function Row({ row, record, produced }: { row: TimelineRow; record: ReactNode; produced: boolean }) {
  const late = delta(row.arrivalDeltaMinutes);
  return (
    <li className={`timeline-row ${row.outcome}`}>
      <div className="timeline-head">
        <h3>{row.name_zh}</h3>
        <span className="timeline-outcome">{TIMELINE_OUTCOME_LABELS[row.outcome]}</span>
        {produced && row.visited ? <span className="timeline-visited">已去過</span> : null}
      </div>
      <dl className="timeline-times">
        <div>
          <dt>排定</dt>
          <dd>{row.planned ? span(row.planned.start, row.planned.end) : "計畫外"}</dd>
        </div>
        <div>
          <dt>實際</dt>
          <dd>
            {row.actual ? span(row.actual.arrived, row.actual.departed) : "未記錄"}
            {late ? <span className="timeline-delta">{late}</span> : null}
          </dd>
        </div>
      </dl>
      {record}
    </li>
  );
}

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ date?: string }> }) {
  const { tripId } = await params;
  const { date } = await searchParams;
  const view = await loadTimeline(tripId, date);
  if (view.state !== "ok") {
    return (
      <main className="settings timeline">
        <h1>Actual Timeline</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  if (!view.date || !view.timeline) {
    return (
      <main className="settings timeline">
        <h1>Actual Timeline</h1>
        <p className="muted">還沒有已批准的每日行程。</p>
      </main>
    );
  }
  const day = view.date;
  const t = view.timeline;
  const editable = view.canEdit && !view.produced && view.dayStatus !== "completed";
  const extra = view.unplanned.filter((u) => !t.rows.some((r) => r.itemId === u.id)).map((u) => ({ id: u.id, name: u.name_zh }));
  return (
    <main className="settings timeline">
      <h1>Actual Timeline</h1>
      <p className="trip-line">
        {view.tripName}，{day}
      </p>
      {view.dates.length > 1 ? (
        <nav aria-label="日期" className="timeline-dates">
          {view.dates.map((d) => (
            <Link key={d} href={`/trips/${tripId}/timeline?date=${d}`} aria-current={d === day ? "page" : undefined}>
              {d.slice(5)}
            </Link>
          ))}
        </nav>
      ) : null}
      <p className="timeline-state">
        {view.produced ? "已產生，內容不再變動。" : "尚未產生。以下是目前紀錄的預覽，產生前可繼續記錄。"}
      </p>
      {view.produced ? (
        <p className="timeline-next">
          <Link href={`/trips/${tripId}/post-trip`}>旅後回顧</Link>
          <span className="muted">最後一日產生後，標記旅後狀態並查看 Planned vs Actual 比較報告</span>
        </p>
      ) : null}
      <section aria-label="Planned vs Actual">
        <h2>Planned vs Actual</h2>
        <p className="timeline-summary">
          排定 {t.summary.planned} 項，完成 {t.summary.completed} 項，部分完成 {t.summary.partial} 項，略過 {t.summary.skipped} 項，沒有紀錄 {t.summary.notRecorded} 項
          {t.summary.unplanned > 0 ? `，計畫外 ${t.summary.unplanned} 項` : ""}
        </p>
        {t.rows.length > 0 ? (
          <ul className="timeline-list">
            {t.rows.map((row) => (
              <Row
                key={row.itemId}
                row={row}
                produced={view.produced}
                record={editable ? <RecordForm tripId={tripId} date={day} items={[{ id: row.itemId, name: row.name_zh }]} label={`記錄 ${row.name_zh}`} /> : null}
              />
            ))}
          </ul>
        ) : (
          <p className="muted">這天沒有排定的項目。</p>
        )}
      </section>
      {editable && extra.length > 0 ? (
        <section aria-label="計畫外">
          <h2>計畫外</h2>
          <p className="muted">現場改去 Backup 或 Standby 時在這裡記錄。</p>
          <RecordForm tripId={tripId} date={day} items={extra} label="記錄計畫外項目" />
        </section>
      ) : null}
      {editable ? (
        <section aria-label="產生">
          <h2>結束今天</h2>
          <p className="muted">產生後這天標示為已完成，不能再記錄。只有記錄為已完成的項目會標為已去過。</p>
          <ProduceForm tripId={tripId} date={day} />
        </section>
      ) : null}
    </main>
  );
}
