"use client";

import { useActionState } from "react";
import { approveDay } from "./actions";

// T30：批准一天。時段由伺服器重新計算，表單只送出行程、日期與畫面上的版本

export function ApproveDayForm({
  tripId,
  date,
  baseVersion,
  label,
  mode,
}: {
  tripId: string;
  date: string;
  baseVersion: number;
  label: string;
  // hidden：已批准或沒有權限；blocked：仍有未通過的可行性檢查
  mode: "ready" | "blocked" | "hidden";
}) {
  const [state, action, pending] = useActionState(approveDay, null);
  if (mode === "hidden" && !state) return null;
  return (
    <form action={action} className="approve-day">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="baseVersion" value={String(baseVersion)} />
      {mode === "ready" ? (
        <button className="secondary" type="submit" disabled={pending}>
          {pending ? "批准中…" : `批准${label}`}
        </button>
      ) : null}
      {mode === "blocked" ? <p className="muted">這天仍有未通過的可行性檢查，處理後才能批准。</p> : null}
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
