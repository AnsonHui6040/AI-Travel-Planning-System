"use client";

import { useActionState } from "react";
import type { TripEditResult } from "../../../../lib/server/trip-edit-core";
import { saveTripSettings } from "./actions";

// 決策 0011：行程設定。縮短日期時以 window.confirm 確認（排在移除日期的項目移回候選清單）

const days = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

export function TripSettingsForm({
  tripId,
  name,
  destination,
  start,
  end,
}: {
  tripId: string;
  name: string;
  destination: string;
  start: string | null;
  end: string | null;
}) {
  const [state, action, pending] = useActionState<TripEditResult | null, FormData>(saveTripSettings, null);
  return (
    <form
      action={action}
      className="screen-form settings-form"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const nextStart = (form.elements.namedItem("start") as HTMLInputElement | null)?.value ?? "";
        const nextEnd = (form.elements.namedItem("end") as HTMLInputElement | null)?.value ?? "";
        const confirm = form.elements.namedItem("confirmRemoval") as HTMLInputElement | null;
        if (confirm) confirm.value = "";
        if (!start || !end || !nextStart || !nextEnd) return;
        const removed = (nextStart > start ? days(start, nextStart) - 1 : 0) + (nextEnd < end ? days(nextEnd, end) - 1 : 0);
        if (removed > 0) {
          if (!window.confirm(`移除 ${removed} 天？排在這些日期的項目會移回候選清單。`)) {
            event.preventDefault();
            return;
          }
          if (confirm) confirm.value = "1";
        }
      }}
    >
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="confirmRemoval" defaultValue="" />
      <div className="screen-body form-stack">
        <label>
          行程名稱
          <input name="name" maxLength={120} required defaultValue={name} autoComplete="off" />
        </label>
        <label>
          目的地
          <input name="destination" maxLength={120} defaultValue={destination} autoComplete="off" />
        </label>
        {start && end ? (
          <div className="field-pair">
            <label>
              開始日期
              <input name="start" type="date" required defaultValue={start} />
            </label>
            <label>
              結束日期
              <input name="end" type="date" required defaultValue={end} />
            </label>
          </div>
        ) : (
          <p className="muted">確認旅行基線後可以在這裡修改日期。</p>
        )}
        {state ? (
          <p role="status" className={state.ok ? undefined : "error"}>
            {state.message}
          </p>
        ) : null}
      </div>
      <div className="screen-actions">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "儲存中…" : "儲存"}
        </button>
      </div>
    </form>
  );
}
