"use server";

import { revalidatePath } from "next/cache";
import { confirmBaselineAction, saveBaselineAction, type BaselineActionResult } from "../../../../lib/server/baseline-core";
import { baselineActionDeps } from "../../../../lib/server/baseline";

// Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 baseline-core 內檢查（C-11）

export async function saveBaseline(_previous: BaselineActionResult | null, form: FormData): Promise<BaselineActionResult> {
  const tripId = form.get("tripId");
  const result = await saveBaselineAction(await baselineActionDeps(), tripId, form.get("data"));
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/baseline`);
  return result;
}

export async function confirmBaseline(_previous: BaselineActionResult | null, form: FormData): Promise<BaselineActionResult> {
  const tripId = form.get("tripId");
  const result = await confirmBaselineAction(await baselineActionDeps(), tripId);
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/baseline`);
  return result;
}
