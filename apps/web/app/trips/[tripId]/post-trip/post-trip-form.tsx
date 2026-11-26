"use client";

import { useActionState } from "react";
import { savePostTripStatus } from "./actions";

// T40：標記一個項目的旅後狀態。欄位不受控（React 19 在 Server Action 後會重設表單）

export function PostTripStatusForm({
  tripId,
  itemId,
  name,
  current,
  options,
}: {
  tripId: string;
  itemId: string;
  name: string;
  current: string | null;
  options: Array<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(savePostTripStatus, null);
  return (
    <form action={action} className="post-trip-form" aria-label={`旅後狀態 ${name}`}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="itemId" value={itemId} />
      <label>
        旅後狀態
        <select name="status" defaultValue={current && options.some((o) => o.value === current) ? current : options[0]?.value}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "儲存中…" : "儲存"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
