"use client";

import { useActionState } from "react";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvite, null);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending}>
        加入行程
      </button>
      {state ? <p role="status">{state.message}</p> : null}
    </form>
  );
}
