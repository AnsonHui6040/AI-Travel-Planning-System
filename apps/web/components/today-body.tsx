"use client";

import { isPackDay, leaveCountdown, type DayPack } from "@atps/offline";
import { useEffect, useState } from "react";
import { DeparturePanel } from "./departure-panel";
import { shiftedChange, useOfflineQueue } from "./use-offline-queue";

// T35：當日行程（線上與離線共用）。最遲離開倒數每分鐘更新；修改先排入佇列，有網路時送出為待批准提案（SH-05）

const STATUS_LABELS: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};

function countdownText(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 0) return `（已超過 ${-minutes} 分鐘）`;
  return `（還有 ${minutes} 分鐘）`;
}

function savedAt(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export function TodayBody({ pack, canEdit, offline }: { pack: DayPack; canEdit: boolean; offline: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const { queue, message, setMessage, add } = useOfflineQueue(pack.tripId);
  const [editing, setEditing] = useState<string | null>(null);
  const [startValue, setStartValue] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const submit = async (entry: DayPack["entries"][number]) => {
    const change = shiftedChange({ tripId: pack.tripId, itemId: entry.itemId, itemName: entry.name, date: pack.date, start: entry.start, end: entry.end, baseVersion: pack.baseVersion }, startValue);
    if (typeof change === "string") {
      setMessage(change);
      return;
    }
    setEditing(null);
    await add(change);
  };

  return (
    <div className="today-body">
      {offline ? <p className="offline-banner">離線模式：顯示 {savedAt(pack.generatedAt, pack.timezone)} 儲存的當日包</p> : null}
      {message ? (
        <p role="status" className="today-message">
          {message}
        </p>
      ) : null}
      {queue.length > 0 ? <p className="muted">佇列中有 {queue.length} 項修改尚未送出</p> : null}
      <ol className="today-list">
        {pack.entries.map((entry, index) => {
          // 倒數只在當天顯示
          const minutes = isPackDay(pack, now) ? leaveCountdown(pack, entry, now) : null;
          const photo = pack.photos.find((p) => p.itemId === entry.itemId);
          return (
            <li key={entry.itemId} aria-label={entry.name}>
              <div className="today-time">
                {entry.start}–{entry.end}
              </div>
              <div className="today-main">
                <h3>{entry.name}</h3>
                {entry.nameLocal ? <p className="muted">{entry.nameLocal}</p> : null}
                {entry.address ? <p className="muted">{entry.address}</p> : null}
                {photo ? (
                  <figure className="today-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={entry.name} loading="lazy" />
                    <figcaption>{photo.credit}</figcaption>
                  </figure>
                ) : null}
                <p className="today-leave">
                  {entry.leaveBy ? `最遲 ${entry.leaveBy} 離開前往${entry.nextName ?? "下一站"}${countdownText(minutes)}` : "最後一站"}
                </p>
                <p className="muted">
                  {STATUS_LABELS[entry.verificationStatus] ?? entry.verificationStatus}
                  {entry.atRisk ? "，At Risk" : ""}
                </p>
                {/* T37：只在當天顯示離開前檢查 */}
                {isPackDay(pack, now) ? <DeparturePanel pack={pack} index={index} now={now} /> : null}
                {canEdit ? (
                  editing === entry.itemId ? (
                    <div className="today-edit">
                      <label>
                        新的開始時間
                        <input value={startValue} onChange={(e) => setStartValue(e.target.value)} inputMode="numeric" placeholder="HH:mm" />
                      </label>
                      <button className="primary" type="button" onClick={() => void submit(entry)}>
                        送出修改
                      </button>
                      <button className="ghost" type="button" onClick={() => setEditing(null)}>
                        取消
                      </button>
                    </div>
                  ) : (
                    <button className="secondary"
                      type="button"
                      onClick={() => {
                        setEditing(entry.itemId);
                        setStartValue(entry.start);
                      }}
                    >
                      調整時間
                    </button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {pack.fixed.length > 0 ? (
        <section aria-label="固定活動">
          <h2>固定活動</h2>
          <ul className="today-plain">
            {pack.fixed.map((f) => (
              <li key={`${f.name}-${f.start}`}>
                {f.start}–{f.end} {f.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="Backup">
        <h2>Backup</h2>
        {pack.backups.length === 0 ? <p className="muted">沒有 Backup。</p> : null}
        <ul className="today-plain">
          {pack.backups.map((b) => (
            <li key={b.id}>
              {b.name}
              {b.standby ? "（Standby）" : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
