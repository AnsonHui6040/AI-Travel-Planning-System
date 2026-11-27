"use client";

import type { DayPack } from "@atps/offline";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { nowStop, type RowState } from "../lib/now-view";
import { DeparturePanel } from "./departure-panel";

// 「現在」分頁：旅行中（docs/verification/ux-logic-2026-11-27.md 第 6 節）。下一站卡片、Morning Check 摘要、
// 今天的時間軸與出狀況、開始導航。時間每分鐘更新；第一次顯示用伺服器時間，掛載後改用裝置時間

const MODE_LABELS: Record<string, string> = { walk: "步行", rail: "鐵路與地鐵", bus: "公車", taxi: "計程車與叫車", drive: "自駕" };
const STATE_LABELS: Record<RowState, string> = { done: "已過", current: "目前", next: "下一站", upcoming: "" };

function Mark({ state }: { state: RowState }) {
  return (
    <span className="now-mark" data-state={state}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {state === "done" ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : null}
        {state === "current" ? <circle cx="12" cy="12" r="5" className="filled" /> : null}
        {state === "next" ? <circle cx="12" cy="12" r="5" /> : null}
      </svg>
      {STATE_LABELS[state] ? <span className="sr-only">{STATE_LABELS[state]}</span> : null}
    </span>
  );
}

function countdownText(minutes: number): string {
  return minutes < 0 ? `已超過 ${-minutes} 分鐘` : `還有 ${minutes} 分鐘`;
}

export function NowTrip({
  pack,
  tripName,
  dayLabel,
  morning,
  canEdit,
  directions,
  modeToNext,
  initialNow,
  saver,
}: {
  pack: DayPack;
  tripName: string;
  dayLabel: string;
  morning: { text: string; href: string } | null;
  canEdit: boolean;
  directions: Record<string, string>;
  modeToNext: Record<string, string>;
  initialNow: string;
  saver: ReactNode;
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const view = nowStop(pack, now);
  const next = view.next;
  const navigateTo = next ? (next.itemId ? directions[next.itemId] : directions[`fixed:${next.name}@${next.start}`]) : undefined;
  const fromEntry = view.departureIndex !== null ? pack.entries[view.departureIndex] : undefined;
  const mode = fromEntry ? modeToNext[fromEntry.itemId] : undefined;
  const base = `/trips/${pack.tripId}`;

  return (
    <main className="screen wide now now-trip">
      <header className="screen-head">
        <h1>{tripName}</h1>
        <p>{dayLabel}</p>
      </header>
      <div className="now-grid">
        <div className="now-side">
          {morning ? (
            <Link className="now-morning" href={morning.href}>
              {morning.text}
            </Link>
          ) : null}
          <section aria-label="Backup" className="now-backups">
            <h2>Backup</h2>
            {pack.backups.length === 0 ? <p className="muted">沒有 Backup。</p> : null}
            <ul>
              {pack.backups.map((b) => (
                <li key={b.id}>
                  {b.name}
                  {b.standby ? "（Standby）" : ""}
                </li>
              ))}
            </ul>
          </section>
          {saver}
        </div>
        <section aria-label="下一站" className="now-next">
          <h2>{view.isToday ? "下一站" : "第一站"}</h2>
          {next ? (
            <>
              <p className="now-stop">
                <span className="now-start">{next.start}</span>
                <span className="now-name">{next.name}</span>
              </p>
              {next.leaveBy ? (
                <p className="now-leave">
                  最遲 {next.leaveBy} 離開
                  {view.countdownMinutes !== null ? (
                    <span className={view.countdownMinutes < 0 ? "now-countdown late" : "now-countdown"}>{countdownText(view.countdownMinutes)}</span>
                  ) : null}
                </p>
              ) : (
                <p className="now-leave">{view.isToday ? `${next.start} 開始` : `${pack.date.slice(5).replace("-", "/")} ${next.start} 開始`}</p>
              )}
              {next.travelMinutes !== null && next.leaveBy ? (
                <p className="muted">
                  {mode ? `${MODE_LABELS[mode] ?? "交通"}約` : "交通約"} {next.travelMinutes} 分鐘（含緩衝）
                </p>
              ) : null}
              {view.departureIndex !== null ? <DeparturePanel pack={pack} index={view.departureIndex} now={now} /> : null}
            </>
          ) : (
            <p className="now-leave">今天的行程已結束</p>
          )}
        </section>
        <section aria-label="今天的時間軸" className="now-day">
          <ol aria-label="今天" className="rows now-rows">
            {view.rows.map((r) => (
              <li key={`${r.kind}-${r.itemId ?? r.name}-${r.start}`} data-state={r.state}>
                {r.itemId ? (
                  <Link href={`${base}/items/${r.itemId}?date=${pack.date}`}>
                    <Mark state={r.state} />
                    <span className="row-time">{r.start}</span>
                    <span className="row-name">{r.name}</span>
                    <span className={r.atRisk ? "row-meta risk" : "row-meta"}>{r.atRisk ? "At Risk" : ""}</span>
                  </Link>
                ) : (
                  <div className="row">
                    <Mark state={r.state} />
                    <span className="row-time">{r.start}</span>
                    <span className="row-name">{r.name}</span>
                    <span className="row-meta">固定活動</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
        <div className="screen-actions">
          {canEdit ? (
            <Link className="secondary" href={`${base}/incident?date=${pack.date}`}>
              出狀況
            </Link>
          ) : null}
          {navigateTo ? (
            <a className="primary" href={navigateTo} target="_blank" rel="noopener noreferrer">
              開始導航
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
