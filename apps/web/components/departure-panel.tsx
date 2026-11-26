"use client";

import { departureCheck } from "@atps/core";
import type { DayPack } from "@atps/offline";

// T37：離開前檢查。以當日包在瀏覽器端計算（離線也能使用）；目前沒有即時交通與營業資料時以估算計算並註明。
// 出現偏差（決策 0004 的 L1 以上）時建議進入 Incident Mode（T38）。

const INCIDENT_LABELS: Record<string, string> = {
  delay: "延誤",
  attraction_closed: "下一站休館",
  rail_disruption: "交通運行異常",
  long_queue: "排隊過久",
  flight_cancelled: "航班取消",
  extreme_weather: "極端天氣",
};

function countdown(minutes: number | null): string {
  if (minutes === null) return "";
  return minutes < 0 ? `（已超過 ${-minutes} 分鐘）` : `（還有 ${minutes} 分鐘）`;
}

export function DeparturePanel({ pack, index, now }: { pack: DayPack; index: number; now: Date }) {
  const entry = pack.entries[index];
  if (!entry) return null;
  const nextEntry = pack.entries[index + 1] ?? null;
  const nextFixed = pack.fixed.find((f) => f.start >= entry.end) ?? null;
  // 下一站是固定活動時，next 為 null
  const fixedFirst = nextFixed && (!nextEntry || nextFixed.start < nextEntry.start);
  const result = departureCheck({
    date: pack.date,
    timezone: pack.timezone,
    now,
    current: { id: entry.itemId, name: entry.name, end: entry.end },
    next: nextEntry && !fixedFirst ? { id: nextEntry.itemId, name: nextEntry.name, start: nextEntry.start, end: nextEntry.end, atRisk: nextEntry.atRisk, closed: false } : null,
    nextFixed,
    plannedTravelMinutes: entry.travelToNextMinutes ?? 30,
    liveTravelMinutes: null,
    transitAbnormal: null,
  });
  if (!result.eta) return null;
  const nextName = nextEntry && !fixedFirst ? nextEntry.name : (nextFixed?.name ?? "下一站");
  return (
    <details className="departure">
      <summary>離開前檢查</summary>
      <dl>
        <div>
          <dt>現在</dt>
          <dd>{result.now}</dd>
        </div>
        <div>
          <dt>最遲離開</dt>
          <dd>
            {result.leaveBy}
            {countdown(result.countdownMinutes)}
          </dd>
        </div>
        <div>
          <dt>預計到達{nextName}</dt>
          <dd>
            {result.eta}
            {result.lateMinutes > 0 ? `（延誤 ${result.lateMinutes} 分鐘）` : ""}
          </dd>
        </div>
        <div>
          <dt>下一站</dt>
          <dd>{result.worthGoing ? "仍值得前往" : "不建議前往"}</dd>
        </div>
        {nextFixed ? (
          <div>
            <dt>下一個固定活動</dt>
            <dd>
              {nextFixed.start} {nextFixed.name}
              {result.fixedMarginMinutes !== null ? (result.fixedMarginMinutes < 0 ? `（會晚 ${-result.fixedMarginMinutes} 分鐘）` : `（餘裕 ${result.fixedMarginMinutes} 分鐘）`) : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {result.notes.length > 0 ? (
        <ul className="departure-notes">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {result.incident ? (
        <>
          <p className="departure-incident" role="alert">
            建議進入 Incident Mode（{result.incident.level}，{INCIDENT_LABELS[result.incident.type] ?? result.incident.type}）
          </p>
          <p className="departure-incident-link">
            <a href={`/trips/${pack.tripId}/incident?date=${pack.date}`}>進入 Incident Mode</a>
          </p>
        </>
      ) : (
        <p className="muted">照原定行程前往</p>
      )}
    </details>
  );
}
