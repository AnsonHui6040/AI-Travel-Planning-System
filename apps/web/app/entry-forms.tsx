"use client";

import { useActionState } from "react";
import { createTrip, sendMagicLink, signOutAction } from "./entry-actions";

// 登入、建立行程與登出的表單。欄位都不受控（React 19 在 Server Action 後會重設表單）

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendMagicLink, null);
  return (
    <form action={action} className="entry-form" aria-label="登入">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="login-email">電子郵件</label>
      <input id="login-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "寄送中…" : "寄送登入連結"}
      </button>
      {state ? (
        <p role="status" className={state.ok ? "ok" : "error"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function CreateTripForm() {
  const [state, action, pending] = useActionState(createTrip, null);
  return (
    <form action={action} className="entry-form" aria-label="建立行程">
      <label htmlFor="trip-name">行程名稱</label>
      <input id="trip-name" name="name" required maxLength={120} />
      <label htmlFor="trip-destination">目的地（可留空）</label>
      <input id="trip-destination" name="destination" maxLength={120} />
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "建立中…" : "建立行程"}
      </button>
      {state && !state.ok ? (
        <p role="status" className="error">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SignOutForm() {
  return (
    <form action={signOutAction}>
      <button className="ghost" type="submit">
        登出
      </button>
    </form>
  );
}
