"use server";

import { revalidatePath } from "next/cache";
import { tripSettingsDeps } from "../../../../lib/server/trip-edit";
import { parseSettingsForm, submitSettings, type TripEditResult } from "../../../../lib/server/trip-edit-core";

// 決策 0011：行程設定（只限 Owner）。Next.js 比對 Origin 與 Host；登入與速率限制在 trip-edit-core 內檢查（C-11）

export async function saveTripSettings(_previous: TripEditResult | null, form: FormData): Promise<TripEditResult> {
  const tripId = form.get("tripId");
  const parsed = parseSettingsForm(form);
  if (!parsed.ok) return parsed;
  const result = await submitSettings(await tripSettingsDeps(), tripId, parsed.input, form.get("confirmRemoval") === "1");
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}
