"use server";

import { revalidatePath } from "next/cache";
import { approveDayAction, type DayApprovalResult } from "../../../../lib/server/day-approval-core";
import { dayApprovalDeps } from "../../../../lib/server/day-approval";

// Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 day-approval-core 內檢查（C-11）

export async function approveDay(_previous: DayApprovalResult | null, form: FormData): Promise<DayApprovalResult> {
  const tripId = form.get("tripId");
  const result = await approveDayAction(await dayApprovalDeps(), tripId, form.get("date"), form.get("baseVersion"));
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}
