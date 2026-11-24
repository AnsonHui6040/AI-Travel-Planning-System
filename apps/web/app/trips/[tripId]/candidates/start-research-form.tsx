"use client";

import { useActionState } from "react";
import { startResearch } from "./actions";

export function StartResearchForm({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(startResearch, null);
  return (
    <form action={action} className="research-start">
      <input type="hidden" name="tripId" value={tripId} />
      <button type="submit" disabled={pending}>
        {pending ? "正在開始…" : "開始研究"}
      </button>
      <p role="status" aria-live="polite" className={state && !state.ok ? "status error" : "status"}>
        {state?.message ?? ""}
      </p>
    </form>
  );
}
