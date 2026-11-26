"use client";

import { useActionState } from "react";
import { markAllRead, setReverify } from "./actions";

// T31：通知標為已讀、旅前自動再核實的開關。表單內沒有受控欄位（React 19 會在 Server Action 後重設表單）

export function MarkAllReadForm() {
  const [state, action, pending] = useActionState(markAllRead, null);
  return (
    <form action={action} className="inline-form">
      <button className="ghost" type="submit" disabled={pending}>
        全部標為已讀
      </button>
      {state && !state.ok ? <p role="status">{state.message}</p> : null}
    </form>
  );
}

export function ReverifyToggle({ tripId, enabled }: { tripId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(setReverify, null);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="value" value={enabled ? "off" : "on"} />
      <button className="secondary" type="submit" disabled={pending}>
        {enabled ? "關閉旅前自動再核實" : "開啟旅前自動再核實"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
