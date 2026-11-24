"use client";

import { drainQueue, enqueue, isPackDay, leaveCountdown, type DayPack, type QueuedChange } from "@atps/offline";
import { useCallback, useEffect, useState } from "react";
import { loadQueue, saveQueue } from "../lib/client/offline-store";

// T35：當日行程（線上與離線共用）。最遲離開倒數每分鐘更新；修改先排入佇列，有網路時送出為待批准提案（SH-05）

const STATUS_LABELS: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
};

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

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
  const [queue, setQueue] = useState<QueuedChange[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [startValue, setStartValue] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const sync = useCallback(async () => {
    const current = await loadQueue(pack.tripId);
    if (current.length === 0 || !navigator.onLine) {
      setQueue(current);
      return;
    }
    const result = await drainQueue(current, async (change) => {
      try {
        const response = await fetch(`/api/trips/${change.tripId}/offline-proposals`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId: change.itemId, date: change.date, start: change.start, end: change.end, baseVersion: change.baseVersion }),
        });
        if (response.status === 201) return "sent";
        if (response.status >= 400 && response.status < 500 && response.status !== 429) return "rejected";
        return "failed";
      } catch {
        return "failed";
      }
    });
    await saveQueue(pack.tripId, result.remaining);
    setQueue(result.remaining);
    if (result.sent > 0) setMessage(`已同步 ${result.sent} 項修改為提案，等成員批准後才會套用`);
    else if (result.rejected > 0) setMessage(`${result.rejected} 項修改無法送出（行程已變更或沒有權限），已移除`);
  }, [pack.tripId]);

  useEffect(() => {
    void sync();
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sync]);

  const submit = async (entry: DayPack["entries"][number]) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startValue)) {
      setMessage("時間格式須為 HH:mm");
      return;
    }
    const duration = toMin(entry.end) - toMin(entry.start);
    const end = toMin(startValue) + duration;
    if (end >= 24 * 60) {
      setMessage("結束時間不可超過當天");
      return;
    }
    const change: QueuedChange = {
      id: crypto.randomUUID(),
      tripId: pack.tripId,
      itemId: entry.itemId,
      itemName: entry.name,
      date: pack.date,
      start: startValue,
      end: toHhmm(end),
      baseVersion: pack.baseVersion,
      queuedAt: new Date().toISOString(),
    };
    const next = enqueue(await loadQueue(pack.tripId), change);
    await saveQueue(pack.tripId, next);
    setQueue(next);
    setEditing(null);
    setMessage(navigator.onLine ? "正在送出修改" : "已排入佇列，恢復網路後送出為提案");
    if (navigator.onLine) await sync();
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
        {pack.entries.map((entry) => {
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
                {canEdit ? (
                  editing === entry.itemId ? (
                    <div className="today-edit">
                      <label>
                        新的開始時間
                        <input value={startValue} onChange={(e) => setStartValue(e.target.value)} inputMode="numeric" placeholder="HH:mm" />
                      </label>
                      <button type="button" onClick={() => void submit(entry)}>
                        送出修改
                      </button>
                      <button type="button" onClick={() => setEditing(null)}>
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
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
            <li key={b.id}>{b.name}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
