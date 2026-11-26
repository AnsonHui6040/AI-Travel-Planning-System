"use client";

import { useActionState } from "react";
import { runMorningCheck } from "./actions";

// T36：執行 Morning Check。完成後畫面重新載入，當日包隨之更新（Day Ready）

export function MorningCheckForm({ tripId, date, label }: { tripId: string; date: string; label: string }) {
  const [state, action, pending] = useActionState(runMorningCheck, null);
  return (
    <form action={action} className="morning-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="date" value={date} />
      <button type="submit" disabled={pending}>
        {pending ? "檢查中…" : label}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
