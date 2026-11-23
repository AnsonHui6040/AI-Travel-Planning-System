"use server";

import { revalidatePath } from "next/cache";
import { sensitiveFieldAction, type ActionResult } from "../../../../lib/server/sensitive-fields-core";
import { sensitiveActionDeps } from "../../../../lib/server/sensitive-fields";

// Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 sensitiveFieldAction 內檢查（C-11）
export async function submitSensitiveField(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const result = await sensitiveFieldAction(await sensitiveActionDeps(), form);
  const tripId = form.get("tripId");
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/my-info`);
  return result;
}
