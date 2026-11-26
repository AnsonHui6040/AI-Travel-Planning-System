"use client";

import { useActionState } from "react";
import { produceTimeline, recordEntry } from "./actions";

// T39：記錄與產生 Actual Timeline。欄位都不受控（React 19 在 Server Action 後會重設表單）

const COMPLETIONS = [
  { value: "completed", label: "已完成" },
  { value: "partial", label: "部分完成" },
  { value: "skipped", label: "略過" },
];

export function RecordForm({ tripId, date, items, label }: { tripId: string; date: string; items: Array<{ id: string; name: string }>; label: string }) {
  const [state, action, pending] = useActionState(recordEntry, null);
  const only = items.length === 1 ? items[0] : undefined;
  return (
    <form action={action} className="timeline-record" aria-label={label}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="date" value={date} />
      {only ? (
        <input type="hidden" name="itemId" value={only.id} />
      ) : (
        <label>
          項目
          <select name="itemId" defaultValue={items[0]?.id}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        到達
        <input type="time" name="arrived" />
      </label>
      <label>
        離開
        <input type="time" name="departed" />
      </label>
      <label>
        狀態
        <select name="completion" defaultValue="completed">
          {COMPLETIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "記錄中…" : "記錄"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ProduceForm({ tripId, date }: { tripId: string; date: string }) {
  const [state, action, pending] = useActionState(produceTimeline, null);
  return (
    <form action={action} className="timeline-produce">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="date" value={date} />
      <button type="submit" disabled={pending}>
        {pending ? "產生中…" : "結束今天，產生 Actual Timeline"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
