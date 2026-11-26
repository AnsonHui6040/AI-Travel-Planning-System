"use server";

import { revalidatePath } from "next/cache";
import { runMorningCheckAction, type MorningCheckActionResult } from "../../../../lib/server/morning-check-core";
import { morningCheckDeps } from "../../../../lib/server/morning-check";

// T36：Morning Check。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 morning-check-core 內檢查（C-11）

export async function runMorningCheck(_previous: MorningCheckActionResult | null, form: FormData): Promise<MorningCheckActionResult> {
  const tripId = form.get("tripId");
  const result = await runMorningCheckAction(await morningCheckDeps(), tripId, form.get("date"));
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/today`);
  return result;
}
