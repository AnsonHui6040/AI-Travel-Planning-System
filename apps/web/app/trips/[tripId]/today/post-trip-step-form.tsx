"use client";

import { useActionState, type ReactNode } from "react";
import { savePostTripStatus } from "../post-trip/actions";

// T40：「現在」一次標記一個項目。選項不受控（React 19 在 Server Action 後會重設表單）；
// 表單包住整個畫面內容，主要按鈕在下方的動作列

export function PostTripStepForm({
  tripId,
  itemId,
  name,
  options,
  children,
  secondary,
}: {
  tripId: string;
  itemId: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  children: ReactNode;
  secondary: ReactNode;
}) {
  const [state, action, pending] = useActionState(savePostTripStatus, null);
  return (
    <form action={action} aria-label={`旅後狀態 ${name}`} className="screen-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="itemId" value={itemId} />
      <section aria-label="旅後狀態" className="screen-body step-card">
        {children}
        <fieldset className="choices">
          <legend>旅後狀態</legend>
          {options.map((o, i) => (
            <label key={o.value}>
              <input type="radio" name="status" value={o.value} defaultChecked={i === 0} />
              {o.label}
            </label>
          ))}
        </fieldset>
        {state && !state.ok ? (
          <p role="status" className="error">
            {state.message}
          </p>
        ) : null}
      </section>
      <div className="screen-actions">
        {secondary}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "儲存中…" : "儲存，下一項"}
        </button>
      </div>
    </form>
  );
}
