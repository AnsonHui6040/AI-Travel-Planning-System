"use client";

import { drainQueue, enqueue, type QueuedChange } from "@atps/offline";
import { useCallback, useEffect, useState } from "react";
import { loadQueue, saveQueue } from "../lib/client/offline-store";

// T35：修改佇列（SH-05）。修改先存入 IndexedDB，有網路時送出為待批准提案；當日行程（離線）與項目詳情共用

export function useOfflineQueue(tripId: string) {
  const [queue, setQueue] = useState<QueuedChange[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const sync = useCallback(async () => {
    const current = await loadQueue(tripId);
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
    await saveQueue(tripId, result.remaining);
    setQueue(result.remaining);
    if (result.sent > 0) setMessage(`已同步 ${result.sent} 項修改為提案，等成員批准後才會套用`);
    else if (result.rejected > 0) setMessage(`${result.rejected} 項修改無法送出（行程已變更或沒有權限），已移除`);
  }, [tripId]);

  useEffect(() => {
    void sync();
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sync]);

  const add = useCallback(
    async (change: QueuedChange) => {
      const next = enqueue(await loadQueue(tripId), change);
      await saveQueue(tripId, next);
      setQueue(next);
      setMessage(navigator.onLine ? "正在送出修改" : "已排入佇列，恢復網路後送出為提案");
      if (navigator.onLine) await sync();
    },
    [tripId, sync],
  );

  return { queue, message, setMessage, add };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// 新的開始時間保留原本的長度；格式錯誤或超過當天時回傳說明
export function shiftedChange(
  input: { tripId: string; itemId: string; itemName: string; date: string; start: string; end: string; baseVersion: number },
  startValue: string,
): QueuedChange | string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startValue)) return "時間格式須為 HH:mm";
  const end = toMin(startValue) + (toMin(input.end) - toMin(input.start));
  if (end >= 24 * 60) return "結束時間不可超過當天";
  return {
    id: crypto.randomUUID(),
    tripId: input.tripId,
    itemId: input.itemId,
    itemName: input.itemName,
    date: input.date,
    start: startValue,
    end: toHhmm(end),
    baseVersion: input.baseVersion,
    queuedAt: new Date().toISOString(),
  };
}
