"use client";

import { useState } from "react";
import { shiftedChange, useOfflineQueue } from "./use-offline-queue";

// 項目詳情的「調整時間」：與離線當日行程相同，修改送出為待批准提案（SH-05），批准前不改動行程

export function AdjustTime(props: { tripId: string; itemId: string; itemName: string; date: string; start: string; end: string; baseVersion: number }) {
  const { queue, message, setMessage, add } = useOfflineQueue(props.tripId);
  const [editing, setEditing] = useState(false);
  const [startValue, setStartValue] = useState(props.start);

  const submit = async () => {
    const change = shiftedChange(props, startValue);
    if (typeof change === "string") {
      setMessage(change);
      return;
    }
    setEditing(false);
    await add(change);
  };

  return (
    <div className="adjust-time">
      {editing ? (
        <div className="today-edit">
          <label>
            新的開始時間
            <input value={startValue} onChange={(e) => setStartValue(e.target.value)} inputMode="numeric" placeholder="HH:mm" />
          </label>
          <button className="primary" type="button" onClick={() => void submit()}>
            送出修改
          </button>
          <button className="ghost" type="button" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      ) : (
        <button className="secondary" type="button" onClick={() => setEditing(true)}>
          調整時間
        </button>
      )}
      {message ? (
        <p role="status" className="today-message">
          {message}
        </p>
      ) : null}
      {queue.length > 0 ? <p className="muted">佇列中有 {queue.length} 項修改尚未送出</p> : null}
    </div>
  );
}
