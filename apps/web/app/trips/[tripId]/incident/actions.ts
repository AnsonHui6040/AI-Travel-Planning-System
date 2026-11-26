"use server";

import { redirect } from "next/navigation";
import { startIncidentAction, type IncidentActionResult } from "../../../../lib/server/incident-core";
import { incidentDeps } from "../../../../lib/server/incident";

// T38：進入 Incident Mode。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 incident-core 內檢查（C-11）

export async function startIncident(_previous: IncidentActionResult | null, form: FormData): Promise<IncidentActionResult> {
  // 只取表單欄位（略過 Next.js 的內部欄位）
  const raw = Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string"));
  const result = await startIncidentAction(await incidentDeps(), raw);
  if (result.ok && result.incidentId && typeof raw.tripId === "string") redirect(`/trips/${raw.tripId}/incident/${result.incidentId}`);
  return result;
}
